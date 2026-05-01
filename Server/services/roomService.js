const Room = require("../models/Room");
const { EMPTY_ROOM_GRACE_MS } = require("../config/constants");
const { redis, ensureRedisConnection } = require("../config/redis");

const rooms = {};
const emptyRoomTimers = new Map();
const roomMembershipLocks = new Map();

function roomKey(roomId) {
  return `room:${roomId}`;
}

async function getRoom(roomId) {
  if (rooms[roomId]) return rooms[roomId];

  try {
    const ready = await ensureRedisConnection();
    if (!ready) return null;
    const raw = await redis.get(roomKey(roomId));
    if (!raw) return null;
    const room = JSON.parse(raw);
    rooms[roomId] = room;
    return room;
  } catch (err) {
    console.error(`Room GET error for ${roomId}:`, err.message);
    return null;
  }
}

function getRooms() {
  return rooms;
}

async function setRoom(roomId, roomState) {
  rooms[roomId] = roomState;
  try {
    const ready = await ensureRedisConnection();
    if (!ready) return rooms[roomId];
    await redis.set(roomKey(roomId), JSON.stringify(roomState));
  } catch (err) {
    console.error(`Room SET error for ${roomId}:`, err.message);
  }
  return rooms[roomId];
}

async function destroyRoom(roomId) {
  clearRoomCleanup(roomId);
  delete rooms[roomId];
  try {
    const ready = await ensureRedisConnection();
    if (!ready) return;
    await redis.del(roomKey(roomId));
  } catch (err) {
    console.error(`Room destroy error for ${roomId}:`, err.message);
  }
}

function clearRoomCleanup(roomId) {
  const timer = emptyRoomTimers.get(roomId);
  if (timer) {
    clearTimeout(timer);
    emptyRoomTimers.delete(roomId);
  }
}

function scheduleRoomCleanup(roomId) {
  clearRoomCleanup(roomId);
  emptyRoomTimers.set(
    roomId,
    setTimeout(() => {
      emptyRoomTimers.delete(roomId);
      const room = rooms[roomId];
      if (!room) return;
      if (room.users.length === 0) {
        delete rooms[roomId];
        ensureRedisConnection().then((ready) => {
          if (!ready) return;
          return redis.del(roomKey(roomId));
        }).catch((err) =>
          console.error(`Room cleanup delete error for ${roomId}:`, err.message)
        );
      }
    }, EMPTY_ROOM_GRACE_MS)
  );
}

async function runWithLock(roomId, fn) {
  const previous = roomMembershipLocks.get(roomId) || Promise.resolve();
  let release;
  const current = new Promise((resolve) => {
    release = resolve;
  });
  roomMembershipLocks.set(roomId, current);

  try {
    await previous.catch(() => {});
    return await fn();
  } finally {
    release();
    if (roomMembershipLocks.get(roomId) === current) {
      roomMembershipLocks.delete(roomId);
    }
  }
}

function makeDefaultRoom() {
  const fileId = "file_main";
  return {
    files: {
      [fileId]: {
        id: fileId,
        name: "main.js",
        content: "// Start coding here\n",
        language: "javascript",
        parentId: null,
      },
    },
    folders: {},
    activeFile: fileId,
    users: [],
  };
}

async function persistRoom(roomId) {
  const room = rooms[roomId];
  if (!room) return;
  if (typeof room.files?.forEach === "function" && !(room.files instanceof Map)) {
    console.error("[Persist] room.files is a Mongoose document, not a plain object. Skipping persist.");
    return;
  }

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
      { upsert: true }
    );
  } catch (err) {
    console.error("Room persist error:", err.message);
  }
}

async function loadRoomFromDB(roomId) {
  const KNOWN_FILE_FIELDS = ["id", "name", "content", "language", "parentId", "readOnly"];
  const normalizeEntry = (val, knownFields) => {
    const raw = typeof val?.toObject === "function" ? val.toObject() : (val || {});
    const clean = {};
    knownFields.forEach((field) => {
      if (raw[field] !== undefined) clean[field] = raw[field];
    });
    if (clean.content == null) clean.content = "";
    return clean;
  };
  const deserializeMapField = (field, knownFields) => {
    const result = {};
    if (!field) return result;
    if (typeof field.forEach === "function") {
      field.forEach((val, key) => {
        try {
          result[key] = normalizeEntry(val, knownFields);
        } catch {
          result[key] = normalizeEntry({}, knownFields);
        }
      });
    } else if (typeof field === "object") {
      Object.entries(field).forEach(([key, val]) => {
        result[key] = normalizeEntry(val, knownFields);
      });
    }
    return result;
  };
  try {
    const doc = await Room.findOne({ roomId });
    if (!doc) {
      console.log(`[DB] Room ${roomId} not found`);
      return null;
    }

    console.log(`[DB] Found room ${roomId}, files type:`, typeof doc.files, doc.files?.constructor?.name);

    const files = deserializeMapField(doc.files, KNOWN_FILE_FIELDS);
    const folders = deserializeMapField(doc.folders, ["id", "name", "parentId"]);
    const required = ["id", "name"];
    Object.entries(files).forEach(([key, file]) => {
      if (!required.every((f) => file[f])) {
        console.warn(`[DB] Dropping malformed file entry key="${key}"`, file);
        delete files[key];
      }
    });
    if (Object.keys(files).length === 0 && doc.files && (doc.files.size > 0 || Object.keys(doc.files || {}).length > 0)) {
      console.error("[DB] Deserialization produced 0 files despite non-empty doc.files. Raw:", doc.files);
    }

    console.log(`[DB] Loaded files:`, Object.keys(files).length, Object.keys(files));
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

function deleteFolder(room, folderId, visited = new Set()) {
  if (visited.has(folderId)) return { deletedFiles: [], deletedFolders: [] };
  visited.add(folderId);

  const deletedFiles = [];
  const deletedFolders = [];
  const foldersToDelete = [folderId];
  const filesToDelete = [];

  let i = 0;
  while (i < foldersToDelete.length) {
    const currentFolderId = foldersToDelete[i++];

    for (const [id, file] of Object.entries(room.files)) {
      if (file.parentId === currentFolderId && !filesToDelete.includes(id)) {
        filesToDelete.push(id);
      }
    }

    for (const [id, folder] of Object.entries(room.folders)) {
      if (folder.parentId === currentFolderId && !foldersToDelete.includes(id)) {
        foldersToDelete.push(id);
      }
    }
  }

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

module.exports = {
  getRoom,
  getRooms,
  setRoom,
  destroyRoom,
  persistRoom,
  loadRoomFromDB,
  makeDefaultRoom,
  scheduleRoomCleanup,
  clearRoomCleanup,
  runWithLock,
  deleteFolder,
};
