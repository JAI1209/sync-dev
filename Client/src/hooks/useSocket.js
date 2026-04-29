import { useEffect, useRef, useState, useCallback } from "react";
import { io } from "socket.io-client";
import { jwtDecode } from "jwt-decode";
import { refreshAccessToken } from "../api/auth";
import { clearAuthTokens, getAccessToken } from "../api/client";

const SERVER_URL = import.meta.env.VITE_API_URL || "http://localhost:3000";
const TOKEN_REFRESH_SKEW_MS = 30 * 1000;

function tokenNeedsRefresh(token) {
  try {
    const decoded = jwtDecode(token);
    return !decoded?.exp || decoded.exp * 1000 <= Date.now() + TOKEN_REFRESH_SKEW_MS;
  } catch {
    return true;
  }
}

export function useSocket({ roomId, navigate, fs, setEditorKey, setEditorNotification }) {
  const {
    loadRoomState,
    setActiveFile,
    applyFileCreated,
    applyFolderCreated,
    applyFileRenamed,
    applyFolderRenamed,
    applyFileDeleted,
    applyFolderDeleted,
    applyFileUpdated,
  } = fs;

  const socketRef = useRef(null);
  const debounceTimer = useRef(null);
  const pendingRemoteUpdates = useRef(new Set());
  const importRetryCount = useRef(0);
  const attemptedSocketRefreshRef = useRef(false);
  const joinTimeoutRef = useRef(null);

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

  const getFreshSocketToken = useCallback(async (forceRefresh = false) => {
    // FIX: Always refresh token before connecting to avoid stale JWT rejections.
    let token = getAccessToken();
    if (forceRefresh || !token || tokenNeedsRefresh(token)) {
      const refreshed = await refreshAccessToken();
      if (!refreshed) {
        const hasPendingImport = Boolean(sessionStorage.getItem("syncdev_pending_import"));
        if (hasPendingImport) {
          setSocketIssue("Session expired. Refresh the page to reconnect and retry the import.");
          return null;
        }
        clearAuthTokens();
        navigate("/login");
        return null;
      }
      token = getAccessToken();
    }
    return token;
  }, [navigate]);

  useEffect(() => {
    let socket;
    let isActive = true;
    const clearJoinTimeout = () => {
      if (joinTimeoutRef.current) {
        clearTimeout(joinTimeoutRef.current);
        joinTimeoutRef.current = null;
      }
    };

    const startJoinTimeout = () => {
      clearJoinTimeout();
      // FIX: Surface silent join failures instead of leaving the editor loading forever.
      joinTimeoutRef.current = setTimeout(() => {
        if (!isActive) return;
        setSocketStatus("error");
        setSocketIssue("Room join timed out — check your connection");
        setJoined(false);
      }, 10000);
    };

    const emitJoinRoom = () => {
      socket.emit("join-room", { roomId });
      startJoinTimeout();
    };

    const initSocket = async () => {
      let token = await getFreshSocketToken();
      if (!token) {
        return;
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

      socket.auth = { token };
      socket.connect();

      socket.on("connect", () => {
        attemptedSocketRefreshRef.current = false;
        setSocketStatus("connected");
        setSocketIssue("");
        setLastConnectedAt(new Date());
        setReconnecting(false);
        emitJoinRoom();
        socket.emit("retry-upload");

        // Retry folder upload that may have happened while offline.
        try {
          const raw = sessionStorage.getItem("syncdev_pending_upload");
          if (!raw) return;
          const pending = JSON.parse(raw);
          if (!pending || pending.roomId !== roomId) return;

          socket.emit("bulk-import", {
            roomId,
            files: pending.files || {},
            folders: pending.folders || {},
          });
          sessionStorage.removeItem("syncdev_pending_upload");
        } catch {
          sessionStorage.removeItem("syncdev_pending_upload");
        }
      });

      socket.on("disconnect", (reason) => {
        clearJoinTimeout();
        setSocketStatus("disconnected");
        setSocketIssue(`Disconnected (${reason})`);
        if (reason === "io server disconnect") {
          setJoined(false);
        }
      });

      socket.on("connect_error", async (err) => {
        console.error("Socket error:", err.message);
        setSocketStatus("error");
        setSocketIssue(`Connection error: ${err.message}`);

        const tokenError =
          err.message?.includes("jwt expired") ||
          err.message?.includes("Invalid or expired token") ||
          err.message?.includes("Authentication required");

        if (!tokenError) {
          return;
        }

        if (attemptedSocketRefreshRef.current) {
          setReconnecting(false);
          const hasPendingImport = Boolean(sessionStorage.getItem("syncdev_pending_import"));
          if (hasPendingImport) {
            setSocketIssue("Session expired. Refresh the page to reconnect and retry the import.");
            return;
          }
          clearAuthTokens();
          navigate("/login");
          return;
        }

        attemptedSocketRefreshRef.current = true;
        setReconnecting(true);
        // FIX: A server JWT rejection means the current socket token is invalid even if local decoding looks fresh.
        const freshToken = await getFreshSocketToken(true);
        if (!freshToken) {
          setReconnecting(false);
          return;
        }

        socket.auth = { token: freshToken };
        socket.connect();
      });

      socket.io.on("reconnect_attempt", async () => {
        setReconnecting(true);
        setSocketStatus("connecting");
        // FIX: Refresh the token on every reconnect attempt instead of reusing a stale in-memory JWT.
        const freshToken = await getFreshSocketToken(true);
        if (freshToken) {
          socket.auth = { token: freshToken };
        }
      });

      socket.io.on("reconnect", () => {
        setReconnecting(false);
      });

      socket.on("room-state", (state) => {
        clearJoinTimeout();
        const normalizedFiles = state?.files && typeof state.files === "object" ? state.files : {};
        const normalizedFolders = state?.folders && typeof state.folders === "object" ? state.folders : {};
        const activeFile = typeof state?.activeFile === "string" ? state.activeFile : null;

        // FIX: Pending GitHub imports stay hidden until import-complete confirms server persistence.
        // Always trust canonical room state from server on join/reconnect.
        loadRoomState({
          files: normalizedFiles,
          folders: normalizedFolders,
          activeFile,
        });

        setJoined(true);
        // FIX: Snapshot restore broadcasts room-state without role; preserve current RBAC role in that case.
        if (state?.role) {
          setUserRole(state.role);
        }

        if (Object.keys(normalizedFiles).length > 0) {
          setTimeout(() => setEditorKey?.((k) => k + 1), 50);
        }
      });

      socket.on("join-ack", ({ roomId: ackRoomId }) => {
        if (ackRoomId !== roomId) return;
        clearJoinTimeout();
      });

      socket.on("role-changed", ({ roomId: changedRoomId, oldRole, newRole, changedBy }) => {
        if (changedRoomId !== roomId) return;
        console.log(`[Role] Changed from ${oldRole} to ${newRole} by ${changedBy}`);
        setUserRole(newRole);
        setEditorKey?.((k) => k + 1);
        // FIX: Role changes must be visible in the editor, not only in socket status text.
        setEditorNotification?.(`Your role was changed to: ${newRole}`);
        setSocketIssue(`Role updated: ${oldRole} -> ${newRole}`);
        setTimeout(() => {
          setSocketIssue("");
          setEditorNotification?.(null);
        }, 3000);
      });

      socket.on("permission-denied", ({ roomId: deniedRoomId, reason, permission, currentRole }) => {
        if (deniedRoomId && deniedRoomId !== roomId) return;
        const fallback = permission ? `Permission denied (${permission})` : "Permission denied";
        const withRole = currentRole ? `${reason || fallback} [role: ${currentRole}]` : (reason || fallback);
        // FIX: Show user-visible feedback when RBAC denies a socket action.
        setEditorNotification?.(`Action blocked: ${reason || permission || "permission denied"}`);
        setSocketIssue(withRole);
        setTimeout(() => {
          setSocketIssue("");
          setEditorNotification?.(null);
        }, 3000);
      });

      socket.on("operation-error", ({ msg }) => {
        if (!msg) return;
        setSocketIssue(msg);
        setTimeout(() => setSocketIssue(""), 3000);
      });

      socket.on("room-join-denied", ({ roomId: deniedRoomId, reason }) => {
        if (deniedRoomId && deniedRoomId !== roomId) return;
        clearJoinTimeout();
        setJoined(false);
        setSocketStatus("error");
        setSocketIssue(reason || "Unable to join room");
      });

      socket.on("removed-from-room", ({ roomId: removedRoomId, removedBy }) => {
        if (removedRoomId && removedRoomId !== roomId) return;
        // FIX: Removed members are redirected immediately so stale sockets cannot keep editing.
        setEditorNotification?.(`Removed from room by ${removedBy || "owner"}`);
        setJoined(false);
        setUsers([]);
        loadRoomState({ files: {}, folders: {}, activeFile: null });
        setSocketStatus("error");
        setSocketIssue(`Removed from room by ${removedBy || "owner"}`);
        socket.disconnect();
        setTimeout(() => navigate("/dashboard"), 600);
      });

      socket.on("room-terminated", ({ msg, roomId: terminatedRoomId }) => {
        if (terminatedRoomId && terminatedRoomId !== roomId) return;
        // FIX: Tear down local room state before redirecting so terminated rooms do not leave stale files mounted.
        setEditorNotification?.(msg || "This room has been terminated.");
        setJoined(false);
        setUsers([]);
        loadRoomState({ files: {}, folders: {}, activeFile: null });
        setSocketStatus("error");
        setSocketIssue(msg || "This room has been terminated.");
        socket.disconnect();
        setTimeout(() => navigate("/dashboard"), 1500);
      });

      socket.on("users-update", (nextUsers) => {
        setUsers(Array.isArray(nextUsers) ? nextUsers : []);
      });

      socket.on("file-update", ({ fileId, content }) => {
        if (!fileId) return;
        const nextContent = typeof content === "string" ? content : "";

        if (debounceTimer.current) {
          clearTimeout(debounceTimer.current);
          debounceTimer.current = null;
        }

        pendingRemoteUpdates.current.add(fileId);
        applyFileUpdated({ fileId, content: nextContent });
        setTimeout(() => pendingRemoteUpdates.current.delete(fileId), 100);
      });

      socket.on("file-created", (file) => applyFileCreated(file));
      socket.on("folder-created", (folder) => applyFolderCreated(folder));

      socket.on("bulk-imported", ({ files: importedFiles, folders: importedFolders }) => {
        const fileArray = Array.isArray(importedFiles)
          ? importedFiles
          : Object.values(importedFiles || {});
        const folderArray = Array.isArray(importedFolders)
          ? importedFolders
          : Object.values(importedFolders || {});

        folderArray.forEach((folder) => applyFolderCreated(folder));
        fileArray.forEach((file) => applyFileCreated(file));

        if (fileArray.length > 0) {
          setTimeout(() => setEditorKey?.((k) => k + 1), 100);
        }
      });

      socket.on("file-renamed", applyFileRenamed);
      socket.on("folder-renamed", applyFolderRenamed);
      socket.on("file-deleted", ({ fileId }) => applyFileDeleted({ fileId }));
      socket.on("folder-deleted", (payload) => applyFolderDeleted(payload));
      socket.on("file-switched", ({ fileId }) => {
        if (!fileId) return;
        setActiveFile?.(fileId);
      });
      socket.on("file-switched-ack", ({ fileId }) => {
        if (!fileId) return;
        // FIX: Reconcile sender active file with server-confirmed switch state.
        setActiveFile?.(fileId);
      });
    };

    initSocket();

    return () => {
      isActive = false;
      clearJoinTimeout();
      if (socket) {
        // FIX: Remove listeners before disconnect so StrictMode double-mount does not duplicate events.
        socket.removeAllListeners();
        socket.io.removeAllListeners();
        socket.disconnect();
      }
    };
  }, [
    roomId,
    navigate,
    getFreshSocketToken,
    loadRoomState,
    applyFileCreated,
    applyFolderCreated,
    applyFileRenamed,
    applyFolderRenamed,
    applyFileDeleted,
    applyFolderDeleted,
    applyFileUpdated,
    setActiveFile,
    setEditorKey,
    setEditorNotification,
  ]);

  const handleReconnectSocket = useCallback(async () => {
    const socket = socketRef.current;
    if (!socket) return;

    attemptedSocketRefreshRef.current = false;
    setReconnecting(true);
    setSocketStatus("connecting");

    const token = await getFreshSocketToken(true);
    if (!token) {
      setReconnecting(false);
      return;
    }

    socket.auth = { token };
    socket.connect();
  }, [getFreshSocketToken]);

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
