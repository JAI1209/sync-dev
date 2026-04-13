/**
 * Security Middleware
 * Rate limiting, input sanitization, and security headers
 */

const rateLimit = new Map();
const BLOCKED_IPS = new Set();

// Rate limit configuration
const RATE_LIMITS = {
  // Auth endpoints - stricter
  login: { window: 15 * 60 * 1000, max: 5 },      // 5 attempts per 15 min
  register: { window: 60 * 60 * 1000, max: 3 },    // 3 per hour
  forgotPassword: { window: 60 * 60 * 1000, max: 3 },

  // General API
  api: { window: 60 * 1000, max: 60 },            // 60 per minute
  socket: { window: 60 * 1000, max: 100 },        // 100 socket events per min
};

/**
 * Rate limiting middleware
 */
function rateLimitMiddleware(type = "api") {
  const config = RATE_LIMITS[type] || RATE_LIMITS.api;

  return (req, res, next) => {
    const key = `${req.ip}:${type}`;
    const now = Date.now();

    // Check if IP is blocked
    if (BLOCKED_IPS.has(req.ip)) {
      return res.status(403).json({ msg: "IP blocked due to suspicious activity" });
    }

    // Get or create rate limit entry
    let entry = rateLimit.get(key);
    if (!entry || now > entry.resetTime) {
      entry = {
        count: 0,
        resetTime: now + config.window,
      };
    }

    // Check limit
    if (entry.count >= config.max) {
      const retryAfter = Math.ceil((entry.resetTime - now) / 1000);
      res.setHeader("Retry-After", retryAfter);
      return res.status(429).json({
        msg: "Too many requests",
        retryAfter,
      });
    }

    // Increment counter
    entry.count++;
    rateLimit.set(key, entry);

    // Add rate limit headers
    res.setHeader("X-RateLimit-Limit", config.max);
    res.setHeader("X-RateLimit-Remaining", Math.max(0, config.max - entry.count));

    next();
  };
}

/**
 * Input sanitization middleware
 * Prevents NoSQL injection and XSS
 * BUG 14 FIX: Skip sanitization for routes that handle user code
 */
function sanitizeInput(req, res, next) {
  // Skip sanitization for code execution and GitHub import routes
  // These routes handle user code that may contain MongoDB operators
  const skipPaths = ['/api/execute', '/api/github'];
  if (skipPaths.some(path => req.path.startsWith(path))) {
    return next();
  }

  // Sanitize string inputs
  const sanitize = (obj) => {
    if (typeof obj === "string") {
      // Remove potential NoSQL operators
      return obj
        .replace(/\$\{.*\}/g, "") // Template literals
        .replace(/\$gt|\$gte|\$lt|\$lte|\$ne|\$eq|\$in|\$nin|\$regex|\$where/g, "")
        .trim();
    }
    if (typeof obj === "object" && obj !== null) {
      if (Array.isArray(obj)) {
        return obj.map(sanitize);
      }
      const sanitized = {};
      for (const [key, value] of Object.entries(obj)) {
        // Skip keys starting with $ (NoSQL operators)
        if (!key.startsWith("$")) {
          sanitized[key] = sanitize(value);
        }
      }
      return sanitized;
    }
    return obj;
  };

  req.body = sanitize(req.body);
  req.query = sanitize(req.query);
  req.params = sanitize(req.params);

  next();
}

/**
 * Security headers middleware
 */
function securityHeaders(req, res, next) {
  // Prevent clickjacking
  res.setHeader("X-Frame-Options", "DENY");

  // XSS protection
  res.setHeader("X-XSS-Protection", "1; mode=block");

  // Content type sniffing
  res.setHeader("X-Content-Type-Options", "nosniff");

  // Referrer policy
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");

  // HSTS (uncomment in production with HTTPS)
  // res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");

  next();
}

/**
 * Block IP address
 */
function blockIP(ip) {
  BLOCKED_IPS.add(ip);
  console.log(`[Security] Blocked IP: ${ip}`);
}

/**
 * Clean up old rate limit entries periodically
 */
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimit.entries()) {
    if (now > entry.resetTime) {
      rateLimit.delete(key);
    }
  }
}, 5 * 60 * 1000); // Clean every 5 minutes

module.exports = {
  rateLimitMiddleware,
  sanitizeInput,
  securityHeaders,
  blockIP,
};
