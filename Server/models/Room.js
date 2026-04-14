const mongoose = require("mongoose");

const FileSchema = new mongoose.Schema({
  id: { type: String, required: true },
  name: { type: String, required: true },
  content: { type: String, default: "" },
  language: { type: String, default: "plaintext" },
  parentId: { type: String, default: null },
}, { _id: false });

const FolderSchema = new mongoose.Schema({
  id: { type: String, required: true },
  name: { type: String, required: true },
  parentId: { type: String, default: null },
}, { _id: false });

const RoomSchema = new mongoose.Schema({
  roomId: { type: String, required: true, unique: true },
  files: { type: Map, of: FileSchema, default: {} },
  folders: { type: Map, of: FolderSchema, default: {} },
  activeFile: { type: String, default: null },
  lastActivity: { type: Date, default: Date.now },
});

RoomSchema.index({ lastActivity: 1 }, { expireAfterSeconds: 86400 * 30 }); // auto-delete after 30 days inactivity

module.exports = mongoose.model("Room", RoomSchema);
