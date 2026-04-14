const Room = require("../models/Room");
const { EMPTY_ROOM_GRACE_MS } = require("../config/constants");
const { redis } = require("../config/redis");

const rooms = {};
const emptyRoomTimers = new Map();
const roomMembershipLocks = new Map();

function roomKey(roomId) {
  return `room:${roomId}`;
}

async function getRoom(roomId) {
  if (rooms[roomId]) return rooms[roomId];

  try {
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
    await redis.set(roomKey(roomId), JSON.stringify(roomState));
  } catch (err) {
    console.error(`Room SET error for ${roomId}:`, err.message);
  }
  return rooms[roomId];
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
        redis.del(roomKey(roomId)).catch((err) =>
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
  try {
    const doc = await Room.findOne({ roomId });
    if (!doc) {
      console.log(`[DB] Room ${roomId} not found`);
      return null;
    }

    console.log(`[DB] Found room ${roomId}, files type:`, typeof doc.files, doc.files?.constructor?.name);

    const files = {};
    if (doc.files && typeof doc.files.forEach === "function") {
      doc.files.forEach((val, key) => {
        files[key] = val.toObject();
      });
    } else {
      console.log(`[DB] doc.files is not a Map, it's:`, doc.files);
    }

    const folders = {};
    if (doc.folders && typeof doc.folders.forEach === "function") {
      doc.folders.forEach((val, key) => {
        folders[key] = val.toObject();
      });
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
  persistRoom,
  loadRoomFromDB,
  makeDefaultRoom,
  scheduleRoomCleanup,
  clearRoomCleanup,
  runWithLock,
  deleteFolder,
};