require("dotenv").config();

const path = require("path");
const express = require("express");
const { v4: uuidv4 } = require("uuid");
const { WebSocketServer } = require("ws");
const pool = require("./containerPool");
const runner = require("./runner");
const { startIdleCleanup } = require("./cleanup");
const { uploadFilesToContainer } = require("./runner");
const { allocatePort, releasePort } = require("./portAllocator");
const pty = require("node-pty");

const app = express();
const INTERNAL_SECRET = process.env.EXEC_SERVICE_SECRET;
const sessions = new Map();

app.use(express.json({ limit: "32mb" }));
app.use((req, res, next) => {
  if (!INTERNAL_SECRET) return res.status(500).json({ error: "Server misconfiguration: secret not set" });
  if (req.headers["x-internal-secret"] !== INTERNAL_SECRET) return res.status(401).json({ error: "Unauthorized" });
  next();
});

app.post("/execute", async (req, res) => { /* unchanged behavior */
  const { roomId, files, command, language } = req.body;
  if (!roomId || !files) return res.status(400).json({ error: "roomId and files are required" });
  res.setHeader("Content-Type", "text/event-stream");res.setHeader("Cache-Control", "no-cache");res.setHeader("Connection", "keep-alive");res.flushHeaders();
  const requestId = uuidv4();
  const send = (type, payload) => res.write(`data: ${JSON.stringify({ type, payload, requestId })}\n\n`);
  if (!command) { send("stderr", "\r\n[SyncDev] No run command provided.\r\n");res.write("data: [DONE]\n\n");return res.end(); }
  try { const container = await pool.getOrCreate(roomId, language); await runner.exec(container, files, command, { send }); }
  catch (err) { send("stderr", `\r\n[Exec error] ${err.message}\r\n`); }
  finally { res.write("data: [DONE]\n\n"); res.end(); }
});

app.post('/terminal/start', async (req, res) => {
  const { roomId, language } = req.body;
  if (!roomId) return res.status(400).json({ error: 'roomId required' });
  if (sessions.has(roomId)) return res.json({ ok: true, ports: sessions.get(roomId).ports, sessionId: sessions.get(roomId).sessionId });
  const ports = { 3000: await allocatePort(), 5173: await allocatePort(), 8000: await allocatePort(), 8080: await allocatePort() };
  const image = language === 'python' ? 'syncdev-sandbox:python312' : 'syncdev-sandbox:node20';
  const container = await pool.docker.createContainer({
    Image: image, Tty: true, AttachStdin: true, AttachStdout: true, AttachStderr: true, OpenStdin: true, Cmd: ['/bin/bash'], WorkingDir: '/workspace',
    HostConfig: { Memory: 512 * 1024 * 1024, MemorySwap: 512 * 1024 * 1024, CpuQuota: 100000, CpuPeriod: 100000, NetworkMode: 'bridge', ReadonlyRootfs: false,
      SecurityOpt: ['no-new-privileges'], CapDrop: ['ALL'], CapAdd: ['CHOWN', 'SETUID', 'SETGID'], PidsLimit: 256, AutoRemove: false,
      PortBindings: { '3000/tcp': [{ HostPort: String(ports[3000]) }], '5173/tcp': [{ HostPort: String(ports[5173]) }], '8000/tcp': [{ HostPort: String(ports[8000]) }], '8080/tcp': [{ HostPort: String(ports[8080]) }] } },
    ExposedPorts: { '3000/tcp': {}, '5173/tcp': {}, '8000/tcp': {}, '8080/tcp': {} },
  });
  await container.start();
  const sessionId = uuidv4();
  sessions.set(roomId, { sessionId, container, ports, ptyProcess: null });
  res.json({ ok: true, ports, sessionId });
});

app.delete('/terminal/:roomId', async (req, res) => {
  const { roomId } = req.params; const session = sessions.get(roomId);
  if (session) { session.ptyProcess?.kill(); try { await session.container.stop({ t: 2 }); await session.container.remove({ force: true }); } catch {} Object.values(session.ports || {}).forEach((port) => releasePort(port)); sessions.delete(roomId); }
  res.json({ ok: true });
});

app.delete('/container/:roomId', async (req, res) => { await pool.destroy(req.params.roomId); res.json({ ok: true }); });
app.get('/health', (_req, res) => res.json({ ok: true }));

const PORT = Number(process.env.PORT || 4000);

async function prebuildImages() { /* unchanged */
  const images = [{ tag: 'syncdev-sandbox:node20', dockerfile: 'images/node20.Dockerfile' }, { tag: 'syncdev-sandbox:python312', dockerfile: 'images/python312.Dockerfile' }];
  for (const { tag, dockerfile } of images) { try { await pool.docker.getImage(tag).inspect(); } catch { const stream = await pool.docker.buildImage({ context: path.join(__dirname, '..'), src: [dockerfile] }, { t: tag, dockerfile }); await new Promise((resolve, reject) => pool.docker.modem.followProgress(stream, (err) => (err ? reject(err) : resolve()))); } }
}

prebuildImages().then(() => {
  startIdleCleanup();
  const httpServer = app.listen(PORT, () => console.log(`[ExecService] listening on :${PORT}`));
  const wss = new WebSocketServer({ server: httpServer, path: '/terminal/ws' });
  wss.on('connection', (ws, req) => {
    const url = new URL(req.url, 'http://localhost');
    const roomId = url.searchParams.get('roomId');
    if (url.searchParams.get('secret') !== INTERNAL_SECRET) return ws.close(4001, 'Unauthorized');
    const session = sessions.get(roomId);
    if (!session) return ws.close(4004, 'No session for this room');
    let filesLoaded = false;
    ws.on('message', async (data) => {
      if (!filesLoaded) {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'init') {
            filesLoaded = true;
            await uploadFilesToContainer(session.container, msg.files || {});
            const ptyProcess = pty.spawn('docker', ['exec', '-it', session.container.id, '/bin/bash'], { name: 'xterm-256color', cols: msg.cols || 120, rows: msg.rows || 30, env: { ...process.env, TERM: 'xterm-256color', HOME: '/workspace', PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin' } });
            session.ptyProcess = ptyProcess;
            ptyProcess.onData((chunk) => ws.readyState === ws.OPEN && ws.send(JSON.stringify({ type: 'output', data: chunk })));
            ptyProcess.onExit(({ exitCode }) => { if (ws.readyState === ws.OPEN) { ws.send(JSON.stringify({ type: 'exit', code: exitCode })); ws.close(); } });
            ws.send(JSON.stringify({ type: 'ready', ports: session.ports }));
            return;
          }
        } catch {}
      }
      try { const msg = JSON.parse(data.toString()); if (msg.type === 'input') session.ptyProcess?.write(msg.data); else if (msg.type === 'resize') session.ptyProcess?.resize(msg.cols, msg.rows); }
      catch { session.ptyProcess?.write(data.toString()); }
    });
  });
}).catch((err) => { console.error('[ExecService] Failed to prepare sandbox images:', err.message); });


async function shutdown(signal) {
  console.log(`[ExecService] ${signal} received, cleaning up...`);
  for (const [roomId, session] of sessions.entries()) {
    session.ptyProcess?.kill();
    try { await session.container.stop({ t: 2 }); await session.container.remove({ force: true }); } catch {}
    Object.values(session.ports || {}).forEach((port) => releasePort(port));
    sessions.delete(roomId);
  }
  await pool.destroyAll();
  process.exit(0);
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
