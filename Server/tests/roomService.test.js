import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../config/redis", () => ({
  redis: { get: vi.fn(), set: vi.fn(), del: vi.fn(), keys: vi.fn(() => []), ping: vi.fn(() => "PONG") },
  ensureRedisConnection: vi.fn(() => true),
}));

vi.mock("../models/Room", () => ({ default: { findOneAndUpdate: vi.fn(), findOne: vi.fn() } }));

const roomService = await import("../services/roomService.js");
const { redis, ensureRedisConnection } = await import("../config/redis.js");
const Room = (await import("../models/Room.js")).default;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("roomService.getRoom", () => {
  it("returns null when Redis returns nothing", async () => {
    redis.get.mockResolvedValue(null);
    expect(await roomService.getRoom("nonexistent")).toBeNull();
  });

  it("serves stale cache when Redis is unavailable", async () => {
    const room = { files: {}, folders: {}, users: [] };
    redis.get.mockResolvedValue(JSON.stringify(room));
    await roomService.getRoom("room-1");
    ensureRedisConnection.mockResolvedValue(false);
    expect(await roomService.getRoom("room-1")).toEqual(room);
  });
});

describe("roomService.persistRoom", () => {
  it("debounces writes and only persists once for rapid calls", async () => {
    vi.useFakeTimers();
    const roomId = "debounce-room";
    const room = { files: {}, folders: {}, users: [], activeFile: null };
    redis.get.mockResolvedValue(JSON.stringify(room));
    Room.findOneAndUpdate.mockResolvedValue({});

    roomService.persistRoom(roomId);
    roomService.persistRoom(roomId);
    roomService.persistRoom(roomId);

    await vi.advanceTimersByTimeAsync(1999);
    expect(Room.findOneAndUpdate).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(Room.findOneAndUpdate).toHaveBeenCalledTimes(1);
  });
});
