const { Server } = require("socket.io");
const { createAdapter } = require("@socket.io/redis-adapter");
const jwt = require("jsonwebtoken");
const config = require("../config");
const { redis, redisOptions, ensureRedisConnection } = require("../config/redis");
const { registerRoomHandlers } = require("./roomHandler");

async function attachRedisAdapter(io) {
  const ready = await ensureRedisConnection();
  if (!ready) {
    console.warn("[Socket] Redis unavailable - using in-memory adapter");
    return;
  }

  const pubClient = redis.duplicate({ ...redisOptions, lazyConnect: true });
  const subClient = redis.duplicate({ ...redisOptions, lazyConnect: true });

  pubClient.on("error", (err) => console.error("[Redis Adapter] pub error:", err.message));
  subClient.on("error", (err) => console.error("[Redis Adapter] sub error:", err.message));

  try {
    await Promise.all([pubClient.connect(), subClient.connect()]);
    io.adapter(createAdapter(pubClient, subClient));
    console.log("[Socket] Redis adapter attached");
  } catch (err) {
    console.error("[Socket] Failed to attach Redis adapter, falling back to memory:", err.message);
    try {
      pubClient.disconnect();
      subClient.disconnect();
    } catch {
      // no-op
    }
  }
}

async function initSocket(httpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin(origin, callback) {
        const allowed = (process.env.CLIENT_ORIGIN || process.env.CORS_ORIGINS || "http://localhost:5173")
          .split(",")
          .map((value) => value.trim());

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

  await attachRedisAdapter(io);

  io.on("connection", (socket) => {
    registerRoomHandlers(io, socket);
  });

  return io;
}

module.exports = { initSocket };
