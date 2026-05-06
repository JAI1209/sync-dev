const REQUIRED = ["JWT_SECRET", "MONGODB_URI", "EXEC_SERVICE_SECRET"];
const RECOMMENDED = ["REDIS_URL", "CLIENT_ORIGIN", "SENTRY_DSN"];

function validateEnv() {
  const missing = REQUIRED.filter((key) => !process.env[key]);
  if (missing.length) {
    console.error(`[Startup] Missing required env vars: ${missing.join(", ")}`);
    process.exit(1);
  }

  const absent = RECOMMENDED.filter((key) => !process.env[key]);
  if (absent.length) {
    console.warn(`[Startup] Missing recommended env vars: ${absent.join(", ")}`);
  }
}

module.exports = validateEnv;
