const mongoose = require("mongoose");

const FileSnapshotSchema = new mongoose.Schema({
  id: { type: String, required: true },
  name: { type: String, required: true },
  content: { type: String, default: "" },
  language: { type: String, default: "plaintext" },
  parentId: { type: String, default: null },
}, { _id: false });

const FolderSnapshotSchema = new mongoose.Schema({
  id: { type: String, required: true },
  name: { type: String, required: true },
  parentId: { type: String, default: null },
}, { _id: false });

const SnapshotSchema = new mongoose.Schema({
  roomId: { type: String, required: true },
  snapshotId: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  createdBy: { type: String, required: true }, // username
  files: { type: Map, of: FileSnapshotSchema, default: {} },
  folders: { type: Map, of: FolderSnapshotSchema, default: {} },
  activeFile: { type: String, default: null },
  createdAt: { type: Date, default: Date.now },
});

SnapshotSchema.index({ roomId: 1, createdAt: -1 });

module.exports = mongoose.model("Snapshot", SnapshotSchema);
