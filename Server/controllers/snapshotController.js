const snapshotService = require("../services/snapshotService");
const roomService = require("../services/roomService");
const { logger } = require("../logger");

async function listSnapshots(req, res) {
  try {
    const snapshots = await snapshotService.listSnapshots(req.params.roomId);
    return res.json({ snapshots });
  } catch (err) {
    logger.error("List snapshots error", { message: err.message, stack: err.stack });
    return res.status(500).json({ msg: "Failed to list snapshots" });
  }
}

async function createSnapshot(req, res) {
  const { name } = req.body;
  const roomId = req.params.roomId;
  const username = req.auth.user.username;

  if (!name || name.trim().length === 0) {
    return res.status(400).json({ msg: "Snapshot name is required" });
  }

  try {
    const room = await roomService.getRoom(roomId);
    if (!room) {
      return res.status(404).json({ msg: "Room not found" });
    }

    const snapshot = await snapshotService.createSnapshot(roomId, name.trim(), username, room);
    return res.json({
      msg: "Snapshot saved",
      snapshot: {
        snapshotId: snapshot.snapshotId,
        name: snapshot.name,
        createdAt: snapshot.createdAt,
      },
    });
  } catch (err) {
    logger.error("Create snapshot error", { message: err.message, stack: err.stack });
    return res.status(500).json({ msg: "Failed to create snapshot" });
  }
}

async function restoreSnapshot(req, res) {
  const { snapshotId } = req.body;
  const roomId = req.params.roomId;

  if (!snapshotId) {
    return res.status(400).json({ msg: "Snapshot ID is required" });
  }

  try {
    const snapshot = await snapshotService.findSnapshot(roomId, snapshotId);
    if (!snapshot) {
      return res.status(404).json({ msg: "Snapshot not found" });
    }

    const restoredRoom = await snapshotService.restoreSnapshot(roomId, snapshot);
    const io = req.app.get("io");
    if (io) {
      io.to(roomId).emit("room-state", {
        files: restoredRoom.files,
        folders: restoredRoom.folders,
        activeFile: restoredRoom.activeFile,
      });
    }

    return res.json({
      msg: "Snapshot restored",
      restoredFrom: snapshot.name,
      restoredAt: new Date().toISOString(),
      state: {
        files: restoredRoom.files,
        folders: restoredRoom.folders,
        activeFile: restoredRoom.activeFile,
      },
    });
  } catch (err) {
    logger.error("Restore snapshot error", { message: err.message, stack: err.stack });
    return res.status(500).json({ msg: "Failed to restore snapshot" });
  }
}

async function deleteSnapshot(req, res) {
  const roomId = req.params.roomId;
  const snapshotId = req.params.snapshotId;

  try {
    const deletedCount = await snapshotService.deleteSnapshot(roomId, snapshotId);
    if (deletedCount === 0) {
      return res.status(404).json({ msg: "Snapshot not found" });
    }

    return res.json({ msg: "Snapshot deleted" });
  } catch (err) {
    logger.error("Delete snapshot error", { message: err.message, stack: err.stack });
    return res.status(500).json({ msg: "Failed to delete snapshot" });
  }
}

module.exports = {
  listSnapshots,
  createSnapshot,
  restoreSnapshot,
  deleteSnapshot,
};
