import { describe, it, expect, beforeEach } from "vitest";
import {
  getRoom,
  getRooms,
  setRoom,
  makeDefaultRoom,
  clearRoomCleanup,
} from "../services/roomService.js";

const TEST_ROOM = "test-room-vitest";

function clearInMemoryRooms() {
  const rooms = getRooms();
  for (const key of Object.keys(rooms)) {
    delete rooms[key];
    clearRoomCleanup(key);
  }
}

beforeEach(() => {
  clearInMemoryRooms();
});

describe("roomService", () => {
  it("makeDefaultRoom returns expected shape", () => {
    const room = makeDefaultRoom();
    expect(room).toHaveProperty("files");
    expect(room).toHaveProperty("folders");
    expect(room).toHaveProperty("activeFile");
    expect(room).toHaveProperty("users");
    expect(room.users).toEqual([]);
  });

  it("makeDefaultRoom has one default file", () => {
    const room = makeDefaultRoom();
    const fileKeys = Object.keys(room.files);
    expect(fileKeys.length).toBe(1);
    expect(room.files[fileKeys[0]].name).toBe("main.js");
  });

  it("getRoom returns null for unknown room when Redis has no room", async () => {
    const result = await getRoom("nonexistent-room-xyz");
    expect(result).toBeNull();
  });

  it("setRoom stores room state and getRoom reads it back from memory", async () => {
    const room = makeDefaultRoom();
    await setRoom(TEST_ROOM, room);
    const fetched = await getRoom(TEST_ROOM);
    expect(fetched).not.toBeNull();
    expect(Object.keys(fetched.files).length).toBe(1);
  });

  it("setRoom overwrites existing room state", async () => {
    const room = makeDefaultRoom();
    await setRoom(TEST_ROOM, room);

    const updated = { ...room, users: ["alice"] };
    await setRoom(TEST_ROOM, updated);

    const fetched = await getRoom(TEST_ROOM);
    expect(fetched.users).toContain("alice");
  });

  it("getRoom returns in-memory cache on second call", async () => {
    const room = makeDefaultRoom();
    await setRoom(TEST_ROOM, room);
    const first = await getRoom(TEST_ROOM);
    const second = await getRoom(TEST_ROOM);
    expect(second).toBe(first);
  });
});
