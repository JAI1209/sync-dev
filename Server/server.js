const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });
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
const { morganMiddleware, logger } = require("./logger");
const { rateLimitMiddleware, sanitizeInput, securityHeaders } = require("./middleware/security");
const { connectDB } = require("./config/db");
const { initSocket } = require("./socket");
const roomService = require("./services/roomService");

const app = express();
const server = http.createServer(app);

app.use(cors({
  origin: function(origin, callback) { callback(null, true); },
  credentials: true
}));
app.use(morganMiddleware);
app.use(securityHeaders);
app.use(sanitizeInput);
app.use(express.json({ limit: "32mb" }));

// Rate limiting for auth routes (stricter)
app.use("/api/auth/login", rateLimitMiddleware("login"));
app.use("/api/auth/register", rateLimitMiddleware("register"));
app.use("/api/auth/forgot-password", rateLimitMiddleware("forgotPassword"));

// General API rate limiting
app.use("/api", rateLimitMiddleware("api"));

app.use("/api/auth", authRoutes);
app.use("/api/ai", aiRoutes);
app.use("/api/snapshots", snapshotRoutes);
app.use("/api/rbac", rbacRoutes);
app.use("/api/auth/github", githubOAuthRoutes);
app.use("/api/github", githubImportRoutes);
app.use("/api/execute", executeRoutes);

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
    const io = initSocket(server);
    app.set("io", io);
    server.listen(LISTEN_PORT, () => logger.info("Server running", { port: LISTEN_PORT }));
  } catch (err) {
    logger.error("Startup failed", { error: err.message });
    process.exit(1);
  }
}

startServer();
process.on("SIGINT", async () => { await mongoose.connection.close(); process.exit(0); });



