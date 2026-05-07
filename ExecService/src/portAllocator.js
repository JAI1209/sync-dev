const Redis = require("ioredis");
const net = require("net");

const MIN_PORT = 20000;
const MAX_PORT = 20999;
const PORT_KEY = "execservice:allocated_ports";
const allocatedPorts = new Set();

const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379", {
  lazyConnect: true,
  enableOfflineQueue: false,
  maxRetriesPerRequest: 0,
  retryStrategy(times) {
    if (times > 3) return null;
    return Math.min(times * 100, 1000);
  },
});

redis.on("error", (err) => {
  console.warn("[portAllocator] Redis error:", err.message);
});

let connectAttempted = false;

async function ensureRedisReady() {
  if (redis.status === "ready") return true;
  if (redis.status === "connecting") return false;
  if (connectAttempted && redis.status !== "wait") return false;

  connectAttempted = true;
  try {
    await redis.connect();
    return redis.status === "ready";
  } catch (_err) {
    return false;
  }
}

function isPortFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(false));
    srv.once("listening", () => srv.close(() => resolve(true)));
    srv.listen(port, "0.0.0.0");
  });
}

async function allocatePort() {
  const redisReady = await ensureRedisReady();

  for (let p = MIN_PORT; p <= MAX_PORT; p += 1) {
    const reserved = redisReady ? await redis.sismember(PORT_KEY, p) : allocatedPorts.has(p);
    if (reserved) continue;
    if (!(await isPortFree(p))) continue;

    if (redisReady) {
      const added = await redis.sadd(PORT_KEY, p);
      if (added === 1) return p;
      continue;
    }

    allocatedPorts.add(p);
    return p;
  }

  throw new Error("No free ports in range 20000–20999");
}

function releasePort(port) {
  const numericPort = Number(port);
  allocatedPorts.delete(numericPort);          // always clean local set immediately
  ensureRedisReady().then((redisReady) => {
    if (redisReady) {
      redis.srem(PORT_KEY, numericPort).catch((err) => {
        console.warn("[portAllocator] Failed to release port from Redis:", err.message);
      });
    }
  });
}

module.exports = { allocatePort, releasePort };
