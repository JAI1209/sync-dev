const Docker = require("dockerode");

const socketPath = process.env.DOCKER_SOCKET || "/var/run/docker.sock";

let docker;
if (socketPath.startsWith("tcp://")) {
  const tcpUrl = new URL(socketPath);
  docker = new Docker({
    host: tcpUrl.hostname,
    port: Number(tcpUrl.port) || 2375,
    protocol: "http",
  });
} else if (socketPath.startsWith("npipe://") || socketPath.startsWith("//./pipe/")) {
  docker = new Docker({ socketPath });
} else {
  docker = new Docker({ socketPath });
}

const MEMORY_MB = Number(process.env.CONTAINER_MEMORY_MB || 256);
const CPU_QUOTA = Number(process.env.CONTAINER_CPU_QUOTA || 50000);
const IDLE_TTL_MS = Number(process.env.CONTAINER_IDLE_TTL_MS || 300000);

const IMAGE_MAP = {
  javascript: "syncdev-sandbox:node20",
  typescript: "syncdev-sandbox:node20",
  tsx: "syncdev-sandbox:node20",
  python: "syncdev-sandbox:python312",
  shell: "syncdev-sandbox:node20",
};

const pool = new Map();

function imageForLanguage(language = "javascript") {
  return IMAGE_MAP[String(language).toLowerCase()] || IMAGE_MAP.javascript;
}

async function isRunning(container) {
  try {
    const info = await container.inspect();
    return Boolean(info?.State?.Running);
  } catch {
    return false;
  }
}

/**
 * Get or create a sandbox container for a room.
 * Reuses existing running container if image matches.
 * @param {string} roomId
 * @param {string} language
 * @returns {Promise<import("dockerode").Container>}
 */
async function getOrCreate(roomId, language = "javascript") {
  const image = imageForLanguage(language);

  if (pool.has(roomId)) {
    const entry = pool.get(roomId);
    if (entry.image === image && (await isRunning(entry.container))) {
      entry.lastUsed = Date.now();
      return entry.container;
    }
    await destroy(roomId);
  }

  const container = await docker.createContainer({
    Image: image,
    Tty: false,
    AttachStdout: true,
    AttachStderr: true,
    OpenStdin: true,
    StdinOnce: false,
    WorkingDir: "/workspace",
    HostConfig: {
      Memory: MEMORY_MB * 1024 * 1024,
      MemorySwap: MEMORY_MB * 1024 * 1024,
      CpuQuota: CPU_QUOTA,
      CpuPeriod: 100000,
      NetworkMode: "none",
      ReadonlyRootfs: false,
      SecurityOpt: ["no-new-privileges"],
      CapDrop: ["ALL"],
      PidsLimit: 64,
      AutoRemove: false,
    },
  });

  await container.start();
  pool.set(roomId, { container, image, lastUsed: Date.now() });
  console.log(`[Pool] Created container for room ${roomId} (${image})`);
  return container;
}

async function destroy(roomId) {
  if (!pool.has(roomId)) return;
  const { container } = pool.get(roomId);
  pool.delete(roomId);
  try {
    if (await isRunning(container)) {
      await container.stop({ t: 2 });
    }
    await container.remove({ force: true });
    console.log(`[Pool] Destroyed container for room ${roomId}`);
  } catch (err) {
    console.error(`[Pool] Cleanup error for ${roomId}:`, err.message);
  }
}

function pruneIdle() {
  const now = Date.now();
  for (const [roomId, entry] of pool.entries()) {
    if (now - entry.lastUsed > IDLE_TTL_MS) {
      console.log(`[Pool] Pruning idle container for room ${roomId}`);
      destroy(roomId).catch(() => {});
    }
  }
}

async function destroyAll() {
  for (const [roomId] of pool.entries()) {
    await destroy(roomId).catch(() => {});
  }
}

module.exports = {
  getOrCreate,
  destroy,
  pruneIdle,
  destroyAll,
  docker,
  IMAGE_MAP,
};
