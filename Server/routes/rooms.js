const router = require("express").Router();
const Room = require("../models/Room");
const { randomBytes } = require("crypto");
const { authJwt } = require("../middleware/authJwt");
const { assignRoomOwner } = require("../middleware/rbac");
const roomService = require("../services/roomService");

const ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function generateRoomId(length = 8) {
  const bytes = randomBytes(length);
  let roomId = "";
  for (let index = 0; index < length; index += 1) {
    roomId += ROOM_ALPHABET[bytes[index] % ROOM_ALPHABET.length];
  }
  return roomId;
}

router.post("/", authJwt, async (req, res) => {
  const userId = req.auth?.user?.id;
  const username = req.auth?.user?.username || "anonymous";
  if (!userId) {
    return res.status(401).json({ msg: "Authentication required" });
  }

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const roomId = generateRoomId();
    const exists = await Room.exists({ roomId });
    if (exists) continue;

    const roomState = roomService.makeDefaultRoom();

    try {
      // FIX: Room creation is now server-backed so dashboard errors are visible and ownership is persisted immediately.
      await Room.create({
        roomId,
        files: roomState.files,
        folders: roomState.folders,
        activeFile: roomState.activeFile,
        lastActivity: new Date(),
      });
      await assignRoomOwner(roomId, userId, username);
      await roomService.setRoom(roomId, roomState);

      return res.status(201).json({ roomId });
    } catch (error) {
      await Room.deleteOne({ roomId }).catch(() => {});
      if (error?.code === 11000) {
        continue;
      }
      return res.status(500).json({ msg: "Failed to create room" });
    }
  }

  return res.status(500).json({ msg: "Could not allocate a room ID. Try again." });
});

module.exports = router;
