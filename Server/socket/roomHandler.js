const roomService = require("../services/roomService");
const Room = require("../models/Room");
const RoomMember = require("../models/RoomMember");
const Snapshot = require("../models/Snapshot");
const User = require("../models/User");
const { checkSocketPermission, ensureRoomMembership, ROLE_HIERARCHY } = require("../middleware/rbac");
const { importRepoFromGitHub } = require("../services/githubRepoImport");
const { streamExec, destroyRoomContainer } = require("../services/execService");
const { extToLanguage } = require("../utils/extToLanguage");
const WebSocket = require("ws");
const EXEC_URL = process.env.EXEC_SERVICE_URL || "http://localhost:4000";
const EXEC_SECRET = process.env.EXEC_SERVICE_SECRET || "change-me-in-production";
const terminalSessions = require("../services/terminalSessions");
const socketHandler = require("../utils/socketHandler");
const { redis, ensureRedisConnection } = require("../config/redis");

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
    if (typeof nextContent === "string" && nextContent.length > 5 * 1024 * 1024) {
      socket.emit("operation-error", { msg: "File content exceeds 5MB limit" });
      return;
    }
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
  if (update && update.length > 1 * 1024 * 1024) {
    return;
  }
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
    const totalSize = Object.values(files || {}).reduce((sum, f) => sum + (f?.content?.length || 0), 0);
    if (totalSize > 10 * 1024 * 1024) {
      socket.emit("operation-error", { msg: "Import exceeds 10MB total size limit" });
      return;
    }

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

  io.to(roomId).emit("run-started", { roomId });

  const runCommand = command || inferCommand(room, language);
  try {
    await streamExec({
      roomId,
      files,
      command: runCommand,
      language: language || "javascript",
      onChunk({ type, payload }) {
        io.to(roomId).emit("run-output", { type, payload });
      },
    });
    if (await ensureRedisConnection()) {
      const historyKey = `exechistory:${roomId}`;
      await redis.lpush(historyKey, JSON.stringify({ command: runCommand, language: language || "javascript", exitCode: 0, timestamp: Date.now(), triggeredBy: socket.username }));
      await redis.ltrim(historyKey, 0, 19);
      await redis.expire(historyKey, 86400);
    }
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


async function handleStartTerminal(io, socket, { roomId, language } = {}) {
  if (!roomId) return;

  const perm = await checkSocketPermission(socket, roomId, "EXECUTE_CODE");
  if (!perm.allowed) {
    emitPermissionDenied(socket, roomId, "EXECUTE_CODE", perm);
    return;
  }

  // Guard: if a session already exists, just re-emit ready for this socket
  if (terminalSessions.has(roomId)) {
    const existing = terminalSessions.get(roomId);
    // Only reuse if the ptyWs connection is still alive
    if (existing.ptyWs?.readyState === WebSocket.OPEN) {
      const SERVER_ORIGIN = process.env.PUBLIC_SERVER_URL || "http://localhost:3000";
      socket.emit("terminal-ready", {
        roomId,
        previewUrl: `${SERVER_ORIGIN}/preview/${roomId}/?token=${existing.previewToken}&port=3000`,
        portMap: {
          3000: `${SERVER_ORIGIN}/preview/${roomId}/?token=${existing.previewToken}&port=3000`,
          5173: `${SERVER_ORIGIN}/preview/${roomId}/?token=${existing.previewToken}&port=5173`,
          8000: `${SERVER_ORIGIN}/preview/${roomId}/?token=${existing.previewToken}&port=8000`,
          8080: `${SERVER_ORIGIN}/preview/${roomId}/?token=${existing.previewToken}&port=8080`,
        },
      });
      return;
    }
    // Session exists but ptyWs is dead — clean it up and fall through to create a new one
    terminalSessions.delete(roomId);
  }

  const rateLimitKey = `terminal:ratelimit:${socket.userId}`;
  const ready = await ensureRedisConnection();
  if (ready) {
    const count = await redis.incr(rateLimitKey);
    if (count === 1) await redis.expire(rateLimitKey, 60);
    if (count > 3) {
      socket.emit("operation-error", { msg: "Too many terminal sessions. Wait 1 minute." });
      return;
    }
  }

  const startRes = await fetch(`${EXEC_URL}/terminal/start`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-internal-secret": EXEC_SECRET,
    },
    body: JSON.stringify({ roomId, language }),
  });

  if (!startRes.ok) {
    throw new Error(await startRes.text());
  }

  const { ports = {} } = await startRes.json();
  const wsUrl = `${EXEC_URL.replace("http", "ws")}/terminal/ws?roomId=${encodeURIComponent(roomId)}&secret=${encodeURIComponent(EXEC_SECRET)}`;
  const ptyWs = new WebSocket(wsUrl);
  ptyWs.on("error", (err) => {
    console.error("[handleStartTerminal] ptyWs error:", err.message);
    terminalSessions.delete(roomId);
  });
  const previewToken = require("crypto").randomBytes(16).toString("hex");
  terminalSessions.set(roomId, { ports, ptyWs, previewToken });

  ptyWs.on("open", async () => {
    const room = await roomService.getRoom(roomId);
    const files = {};
    for (const file of Object.values(room?.files || {})) {
      if (!file?.name) continue;
      files[buildFilePath(file, room.folders || {})] = file.content || "";
    }
    ptyWs.send(JSON.stringify({ type: "init", files, cols: 120, rows: 30 }));
  });

  ptyWs.on("message", (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === "ready") {
        const SERVER_ORIGIN = process.env.PUBLIC_SERVER_URL || "http://localhost:3000";
        const portMap = {
          3000: `${SERVER_ORIGIN}/preview/${roomId}/?token=${previewToken}&port=3000`,
          5173: `${SERVER_ORIGIN}/preview/${roomId}/?token=${previewToken}&port=5173`,
          8000: `${SERVER_ORIGIN}/preview/${roomId}/?token=${previewToken}&port=8000`,
          8080: `${SERVER_ORIGIN}/preview/${roomId}/?token=${previewToken}&port=8080`,
        };
        // Default preview to port 3000 (Express/Node) — user can switch
        io.to(roomId).emit("terminal-ready", {
          roomId,
          previewUrl: portMap[3000],
          portMap,
        });
      } else if (msg.type === "output") {
        io.to(roomId).emit("terminal-output", { roomId, data: msg.data });
      } else if (msg.type === "exit") {
        io.to(roomId).emit("terminal-exit", { roomId, code: msg.code });
      }
    } catch {}
  });
}

function handleTerminalInput(_io, _socket, { roomId, data } = {}) {
  const term = terminalSessions.get(roomId);
  if (term?.ptyWs?.readyState === WebSocket.OPEN) {
    term.ptyWs.send(JSON.stringify({ type: "input", data }));
  }
}

function handleTerminalResize(_io, _socket, { roomId, cols, rows } = {}) {
  const term = terminalSessions.get(roomId);
  if (term?.ptyWs?.readyState === WebSocket.OPEN) {
    term.ptyWs.send(JSON.stringify({ type: "resize", cols, rows }));
  }
}

async function handleStopTerminal(io, _socket, { roomId } = {}) {
  if (!roomId) return;
  const term = terminalSessions.get(roomId);

  if (term?.ptyWs) {
    await new Promise((resolve) => {
      if (term.ptyWs.readyState === WebSocket.OPEN) {
        const timer = setTimeout(resolve, 3000);
        term.ptyWs.once("close", () => { clearTimeout(timer); resolve(); });
        term.ptyWs.close();
      } else {
        resolve();
      }
    });
  }

  try {
    await fetch(`${EXEC_URL}/terminal/${encodeURIComponent(roomId)}`, {
      method: "DELETE",
      headers: { "x-internal-secret": EXEC_SECRET },
    });
  } catch (err) {
    console.error("[handleStopTerminal] DELETE failed:", err.message);
  }

  terminalSessions.delete(roomId);
  io.to(roomId).emit("terminal-stopped", { roomId });
}

async function handleGetExecHistory(_io, socket, { roomId } = {}) {
  const ready = await ensureRedisConnection();
  if (!ready) return socket.emit("exec-history", []);
  const key = `exechistory:${roomId}`;
  const items = await redis.lrange(key, 0, 19);
  socket.emit("exec-history", items.map((i) => JSON.parse(i)));
}

function handleCursorMove(_io, socket, { roomId, fileId, position } = {}) {
  socket.to(roomId).emit("cursor-update", { socketId: socket.id, username: socket.username, fileId, position });
}


async function handleLeaveRoom(io, socket, { roomId } = {}) {
  const rid = roomId || socket.roomId;
  if (!rid) return;
  socket.leave(rid);
  const room = await roomService.getRoom(rid);
  if (room?.users) {
    room.users = room.users.filter((u) => u.socketId !== socket.id);
    await roomService.setRoom(rid, room);
    io.to(rid).emit("users-update", room.users);
    if (room.users.length === 0) roomService.scheduleRoomCleanup(rid);
  }
}

async function handleTerminateRoom(io, socket, { roomId } = {}) {
  if (!roomId) return;
  const perm = await checkSocketPermission(socket, roomId, "TERMINATE_ROOM");
  if (!perm.allowed) {
    emitPermissionDenied(socket, roomId, "TERMINATE_ROOM", perm);
    return;
  }

  // Clean up terminal session if one exists for this room
  const term = terminalSessions.get(roomId);
  if (term) {
    if (term.ptyWs?.readyState === WebSocket.OPEN) {
      term.ptyWs.close();
    }
    try {
      await fetch(`${EXEC_URL}/terminal/${encodeURIComponent(roomId)}`, {
        method: "DELETE",
        headers: { "x-internal-secret": EXEC_SECRET },
      });
    } catch (err) {
      console.error("[handleTerminateRoom] Terminal cleanup failed:", err.message);
    }
    terminalSessions.delete(roomId);
  }

  await roomService.destroyRoom(roomId);
  io.to(roomId).emit("room-terminated", { roomId });
}

async function handleChangeRole(io, socket, { roomId } = {}) {
  const perm = await checkSocketPermission(socket, roomId, "MANAGE_ROLES");
  if (!perm.allowed) emitPermissionDenied(socket, roomId, "MANAGE_ROLES", perm);
}

function handleRetryUpload() {}
function handleWebrtcOffer(io, socket, data = {}) { socket.to(data.roomId).emit("webrtc-offer", { ...data, socketId: socket.id }); }
function handleWebrtcAnswer(io, socket, data = {}) { socket.to(data.roomId).emit("webrtc-answer", { ...data, socketId: socket.id }); }
function handleWebrtcIceCandidate(io, socket, data = {}) { socket.to(data.roomId).emit("webrtc-ice-candidate", { ...data, socketId: socket.id }); }
function handleWebrtcEndCall(io, socket, { roomId } = {}) { socket.to(roomId).emit("webrtc-end-call", { socketId: socket.id }); }
async function handleDisconnect(io, socket) { await handleLeaveRoom(io, socket, { roomId: socket.roomId }); }

function registerRoomHandlers(io, socket) {
  const username = socket.auth?.user?.username || "anonymous";

  if (process.env.NODE_ENV !== "production") {
    socket.onAny((event) => {
      console.log(`[DEBUG] Event "${event}" from ${username}`);
    });
  }

  const sh = (fn) => socketHandler(io, socket, fn);

  socket.on("join-room",            sh(handleJoinRoom));
  socket.on("file-change",          sh(handleFileChange));
  socket.on("yjs-update",           sh(handleYjsUpdate));
  socket.on("create-file",          sh(handleCreateFile));
  socket.on("create-folder",        sh(handleCreateFolder));
  socket.on("rename-file",          sh(handleRenameFile));
  socket.on("rename-folder",        sh(handleRenameFolder));
  socket.on("delete-file",          sh(handleDeleteFile));
  socket.on("delete-folder",        sh(handleDeleteFolder));
  socket.on("switch-file",          sh(handleSwitchFile));
  socket.on("bulk-import",          sh(handleBulkImport));
  socket.on("start-github-import",  sh(handleStartGithubImport));
  socket.on("get-file-page",        sh(handleGetFilePage));
  socket.on("run-code",             sh(handleRunCode));
  socket.on("kill-run",             sh(handleKillRun));
  socket.on("start-terminal",       sh(handleStartTerminal));
  socket.on("terminal-input",       sh(handleTerminalInput));
  socket.on("terminal-resize",      sh(handleTerminalResize));
  socket.on("stop-terminal",        sh(handleStopTerminal));
  socket.on("get-exec-history",     sh(handleGetExecHistory));
  socket.on("cursor-move",          sh(handleCursorMove));
  socket.on("leave-room",           sh(handleLeaveRoom));
  socket.on("terminate-room",       sh(handleTerminateRoom));
  socket.on("change-role",          sh(handleChangeRole));
  socket.on("retry-upload",         sh(handleRetryUpload));
  socket.on("webrtc-offer",         sh(handleWebrtcOffer));
  socket.on("webrtc-answer",        sh(handleWebrtcAnswer));
  socket.on("webrtc-ice-candidate", sh(handleWebrtcIceCandidate));
  socket.on("webrtc-end-call",      sh(handleWebrtcEndCall));
  socket.on("disconnect",           () => handleDisconnect(io, socket));
}


function buildFilePath(file, folders = {}) {
  if (!file?.name) return "";

  const segments = [file.name];
  const seen = new Set();
  let parentId = file.parentId;

  while (parentId && !seen.has(parentId)) {
    seen.add(parentId);
    const folder = folders[parentId];
    if (!folder) break;
    if (folder.name) segments.unshift(folder.name);
    parentId = folder.parentId;
  }

  return segments.join("/");
}

function inferCommand(room = {}, language = "javascript") {
  const activeFile = room?.activeFile ? room?.files?.[room.activeFile] : null;
  const activePath = activeFile ? buildFilePath(activeFile, room?.folders || {}) : "";
  const lang = String(language || "javascript").toLowerCase();

  switch (lang) {
    case "typescript":
      return activePath ? `npx ts-node ${activePath}` : "npx ts-node index.ts";
    case "python":
      if (activePath) return `([ -f requirements.txt ] && pip install --user -q -r requirements.txt 2>&1); python3 ${activePath}`;
      return "([ -f requirements.txt ] && pip install --user -q -r requirements.txt 2>&1); python3 main.py";
    case "java":
      return activePath ? `javac ${activePath} && java ${activePath.replace(/\.java$/i, "")}` : "javac  && java ";
    case "cpp":
    case "c":
      return activePath ? `g++ -o out ${activePath} && ./out` : "g++ -o out  && ./out";
    case "go":
      return activePath ? `go run ${activePath}` : "go run main.go";
    case "rust":
      return "cargo run";
    case "ruby":
      return activePath ? `ruby ${activePath}` : "ruby main.rb";
    case "php":
      return activePath ? `php ${activePath}` : "php index.php";
    case "shell":
    case "sh":
      return activePath ? `bash ${activePath}` : "bash run.sh";
    case "html":
      return `echo "__SYNCDEV_HTML_PREVIEW__:${activePath || "index.html"}"`;
    case "javascript":
    default:
      return activePath ? `node ${activePath}` : "node index.js";
  }
}


module.exports = {
  registerRoomHandlers,
  handleJoinRoom,
  handleRunCode,
  handleStartTerminal,
  inferCommand,
  buildFilePath,
};
