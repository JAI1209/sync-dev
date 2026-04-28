import { useRef, useState, useCallback, useMemo, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useMonaco } from "@monaco-editor/react";
import { useFileSystem } from "../hooks/useFileSystem";
import { useSocket } from "../hooks/useSocket";
import { useMonacoModels } from "../hooks/useMonacoModels";
import { useWebRTC } from "../hooks/useWebRTC";
import { useGitHub } from "../hooks/useGitHub";
import { readUploadedFiles } from "../utils/readFiles";
import EditorHeader from "../components/EditorHeader.jsx";
import EditorWorkspace from "../components/EditorWorkspace.jsx";
import ParticipantsPanel from "../components/ParticipantsPanel.jsx";
import VideoToolbar from "../components/VideoToolbar.jsx";

export default function Editor({ username }) {
  const { roomId } = useParams();
  const navigate = useNavigate();
  const monaco = useMonaco();

  const fs = useFileSystem();
  const {
    files,
    folders,
    activeFileId,
    openTabs,
    loadRoomState,
    loadFiles,
    openFile,
    closeTab,
    createFile,
    createFolder,
    renameFile,
    renameFolder,
    deleteFile,
    deleteFolder,
    setActiveFile,
    updateFileContent,
  } = fs;

  const [editorKey, setEditorKey] = useState(0);
  const [copied, setCopied] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [hoveredUser, setHoveredUser] = useState(null);
  const [uploadStatus, setUploadStatus] = useState(null);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [showVideo, setShowVideo] = useState(false);
  const [editorNotification, setEditorNotification] = useState(null);
  const [filesLoaded, setFilesLoaded] = useState(false);

  const sidebarOpen = true;
  const uploadInputRef = useRef(null);
  const usersRef = useRef([]);

  const {
    socketRef,
    joined,
    userRole,
    users,
    socketStatus,
    socketIssue,
    reconnecting,
    handleReconnectSocket,
    pendingRemoteUpdates,
  } = useSocket({
    roomId,
    navigate,
    fs,
    setEditorKey,
    setEditorNotification,
  });

  // FIX: Granular permission checks instead of single canEditRoom boolean.
  const permissions = useMemo(() => ({
    canEditFiles: ["owner", "admin", "editor"].includes(userRole),
    canManageRoom: ["owner", "admin"].includes(userRole),
    canManageRoles: userRole === "owner",
    canPushGitHub: ["owner", "admin"].includes(userRole),
    canInvite: ["owner", "admin"].includes(userRole),
  }), [userRole]);

  const showRoleDenied = useCallback((action) => {
    setEditorNotification(`Your role cannot ${action}.`);
    setTimeout(() => setEditorNotification(null), 2500);
  }, []);

  const handleCreateFile = useCallback((name, parentId) => {
    if (!permissions.canEditFiles) {
      showRoleDenied("create files");
      return;
    }

    const file = createFile(name, parentId);
    socketRef.current?.emit("create-file", { roomId, file });

    const onAck = ({ fileId }) => {
      if (fileId === file.id) {
        clearTimeout(timeout);
        setActiveFile(file.id);
      }
    };

    const timeout = setTimeout(() => {
      socketRef.current?.off("file-created-ack", onAck);
    }, 5000);

    socketRef.current?.once("file-created-ack", onAck);
  }, [permissions.canEditFiles, createFile, roomId, showRoleDenied, socketRef, setActiveFile]);

  const handleCreateFolder = useCallback((name, parentId) => {
    if (!permissions.canEditFiles) {
      showRoleDenied("create folders");
      return;
    }
    const folder = createFolder(name, parentId);
    socketRef.current?.emit("create-folder", { roomId, folder });
  }, [permissions.canEditFiles, createFolder, roomId, showRoleDenied, socketRef]);

  const handleOpenFile = useCallback((fileId) => {
    openFile(fileId);
    socketRef.current?.emit("switch-file", { roomId, fileId });
  }, [openFile, roomId, socketRef]);

  const handleRenameFile = useCallback((fileId, name) => {
    if (!permissions.canEditFiles) {
      showRoleDenied("rename files");
      return;
    }
    renameFile(fileId, name);
    socketRef.current?.emit("rename-file", { roomId, fileId, name });
  }, [permissions.canEditFiles, renameFile, roomId, showRoleDenied, socketRef]);

  const handleRenameFolder = useCallback((folderId, name) => {
    if (!permissions.canEditFiles) {
      showRoleDenied("rename folders");
      return;
    }
    renameFolder(folderId, name);
    socketRef.current?.emit("rename-folder", { roomId, folderId, name });
  }, [permissions.canEditFiles, renameFolder, roomId, showRoleDenied, socketRef]);

  const handleDeleteFile = useCallback((fileId) => {
    if (!permissions.canEditFiles) {
      showRoleDenied("delete files");
      return;
    }
    deleteFile(fileId);
    socketRef.current?.emit("delete-file", { roomId, fileId });
  }, [permissions.canEditFiles, deleteFile, roomId, showRoleDenied, socketRef]);

  const handleDeleteFolder = useCallback((folderId) => {
    if (!permissions.canEditFiles) {
      showRoleDenied("delete folders");
      return;
    }
    deleteFolder(folderId, folders);
    socketRef.current?.emit("delete-folder", { roomId, folderId, folders });
  }, [permissions.canEditFiles, deleteFolder, folders, roomId, showRoleDenied, socketRef]);

  useEffect(() => {
    if (joined && Object.keys(files).length > 0) {
      setFilesLoaded(true);
    }
  }, [joined, files]);

  useEffect(() => {
    usersRef.current = users;
  }, [users]);

  useEffect(() => {
    const handler = (msg) => {
      if (msg && msg.includes("clipboard")) {
        setEditorNotification("Image paste is not supported here. Paste as text instead.");
        setTimeout(() => setEditorNotification(null), 3000);
        return true;
      }
      return false;
    };

    window.addEventListener("error", handler);
    return () => window.removeEventListener("error", handler);
  }, []);

  const { handleEditorMount } = useMonacoModels({
    files,
    joined,
    activeFileId,
    monaco,
    socketRef,
    pendingRemoteUpdates,
    roomId,
    updateFileContent,
  });

  const webrtc = useWebRTC({ socketRef, joined, usersRef, showVideo });
  const {
    micOn,
    camOn,
    remoteStreams,
    localVideoRef,
    remoteVideoRefs,
    toggleMic,
    toggleCam,
    endCall,
    mutedPeers,
    setMutedPeers,
  } = webrtc;

  const handleToggleCam = useCallback(async () => {
    const turningOn = !camOn;
    if (turningOn) {
      setShowVideo(true);
    }
    await toggleCam();
  }, [camOn, toggleCam]);

  const handleEndCall = useCallback(() => {
    endCall();
    setShowVideo(false);
  }, [endCall]);

  const handleLeaveRoom = useCallback(() => {
    // FIX: Non-owners need an explicit leave flow so their socket/user presence is cleaned up server-side.
    const confirmed = window.confirm(
      "Leave this room? You can rejoin later with the same room link."
    );
    if (!confirmed) return;
    socketRef.current?.emit("leave-room", { roomId });
    socketRef.current?.disconnect();
    navigate("/dashboard");
  }, [navigate, roomId, socketRef]);

  const handleTerminateRoom = useCallback(() => {
    // FIX: Owners can now terminate the room itself instead of only stopping local media streams.
    const confirmed = window.confirm(
      "Terminate this room? All participants will be disconnected and the room state will be deleted."
    );
    if (!confirmed) return;
    socketRef.current?.emit("terminate-room", { roomId });
    socketRef.current?.disconnect();
    navigate("/dashboard");
  }, [navigate, roomId, socketRef]);

  useEffect(() => {
    // FIX: Muting a peer must update the actual remote video element, not only button state.
    Object.entries(remoteVideoRefs.current || {}).forEach(([peerId, element]) => {
      if (element) element.muted = mutedPeers.has(peerId);
    });
  }, [mutedPeers, remoteStreams, remoteVideoRefs]);

  useEffect(() => {
    if (!joined) return undefined;
    // FIX: Warn before accidental tab closes while the user is still in a joined collaborative room.
    const handler = (event) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [joined]);

  const github = useGitHub({
    files,
    folders,
    roomId,
    socketRef,
    joined,
    loadFiles,
    activeFileId,
  });
  const {
    githubMeta,
    commitBranch,
    setCommitBranch,
    commitMessage,
    setCommitMessage,
    githubBusy,
    githubHint,
    importProgress,
    handleCommitPush,
    handleDownloadZip,
    handleImportGithub,
  } = github;

  const activeFile = activeFileId ? files[activeFileId] : null;

  const handleSnapshotRestored = useCallback((state) => {
    if (!state) return;
    // FIX: Snapshot restore response updates this client immediately while socket room-state reaches peers.
    loadRoomState({
      files: state.files || {},
      folders: state.folders || {},
      activeFile: state.activeFile || null,
    });
    setEditorKey((key) => key + 1);
  }, [loadRoomState]);

  const monacoOptions = useMemo(() => ({
    fontSize: 14,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    wordWrap: "on",
    fontFamily: "JetBrains Mono, monospace",
    renderLineHighlight: "all",
    cursorBlinking: "smooth",
    automaticLayout: true,
    readOnly: userRole === "viewer",
    domReadOnly: userRole === "viewer",
  }), [userRole]);

  const handleUpload = useCallback(async () => {
    if (!permissions.canEditFiles) {
      showRoleDenied("upload folders");
      return;
    }

    if (!uploadInputRef.current?.files?.length) return;
    const selectedCount = uploadInputRef.current.files.length;
    // FIX: Upload folder now exposes visible progress with selected file count.
    setUploadStatus(`Uploading ${selectedCount} file${selectedCount === 1 ? "" : "s"}...`);

    try {
      const { files: newFiles, folders: newFolders } = await readUploadedFiles(
        uploadInputRef.current.files
      );

      const importedCount = Object.keys(newFiles).length;
      setUploadStatus(`Syncing ${importedCount} file${importedCount === 1 ? "" : "s"}...`);
      loadFiles(newFiles, newFolders, Object.keys(newFiles)[0] || null);

      const socket = socketRef.current;
      const pendingData = { roomId, files: newFiles, folders: newFolders };

      if (socket?.connected) {
        sessionStorage.removeItem("syncdev_pending_upload");
        socket.emit("bulk-import", pendingData);
      } else {
        sessionStorage.setItem("syncdev_pending_upload", JSON.stringify(pendingData));
      }
    } catch (error) {
      setEditorNotification("Upload failed: " + error.message);
      setTimeout(() => setEditorNotification(null), 3000);
    } finally {
      setUploadStatus(null);
      uploadInputRef.current.value = "";
    }
  }, [permissions.canEditFiles, loadFiles, roomId, showRoleDenied, socketRef]);

  const handleCopyRoom = async () => {
    // FIX: Room ID copy button now handles clipboard failures with inline editor feedback.
    try {
      await navigator.clipboard.writeText(roomId);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setEditorNotification("Could not copy room ID.");
      setTimeout(() => setEditorNotification(null), 2500);
    }
  };

  const getRunCode = useCallback(() => {
    const file = activeFile;
    if (!file) return "// No active file";
    if (file.language === "javascript" || file.language === "typescript") {
      return file.content || "";
    }
    return "// Select a JS/TS file to run";
  }, [activeFile]);

  return (
    <div className="editor-wrapper">
      <EditorHeader
        roomId={roomId}
        copied={copied}
        handleCopyRoom={handleCopyRoom}
        onLeaveRoom={handleLeaveRoom}
        userRole={userRole}
        githubBusy={githubBusy}
        githubMeta={githubMeta}
        commitBranch={commitBranch}
        setCommitBranch={setCommitBranch}
        commitMessage={commitMessage}
        setCommitMessage={setCommitMessage}
        handleCommitPush={handleCommitPush}
        handleDownloadZip={handleDownloadZip}
        handleImportGithub={handleImportGithub}
        terminalOpen={terminalOpen}
        setTerminalOpen={setTerminalOpen}
        socketStatus={socketStatus}
        reconnecting={reconnecting}
        handleReconnectSocket={handleReconnectSocket}
        socketIssue={socketIssue}
        githubHint={githubHint}
        importProgress={importProgress}
        permissions={permissions}
      />

      <EditorWorkspace
        sidebarOpen={sidebarOpen}
        files={files}
        folders={folders}
        activeFileId={activeFileId}
        openTabs={openTabs}
        openFile={handleOpenFile}
        closeTab={closeTab}
        handleCreateFile={handleCreateFile}
        handleCreateFolder={handleCreateFolder}
        handleRenameFile={handleRenameFile}
        handleRenameFolder={handleRenameFolder}
        handleDeleteFile={handleDeleteFile}
        handleDeleteFolder={handleDeleteFolder}
        userRole={userRole}
        permissions={permissions}
        uploadInputRef={uploadInputRef}
        uploadStatus={uploadStatus}
        handleUpload={handleUpload}
        roomId={roomId}
        joined={joined}
        filesLoaded={filesLoaded}
        editorKey={editorKey}
        handleEditorMount={handleEditorMount}
        monacoOptions={monacoOptions}
        terminalOpen={terminalOpen}
        getRunCode={getRunCode}
        activeFile={activeFile}
        editorNotification={editorNotification}
        onSnapshotRestored={handleSnapshotRestored}
      />

      <ParticipantsPanel
        users={users}
        username={username}
        showAll={showAll}
        setShowAll={setShowAll}
        hoveredUser={hoveredUser}
        setHoveredUser={setHoveredUser}
        mutedPeers={mutedPeers}
        setMutedPeers={setMutedPeers}
        camOn={camOn}
        remoteStreams={remoteStreams}
        showVideo={showVideo}
        localVideoRef={localVideoRef}
        remoteVideoRefs={remoteVideoRefs}
      />

      <VideoToolbar
        micOn={micOn}
        camOn={camOn}
        toggleMic={toggleMic}
        toggleCam={handleToggleCam}
        remoteStreams={remoteStreams}
        showVideo={showVideo}
        setShowVideo={setShowVideo}
        users={users}
        onEndCall={handleEndCall}
        onTerminateRoom={handleTerminateRoom}
        userRole={userRole}
      />
    </div>
  );
}
