const roomService = require("../services/roomService");
const RoomMember = require("../models/RoomMember");
const { checkSocketPermission, assignRoomOwner } = require("../middleware/rbac");
const { extToLanguage } = require("../utils/extToLanguage");

async function handleJoinRoom(io, socket, { roomId }) {
  const userId = socket.auth?.user?.id;
  const username = socket.auth?.user?.username || "anonymous";

  let room = await roomService.getRoom(roomId);
  if (!room) {
    const dbRoom = await roomService.loadRoomFromDB(roomId);
    if (dbRoom) {
      console.log(
        `[Join] Loaded room ${roomId} from DB: ${Object.keys(dbRoom.files).length} files, ${Object.keys(dbRoom.folders).length} folders`
      );
      await roomService.setRoom(roomId, dbRoom);
      room = dbRoom;
    } else {
      console.log(`[Join] Room ${roomId} not in DB, creating default`);
      room = roomService.makeDefaultRoom();
      await roomService.setRoom(roomId, room);
    }
  } else {
    console.log(`[Join] Room ${roomId} already in memory: ${Object.keys(room.files).length} files`);
  }

  let userRole = "viewer";
  if (userId) {
    userRole = await roomService.runWithLock(roomId, async () => {
      const member = await RoomMember.findOne({ roomId, userId });

      if (member) {
        member.lastActive = new Date();
        await member.save();
        return member.role;
      }

      const hasOwner = await RoomMember.findOne({ roomId, role: "owner" });
      if (!hasOwner) {
        try {
          await assignRoomOwner(roomId, userId, username);
          console.log(`[RBAC] Assigned ${username} as owner of room ${roomId}`);
          return "owner";
        } catch (err) {
          console.error("[RBAC] Failed to assign owner:", err.message);
        }
      }

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
        if (err.code !== 11000) {
          console.error("[RBAC] Failed to add member:", err.message);
        }
      }

      const latest = await RoomMember.findOne({ roomId, userId });
      return latest?.role || "viewer";
    });
  }

  socket.join(roomId);
  socket.roomId = roomId;
  socket.username = username;

  roomService.clearRoomCleanup(roomId);

  room.users = room.users.filter((u) => u.id !== socket.id);
  room.users.push({ id: socket.id, username, role: userRole });

  const roomFiles = room.files;
  const roomFolders = room.folders;
  console.log(
    `[RoomState] Sending to ${username}: ${Object.keys(roomFiles).length} files, ${Object.keys(roomFolders).length} folders`
  );

  socket.emit("room-state", {
    files: roomFiles,
    folders: roomFolders,
    activeFile: room.activeFile,
    role: userRole,
  });
  io.to(roomId).emit("users-update", room.users);
  socket.to(roomId).emit("peer-joined", { socketId: socket.id });

  console.log(`${username} joined room ${roomId} (role: ${userRole})`);
}

async function handleFileChange(io, socket, { roomId, fileId, content }) {
  try {
    console.log(`[Socket] file-change received from ${socket.username}: ${fileId} (${content.length} chars)`);
    const perm = await checkSocketPermission(socket, roomId, "EDIT_FILES");
    if (!perm.allowed) {
      console.log(`[Socket] file-change denied for ${socket.username}: ${perm.reason}`);
      socket.emit("error", { msg: perm.reason });
      return;
    }

    const room = await roomService.getRoom(roomId);
    if (!room) {
      console.log(`[Socket] file-change: room ${roomId} not found`);
      return;
    }
    if (!room.files[fileId]) {
      console.log(`[Socket] file-change: file ${fileId} not found`);
      return;
    }

    room.files[fileId].content = content;
    await roomService.setRoom(roomId, room);
    console.log(`[Socket] Broadcasting file-update to room ${roomId}`);
    socket.to(roomId).emit("file-update", { fileId, content });
    roomService.persistRoom(roomId);
  } catch (err) {
    console.error("[Socket] file-change error:", err.message);
    socket.emit("error", { msg: "Failed to save changes" });
  }
}

async function handleCreateFile(io, socket, { roomId, file }) {
  const perm = await checkSocketPermission(socket, roomId, "CREATE_FILES");
  if (!perm.allowed) {
    socket.emit("error", { msg: perm.reason });
    return;
  }

  const room = await roomService.getRoom(roomId);
  if (!room) {
    socket.emit("error", { msg: "Room not found" });
    return;
  }

  if (file.parentId && !room.folders[file.parentId]) {
    const placeholderFolder = {
      id: file.parentId,
      name: file.parentId.split("_").pop() || "folder",
      parentId: null,
    };
    room.folders[placeholderFolder.id] = placeholderFolder;
    socket.to(roomId).emit("folder-created", placeholderFolder);
  }

  room.files[file.id] = file;
  await roomService.setRoom(roomId, room);
  socket.emit("file-created-ack", { fileId: file.id });
  socket.to(roomId).emit("file-created", file);
  roomService.persistRoom(roomId);
}

async function handleCreateFolder(io, socket, { roomId, folder }) {
  const perm = await checkSocketPermission(socket, roomId, "CREATE_FOLDERS");
  if (!perm.allowed) {
    socket.emit("error", { msg: perm.reason });
    return;
  }

  const room = await roomService.getRoom(roomId);
  if (!room) {
    socket.emit("error", { msg: "Room not found" });
    return;
  }

  if (folder.parentId && !room.folders[folder.parentId]) {
    const placeholderParent = {
      id: folder.parentId,
      name: folder.parentId.split("_").pop() || "folder",
      parentId: null,
    };
    room.folders[placeholderParent.id] = placeholderParent;
    socket.to(roomId).emit("folder-created", placeholderParent);
  }

  room.folders[folder.id] = folder;
  await roomService.setRoom(roomId, room);
  socket.to(roomId).emit("folder-created", folder);
  roomService.persistRoom(roomId);
}

async function handleRenameFile(io, socket, { roomId, fileId, name }) {
  const perm = await checkSocketPermission(socket, roomId, "RENAME_ITEMS");
  if (!perm.allowed) {
    socket.emit("error", { msg: perm.reason });
    return;
  }

  const room = await roomService.getRoom(roomId);
  if (!room?.files[fileId]) return;

  room.files[fileId].name = name;
  const ext = name.split(".").pop().toLowerCase();
  room.files[fileId].language = extToLanguage(ext);
  await roomService.setRoom(roomId, room);

  socket.to(roomId).emit("file-renamed", {
    fileId,
    name,
    language: room.files[fileId].language,
  });
  roomService.persistRoom(roomId);
}

async function handleRenameFolder(io, socket, { roomId, folderId, name }) {
  const perm = await checkSocketPermission(socket, roomId, "RENAME_ITEMS");
  if (!perm.allowed) {
    socket.emit("error", { msg: perm.reason });
    return;
  }

  const room = await roomService.getRoom(roomId);
  if (!room?.folders[folderId]) return;

  room.folders[folderId].name = name;
  await roomService.setRoom(roomId, room);
  socket.to(roomId).emit("folder-renamed", { folderId, name });
  roomService.persistRoom(roomId);
}

async function handleDeleteFile(io, socket, { roomId, fileId }) {
  const perm = await checkSocketPermission(socket, roomId, "DELETE_FILES");
  if (!perm.allowed) {
    socket.emit("error", { msg: perm.reason });
    return;
  }

  const room = await roomService.getRoom(roomId);
  if (!room?.files[fileId]) return;

  delete room.files[fileId];
  if (room.activeFile === fileId) {
    const remaining = Object.keys(room.files);
    room.activeFile = remaining[0] || null;
  }
  await roomService.setRoom(roomId, room);

  socket.to(roomId).emit("file-deleted", { fileId, newActiveFile: room.activeFile });
  roomService.persistRoom(roomId);
}

async function handleDeleteFolder(io, socket, { roomId, folderId }) {
  const perm = await checkSocketPermission(socket, roomId, "DELETE_FILES");
  if (!perm.allowed) {
    socket.emit("error", { msg: perm.reason });
    return;
  }

  const room = await roomService.getRoom(roomId);
  if (!room) return;

  const { deletedFiles, deletedFolders } = roomService.deleteFolder(room, folderId);
  if (deletedFiles.includes(room.activeFile)) {
    const remaining = Object.keys(room.files);
    room.activeFile = remaining[0] || null;
  }
  await roomService.setRoom(roomId, room);

  io.in(roomId).emit("folder-deleted", {
    folderId,
    deletedFiles,
    deletedFolders,
    newActiveFile: room.activeFile,
  });
  roomService.persistRoom(roomId);
}

async function handleSwitchFile(io, socket, { roomId, fileId }) {
  const room = await roomService.getRoom(roomId);
  if (!room?.files[fileId]) return;
  room.activeFile = fileId;
  await roomService.setRoom(roomId, room);
  socket.to(roomId).emit("file-switched", { fileId });
  roomService.persistRoom(roomId);
}

async function handleBulkImport(io, socket, { roomId, files, folders }) {
  try {
    const perm = await checkSocketPermission(socket, roomId, "IMPORT_FROM_GITHUB");
    if (!perm.allowed) {
      const createPerm = await checkSocketPermission(socket, roomId, "CREATE_FILES");
      if (!createPerm.allowed) {
        socket.emit("import-error", { msg: "Import requires editor role or higher" });
        return;
      }
    }

    const room = await roomService.getRoom(roomId);
    if (!room) {
      socket.emit("import-error", { msg: "Room not found" });
      return;
    }

    const importedFiles = [];
    const importedFolders = [];

    if (folders) {
      for (const folder of Object.values(folders)) {
        if (!room.folders[folder.id]) {
          room.folders[folder.id] = folder;
          importedFolders.push(folder);
        }
      }
    }

    if (files) {
      for (const file of Object.values(files)) {
        if (!room.files[file.id]) {
          if (file.parentId && !room.folders[file.parentId]) {
            const placeholderFolder = {
              id: file.parentId,
              name: file.parentId.split("_").pop() || "folder",
              parentId: null,
            };
            room.folders[placeholderFolder.id] = placeholderFolder;
            importedFolders.push(placeholderFolder);
          }
          room.files[file.id] = file;
          importedFiles.push(file);
        }
      }
    }

    await roomService.setRoom(roomId, room);
    await roomService.persistRoom(roomId);

    io.to(roomId).emit("bulk-imported", {
      files: importedFiles,
      folders: importedFolders,
      importedBy: socket.username,
    });

    socket.emit("import-complete", {
      filesImported: importedFiles.length,
      foldersImported: importedFolders.length,
    });
  } catch (err) {
    console.error("[Import] Error:", err.message);
    socket.emit("import-error", { msg: "Import failed: " + err.message });
  }
}

function handleRetryUpload(io, socket) {
  socket.emit("upload-retry-ack");
}

function handleWebrtcOffer(io, socket, { to, offer }) {
  io.to(to).emit("webrtc-offer", { from: socket.id, offer });
}

function handleWebrtcAnswer(io, socket, { to, answer }) {
  io.to(to).emit("webrtc-answer", { from: socket.id, answer });
}

function handleWebrtcIceCandidate(io, socket, { to, candidate }) {
  io.to(to).emit("webrtc-ice-candidate", { from: socket.id, candidate });
}

async function handleDisconnect(io, socket) {
  const { roomId } = socket;
  const room = roomId && (await roomService.getRoom(roomId));
  if (room) {
    room.users = room.users.filter((u) => u.id !== socket.id);
    io.to(roomId).emit("users-update", room.users);
    socket.to(roomId).emit("peer-left", { socketId: socket.id });
    if (room.users.length === 0) {
      roomService.persistRoom(roomId);
      roomService.scheduleRoomCleanup(roomId);
    }
  }
  console.log("user disconnected:", socket.id);
}

function registerRoomHandlers(io, socket) {
  const username = socket.auth?.user?.username || "anonymous";
  if (process.env.NODE_ENV !== "production") {
    socket.onAny((event, ...args) => {
      console.log(`[DEBUG] Event "${event}" from ${username}`);
    });
  }

  socket.on("join-room", (data) => handleJoinRoom(io, socket, data));
  socket.on("file-change", (data) => handleFileChange(io, socket, data));
  socket.on("create-file", (data) => handleCreateFile(io, socket, data));
  socket.on("create-folder", (data) => handleCreateFolder(io, socket, data));
  socket.on("rename-file", (data) => handleRenameFile(io, socket, data));
  socket.on("rename-folder", (data) => handleRenameFolder(io, socket, data));
  socket.on("delete-file", (data) => handleDeleteFile(io, socket, data));
  socket.on("delete-folder", (data) => handleDeleteFolder(io, socket, data));
  socket.on("switch-file", (data) => handleSwitchFile(io, socket, data));
  socket.on("bulk-import", (data) => handleBulkImport(io, socket, data));
  socket.on("retry-upload", () => handleRetryUpload(io, socket));
  socket.on("webrtc-offer", (data) => handleWebrtcOffer(io, socket, data));
  socket.on("webrtc-answer", (data) => handleWebrtcAnswer(io, socket, data));
  socket.on("webrtc-ice-candidate", (data) => handleWebrtcIceCandidate(io, socket, data));
  socket.on("disconnect", () => handleDisconnect(io, socket));
}

module.exports = { registerRoomHandlers };
