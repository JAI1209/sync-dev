const pool = require("./containerPool");

function startIdleCleanup() {
  const interval = setInterval(() => {
    pool.pruneIdle();
  }, 60000);
  interval.unref?.();
  return () => clearInterval(interval);
}

module.exports = { startIdleCleanup };
