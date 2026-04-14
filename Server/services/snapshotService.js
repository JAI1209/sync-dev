const Snapshot = require("../models/Snapshot");
const Room = require("../models/Room");
const roomService = require("./roomService");
const { generateNodeId } = require("../utils/ids");

async function listSnapshots(roomId) {
  return Snapshot.find({ roomId })
    .sort({ createdAt: -1 })
    .limit(50)
    .select("snapshotId name createdBy createdAt")
    .lean();
}

async function createSnapshot(roomId, name, username, room) {
  const snapshot = new Snapshot({
    roomId,
    snapshotId: generateNodeId("snap"),
    name,
    createdBy: username,
    files: room.files,
    folders: room.folders,
    activeFile: room.activeFile,
  });

  await snapshot.save();
  return snapshot.toObject();
}

async function findSnapshot(roomId, snapshotId) {
  return Snapshot.findOne({ roomId, snapshotId }).lean();
}

async function restoreSnapshot(roomId, snapshot) {
  const updatedRoom = {
    files: snapshot.files,
    folders: snapshot.folders,
    activeFile: snapshot.activeFile,
  };

  await Room.findOneAndUpdate(
    { roomId },
    {
      roomId,
      files: snapshot.files,
      folders: snapshot.folders,
      activeFile: snapshot.activeFile,
      lastActivity: new Date(),
    },
    { upsert: true, new: true }
  );

  const currentRoom = await roomService.getRoom(roomId);
  await roomService.setRoom(roomId, {
    ...currentRoom,
    files: snapshot.files,
    folders: snapshot.folders,
    activeFile: snapshot.activeFile,
  });

  return updatedRoom;
}

async function deleteSnapshot(roomId, snapshotId) {
  const result = await Snapshot.deleteOne({ roomId, snapshotId });
  return result.deletedCount;
}

module.exports = {
  listSnapshots,
  createSnapshot,
  findSnapshot,
  restoreSnapshot,
  deleteSnapshot,
};
