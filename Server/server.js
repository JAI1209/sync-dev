const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const mongoose = require("mongoose");
const cors = require("cors");
const authRoutes = require("./routes/Auth");
const githubOAuthRoutes = require("./routes/githubOAuth");
const githubImportRoutes = require("./routes/githubImport");
const executeRoutes = require("./routes/execute");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: true,
    methods: ["GET", "POST"],
    credentials: true
  },
});

app.use(cors({
  origin: function(origin, callback) { callback(null, true); },
  credentials: true
}));
app.use(express.json({ limit: "32mb" }));
app.use("/api/auth", authRoutes);
app.use("/api/auth/github", githubOAuthRoutes);
app.use("/api/github", githubImportRoutes);
app.use("/api/execute", executeRoutes);

// ── Room state ─────────────────────────────────────────────────────────────────
// rooms[roomId] = {
//   files: { [fileId]: { id, name, content, language, parentId } },
//   folders: { [folderId]: { id, name, parentId } },
//   activeFile: fileId | null,
//   users: [{ id, socketId, username }]
// }
const rooms = {};
// When the last socket leaves, wait before dropping room state so a browser
// reload (disconnect → reconnect) does not wipe files and folders.
const emptyRoomTimers = new Map();
const EMPTY_ROOM_GRACE_MS = Number(process.env.EMPTY_ROOM_GRACE_MS) || 120_000;

function clearEmptyRoomTimer(roomId) {
  const t = emptyRoomTimers.get(roomId);
  if (t) {
    clearTimeout(t);
    emptyRoomTimers.delete(roomId);
  }
}

function scheduleEmptyRoomDeletion(roomId) {
  clearEmptyRoomTimer(roomId);
  emptyRoomTimers.set(
    roomId,
    setTimeout(() => {
      emptyRoomTimers.delete(roomId);
      if (!rooms[roomId]) return;
      if (rooms[roomId].users.length === 0) delete rooms[roomId];
    }, EMPTY_ROOM_GRACE_MS)
  );
}

function makeDefaultRoom() {
  const fileId = "file_main";
  return {
    files: {
      [fileId]: { id: fileId, name: "main.js", content: "// Start coding here\n", language: "javascript", parentId: null }
    },
    folders: {},
    activeFile: fileId,
    users: [],
  };
}

io.on("connection", (socket) => {
  console.log("user connected:", socket.id);

  // ── Join room ────────────────────────────────────────────────────────────────
  socket.on("join-room", ({ roomId, username }) => {
    socket.join(roomId);
    socket.roomId = roomId;
    socket.username = username;

    if (!rooms[roomId]) rooms[roomId] = makeDefaultRoom();
    clearEmptyRoomTimer(roomId);

    rooms[roomId].users = rooms[roomId].users.filter((u) => u.id !== socket.id);
    rooms[roomId].users.push({ id: socket.id, username });

    // Send the full room state to the joining user
    socket.emit("room-state", {
      files: rooms[roomId].files,
      folders: rooms[roomId].folders,
      activeFile: rooms[roomId].activeFile,
    });
    io.to(roomId).emit("users-update", rooms[roomId].users);
    socket.to(roomId).emit("peer-joined", { socketId: socket.id });

    console.log(`${username} joined room ${roomId}`);
  });

  // ── File content change ──────────────────────────────────────────────────────
  socket.on("file-change", ({ roomId, fileId, content }) => {
    if (!rooms[roomId]) return;
    if (!rooms[roomId].files[fileId]) return;
    rooms[roomId].files[fileId].content = content;
    socket.to(roomId).emit("file-update", { fileId, content });
  });

  // ── Create file ──────────────────────────────────────────────────────────────
  socket.on("create-file", ({ roomId, file }) => {
    if (!rooms[roomId]) return;
    rooms[roomId].files[file.id] = file;
    socket.to(roomId).emit("file-created", file);
  });

  // ── Create folder ────────────────────────────────────────────────────────────
  socket.on("create-folder", ({ roomId, folder }) => {
    if (!rooms[roomId]) return;
    rooms[roomId].folders[folder.id] = folder;
    socket.to(roomId).emit("folder-created", folder);
  });

  // ── Rename file ──────────────────────────────────────────────────────────────
  socket.on("rename-file", ({ roomId, fileId, name }) => {
    if (!rooms[roomId]?.files[fileId]) return;
    rooms[roomId].files[fileId].name = name;
    // Infer language from extension
    const ext = name.split(".").pop().toLowerCase();
    rooms[roomId].files[fileId].language = extToLanguage(ext);
    socket.to(roomId).emit("file-renamed", { fileId, name, language: rooms[roomId].files[fileId].language });
  });

  // ── Rename folder ────────────────────────────────────────────────────────────
  socket.on("rename-folder", ({ roomId, folderId, name }) => {
    if (!rooms[roomId]?.folders[folderId]) return;
    rooms[roomId].folders[folderId].name = name;
    socket.to(roomId).emit("folder-renamed", { folderId, name });
  });

  // ── Delete file ──────────────────────────────────────────────────────────────
  socket.on("delete-file", ({ roomId, fileId }) => {
    if (!rooms[roomId]?.files[fileId]) return;
    delete rooms[roomId].files[fileId];
    if (rooms[roomId].activeFile === fileId) {
      const remaining = Object.keys(rooms[roomId].files);
      rooms[roomId].activeFile = remaining[0] || null;
    }
    socket.to(roomId).emit("file-deleted", { fileId, newActiveFile: rooms[roomId].activeFile });
  });

  // ── Delete folder (and all children) ────────────────────────────────────────
  socket.on("delete-folder", ({ roomId, folderId }) => {
    if (!rooms[roomId]) return;
    const { deletedFiles, deletedFolders } = deleteFolder(rooms[roomId], folderId);
    if (deletedFiles.includes(rooms[roomId].activeFile)) {
      const remaining = Object.keys(rooms[roomId].files);
      rooms[roomId].activeFile = remaining[0] || null;
    }
    socket.to(roomId).emit("folder-deleted", {
      folderId,
      deletedFiles,
      deletedFolders,
      newActiveFile: rooms[roomId].activeFile,
    });
  });

  // ── Switch active file ───────────────────────────────────────────────────────
  socket.on("switch-file", ({ roomId, fileId }) => {
    if (!rooms[roomId]?.files[fileId]) return;
    rooms[roomId].activeFile = fileId;
    socket.to(roomId).emit("file-switched", { fileId });
  });

  // ── WebRTC signaling ─────────────────────────────────────────────────────────
  socket.on("webrtc-offer",          ({ to, offer })     => io.to(to).emit("webrtc-offer",          { from: socket.id, offer }));
  socket.on("webrtc-answer",         ({ to, answer })    => io.to(to).emit("webrtc-answer",         { from: socket.id, answer }));
  socket.on("webrtc-ice-candidate",  ({ to, candidate }) => io.to(to).emit("webrtc-ice-candidate",  { from: socket.id, candidate }));

  // ── Disconnect ───────────────────────────────────────────────────────────────
  socket.on("disconnect", () => {
    const { roomId } = socket;
    if (roomId && rooms[roomId]) {
      rooms[roomId].users = rooms[roomId].users.filter((u) => u.id !== socket.id);
      io.to(roomId).emit("users-update", rooms[roomId].users);
      socket.to(roomId).emit("peer-left", { socketId: socket.id });
      // Defer deletion so a solo tab reload can rejoin before state is dropped.
      if (rooms[roomId].users.length === 0) scheduleEmptyRoomDeletion(roomId);
    }
    console.log("user disconnected:", socket.id);
  });
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function deleteFolder(room, folderId) {
  const deletedFiles = [];
  const deletedFolders = [];
  for (const [id, file] of Object.entries(room.files)) {
    if (file.parentId === folderId) { delete room.files[id]; deletedFiles.push(id); }
  }
  for (const [id, folder] of Object.entries(room.folders)) {
    if (folder.parentId === folderId) {
      const nested = deleteFolder(room, id);
      deletedFiles.push(...nested.deletedFiles);
      deletedFolders.push(...nested.deletedFolders);
    }
  }
  delete room.folders[folderId];
  deletedFolders.push(folderId);
  return { deletedFiles, deletedFolders };
}

function extToLanguage(ext) {
  const map = { js: "javascript", jsx: "javascript", ts: "typescript", tsx: "typescript",
    py: "python", java: "java", cpp: "cpp", c: "cpp", cs: "csharp",
    html: "html", css: "css", json: "json", md: "markdown", sh: "shell",
    go: "go", rs: "rust", php: "php", rb: "ruby", yml: "yaml", yaml: "yaml" };
  return map[ext] || "plaintext";
}

// ── MongoDB + server start ────────────────────────────────────────────────────
const uri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/syncdev";
if (!process.env.MONGODB_URI) console.warn("MONGODB_URI is not set. Using local MongoDB fallback.");

async function startServer() {
  try {
    await mongoose.connect(uri);
    console.log("MongoDB connected");
    const port = process.env.PORT || 3000;
    server.listen(port, () => console.log(`Server running on port ${port}`));
  } catch (err) {
    console.error("Mongo connection failed:", err.message);
    process.exit(1);
  }
}

startServer();
process.on("SIGINT", async () => { await mongoose.connection.close(); process.exit(0); });
