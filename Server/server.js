require("dotenv").config();
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const mongoose = require("mongoose");
const cors = require("cors");
const authRoutes = require("./routes/Auth");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "http://localhost:5173",
    methods: ["GET", "POST"],
  },
});

app.use(cors({ origin: "http://localhost:5173" }));
app.use(express.json());
app.use("/api/auth", authRoutes);

// rooms stored in memory
const rooms = {};

io.on("connection", (socket) => {
  console.log("user connected:", socket.id);

  // ── Room join ──────────────────────────────────────────────────────────────
  socket.on("join-room", ({ roomId, username }) => {
    socket.join(roomId);
    socket.roomId = roomId;
    socket.username = username;

    if (!rooms[roomId]) rooms[roomId] = { code: "", users: [] };

    // Remove stale entry for this socket, then add fresh
    rooms[roomId].users = rooms[roomId].users.filter((u) => u.id !== socket.id);
    rooms[roomId].users.push({ id: socket.id, username });

    socket.emit("load-code", rooms[roomId].code);
    io.to(roomId).emit("users-update", rooms[roomId].users);

    // Tell all EXISTING peers in the room that a new peer joined,
    // so they can initiate WebRTC offers to this socket.
    socket.to(roomId).emit("peer-joined", { socketId: socket.id });

    console.log(`${username} joined room ${roomId}`);
  });

  // ── Code sync ──────────────────────────────────────────────────────────────
  socket.on("code-change", ({ roomId, code }) => {
    rooms[roomId].code = code;
    socket.to(roomId).emit("code-update", code);
  });

  // ── WebRTC signaling (peer-to-peer relay) ──────────────────────────────────
  socket.on("webrtc-offer", ({ to, offer }) => {
    io.to(to).emit("webrtc-offer", { from: socket.id, offer });
  });

  socket.on("webrtc-answer", ({ to, answer }) => {
    io.to(to).emit("webrtc-answer", { from: socket.id, answer });
  });

  socket.on("webrtc-ice-candidate", ({ to, candidate }) => {
    io.to(to).emit("webrtc-ice-candidate", { from: socket.id, candidate });
  });

  // ── Disconnect ─────────────────────────────────────────────────────────────
  socket.on("disconnect", () => {
    const { roomId, username } = socket;
    if (roomId && rooms[roomId]) {
      rooms[roomId].users = rooms[roomId].users.filter((u) => u.id !== socket.id);
      io.to(roomId).emit("users-update", rooms[roomId].users);
      // Notify peers so they can clean up the RTCPeerConnection
      socket.to(roomId).emit("peer-left", { socketId: socket.id });
    }
    console.log("user disconnected:", socket.id);
  });
});

// ── MongoDB + server start ─────────────────────────────────────────────────────
const uri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/syncdev";
if (!process.env.MONGODB_URI) {
  console.warn("MONGODB_URI is not set. Using local MongoDB fallback.");
}

async function startServer() {
  try {
    await mongoose.connect(uri);
    console.log("MongoDB connected");

    const port = process.env.PORT || 3000;
    server.listen(port, () => {
      console.log(`Server running on port ${port}`);
    });
  } catch (err) {
    console.error("Mongo connection failed:", err.message);
    process.exit(1);
  }
}

startServer();

process.on("SIGINT", async () => {
  await mongoose.connection.close();
  process.exit(0);
});