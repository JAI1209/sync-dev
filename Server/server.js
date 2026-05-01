const Sentry = require("@sentry/node");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  enabled: !!process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV || "development",
  tracesSampleRate: 0.1,
});
const express = require("express");
const http = require("http");
const mongoose = require("mongoose");
const cors = require("cors");
const authRoutes = require("./routes/Auth");
const githubOAuthRoutes = require("./routes/githubOAuth");
const githubImportRoutes = require("./routes/githubImport");
const executeRoutes = require("./routes/execute");
const aiRoutes = require("./routes/ai");
const snapshotRoutes = require("./routes/snapshots");
const rbacRoutes = require("./routes/rbac");
const roomRoutes = require("./routes/rooms");
const { morganMiddleware, logger } = require("./logger");
const { rateLimitMiddleware, sanitizeInput, securityHeaders } = require("./middleware/security");
const { connectDB } = require("./config/db");
const { disconnectRedis } = require("./config/redis");
const { initSocket } = require("./socket");
const roomService = require("./services/roomService");

const app = express();
const server = http.createServer(app);

const CORS_ORIGINS = (process.env.CLIENT_ORIGIN || process.env.CORS_ORIGINS || "http://localhost:5173")
  .split(",")
  .map((o) => o.trim());

app.use(cors({
  origin: function(origin, callback) {
    if (!origin || CORS_ORIGINS.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`CORS: origin ${origin} not allowed`));
    }
  },
  credentials: true,
}));
app.use(morganMiddleware);
app.use(securityHeaders);
app.use(sanitizeInput);
app.use(express.json({ limit: "32mb" }));

// Rate limiting for auth routes (stricter)
app.use("/api/auth/login", rateLimitMiddleware("login"));
app.use("/api/auth/register", rateLimitMiddleware("register"));
app.use("/api/auth/forgot", rateLimitMiddleware("forgotPassword"));

// General API rate limiting
app.use("/api", rateLimitMiddleware("api"));

app.use("/api/auth", authRoutes);
app.use("/api/ai", aiRoutes);
app.use("/api/snapshots", snapshotRoutes);
app.use("/api/rbac", rbacRoutes);
app.use("/api/rooms", roomRoutes);
app.use("/api/auth/github", githubOAuthRoutes);
app.use("/api/github", githubImportRoutes);
app.use("/api/execute", executeRoutes);

Sentry.setupExpressErrorHandler(app);

// ── Room state ─────────────────────────────────────────────────────────────────
// Room lifecycle and socket event handling are now managed in Server/socket.
// The module initializes Socket.IO, authenticates sockets, and registers room events.

// ── MongoDB + server start ────────────────────────────────────────────────────
const LISTEN_PORT = Number(process.env.PORT || 3000);

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    logger.error("Port already in use", {
      port: LISTEN_PORT,
      hint: "Another server is already running on this port. Stop it or reuse the existing instance.",
    });
    process.exit(1);
  }

  logger.error("Server listen failed", { error: err.message, code: err.code });
  process.exit(1);
});

async function startServer() {
  try {
    await connectDB();
    const io = await initSocket(server);
    app.set("io", io);
    server.listen(LISTEN_PORT, () => logger.info("Server running", { port: LISTEN_PORT }));
  } catch (err) {
    logger.error("Startup failed", { error: err.message });
    process.exit(1);
  }
}

startServer();
process.on("SIGINT", async () => {
  await mongoose.connection.close();
  await disconnectRedis();
  process.exit(0);
});

