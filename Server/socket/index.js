const { Server } = require("socket.io");
const { createAdapter } = require("@socket.io/redis-adapter");
const { redis } = require("../config/redis");
const jwt = require("jsonwebtoken");
const config = require("../config");
const { registerRoomHandlers } = require("./roomHandler");

async function initSocket(httpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin: function(origin, callback) {
        const allowed = (process.env.CORS_ORIGINS || "http://localhost:5173")
          .split(",")
          .map((o) => o.trim());
        if (!origin || allowed.includes(origin)) {
          callback(null, true);
        } else {
          callback(new Error(`CORS: origin ${origin} not allowed`));
        }
      },
      methods: ["GET", "POST"],
      credentials: true,
    },
  });

  io.use((socket, next) => {
    const token =
      socket.handshake.auth?.token ||
      socket.handshake.query?.token ||
      socket.handshake.headers?.authorization?.replace(/^Bearer\s+/i, "");

    if (!token) {
      return next(new Error("Authentication required"));
    }

    try {
      const decoded = jwt.verify(token, config.jwtSecret);
      const authUser = decoded.user?.id ? decoded.user : decoded.user?.user ?? decoded.user;
      socket.auth = { ...decoded, user: authUser };
      socket.userId = authUser?.id;
      socket.username = authUser?.username || "anonymous";
      next();
    } catch {
      return next(new Error("Invalid or expired token"));
    }
  });

  const pubClient = redis.duplicate({ lazyConnect: true });
  const subClient = redis.duplicate({ lazyConnect: true });

  pubClient.on("error", (err) => console.error("[Redis Adapter] pub error:", err.message));
  subClient.on("error", (err) => console.error("[Redis Adapter] sub error:", err.message));

  await Promise.all([pubClient.connect(), subClient.connect()]);
  io.adapter(createAdapter(pubClient, subClient));
  console.log("[Socket] Redis adapter attached");

  io.on("connection", (socket) => {
    registerRoomHandlers(io, socket);
  });

  return io;
}

module.exports = { initSocket };