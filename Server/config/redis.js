const Redis = require("ioredis");
const { logger } = require("../logger");

const redisUrl = process.env.REDIS_URL || "redis://127.0.0.1:6379";
const useTls = redisUrl.startsWith("rediss://") || process.env.REDIS_TLS === "true";

const redisOptions = {
  lazyConnect: true,
  maxRetriesPerRequest: 3,
  ...(useTls ? { tls: { rejectUnauthorized: false } } : {}),
};

const redis = new Redis(redisUrl, redisOptions);

redis.on("connect", () => logger.info("Redis connected"));
redis.on("error", (err) => logger.error("Redis error", { error: err?.message || "unknown" }));

async function ensureRedisConnection() {
  if (redis.status === "ready" || redis.status === "connect") {
    return true;
  }

  try {
    await redis.connect();
    return true;
  } catch (err) {
    logger.error("Redis connect failed", { error: err?.message || "unknown" });
    return false;
  }
}

async function disconnectRedis() {
  if (redis.status === "end") return;

  try {
    await redis.quit();
  } catch {
    redis.disconnect();
  }
}

module.exports = { redis, redisOptions, ensureRedisConnection, disconnectRedis };