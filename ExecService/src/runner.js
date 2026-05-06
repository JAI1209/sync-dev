const path = require("path");
const tar = require("tar-stream");
const { Writable } = require("stream");

function normalizeArchivePath(filePath) {
  const normalized = path.posix
    .normalize(String(filePath || "").replace(/\\/g, "/").replace(/^\/+/, ""))
    .replace(/^(\.\.\/)+/, "");

  if (!normalized || normalized === "." || normalized.startsWith("../") || path.posix.isAbsolute(normalized)) {
    return null;
  }
  return normalized;
}

async function uploadFiles(container, files) {
  const pack = tar.pack();

  for (const [filePath, content] of Object.entries(files || {})) {
    const name = normalizeArchivePath(filePath);
    if (!name) continue;
    pack.entry({ name }, String(content ?? ""));
  }
  pack.finalize();

  await container.putArchive(pack, { path: "/workspace" });
}

/**
 * Upload files into container /workspace and run a command.
 * Streams stdout/stderr via send callback.
 * @param {import("dockerode").Container} container
 * @param {Record<string, string>} files
 * @param {string} command
 * @param {{ send: (type: string, payload: string) => void }} opts
 */
async function exec(container, files, command, { send }) {
  await uploadFiles(container, files);

  const processExec = await container.exec({
    Cmd: ["sh", "-c", command],
    AttachStdout: true,
    AttachStderr: true,
    WorkingDir: "/workspace",
  });

  const stream = await processExec.start({ hijack: true, stdin: false });
  const raw = process.env.CONTAINER_TIMEOUT_MS;
  const timeoutMs = raw !== undefined && raw !== "" ? Number(raw) : 30000;

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      fn?.();
      resolve();
    };

    const stdout = new Writable({
      write(chunk, _encoding, callback) {
        send("stdout", chunk.toString("utf8"));
        callback();
      },
    });

    const stderr = new Writable({
      write(chunk, _encoding, callback) {
        send("stderr", chunk.toString("utf8"));
        callback();
      },
    });

    container.modem.demuxStream(stream, stdout, stderr);

    const timer = timeoutMs > 0
      ? setTimeout(async () => {
          if (settled) return;
          send("stderr", `\r\n[SyncDev] Process killed - ${timeoutMs / 1000}s timeout exceeded\r\n`);
          send("exit", "124");
          try { await container.kill(); } catch { /* already stopped */ }
          finish();
        }, timeoutMs)
      : null;

    stream.on("end", async () => {
      try {
        const inspect = await processExec.inspect();
        send("exit", String(inspect.ExitCode ?? 0));
      } catch {
        send("exit", "0");
      }
      finish();
    });

    stream.on("error", (err) => {
      if (settled) return;
      if (timer) clearTimeout(timer);
      settled = true;
      reject(err);
    });
  });
}

module.exports = { exec, uploadFilesToContainer: uploadFiles };
