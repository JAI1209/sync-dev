/**
 * Yjs CRDT Collaborative Document Server
 * Provides conflict-free collaborative editing with Awareness (cursor/selection sync)
 */

const Y = require("yjs");
const { Awareness } = require("y-protocols/awareness");
const { encodeStateAsUpdate, applyUpdate, encodeStateVector } = Y;

// ── Document store ────────────────────────────────────────────────────────────
// roomId -> { doc, awareness, persistTimer }
const docs = new Map();
const PERSIST_DELAY_MS = 5000; // Debounce persistence

function getOrCreateDoc(roomId, RoomModel) {
  let entry = docs.get(roomId);
  if (!entry) {
    const doc = new Y.Doc();
    const awareness = new Awareness(doc);
    
    // Track which files exist in this document
    const filesMap = doc.getMap("files");
    const metaMap = doc.getMap("meta"); // activeFile, etc
    
    // Set default if empty
    if (filesMap.size === 0) {
      const defaultFileId = "file_main";
      filesMap.set(defaultFileId, {
        id: defaultFileId,
        name: "main.js",
        content: new Y.Text("// Start coding here\n"),
        language: "javascript",
        parentId: null,
      });
      metaMap.set("activeFile", defaultFileId);
    }

    entry = { doc, awareness, filesMap, metaMap, clients: new Set(), persistTimer: null };
    docs.set(roomId, entry);
    
    // Load from MongoDB if exists
    if (RoomModel) {
      loadDocFromDB(roomId, entry, RoomModel);
    }

    // Subscribe to changes for persistence
    doc.on("update", () => {
      schedulePersist(roomId, entry, RoomModel);
    });
  }
  return entry;
}

async function loadDocFromDB(roomId, entry, RoomModel) {
  try {
    const saved = await RoomModel.findOne({ roomId });
    if (!saved) return;
    
    const { doc, filesMap, metaMap } = entry;
    
    // Restore files
    saved.files.forEach((fileData, fileId) => {
      const text = new Y.Text(fileData.content || "");
      filesMap.set(fileId, {
        id: fileId,
        name: fileData.name,
        content: text,
        language: fileData.language,
        parentId: fileData.parentId,
      });
    });
    
    // Restore folders
    saved.folders.forEach((folderData, folderId) => {
      const foldersMap = doc.getMap("folders");
      foldersMap.set(folderId, {
        id: folderId,
        name: folderData.name,
        parentId: folderData.parentId,
      });
    });
    
    metaMap.set("activeFile", saved.activeFile);
  } catch (err) {
    console.error("Yjs load from DB error:", err.message);
  }
}

function schedulePersist(roomId, entry, RoomModel) {
  if (!RoomModel) return;
  if (entry.persistTimer) clearTimeout(entry.persistTimer);
  entry.persistTimer = setTimeout(() => {
    persistDocToDB(roomId, entry, RoomModel);
  }, PERSIST_DELAY_MS);
}

async function persistDocToDB(roomId, entry, RoomModel) {
  const { doc, filesMap, metaMap } = entry;
  const foldersMap = doc.getMap("folders");
  
  const files = {};
  filesMap.forEach((file, id) => {
    files[id] = {
      id,
      name: file.name,
      content: file.content?.toString() || "",
      language: file.language,
      parentId: file.parentId,
    };
  });
  
  const folders = {};
  foldersMap.forEach((folder, id) => {
    folders[id] = {
      id,
      name: folder.name,
      parentId: folder.parentId,
    };
  });
  
  try {
    await RoomModel.findOneAndUpdate(
      { roomId },
      { roomId, files, folders, activeFile: metaMap.get("activeFile"), lastActivity: new Date() },
      { upsert: true }
    );
  } catch (err) {
    console.error("Yjs persist error:", err.message);
  }
}

// ── Socket.IO handlers for Yjs ────────────────────────────────────────────────
function setupYjsSocketHandlers(io, RoomModel) {
  io.on("connection", (socket) => {
    socket.on("yjs-join", ({ roomId }) => {
      const entry = getOrCreateDoc(roomId, RoomModel);
      entry.clients.add(socket.id);
      socket.yjsRoomId = roomId;
      
      // Send initial state
      const { doc, awareness } = entry;
      const stateUpdate = encodeStateAsUpdate(doc);
      socket.emit("yjs-sync", { state: Buffer.from(stateUpdate).toString("base64") });
      
      // Send awareness state
      const awarenessState = Array.from(awareness.getStates().entries());
      socket.emit("yjs-awareness", { states: awarenessState });
      
      socket.join(`yjs-${roomId}`);
      
      console.log(`[Yjs] ${socket.id} joined ${roomId}`);
    });
    
    socket.on("yjs-update", ({ update }) => {
      const roomId = socket.yjsRoomId;
      if (!roomId) return;
      const entry = docs.get(roomId);
      if (!entry) return;
      
      // Apply update to doc
      const binary = Buffer.from(update, "base64");
      applyUpdate(entry.doc, new Uint8Array(binary));
      
      // Broadcast to others in room
      socket.to(`yjs-${roomId}`).emit("yjs-update", { update });
    });
    
    socket.on("yjs-awareness-update", ({ update }) => {
      const roomId = socket.yjsRoomId;
      if (!roomId) return;
      const entry = docs.get(roomId);
      if (!entry) return;
      
      // Apply awareness update
      const binary = Buffer.from(update, "base64");
      entry.awareness.applyAwarenessUpdate(new Uint8Array(binary), socket.id);
      
      // Broadcast
      socket.to(`yjs-${roomId}`).emit("yjs-awareness-update", { update, clientId: socket.id });
    });
    
    socket.on("disconnect", () => {
      const roomId = socket.yjsRoomId;
      if (!roomId) return;
      const entry = docs.get(roomId);
      if (entry) {
        entry.clients.delete(socket.id);
        // Remove awareness state for this client
        entry.awareness.removeAwarenessStates([socket.id], "disconnect");
        
        // Clean up empty docs after delay
        if (entry.clients.size === 0) {
          setTimeout(() => {
            if (entry.clients.size === 0) {
              persistDocToDB(roomId, entry, RoomModel);
              docs.delete(roomId);
              console.log(`[Yjs] Cleaned up ${roomId}`);
            }
          }, 120000); // 2 minute grace period
        }
      }
    });
  });
}

// ── Helper to convert Yjs state to legacy format for compatibility ───────────
function getLegacyRoomState(roomId) {
  const entry = docs.get(roomId);
  if (!entry) return null;
  
  const { filesMap, metaMap } = entry;
  const doc = entry.doc;
  const foldersMap = doc.getMap("folders");
  
  const files = {};
  filesMap.forEach((file, id) => {
    files[id] = {
      id,
      name: file.name,
      content: file.content?.toString() || "",
      language: file.language,
      parentId: file.parentId,
    };
  });
  
  const folders = {};
  foldersMap.forEach((folder, id) => {
    folders[id] = {
      id,
      name: folder.name,
      parentId: folder.parentId,
    };
  });
  
  return { files, folders, activeFile: metaMap.get("activeFile") };
}

module.exports = {
  setupYjsSocketHandlers,
  getOrCreateDoc,
  getLegacyRoomState,
};
