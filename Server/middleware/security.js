/**
 * Security Middleware
 * Rate limiting (Redis-backed), input sanitization, security headers
 */

const { redis } = require('../config/redis');
const { logger } = require('../logger');

const RATE_LIMITS = {
  login:          { window: 15 * 60, max: 5 },   // 5 per 15 min
  register:       { window: 60 * 60, max: 3 },   // 3 per hour
  forgotPassword: { window: 60 * 60, max: 3 },
  api:            { window: 60,      max: 60 },   // 60 per minute
  socket:         { window: 60,      max: 100 },
};

function rateLimitMiddleware(type = 'api') {
  const config = RATE_LIMITS[type] || RATE_LIMITS.api;

  return async (req, res, next) => {
    const key = `ratelimit:http:${type}:${req.ip}`;
    try {
      const count = await redis.incr(key);
      if (count === 1) await redis.expire(key, config.window);

      const ttl = await redis.ttl(key);
      res.setHeader('X-RateLimit-Limit', config.max);
      res.setHeader('X-RateLimit-Remaining', Math.max(0, config.max - count));

      if (count > config.max) {
        return res.status(429).json({ msg: 'Too many requests', retryAfter: ttl });
      }
    } catch (err) {
      // Redis down — fail open so the app keeps working
      logger.error('Rate limit Redis error', { error: err.message });
    }
    next();
  };
}

function sanitizeInput(req, res, next) {
  const skipPaths = ['/api/execute', '/api/github'];
  if (skipPaths.some(p => req.path.startsWith(p))) return next();

  const sanitize = (obj) => {
    if (typeof obj === 'string') {
      return obj
        .replace(/\$\{.*\}/g, '')
        .replace(/\$gt|\$gte|\$lt|\$lte|\$ne|\$eq|\$in|\$nin|\$regex|\$where/g, '')
        .trim();
    }
    if (typeof obj === 'object' && obj !== null) {
      if (Array.isArray(obj)) return obj.map(sanitize);
      const out = {};
      for (const [k, v] of Object.entries(obj)) {
        if (!k.startsWith('$')) out[k] = sanitize(v);
      }
      return out;
    }
    return obj;
  };

  req.body   = sanitize(req.body);
  req.query  = sanitize(req.query);
  req.params = sanitize(req.params);
  next();
}

function securityHeaders(req, res, next) {
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  next();
}

module.exports = { rateLimitMiddleware, sanitizeInput, securityHeaders };
