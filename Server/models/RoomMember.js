const mongoose = require("mongoose");

/**
 * Room Member Schema - RBAC for room-level permissions
 */
const RoomMemberSchema = new mongoose.Schema({
  roomId: { type: String, required: true, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  username: { type: String, required: true },
  role: {
    type: String,
    enum: ["owner", "admin", "editor", "viewer"],
    default: "viewer",
    required: true,
  },
  joinedAt: { type: Date, default: Date.now },
  lastActive: { type: Date, default: Date.now },
});

// Compound index for fast lookups
RoomMemberSchema.index({ roomId: 1, userId: 1 }, { unique: true });
RoomMemberSchema.index({ roomId: 1, role: 1 });

module.exports = mongoose.model("RoomMember", RoomMemberSchema);
