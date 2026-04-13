/**
 * Yjs CRDT Collaboration Hook
 * Provides real-time collaborative editing with cursor/awareness sync
 */

import { useEffect, useRef, useCallback, useState } from "react";
import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";

export function useYjsCollab({
  socket,
  roomId,
  username,
  onFileChange,
  onFilesSync,
}) {
  const ydocRef = useRef(null);
  const awarenessRef = useRef(null);
  const filesMapRef = useRef(null);
  const foldersMapRef = useRef(null);
  const metaMapRef = useRef(null);
  const [isSynced, setIsSynced] = useState(false);
  const [awarenessStates, setAwarenessStates] = useState([]);

  // Initialize Yjs document
  useEffect(() => {
    if (!socket || !roomId) return;

    const doc = new Y.Doc();
    const awareness = new Awareness(doc);
    const filesMap = doc.getMap("files");
    const foldersMap = doc.getMap("folders");
    const metaMap = doc.getMap("meta");

    ydocRef.current = doc;
    awarenessRef.current = awareness;
    filesMapRef.current = filesMap;
    foldersMapRef.current = foldersMap;
    metaMapRef.current = metaMap;

    // Set local awareness state (user info)
    awareness.setLocalStateField("user", {
      name: username || "Anonymous",
      color: getRandomColor(username),
      id: socket.id,
    });

    // Subscribe to file changes
    filesMap.observe((event) => {
      event.changes.keys.forEach((change, key) => {
        const file = filesMap.get(key);
        if (file && change.action !== "delete") {
          const content = file.content?.toString() || "";
          onFileChange?.(key, content);
        }
      });
    });

    // Subscribe to awareness changes
    awareness.on("change", () => {
      const states = Array.from(awareness.getStates().values()).filter(
        (s) => s.user?.name !== username
      );
      setAwarenessStates(states);
    });

    // Subscribe to doc updates to send to server
    doc.on("update", (update) => {
      if (!socket) return;
      socket.emit("yjs-update", {
        update: Buffer.from(update).toString("base64"),
      });
    });

    // Subscribe to awareness updates
    awareness.on("update", ({ added, updated, removed }) => {
      if (!socket) return;
      const update = Awareness.encodeAwarenessUpdate(awareness, [
        ...added,
        ...updated,
        ...removed,
      ]);
      socket.emit("yjs-awareness-update", {
        update: Buffer.from(update).toString("base64"),
      });
    });

    // Join room
    socket.emit("yjs-join", { roomId });

    // Handle server sync
    const handleSync = ({ state }) => {
      const update = new Uint8Array(Buffer.from(state, "base64"));
      Y.applyUpdate(doc, update);
      setIsSynced(true);

      // Sync to legacy format
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
      onFilesSync?.({
        files,
        folders,
        activeFile: metaMap.get("activeFile"),
      });
    };

    const handleUpdate = ({ update }) => {
      const binary = new Uint8Array(Buffer.from(update, "base64"));
      Y.applyUpdate(doc, binary);
    };

    const handleAwareness = ({ states }) => {
      states.forEach(([clientId, state]) => {
        awareness.setLocalStateField("user", state);
      });
    };

    const handleAwarenessUpdate = ({ update, clientId }) => {
      const binary = new Uint8Array(Buffer.from(update, "base64"));
      Awareness.applyAwarenessUpdate(awareness, binary, clientId);
    };

    socket.on("yjs-sync", handleSync);
    socket.on("yjs-update", handleUpdate);
    socket.on("yjs-awareness", handleAwareness);
    socket.on("yjs-awareness-update", handleAwarenessUpdate);

    return () => {
      socket.off("yjs-sync", handleSync);
      socket.off("yjs-update", handleUpdate);
      socket.off("yjs-awareness", handleAwareness);
      socket.off("yjs-awareness-update", handleAwarenessUpdate);
      awareness.destroy();
      doc.destroy();
    };
  }, [socket, roomId, username]);

  // Update file content
  const updateFileContent = useCallback((fileId, content) => {
    const filesMap = filesMapRef.current;
    if (!filesMap) return;

    let file = filesMap.get(fileId);
    if (!file) {
      // Create new file
      const text = new Y.Text(content);
      file = {
        id: fileId,
        name: fileId,
        content: text,
        language: "plaintext",
        parentId: null,
      };
      filesMap.set(fileId, file);
    } else {
      // Update existing
      const current = file.content?.toString() || "";
      if (current !== content) {
        // Apply delta
        file.content.delete(0, file.content.length);
        file.content.insert(0, content);
      }
    }
  }, []);

  // Create file
  const createFile = useCallback((file) => {
    const filesMap = filesMapRef.current;
    if (!filesMap) return;

    const text = new Y.Text(file.content || "");
    filesMap.set(file.id, {
      ...file,
      content: text,
    });
  }, []);

  // Delete file
  const deleteFile = useCallback((fileId) => {
    const filesMap = filesMapRef.current;
    if (!filesMap) return;
    filesMap.delete(fileId);
  }, []);

  // Set active file
  const setActiveFile = useCallback((fileId) => {
    const metaMap = metaMapRef.current;
    if (!metaMap) return;
    metaMap.set("activeFile", fileId);
  }, []);

  return {
    isSynced,
    awarenessStates,
    updateFileContent,
    createFile,
    deleteFile,
    setActiveFile,
  };
}

function getRandomColor(str) {
  const colors = [
    "#ef4444",
    "#f97316",
    "#f59e0b",
    "#84cc16",
    "#10b981",
    "#06b6d4",
    "#3b82f6",
    "#6366f1",
    "#8b5cf6",
    "#d946ef",
    "#f43f5e",
  ];
  let hash = 0;
  for (let i = 0; i < (str || "").length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}
