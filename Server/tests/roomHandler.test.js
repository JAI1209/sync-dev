import { describe, it, expect, vi } from "vitest";

vi.mock("../services/roomService", () => ({
  default: {
    getRoom: vi.fn(),
    setRoom: vi.fn(),
    persistRoom: vi.fn(),
    runWithLock: vi.fn((_, fn) => fn()),
    makeDefaultRoom: vi.fn(() => ({ files: {}, folders: {}, activeFile: null, users: [] })),
    clearRoomCleanup: vi.fn(),
    scheduleRoomCleanup: vi.fn(),
    loadRoomFromDB: vi.fn(),
  },
}));

const { inferCommand, buildFilePath } = await import("../socket/roomHandler.js");

describe("inferCommand", () => {
  it("returns node command for javascript with no active file", () => {
    const room = { activeFile: null, files: {}, folders: {} };
    expect(inferCommand(room, "javascript")).toBe("node index.js");
  });
  it("uses active file path when set", () => {
    const room = { activeFile: "f1", files: { f1: { id: "f1", name: "app.js", parentId: null } }, folders: {} };
    expect(inferCommand(room, "javascript")).toContain("app.js");
  });
});

describe("buildFilePath", () => {
  it("returns filename for root file", () => {
    expect(buildFilePath({ name: "index.js", parentId: null }, {})).toBe("index.js");
  });
});
