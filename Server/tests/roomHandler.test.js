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
  it("returns ts-node command for typescript", () => {
    const room = { activeFile: "f1", files: { f1: { id: "f1", name: "main.ts", parentId: null } }, folders: {} };
    expect(inferCommand(room, "typescript")).toBe("npx ts-node main.ts");
  });
  it("returns python command for python", () => {
    const room = { activeFile: "f1", files: { f1: { id: "f1", name: "script.py", parentId: null } }, folders: {} };
    expect(inferCommand(room, "python")).toBe("python3 script.py");
  });
});

describe("buildFilePath", () => {
  it("returns filename for root file", () => {
    expect(buildFilePath({ name: "index.js", parentId: null }, {})).toBe("index.js");
  });
  it("builds nested path when file has parent folders", () => {
    const folders = {
      root: { id: "root", name: "src", parentId: null },
      child: { id: "child", name: "utils", parentId: "root" },
    };
    expect(buildFilePath({ name: "index.ts", parentId: "child" }, folders)).toBe("src/utils/index.ts");
  });
});
