import { useEffect, useRef, useState, useCallback } from "react";
import { io } from "socket.io-client";
import { refreshAccessToken } from "../api/auth";
import { clearAuthTokens, getAccessToken } from "../api/client";

const SERVER_URL = import.meta.env.VITE_API_URL || "http://localhost:3000";

export function useSocket({
  roomId,
  navigate,
  fs,
  monaco,
  setEditorKey,
}) {
  const {
    files,
    folders,
    loadRoomState,
    loadFiles,
    applyFileCreated,
    applyFolderCreated,
    applyFileRenamed,
    applyFolderRenamed,
    applyFileDeleted,
    applyFolderDeleted,
    applyFileUpdated,
  } = fs;

  const socketRef = useRef(null);
  const filesRef = useRef(files);
  const foldersRef = useRef(folders);
  const debounceTimer = useRef(null);
  const suppressRef = useRef(false);
  const pendingRemoteUpdates = useRef(new Set());
  const importRetryCount = useRef(0);
  const attemptedSocketRefreshRef = useRef(false);

  // keep refs in sync
  useEffect(() => { filesRef.current = files; }, [files]);
  useEffect(() => { foldersRef.current = folders; }, [folders]);

  const [joined, setJoined] = useState(false);
  const [userRole, setUserRole] = useState("viewer");
  const [socketStatus, setSocketStatus] = useState("connecting");
  const [socketIssue, setSocketIssue] = useState("");
  const [users, setUsers] = useState([]);
  const [reconnecting, setReconnecting] = useState(false);
  const [lastConnectedAt, setLastConnectedAt] = useState(null);

  const triggerImportRetry = useCallback(() => {
    importRetryCount.current += 1;
    if (importRetryCount.current > 10) {
      console.error("[Import] Max retries exceeded");
      sessionStorage.removeItem("syncdev_pending_import");
      return;
    }
    setLastConnectedAt(Date.now());
  }, []);

  // ── Socket setup ───────────────────────────────────────────────────────────
  useEffect(() => {
    let socket;
    let isActive = true;

    const initSocket = async () => {
      let token = getAccessToken();
      if (!token) {
        const refreshed = await refreshAccessToken();
        if (!refreshed) {
          if (isActive) {
            clearAuthTokens();
            navigate("/login");
          }
          return;
        }
        token = getAccessToken();
      }

      if (!isActive) return;

      socket = io(SERVER_URL, {
        autoConnect: false,
        auth: { token },
        reconnectionAttempts: 5,
        reconnectionDelay: 1000,
      });
      socketRef.current = socket;

      setSocketStatus("connecting");
      setSocketIssue("");
      setLastConnectedAt(new Date());
      setReconnecting(false);

      socket.connect();

      socket.on("connect", () => {
        attemptedSocketRefreshRef.current = false;
        setSocketStatus("connected");
        setSocketIssue("");
        setLastConnectedAt(new Date());
        setReconnecting(false);
        socket.emit("join-room", { roomId });
      });

      socket.on("disconnect", (reason) => {
        setSocketStatus("disconnected");
        setSocketIssue(`Disconnected (${reason})`);
        setJoined(false);
      });

      socket.on("connect_error", async (err) => {
        console.error("Socket error:", err.message);
        setSocketStatus("error");
        setSocketIssue(`Connection error: ${err.message}`);

        const tokenError =
          err.message?.includes("jwt expired") ||
          err.message?.includes("Invalid or expired token") ||
          err.message?.includes("Authentication required");

        if (tokenError) {
          if (attemptedSocketRefreshRef.current) {
            setReconnecting(false);
            clearAuthTokens();
            navigate("/login");
            return;
          }

          attemptedSocketRefreshRef.current = true;
          setReconnecting(true);
          const refreshed = await refreshAccessToken();
          if (!refreshed) {
            setReconnecting(false);
            clearAuthTokens();
            navigate("/login");
            return;
          }

          socket.auth = { token: refreshed };
          socket.connect();
        }
      });

      // Room state on join
      socket.on("room-state", (state) => {
        // Bug 2 Fix: Server state wins over stale local (reversed spread order)
        const mergedFiles = { ...filesRef.current, ...state.files };
        const mergedFolders = { ...foldersRef.current, ...state.folders };

        const newFiles = Object.keys(state.files).filter((id) => !filesRef.current[id]).length;
        const newFolders = Object.keys(state.folders).filter((id) => !foldersRef.current[id]).length;

        if (newFiles > 0 || newFolders > 0) {
          console.log(`[RoomState] Adding ${newFiles} new files, ${newFolders} new folders from server`);
        }

        loadRoomState({ ...state, files: mergedFiles, folders: mergedFolders });
        setJoined(true);
        setUserRole(state.role || "viewer");
      });

      // Real-time role change from admin
      socket.on("role-changed", ({ roomId: changedRoomId, oldRole, newRole, changedBy }) => {
        if (changedRoomId === roomId) {
          console.log(`[Role] Changed from ${oldRole} to ${newRole} by ${changedBy}`);
          setUserRole(newRole);
          setEditorKey?.((k) => k + 1);
          setSocketIssue(`Role updated: ${oldRole} → ${newRole}`);
          setTimeout(() => setSocketIssue(""), 3000);
        }
      });

      socket.on("users-update", (u) => setUsers(u));

      socket.on("file-update", ({ fileId, content }) => {
        console.log("[Socket] Received file-update:", fileId, content.length, "chars");
        if (debounceTimer.current) {
          clearTimeout(debounceTimer.current);
          debounceTimer.current = null;
        }
        pendingRemoteUpdates.current.add(fileId);
        applyFileUpdated({ fileId, content });
        // Set will be checked in onDidChangeModelContent to skip emit
        setTimeout(() => pendingRemoteUpdates.current.delete(fileId), 100);
      });

      socket.on("file-created", (file) => {
        applyFileCreated(file);
        // Model created by useMonacoModels effect
      });

      socket.on("folder-created", (folder) => applyFolderCreated(folder));

      socket.on("bulk-imported", ({ files: importedFiles, folders: importedFolders }) => {
        const fileCount = Object.keys(importedFiles || {}).length;
        const folderCount = Object.keys(importedFolders || {}).length;
        console.log(`[Import] Received broadcast: ${fileCount} files, ${folderCount} folders`);

        const filesToAdd = Object.values(importedFiles || {}).filter((f) => !filesRef.current[f.id]);
        const foldersToAdd = Object.values(importedFolders || {}).filter((f) => !foldersRef.current[f.id]);

        if (foldersToAdd.length > 0) {
          console.log(`[Import] Adding ${foldersToAdd.length} new folders`);
          foldersToAdd.forEach((folder) => applyFolderCreated(folder));
        }

        if (filesToAdd.length > 0) {
          console.log(`[Import] Adding ${filesToAdd.length} new files`);
          filesToAdd.forEach((file) => applyFileCreated(file));
          // Models created by useMonacoModels effect
        }
      });

      socket.on("file-renamed", (payload) => {
        applyFileRenamed(payload);
        // Model language updated by useMonacoModels
      });

      socket.on("folder-renamed", applyFolderRenamed);

      // Bug 6 Fix: file-deleted/folder-deleted moved to main initSocket (was in separate useEffect with stale guard)
      socket.on("file-deleted", ({ fileId }) => applyFileDeleted({ fileId }));
      socket.on("folder-deleted", (payload) => applyFolderDeleted(payload));
    };

    initSocket();

    return () => {
      isActive = false;
      if (socket) {
        socket.removeAllListeners();
        socket.disconnect();
      }
    };
  }, [roomId, navigate, loadRoomState, applyFileCreated, applyFolderCreated, applyFileRenamed, applyFolderRenamed, applyFileDeleted, applyFolderDeleted, applyFileUpdated, monaco, setEditorKey]);

  const handleReconnectSocket = useCallback(async () => {
    const socket = socketRef.current;
    if (!socket) return;

    attemptedSocketRefreshRef.current = false;
    setReconnecting(true);
    setSocketStatus("connecting");

    const token = getAccessToken();
    if (!token) {
      const refreshed = await refreshAccessToken();
      if (!refreshed) {
        setReconnecting(false);
        clearAuthTokens();
        navigate("/login");
        return;
      }
    }

    socket.auth = { token: getAccessToken() };
    socket.connect();
  }, [navigate]);

  return {
    socketRef,
    joined,
    userRole,
    setUserRole,
    users,
    socketStatus,
    socketIssue,
    setSocketIssue,
    reconnecting,
    handleReconnectSocket,
    triggerImportRetry,
    lastConnectedAt,
    pendingRemoteUpdates,
    debounceTimer,
  };
}
