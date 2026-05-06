const Room = require("../models/Room");
const { EMPTY_ROOM_GRACE_MS } = require("../config/constants");
const { redis, ensureRedisConnection } = require("../config/redis");

const cache = new Map();
const CACHE_TTL_MS = 5000;
const emptyRoomTimers = new Map();
const roomMembershipLocks = new Map();
const persistDebounceTimers = new Map();

function roomKey(roomId) { return `room:${roomId}`; }

function getCachedRoom(roomId) {
  const hit = cache.get(roomId);
  if (hit && hit.expiresAt > Date.now()) return hit.data;
  return null;
}

async function getRoom(roomId) {
  const hit = getCachedRoom(roomId);
  if (hit) return hit;
  const ready = await ensureRedisConnection();
  if (!ready) return cache.get(roomId)?.data || null;
  const raw = await redis.get(roomKey(roomId));
  if (!raw) return null;
  const data = JSON.parse(raw);
  cache.set(roomId, { data, expiresAt: Date.now() + CACHE_TTL_MS });
  return data;
}

function getRooms() {
  return Object.fromEntries(Array.from(cache.entries()).map(([k, v]) => [k, v.data]));
}

async function setRoom(roomId, roomState) {
  cache.set(roomId, { data: roomState, expiresAt: Date.now() + CACHE_TTL_MS });
  const ready = await ensureRedisConnection();
  if (!ready) return roomState;
  await redis.set(roomKey(roomId), JSON.stringify(roomState), "EX", 86400);
  return roomState;
}

async function destroyRoom(roomId) {
  cache.delete(roomId);
  clearRoomCleanup(roomId);
  const ready = await ensureRedisConnection();
  if (!ready) return;
  await redis.del(roomKey(roomId));
}

function clearRoomCleanup(roomId) { const t = emptyRoomTimers.get(roomId); if (t) { clearTimeout(t); emptyRoomTimers.delete(roomId);} }

function scheduleRoomCleanup(roomId) {
  clearRoomCleanup(roomId);
  emptyRoomTimers.set(roomId, setTimeout(async () => {
    emptyRoomTimers.delete(roomId);
    const room = await getRoom(roomId);
    if (room?.users?.length === 0) await destroyRoom(roomId);
  }, EMPTY_ROOM_GRACE_MS));
}

async function reconcileEmptyRooms() {
  const ready = await ensureRedisConnection();
  if (!ready) return;
  const keys = await redis.keys("room:*");
  for (const key of keys) {
    const raw = await redis.get(key).catch(() => null);
    if (!raw) continue;
    try { const room = JSON.parse(raw); if (!room.users || room.users.length === 0) scheduleRoomCleanup(key.replace("room:", "")); } catch {}
  }
}

async function runWithLock(roomId, fn) { const prev = roomMembershipLocks.get(roomId) || Promise.resolve(); let release; const cur = new Promise(r=>release=r); roomMembershipLocks.set(roomId, cur); try { await prev.catch(()=>{}); return await fn(); } finally { release(); if (roomMembershipLocks.get(roomId)===cur) roomMembershipLocks.delete(roomId);} }

function makeDefaultRoom(){const fileId="file_main";return{files:{[fileId]:{id:fileId,name:"main.js",content:"// Start coding here\n",language:"javascript",parentId:null}},folders:{},activeFile:fileId,users:[]};}

async function _persistRoomImmediate(roomId) { const room = await getRoom(roomId); if (!room) return; await Room.findOneAndUpdate({ roomId }, { roomId, files: room.files, folders: room.folders, activeFile: room.activeFile, lastActivity: new Date() }, { upsert: true }); }
function persistRoom(roomId) { if (persistDebounceTimers.has(roomId)) clearTimeout(persistDebounceTimers.get(roomId)); persistDebounceTimers.set(roomId, setTimeout(async ()=>{ persistDebounceTimers.delete(roomId); try { await _persistRoomImmediate(roomId); } catch(err) { console.error("Room persist error:", err.message);} }, 2000)); }

async function loadRoomFromDB(roomId){ const doc=await Room.findOne({roomId}); if(!doc) return null; const files={}; const folders={}; (typeof doc.files?.forEach==="function"?doc.files.entries():Object.entries(doc.files||{})).forEach(([k,v])=>{ files[k]=typeof v?.toObject==="function"?v.toObject():v; }); (typeof doc.folders?.forEach==="function"?doc.folders.entries():Object.entries(doc.folders||{})).forEach(([k,v])=>{ folders[k]=typeof v?.toObject==="function"?v.toObject():v; }); return {files,folders,activeFile:doc.activeFile,users:[]}; }

function deleteFolder(room, folderId){ const deletedFiles=[]; const deletedFolders=[]; const folders=[folderId]; for(let i=0;i<folders.length;i++){const f=folders[i]; for(const [id,file] of Object.entries(room.files)){if(file.parentId===f){delete room.files[id]; deletedFiles.push(id);}} for(const [id,folder] of Object.entries(room.folders)){if(folder.parentId===f) folders.push(id);} if(room.folders[f]) {delete room.folders[f]; deletedFolders.push(f);} } return {deletedFiles,deletedFolders}; }

module.exports = { getRoom, getRooms, setRoom, destroyRoom, persistRoom, loadRoomFromDB, makeDefaultRoom, scheduleRoomCleanup, clearRoomCleanup, runWithLock, deleteFolder, reconcileEmptyRooms };
