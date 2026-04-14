/**
 * Workspace Snapshots API
 * Save and restore room state snapshots
 */

const router = require("express").Router();
const { authJwt } = require("../middleware/authJwt");
const { requirePermission } = require("../middleware/rbac");
const Snapshot = require("../models/Snapshot");
const Room = require("../models/Room");
const roomService = require("../services/roomService");
const { generateNodeId } = require("../utils/ids");

// GET /api/snapshots/:roomId — List snapshots for a room
router.get("/:roomId", authJwt, requirePermission("VIEW_ROOM"), async (req, res) => {
  try {
    const snapshots = await Snapshot.find({ roomId: req.params.roomId })
      .sort({ createdAt: -1 })
      .limit(50)
      .select("snapshotId name createdBy createdAt");
    
    return res.json({ snapshots });
  } catch (err) {
    console.error("List snapshots error:", err.message);
    return res.status(500).json({ msg: "Failed to list snapshots" });
  }
});

// POST /api/snapshots/:roomId — Create a new snapshot
router.post("/:roomId", authJwt, requirePermission("CREATE_SNAPSHOT"), async (req, res) => {
  const { name } = req.body;
  const roomId = req.params.roomId;
  const username = req.auth.user.username;
  
  if (!name || name.trim().length === 0) {
    return res.status(400).json({ msg: "Snapshot name is required" });
  }
  
  try {
    // Get current room state
    const room = await Room.findOne({ roomId });
    if (!room) {
      return res.status(404).json({ msg: "Room not found" });
    }
    
    const snapshot = new Snapshot({
      roomId,
      snapshotId: `snap_${Date.now()}_${generateNodeId().slice(-6)}`,
      name: name.trim(),
      createdBy: username,
      files: room.files,
      folders: room.folders,
      activeFile: room.activeFile,
    });
    
    await snapshot.save();
    
    return res.json({
      msg: "Snapshot saved",
      snapshot: {
        snapshotId: snapshot.snapshotId,
        name: snapshot.name,
        createdAt: snapshot.createdAt,
      },
    });
  } catch (err) {
    console.error("Create snapshot error:", err.message);
    return res.status(500).json({ msg: "Failed to create snapshot" });
  }
});

// POST /api/snapshots/:roomId/restore — Restore a snapshot
router.post("/:roomId/restore", authJwt, requirePermission("RESTORE_SNAPSHOT"), async (req, res) => {
  const { snapshotId } = req.body;
  const roomId = req.params.roomId;
  
  if (!snapshotId) {
    return res.status(400).json({ msg: "Snapshot ID is required" });
  }
  
  try {
    const snapshot = await Snapshot.findOne({ roomId, snapshotId });
    if (!snapshot) {
      return res.status(404).json({ msg: "Snapshot not found" });
    }
    
    // Restore room state in MongoDB
    await Room.findOneAndUpdate(
      { roomId },
      {
        files: snapshot.files,
        folders: snapshot.folders,
        activeFile: snapshot.activeFile,
        lastActivity: new Date(),
      },
      { upsert: true }
    );
    
    // Bug C: Update live in-memory room state
    const room = roomService.getRoom(roomId);
    if (room) {
      room.files = Object.fromEntries(snapshot.files);
      room.folders = Object.fromEntries(snapshot.folders);
      room.activeFile = snapshot.activeFile;
      
      // Emit to all connected sockets
      const io = req.app.get("io");
      if (io) {
        io.to(roomId).emit("room-state", {
          files: room.files,
          folders: room.folders,
          activeFile: room.activeFile,
        });
      }
    }
    
    return res.json({
      msg: "Snapshot restored",
      restoredFrom: snapshot.name,
      restoredAt: new Date().toISOString(),
      state: {
        files: Object.fromEntries(snapshot.files),
        folders: Object.fromEntries(snapshot.folders),
        activeFile: snapshot.activeFile,
      },
    });
  } catch (err) {
    console.error("Restore snapshot error:", err.message);
    return res.status(500).json({ msg: "Failed to restore snapshot" });
  }
});

// DELETE /api/snapshots/:roomId/:snapshotId — Delete a snapshot
router.delete("/:roomId/:snapshotId", authJwt, requirePermission("DELETE_SNAPSHOT"), async (req, res) => {
  try {
    const result = await Snapshot.deleteOne({
      roomId: req.params.roomId,
      snapshotId: req.params.snapshotId,
    });
    
    if (result.deletedCount === 0) {
      return res.status(404).json({ msg: "Snapshot not found" });
    }
    
    return res.json({ msg: "Snapshot deleted" });
  } catch (err) {
    console.error("Delete snapshot error:", err.message);
    return res.status(500).json({ msg: "Failed to delete snapshot" });
  }
});

module.exports = router;
