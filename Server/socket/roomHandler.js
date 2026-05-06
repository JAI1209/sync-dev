const roomService = require("../services/roomService");
const Room = require("../models/Room");
const RoomMember = require("../models/RoomMember");
const Snapshot = require("../models/Snapshot");
const User = require("../models/User");
const { checkSocketPermission, ensureRoomMembership, ROLE_HIERARCHY } = require("../middleware/rbac");
const { importRepoFromGitHub } = require("../services/githubRepoImport");
const { streamExec, destroyRoomContainer } = require("../services/execService");
const { extToLanguage } = require("../utils/extToLanguage");
const AUTO_JOIN_VIEWER = String(process.env.RBAC_AUTO_JOIN_VIEWER || "true").toLowerCase() !== "false";

function emitPermissionDenied(socket, roomId, permission, details = {}) {
  socket.emit("permission-denied", {
    roomId,
    permission,
    reason: details.reason || "Permission denied",
    currentRole: details.currentRole || null,
  });
}

async function handleJoinRoom(io, socket, { roomId }) {
  const userId = socket.userId || socket.auth?.user?.id;
  const username = socket.username || socket.auth?.user?.username || "anonymous";

  if (!roomId) {
    socket.emit("room-join-denied", { roomId, reason: "Room ID is required" });
    return;
  }

  if (!userId) {
    socket.emit("room-join-denied", { roomId, reason: "Authentication required" });
    return;
  }

  let member;
  try {
    member = await roomService.runWithLock(roomId, async () =>
      ensureRoomMembership(roomId, userId, username, { autoCreateViewer: AUTO_JOIN_VIEWER })
    );
  } catch (err) {
    console.error("[Join] Failed to resolve room membership:", err.message);
    socket.emit("room-join-denied", {
      roomId,
      reason: "Failed to verify room membership",
    });
    return;
  }

  if (!member) {
    socket.emit("room-join-denied", {
      roomId,
      reason: "Access denied - you are not a member of this room",
    });
    return;
  }
  const userRole = member.role;

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

  socket.join(roomId);
  socket.roomId = roomId;
  socket.username = username;
  socket.userRole = userRole;

  roomService.clearRoomCleanup(roomId);

  const stableUserId = String(socket.userId || socket.id);
  room.users = room.users.filter((u) => u.userId !== stableUserId && u.socketId !== socket.id);
  room.users.push({ socketId: socket.id, userId: stableUserId, username, role: userRole });

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
  // FIX: Client needs an explicit join acknowledgement to clear join timeout state.
  socket.emit("join-ack", { roomId, role: userRole, timestamp: Date.now() });
  io.to(roomId).emit("users-update", room.users);
  socket.to(roomId).emit("peer-joined", { socketId: socket.id });

  console.log(`${username} joined room ${roomId} (role: ${userRole})`);
}

async function handleFileChange(io, socket, { roomId, fileId, content }) {
  try {
    const nextContent = typeof content === "string" ? content : "";
    console.log(`[Socket] file-change received from ${socket.username}: ${fileId} (${nextContent.length} chars)`);
    const perm = await checkSocketPermission(socket, roomId, "EDIT_FILES");
    if (!perm.allowed) {
      console.log(`[Socket] file-change denied for ${socket.username}: ${perm.reason}`);
      emitPermissionDenied(socket, roomId, "EDIT_FILES", perm);
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

    room.files[fileId].content = nextContent;
    await roomService.setRoom(roomId, room);
    console.log(`[Socket] Broadcasting file-update to room ${roomId}`);
    socket.to(roomId).emit("file-update", { fileId, content: nextContent });
    roomService.persistRoom(roomId);
  } catch (err) {
    console.error("[Socket] file-change error:", err.message);
    socket.emit("operation-error", { msg: "Failed to save changes" });
  }
}

async function handleYjsUpdate(io, socket, { roomId, fileId, update }) {
  const perm = await checkSocketPermission(socket, roomId, "EDIT_FILES");
  if (!perm.allowed) {
    emitPermissionDenied(socket, roomId, "EDIT_FILES", perm);
    return;
  }
  socket.to(roomId).emit("yjs-update", { fileId, update });
}

async function handleCreateFile(io, socket, { roomId, file }) {
  const perm = await checkSocketPermission(socket, roomId, "CREATE_FILES");
  if (!perm.allowed) {
    emitPermissionDenied(socket, roomId, "CREATE_FILES", perm);
    return;
  }

  const room = await roomService.getRoom(roomId);
  if (!room) {
    socket.emit("operation-error", { msg: "Room not found" });
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
    emitPermissionDenied(socket, roomId, "CREATE_FOLDERS", perm);
    return;
  }

  const room = await roomService.getRoom(roomId);
  if (!room) {
    socket.emit("operation-error", { msg: "Room not found" });
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
    emitPermissionDenied(socket, roomId, "RENAME_ITEMS", perm);
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
    emitPermissionDenied(socket, roomId, "RENAME_ITEMS", perm);
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
    emitPermissionDenied(socket, roomId, "DELETE_FILES", perm);
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
    emitPermissionDenied(socket, roomId, "DELETE_FILES", perm);
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
  const perm = await checkSocketPermission(socket, roomId, "VIEW_ROOM");
  if (!perm.allowed) {
    emitPermissionDenied(socket, roomId, "VIEW_ROOM", perm);
    return;
  }

  const room = await roomService.getRoom(roomId);
  if (!room?.files[fileId]) return;
  room.activeFile = fileId;
  await roomService.setRoom(roomId, room);
  // FIX: Sender gets an ack so local activeFile can be reconciled with server state.
  socket.emit("file-switched-ack", { fileId });
  socket.to(roomId).emit("file-switched", { fileId });
  roomService.persistRoom(roomId);
}

async function handleBulkImport(io, socket, { roomId, files, folders, isLastChunk = true }) {
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

    if (isLastChunk && importedFiles.length === 0 && importedFolders.length === 0) {
      socket.emit("import-complete", {
        filesImported: 0,
        foldersImported: 0,
        alreadyExists: true,
      });
      return;
    }

    await roomService.setRoom(roomId, room);
    await roomService.persistRoom(roomId);

    // FIX: Sender mounts after import-complete; peers receive the persisted import via bulk-imported.
    socket.to(roomId).emit("bulk-imported", {
      files: importedFiles,
      folders: importedFolders,
      importedBy: socket.username,
    });

    if (isLastChunk) {
      socket.emit("import-complete", {
        filesImported: importedFiles.length,
        foldersImported: importedFolders.length,
      });
    }
  } catch (err) {
    console.error("[Import] Error:", err.message);
    socket.emit("import-error", { msg: "Import failed: " + err.message });
  }
}

async function handleStartGithubImport(io, socket, { roomId, owner, repo, ref } = {}) {
  try {
    const perm = await checkSocketPermission(socket, roomId, "IMPORT_FROM_GITHUB");
    if (!perm.allowed) {
      socket.emit("import-error", { msg: "Import requires editor role or higher" });
      return;
    }

    const room = await roomService.getRoom(roomId);
    if (!room) {
      socket.emit("import-error", { msg: "Room not found" });
      return;
    }

    const onProgress = (message) => {
      socket.emit("import-progress", { message });
    };

    onProgress("Fetching repo tree from GitHub...");

    const user = await User.findById(socket.userId).select("+githubAccessToken githubTokenExpiry");
    const token = user?.githubAccessToken || null;

    const data = await importRepoFromGitHub({
      owner,
      repo,
      ref: ref || undefined,
      token,
      onProgress,
    });

    onProgress(`Saving ${Object.keys(data.files).length} files to room...`);

    room.files = room.files || {};
    room.folders = room.folders || {};
    Object.assign(room.files, data.files);
    Object.assign(room.folders, data.folders);
    await roomService.setRoom(roomId, room);
    await roomService.persistRoom(roomId);

    const fileCount = Object.keys(data.files).length;

    io.to(roomId).emit("import-ready", {
      fileCount,
      meta: data.meta,
      importedBy: socket.username,
    });
  } catch (err) {
    console.error("[Import] Server-driven import failed:", err.message);
    socket.emit("import-error", {
      msg:
        err.status === 401
          ? "GitHub access denied. Reconnect your GitHub account."
          : err.status === 404
            ? "Repository not found. Check the owner/repo name and branch."
            : "Import failed: " + err.message,
    });
  }
}

async function handleGetFilePage(io, socket, { roomId, offset = 0, limit = 100 } = {}) {
  try {
    const perm = await checkSocketPermission(socket, roomId, "VIEW_ROOM");
    if (!perm.allowed) {
      socket.emit("file-page-error", { msg: "Access denied" });
      return;
    }

    const room = await roomService.getRoom(roomId);
    if (!room) {
      socket.emit("file-page-error", { msg: "Room not found" });
      return;
    }

    const pageOffset = Math.max(0, Number(offset) || 0);
    const pageLimit = Math.max(1, Math.min(Number(limit) || 100, 500));
    const allFileEntries = Object.entries(room.files || {});
    const page = Object.fromEntries(allFileEntries.slice(pageOffset, pageOffset + pageLimit));
    const folders = pageOffset === 0 ? room.folders || {} : {};

    socket.emit("file-page", {
      files: page,
      folders,
      offset: pageOffset,
      total: allFileEntries.length,
    });
  } catch (err) {
    socket.emit("file-page-error", { msg: "Failed to fetch file page: " + err.message });
  }
}

async function handleRunCode(io, socket, { roomId, command, language } = {}) {
  if (!roomId) return;

  const perm = await checkSocketPermission(socket, roomId, "EXECUTE_CODE");
  if (!perm.allowed) {
    emitPermissionDenied(socket, roomId, "EXECUTE_CODE", perm);
    return;
  }

  const room = await roomService.getRoom(roomId);
  if (!room) {
    socket.emit("run-output", { type: "stderr", payload: "[Error] Room not found\r\n" });
    return;
  }

  const files = {};
  for (const file of Object.values(room.files || {})) {
    if (!file?.name) continue;
    files[buildFilePath(file, room.folders || {})] = file.content || "";
  }

  socket.emit("run-started", { roomId });

  try {
    await streamExec({
      roomId,
      files,
      command: command || inferCommand(room, language),
      language: language || "javascript",
      onChunk({ type, payload }) {
        io.to(roomId).emit("run-output", { type, payload });
      },
    });
  } catch (err) {
    socket.emit("run-output", {
      type: "stderr",
      payload: `\r\n[SyncDev] Execution failed: ${err.message}\r\n`,
    });
  } finally {
    io.to(roomId).emit("run-finished", { roomId });
  }
}

async function handleKillRun(io, socket, { roomId } = {}) {
  if (!roomId) return;

  const perm = await checkSocketPermission(socket, roomId, "EXECUTE_CODE");
  if (!perm.allowed) {
    emitPermissionDenied(socket, roomId, "EXECUTE_CODE", perm);
    return;
  }

  await destroyRoomContainer(roomId);
  io.to(roomId).emit("run-output", {
    type: "stderr",
    payload: "\r\n[SyncDev] Run killed.\r\n",
  });
  io.to(roomId).emit("run-finished", { roomId });
}

function handleRetryUpload(io, socket) {
  socket.emit("upload-retry-ack");
}

async function handleLeaveRoom(io, socket, { roomId } = {}) {
  try {
    const targetRoomId = roomId || socket.roomId;
    if (!targetRoomId) return;

    const room = await roomService.getRoom(targetRoomId);
    socket.leave(targetRoomId);

    if (room) {
      room.users = room.users.filter((user) => user.socketId !== socket.id);
      await roomService.setRoom(targetRoomId, room);
      io.to(targetRoomId).emit("users-update", room.users);
      io.to(targetRoomId).emit("user-left", { socketId: socket.id });
      io.to(targetRoomId).emit("peer-left", { socketId: socket.id });
      if (room.users.length === 0) {
        roomService.persistRoom(targetRoomId);
        roomService.scheduleRoomCleanup(targetRoomId);
        await destroyRoomContainer(targetRoomId);
      }
    }

    socket.roomId = null;
    socket.userRole = null;
  } catch (err) {
    console.error("[Room] leave-room error:", err.message);
    socket.emit("operation-error", { msg: "Failed to leave room cleanly" });
  }
}

async function handleTerminateRoom(io, socket, { roomId }) {
  try {
    const perm = await checkSocketPermission(socket, roomId, "TRANSFER_OWNERSHIP");
    if (!perm.allowed) {
      emitPermissionDenied(socket, roomId, "TRANSFER_OWNERSHIP", {
        ...perm,
        reason: "Only the room owner can terminate the room.",
      });
      return;
    }

    const room = (await roomService.getRoom(roomId)) || (await roomService.loadRoomFromDB(roomId));
    if (!room) {
      socket.emit("operation-error", { msg: "Room not found" });
      return;
    }

    const socketsInRoom = await io.in(roomId).fetchSockets();
    io.to(roomId).emit("room-terminated", {
      roomId,
      msg: "The owner has ended this room.",
    });

    await Promise.all([
      Room.findOneAndDelete({ roomId }),
      RoomMember.deleteMany({ roomId }),
      Snapshot.deleteMany({ roomId }),
    ]);
    await roomService.destroyRoom(roomId);
    await destroyRoomContainer(roomId);

    setTimeout(() => {
      socketsInRoom.forEach((participant) => {
        participant.leave(roomId);
        participant.roomId = null;
        participant.disconnect(true);
      });
    }, 150);
  } catch (err) {
    console.error("[Room] terminate-room error:", err.message);
    socket.emit("operation-error", { msg: "Failed to terminate room" });
  }
}

async function handleChangeRole(io, socket, { roomId, username, role }) {
  try {
    const perm = await checkSocketPermission(socket, roomId, "MANAGE_ROLES");
    if (!perm.allowed) {
      emitPermissionDenied(socket, roomId, "MANAGE_ROLES", perm);
      return;
    }

    if (!ROLE_HIERARCHY[role]) {
      socket.emit("operation-error", { msg: "Invalid role" });
      return;
    }

    const target = await RoomMember.findOne({ roomId, username });
    if (!target) {
      socket.emit("operation-error", { msg: "Member not found" });
      return;
    }

    if (target.role === "owner") {
      emitPermissionDenied(socket, roomId, "MANAGE_ROLES", {
        reason: "Cannot change owner's role directly.",
        currentRole: perm.role,
      });
      return;
    }

    const requesterLevel = ROLE_HIERARCHY[perm.role] || 0;
    const currentTargetLevel = ROLE_HIERARCHY[target.role] || 0;
    const nextTargetLevel = ROLE_HIERARCHY[role] || 0;

    if (currentTargetLevel >= requesterLevel || nextTargetLevel >= requesterLevel) {
      emitPermissionDenied(socket, roomId, "MANAGE_ROLES", {
        reason: "Cannot change a member with equal or higher role.",
        currentRole: perm.role,
      });
      return;
    }

    const oldRole = target.role;
    target.role = role;
    await target.save();

    const room = await roomService.getRoom(roomId);
    if (room) {
      room.users = room.users.map((user) =>
        String(user.userId) === String(target.userId) ? { ...user, role } : user
      );
      await roomService.setRoom(roomId, room);
      io.to(roomId).emit("users-update", room.users);
    }

    const sockets = await io.in(roomId).fetchSockets();
    sockets.forEach((participant) => {
      if (String(participant.userId) !== String(target.userId)) return;
      participant.userRole = role;
      participant.emit("role-changed", {
        roomId,
        oldRole,
        newRole: role,
        changedBy: socket.username,
      });
    });

    io.to(roomId).emit("members-updated", { roomId });
  } catch (err) {
    console.error("[Room] change-role error:", err.message);
    socket.emit("operation-error", { msg: "Failed to change role" });
  }
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

function handleWebrtcEndCall(io, socket) {
  if (!socket.roomId) return;
  socket.to(socket.roomId).emit("webrtc-end-call", { from: socket.id });
}

async function handleDisconnect(io, socket) {
  const { roomId } = socket;
  const room = roomId && (await roomService.getRoom(roomId));
  if (room) {
    room.users = room.users.filter((u) => u.socketId !== socket.id);
    io.to(roomId).emit("users-update", room.users);
    socket.to(roomId).emit("peer-left", { socketId: socket.id });
    if (room.users.length === 0) {
      roomService.persistRoom(roomId);
      roomService.scheduleRoomCleanup(roomId);
      await destroyRoomContainer(roomId);
    }
  }
  console.log("user disconnected:", socket.id);
}

function buildFilePath(file, folders = {}) {
  const parts = [file.name];
  let parentId = file.parentId;
  let depth = 0;
  const visited = new Set();

  while (parentId && folders[parentId] && depth < 50 && !visited.has(parentId)) {
    visited.add(parentId);
    depth += 1;
    const folder = folders[parentId];
    parts.unshift(folder.name);
    parentId = folder.parentId;
  }

  return parts.join("/");
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function inferCommand(room, language) {
  const lang = String(language || "javascript").toLowerCase();
  const activeFile = room?.activeFile ? room.files?.[room.activeFile] : null;
  const activePath = activeFile ? shellQuote(buildFilePath(activeFile, room.folders || {})) : null;

  if (lang === "python") return `python3 ${activePath || "main.py"}`;
  if (lang === "shell") return `sh ${activePath || "entrypoint.sh"}`;
  if (lang === "typescript" || lang === "tsx") return `npx --yes tsx ${activePath || "index.ts"}`;
  return `node ${activePath || "index.js"}`;
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
  socket.on("yjs-update", (data) => handleYjsUpdate(io, socket, data));
  socket.on("create-file", (data) => handleCreateFile(io, socket, data));
  socket.on("create-folder", (data) => handleCreateFolder(io, socket, data));
  socket.on("rename-file", (data) => handleRenameFile(io, socket, data));
  socket.on("rename-folder", (data) => handleRenameFolder(io, socket, data));
  socket.on("delete-file", (data) => handleDeleteFile(io, socket, data));
  socket.on("delete-folder", (data) => handleDeleteFolder(io, socket, data));
  socket.on("switch-file", (data) => handleSwitchFile(io, socket, data));
  socket.on("bulk-import", (data) => handleBulkImport(io, socket, data));
  socket.on("start-github-import", (data) => handleStartGithubImport(io, socket, data));
  socket.on("get-file-page", (data) => handleGetFilePage(io, socket, data));
  socket.on("run-code", (data) => handleRunCode(io, socket, data));
  socket.on("kill-run", (data) => handleKillRun(io, socket, data));
  socket.on("leave-room", (data) => handleLeaveRoom(io, socket, data));
  socket.on("terminate-room", (data) => handleTerminateRoom(io, socket, data));
  socket.on("change-role", (data) => handleChangeRole(io, socket, data));
  socket.on("retry-upload", () => handleRetryUpload(io, socket));
  socket.on("webrtc-offer", (data) => handleWebrtcOffer(io, socket, data));
  socket.on("webrtc-answer", (data) => handleWebrtcAnswer(io, socket, data));
  socket.on("webrtc-ice-candidate", (data) => handleWebrtcIceCandidate(io, socket, data));
  socket.on("webrtc-end-call", () => handleWebrtcEndCall(io, socket));
  socket.on("disconnect", () => handleDisconnect(io, socket));
}

module.exports = {
  registerRoomHandlers,
  __testables: {
    handleFileChange,
    handleBulkImport,
    handleStartGithubImport,
    handleGetFilePage,
    handleRunCode,
    handleKillRun,
    buildFilePath,
    inferCommand,
    handleSwitchFile,
  },
};
