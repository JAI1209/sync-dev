const Redis = require("ioredis");
const net = require("net");

const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379");
const MIN_PORT = 3001;
const MAX_PORT = 3999;
const PORT_KEY = "execservice:allocated_ports";

function isPortFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(false));
    srv.once("listening", () => srv.close(() => resolve(true)));
    srv.listen(port, "0.0.0.0");
  });
}

async function allocatePort() {
  for (let p = MIN_PORT; p <= MAX_PORT; p += 1) {
    const reserved = await redis.sismember(PORT_KEY, p);
    if (reserved) continue;
    if (!(await isPortFree(p))) continue;
    const added = await redis.sadd(PORT_KEY, p);
    if (added === 1) return p;
  }
  throw new Error("No free ports in range 3001–3999");
}

async function releasePort(port) {
  await redis.srem(PORT_KEY, Number(port));
}

module.exports = { allocatePort, releasePort };
