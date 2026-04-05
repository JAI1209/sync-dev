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

  socket.on("join-room", ({ roomId, username }) => {
    socket.join(roomId);
    socket.roomId = roomId;
    socket.username = username;

    if (!rooms[roomId]) rooms[roomId] = { code: "", users: [] };

    // remove existing entry for this socket first
    rooms[roomId].users = rooms[roomId].users.filter(u => u.id !== socket.id);
    rooms[roomId].users.push({ id: socket.id, username });

    socket.emit("load-code", rooms[roomId].code);
    io.to(roomId).emit("users-update", rooms[roomId].users);

    console.log(`${username} joined room ${roomId}`);
  });

  socket.on("code-change", ({ roomId, code }) => {
    rooms[roomId].code = code;
    socket.to(roomId).emit("code-update", code);
  });

  socket.on("disconnect", () => {
    const { roomId, username } = socket;
    if (roomId && rooms[roomId]) {
      rooms[roomId].users = rooms[roomId].users.filter(u => u.id !== socket.id);
      io.to(roomId).emit("users-update", rooms[roomId].users);
    }
    console.log("user disconnected:", socket.id);
  });
});

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error("MONGODB_URI is missing in .env");
  process.exit(1);
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