const Redis = require('ioredis');
const { logger } = require('../logger');

const redis = new Redis(process.env.REDIS_URL, {
  tls: { rejectUnauthorized: false },
  maxRetriesPerRequest: 3,
});

redis.on('connect', () => logger.info('Redis connected'));
redis.on('error', (err) => logger.error('Redis error', { error: err.message }));

async function disconnectRedis() {
  await redis.quit();
}

module.exports = { redis, disconnectRedis };
