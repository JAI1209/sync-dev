/**
 * Redis adapter for room state persistence
 * Provides fast in-memory storage with persistence for multi-server scaling
 */

const Redis = require("ioredis");

class RedisRoomStore {
  constructor(redisUrl) {
    this.redis = new Redis(redisUrl || "redis://localhost:6379");
    this.localCache = new Map(); // Fallback cache
    this.TTL_SECONDS = 86400 * 7; // 7 days
  }

  async getRoom(roomId) {
    try {
      const data = await this.redis.get(`room:${roomId}`);
      if (data) return JSON.parse(data);
      return null;
    } catch (err) {
      console.error("Redis get error:", err.message);
      // Fallback to local cache
      return this.localCache.get(roomId) || null;
    }
  }

  async saveRoom(roomId, roomState) {
    try {
      const pipeline = this.redis.pipeline();
      pipeline.setex(`room:${roomId}`, this.TTL_SECONDS, JSON.stringify(roomState));
      // Also update activity timestamp for sorting
      pipeline.zadd("rooms:activity", Date.now(), roomId);
      await pipeline.exec();
    } catch (err) {
      console.error("Redis save error:", err.message);
      // Fallback to local cache
      this.localCache.set(roomId, roomState);
    }
  }

  async deleteRoom(roomId) {
    try {
      const pipeline = this.redis.pipeline();
      pipeline.del(`room:${roomId}`);
      pipeline.zrem("rooms:activity", roomId);
      await pipeline.exec();
    } catch (err) {
      console.error("Redis delete error:", err.message);
      this.localCache.delete(roomId);
    }
  }

  async getActiveRooms(limit = 100) {
    try {
      const roomIds = await this.redis.zrevrange("rooms:activity", 0, limit - 1);
      if (!roomIds.length) return [];
      
      const pipeline = this.redis.pipeline();
      roomIds.forEach(id => pipeline.get(`room:${id}`));
      const results = await pipeline.exec();
      
      return results
        .map(([err, data]) => {
          if (err || !data) return null;
          try {
            const room = JSON.parse(data);
            return { roomId: room.roomId, lastActivity: room.lastActivity, fileCount: Object.keys(room.files || {}).length };
          } catch {
            return null;
          }
        })
        .filter(Boolean);
    } catch (err) {
      console.error("Redis getActiveRooms error:", err.message);
      return [];
    }
  }

  async close() {
    await this.redis.quit();
  }
}

module.exports = { RedisRoomStore };
