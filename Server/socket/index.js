const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const config = require("../config");
const { registerRoomHandlers } = require("./roomHandler");

function initSocket(httpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin: true,
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

  io.on("connection", (socket) => {
    registerRoomHandlers(io, socket);
  });

  return io;
}

module.exports = { initSocket };