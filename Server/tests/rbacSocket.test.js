import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const roomService = require("../services/roomService");
const RoomMember = require("../models/RoomMember");
const { __testables } = require("../socket/roomHandler");

const USER_ID = "507f1f77bcf86cd799439011";

function socketMock() {
  return {
    id: "socket-1",
    userId: USER_ID,
    username: "alice",
    emit: vi.fn(),
    to: vi.fn(() => ({ emit: vi.fn() })),
  };
}

function member(role) {
  return {
    _id: `${role}-member`,
    roomId: "ABCD2345",
    userId: USER_ID,
    username: "alice",
    role,
  };
}

describe("socket RBAC handlers", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(roomService, "setRoom").mockResolvedValue(undefined);
    vi.spyOn(roomService, "persistRoom").mockResolvedValue(undefined);
  });

  it("viewer emitting file-change receives permission-denied response", async () => {
    const socket = socketMock();
    vi.spyOn(RoomMember, "findOne").mockResolvedValue(member("viewer"));

    await __testables.handleFileChange({}, socket, {
      roomId: "ABCD2345",
      fileId: "f1",
      content: "x",
    });

    expect(socket.emit).toHaveBeenCalledWith("permission-denied", expect.objectContaining({
      permission: "EDIT_FILES",
      currentRole: "viewer",
    }));
  });

  it("editor emitting bulk-import with IMPORT_FROM_GITHUB permission is allowed", async () => {
    const socket = socketMock();
    const peerEmitter = { emit: vi.fn() };
    socket.to.mockReturnValue(peerEmitter);
    vi.spyOn(RoomMember, "findOne").mockResolvedValue(member("editor"));
    vi.spyOn(roomService, "getRoom").mockResolvedValue({ files: {}, folders: {}, activeFile: null });

    await __testables.handleBulkImport({}, socket, {
      roomId: "ABCD2345",
      files: { f1: { id: "f1", name: "index.js" } },
      folders: {},
    });

    expect(RoomMember.findOne).toHaveBeenCalledWith(expect.objectContaining({ roomId: "ABCD2345" }));
    expect(peerEmitter.emit).toHaveBeenCalledWith("bulk-imported", expect.any(Object));
    expect(socket.emit).toHaveBeenCalledWith("import-complete", expect.objectContaining({ filesImported: 1 }));
  });

  it("handleBulkImport returns alreadyExists true when all file IDs already exist in room", async () => {
    const socket = socketMock();
    vi.spyOn(RoomMember, "findOne").mockResolvedValue(member("editor"));
    vi.spyOn(roomService, "getRoom").mockResolvedValue({
      files: { f1: { id: "f1", name: "index.js" } },
      folders: {},
      activeFile: "f1",
    });

    await __testables.handleBulkImport({}, socket, {
      roomId: "ABCD2345",
      files: { f1: { id: "f1", name: "index.js" } },
      folders: {},
    });

    expect(socket.emit).toHaveBeenCalledWith("import-complete", {
      filesImported: 0,
      foldersImported: 0,
      alreadyExists: true,
    });
    expect(roomService.setRoom).not.toHaveBeenCalled();
  });

  it("handleSwitchFile emits file-switched-ack back to sender", async () => {
    const socket = socketMock();
    vi.spyOn(RoomMember, "findOne").mockResolvedValue(member("viewer"));
    vi.spyOn(roomService, "getRoom").mockResolvedValue({
      files: { f1: { id: "f1", name: "index.js" } },
      folders: {},
      activeFile: null,
    });

    await __testables.handleSwitchFile({}, socket, { roomId: "ABCD2345", fileId: "f1" });

    expect(socket.emit).toHaveBeenCalledWith("file-switched-ack", { fileId: "f1" });
  });
});
