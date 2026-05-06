require("dotenv").config();

const path = require("path");
const express = require("express");
const { v4: uuidv4 } = require("uuid");
const pool = require("./containerPool");
const runner = require("./runner");
const { startIdleCleanup } = require("./cleanup");

const app = express();
const INTERNAL_SECRET = process.env.EXEC_SERVICE_SECRET;

app.use(express.json({ limit: "32mb" }));

app.use((req, res, next) => {
  if (!INTERNAL_SECRET) {
    console.error("[ExecService] EXEC_SERVICE_SECRET is not set. Refusing all requests.");
    return res.status(500).json({ error: "Server misconfiguration: secret not set" });
  }
  if (req.headers["x-internal-secret"] !== INTERNAL_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
});

app.post("/execute", async (req, res) => {
  const { roomId, files, command, language } = req.body;
  if (!roomId || !files) {
    return res.status(400).json({ error: "roomId and files are required" });
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const requestId = uuidv4();
  const send = (type, payload) => {
    res.write(`data: ${JSON.stringify({ type, payload, requestId })}\n\n`);
  };

  if (!command) {
    send(
      "stderr",
      "\r\n[SyncDev] No run command provided.\r\nEnter a command in the toolbar or open a runnable file.\r\n"
    );
    res.write("data: [DONE]\n\n");
    res.end();
    return;
  }

  try {
    const container = await pool.getOrCreate(roomId, language);
    await runner.exec(container, files, command, { send });
  } catch (err) {
    send("stderr", `\r\n[Exec error] ${err.message}\r\n`);
  } finally {
    res.write("data: [DONE]\n\n");
    res.end();
  }
});

app.delete("/container/:roomId", async (req, res) => {
  await pool.destroy(req.params.roomId);
  res.json({ ok: true });
});

app.get("/health", (_req, res) => res.json({ ok: true }));

async function prebuildImages() {
  const images = [
    { tag: "syncdev-sandbox:node20", dockerfile: "images/node20.Dockerfile" },
    { tag: "syncdev-sandbox:python312", dockerfile: "images/python312.Dockerfile" },
  ];

  for (const { tag, dockerfile } of images) {
    try {
      await pool.docker.getImage(tag).inspect();
      console.log(`[ExecService] Image ${tag} already present`);
    } catch {
      console.log(`[ExecService] Building image ${tag}...`);
      const stream = await pool.docker.buildImage(
        { context: path.join(__dirname, ".."), src: [dockerfile] },
        { t: tag, dockerfile }
      );
      await new Promise((resolve, reject) =>
        pool.docker.modem.followProgress(stream, (err) => (err ? reject(err) : resolve()))
      );
      console.log(`[ExecService] Built ${tag}`);
    }
  }
}

const PORT = Number(process.env.PORT || 4000);

prebuildImages()
  .then(() => {
    startIdleCleanup();
    app.listen(PORT, () => console.log(`[ExecService] listening on :${PORT}`));
  })
  .catch((err) => {
    console.error("[ExecService] Failed to prepare sandbox images:", err.message);
    process.exit(1);
  });
