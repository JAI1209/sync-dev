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
const aiRoutes = require("./routes/ai");
const snapshotRoutes = require("./routes/snapshots");
const rbacRoutes = require("./routes/rbac");
const { morganMiddleware, logger } = require("./logger");
const { checkSocketPermission, assignRoomOwner } = require("./middleware/rbac");
const { rateLimitMiddleware, sanitizeInput, securityHeaders } = require("./middleware/security");

const jwt = require("jsonwebtoken");
const config = require("./config");
const Room = require("./models/Room");
const RoomMember = require("./models/RoomMember");
const { setupYjsSocketHandlers } = require("./yjs-collab");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: true,
    methods: ["GET", "POST"],
    credentials: true
  },
});
app.set('io', io); // Make io available to routes

// ── Socket authentication middleware ─────────────────────────────────────────
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
    socket.auth = decoded;
    socket.userId = decoded.user?.id;
    socket.username = decoded.user?.username || "anonymous";
    next();
  } catch {
    return next(new Error("Invalid or expired token"));
  }
});

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

// ── Room persistence helpers ──────────────────────────────────────────────────
async function persistRoom(roomId) {
  const room = rooms[roomId];
  if (!room) return;
  try {
    await Room.findOneAndUpdate(
      { roomId },
      {
        roomId,
        files: room.files,
        folders: room.folders,
        activeFile: room.activeFile,
        lastActivity: new Date(),
      },
      { upsert: true },
    );
  } catch (err) {
    console.error("Room persist error:", err.message);
  }
}

async function loadRoomFromDB(roomId) {
  try {
    const doc = await Room.findOne({ roomId });
    if (!doc) return null;
    const files = {};
    doc.files.forEach((val, key) => { files[key] = val.toObject(); });
    const folders = {};
    doc.folders.forEach((val, key) => { folders[key] = val.toObject(); });
    return {
      files,
      folders,
      activeFile: doc.activeFile,
      users: [],
    };
  } catch (err) {
    console.error("Room load error:", err.message);
    return null;
  }
}

// ── Setup Yjs CRDT collaboration ────────────────────────────────────────────
// DISABLED: Yjs causes split-brain with legacy socket system. 
// Editor.jsx uses legacy socket events (file-change, file-update).
// If Yjs is needed in future, migrate fully and remove legacy handlers.
// setupYjsSocketHandlers(io, Room);

io.on("connection", (socket) => {
  const username = socket.auth?.user?.username || "anonymous";
  console.log("user connected:", socket.id);
  
  // DEBUG: Log ALL events immediately (gated in production)
  if (process.env.NODE_ENV !== 'production') {
    socket.onAny((event, ...args) => {
      console.log(`[DEBUG] Event "${event}" from ${username}`);
    });
  }

  // ── Join room ────────────────────────────────────────────────────────────────
  socket.on("join-room", async ({ roomId }) => {
    const userId = socket.auth?.user?.id;
    const username = socket.auth?.user?.username || "anonymous";

    if (!rooms[roomId]) {
      // Try loading from MongoDB first
      const dbRoom = await loadRoomFromDB(roomId);
      rooms[roomId] = dbRoom || makeDefaultRoom();
    }

    // Check if room has an owner (established room with RBAC)
    let userRole = "viewer";
    if (userId) {
      const member = await RoomMember.findOne({ roomId, userId });
      
      if (member) {
        // User is a member, use their role
        userRole = member.role;
        // Update last active
        member.lastActive = new Date();
        await member.save();
      } else {
        // Room has no owner yet? This user becomes owner
        const hasOwner = await RoomMember.findOne({ roomId, role: "owner" });
        if (!hasOwner) {
          try {
            await assignRoomOwner(roomId, userId, username);
            userRole = "owner";
            console.log(`[RBAC] Assigned ${username} as owner of room ${roomId}`);
          } catch (err) {
            console.error("[RBAC] Failed to assign owner:", err.message);
          }
        } else {
          // Room has owner, auto-add as viewer for public rooms
          // For private rooms, you could reject here
          try {
            const newMember = new RoomMember({
              roomId,
              userId,
              username,
              role: "viewer",
            });
            await newMember.save();
            console.log(`[RBAC] Added ${username} as viewer to room ${roomId}`);
          } catch (err) {
            console.error("[RBAC] Failed to add member:", err.message);
          }
        }
      }
    }

    socket.join(roomId);
    socket.roomId = roomId;
    socket.username = username;

    clearEmptyRoomTimer(roomId);

    rooms[roomId].users = rooms[roomId].users.filter((u) => u.id !== socket.id);
    rooms[roomId].users.push({ id: socket.id, username, role: userRole });

    // Send the full room state to the joining user
    socket.emit("room-state", {
      files: rooms[roomId].files,
      folders: rooms[roomId].folders,
      activeFile: rooms[roomId].activeFile,
      role: userRole,
    });
    io.to(roomId).emit("users-update", rooms[roomId].users);
    socket.to(roomId).emit("peer-joined", { socketId: socket.id });

    console.log(`${username} joined room ${roomId} (role: ${userRole})`);
  });

  // ── File content change ──────────────────────────────────────────────────────
  socket.on("file-change", async ({ roomId, fileId, content }) => {
    try {
      console.log(`[Socket] file-change received from ${socket.username}: ${fileId} (${content.length} chars)`);
      const perm = await checkSocketPermission(socket, roomId, "EDIT_FILES");
      if (!perm.allowed) {
        console.log(`[Socket] file-change denied for ${socket.username}: ${perm.reason}`);
        socket.emit("error", { msg: perm.reason });
        return;
      }
      if (!rooms[roomId]) {
        console.log(`[Socket] file-change: room ${roomId} not found`);
        return;
      }
      if (!rooms[roomId].files[fileId]) {
        console.log(`[Socket] file-change: file ${fileId} not found`);
        return;
      }
      rooms[roomId].files[fileId].content = content;
      console.log(`[Socket] Broadcasting file-update to room ${roomId}`);
      socket.to(roomId).emit("file-update", { fileId, content });
      persistRoom(roomId);
    } catch (err) {
      console.error("[Socket] file-change error:", err.message);
      socket.emit("error", { msg: "Failed to save changes" });
    }
  });

  // ── Create file ──────────────────────────────────────────────────────────────
  socket.on("create-file", async ({ roomId, file }) => {
    const perm = await checkSocketPermission(socket, roomId, "CREATE_FILES");
    if (!perm.allowed) {
      socket.emit("error", { msg: perm.reason });
      return;
    }
    if (!rooms[roomId]) return;
    rooms[roomId].files[file.id] = file;
    socket.to(roomId).emit("file-created", file);
    persistRoom(roomId);
  });

  // ── Create folder ────────────────────────────────────────────────────────────
  socket.on("create-folder", async ({ roomId, folder }) => {
    const perm = await checkSocketPermission(socket, roomId, "CREATE_FOLDERS");
    if (!perm.allowed) {
      socket.emit("error", { msg: perm.reason });
      return;
    }
    if (!rooms[roomId]) return;
    rooms[roomId].folders[folder.id] = folder;
    socket.to(roomId).emit("folder-created", folder);
    persistRoom(roomId);
  });

  // ── Rename file ──────────────────────────────────────────────────────────────
  socket.on("rename-file", async ({ roomId, fileId, name }) => {
    const perm = await checkSocketPermission(socket, roomId, "RENAME_ITEMS");
    if (!perm.allowed) {
      socket.emit("error", { msg: perm.reason });
      return;
    }
    if (!rooms[roomId]?.files[fileId]) return;
    rooms[roomId].files[fileId].name = name;
    const ext = name.split(".").pop().toLowerCase();
    rooms[roomId].files[fileId].language = extToLanguage(ext);
    socket.to(roomId).emit("file-renamed", { fileId, name, language: rooms[roomId].files[fileId].language });
    persistRoom(roomId);
  });

  // ── Rename folder ────────────────────────────────────────────────────────────
  socket.on("rename-folder", async ({ roomId, folderId, name }) => {
    const perm = await checkSocketPermission(socket, roomId, "RENAME_ITEMS");
    if (!perm.allowed) {
      socket.emit("error", { msg: perm.reason });
      return;
    }
    if (!rooms[roomId]?.folders[folderId]) return;
    rooms[roomId].folders[folderId].name = name;
    socket.to(roomId).emit("folder-renamed", { folderId, name });
    persistRoom(roomId);
  });

  // ── Delete file ──────────────────────────────────────────────────────────────
  socket.on("delete-file", async ({ roomId, fileId }) => {
    const perm = await checkSocketPermission(socket, roomId, "DELETE_FILES");
    if (!perm.allowed) {
      socket.emit("error", { msg: perm.reason });
      return;
    }
    if (!rooms[roomId]?.files[fileId]) return;
    delete rooms[roomId].files[fileId];
    if (rooms[roomId].activeFile === fileId) {
      const remaining = Object.keys(rooms[roomId].files);
      rooms[roomId].activeFile = remaining[0] || null;
    }
    socket.to(roomId).emit("file-deleted", { fileId, newActiveFile: rooms[roomId].activeFile });
    persistRoom(roomId);
  });

  // ── Delete folder (and all children) ────────────────────────────────────────
  socket.on("delete-folder", async ({ roomId, folderId }) => {
    const perm = await checkSocketPermission(socket, roomId, "DELETE_FILES");
    if (!perm.allowed) {
      socket.emit("error", { msg: perm.reason });
      return;
    }
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
    persistRoom(roomId);
  });

  // ── Switch active file ───────────────────────────────────────────────────────
  socket.on("switch-file", ({ roomId, fileId }) => {
    if (!rooms[roomId]?.files[fileId]) return;
    rooms[roomId].activeFile = fileId;
    socket.to(roomId).emit("file-switched", { fileId });
    persistRoom(roomId);
  });

  // ── Bulk import (GitHub) ─────────────────────────────────────────────────────
  socket.on("bulk-import", async (data) => {
    console.log(`[Import] >>> bulk-import EVENT RECEIVED <<<`);
    console.log(`[Import] Socket username: ${socket.username}, roomId: ${data?.roomId}`);
    
    const { roomId, files, folders } = data || {};
    const fileCount = files ? Object.keys(files).length : 0;
    const folderCount = folders ? Object.keys(folders).length : 0;
    console.log(`[Import] Data: ${fileCount} files, ${folderCount} folders`);
    
    try {
      const perm = await checkSocketPermission(socket, roomId, "IMPORT_FROM_GITHUB");
      console.log(`[Import] Permission: ${perm.allowed ? 'allowed' : 'denied'} (${perm.role || 'no role'})`);
      
      if (!perm.allowed) {
        const createPerm = await checkSocketPermission(socket, roomId, "CREATE_FILES");
        if (!createPerm.allowed) {
          console.log(`[Import] Denied: ${perm.reason}`);
          socket.emit("import-error", { msg: "Import requires editor or higher role" });
          return;
        }
      }

      if (!rooms[roomId]) {
        console.log(`[Import] Room not found: ${roomId}`);
        socket.emit("import-error", { msg: "Room not found" });
        return;
      }

      // Merge imported files/folders with existing
      const importedFiles = [];
      const importedFolders = [];

      if (folders) {
        for (const folder of Object.values(folders)) {
          if (!rooms[roomId].folders[folder.id]) {
            rooms[roomId].folders[folder.id] = folder;
            importedFolders.push(folder);
          }
        }
      }

      if (files) {
        for (const file of Object.values(files)) {
          if (!rooms[roomId].files[file.id]) {
            rooms[roomId].files[file.id] = file;
            importedFiles.push(file);
          }
        }
      }

      // Persist and notify
      persistRoom(roomId);
      
      // Broadcast to ALL room members including sender
      io.to(roomId).emit("bulk-imported", {
        files: importedFiles,
        folders: importedFolders,
        importedBy: socket.username,
      });
      
      // Confirm to sender
      socket.emit("import-complete", {
        filesImported: importedFiles.length,
        foldersImported: importedFolders.length,
      });

      console.log(`[Import] Success: ${importedFiles.length} files, ${importedFolders.length} folders`);
    } catch (err) {
      console.error("[Import] Error:", err.message);
      socket.emit("import-error", { msg: "Import failed: " + err.message });
    }
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
      if (rooms[roomId].users.length === 0) {
        persistRoom(roomId);
        scheduleEmptyRoomDeletion(roomId);
      }
    }
    console.log("user disconnected:", socket.id);
  });
});

// ── Helpers ───────────────────────────────────────────────────────────────────
// Bug D: Collect all IDs first, then delete in second pass
function deleteFolder(room, folderId, visited = new Set()) {
  // Cycle detection
  if (visited.has(folderId)) return { deletedFiles: [], deletedFolders: [] };
  visited.add(folderId);
  
  const deletedFiles = [];
  const deletedFolders = [];
  const foldersToDelete = [folderId];
  const filesToDelete = [];
  
  // First pass: collect all descendant folders/files
  let i = 0;
  while (i < foldersToDelete.length) {
    const currentFolderId = foldersToDelete[i++];
    
    // Find files in this folder
    for (const [id, file] of Object.entries(room.files)) {
      if (file.parentId === currentFolderId && !filesToDelete.includes(id)) {
        filesToDelete.push(id);
      }
    }
    
    // Find subfolders
    for (const [id, folder] of Object.entries(room.folders)) {
      if (folder.parentId === currentFolderId && !foldersToDelete.includes(id)) {
        foldersToDelete.push(id);
      }
    }
  }
  
  // Second pass: delete collected items
  for (const id of filesToDelete) {
    delete room.files[id];
    deletedFiles.push(id);
  }
  for (const id of foldersToDelete) {
    delete room.folders[id];
    deletedFolders.push(id);
  }
  
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
if (!process.env.MONGODB_URI) logger.warn("MONGODB_URI is not set. Using local MongoDB fallback.");

async function startServer() {
  try {
    await mongoose.connect(uri);
    logger.info("MongoDB connected", { uri: uri.replace(/:\/\/.*@/, "://***@") }); // hide credentials
    const port = process.env.PORT || 3000;
    server.listen(port, () => logger.info("Server running", { port }));
  } catch (err) {
    logger.error("Mongo connection failed", { error: err.message });
    process.exit(1);
  }
}

startServer();
process.on("SIGINT", async () => { await mongoose.connection.close(); process.exit(0); });

// Export for route access (Bug C: snapshot restore needs to update live state)
module.exports = { rooms, io };
