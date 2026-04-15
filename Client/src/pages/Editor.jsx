import { useRef, useState, useCallback, useMemo, lazy, Suspense, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import MonacoEditor, { useMonaco } from "@monaco-editor/react";
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
  const { roomId } = useParams(), navigate = useNavigate(), monaco = useMonaco();
  const fs = useFileSystem();
  const {
    files, folders, activeFileId, openTabs,
    loadFiles, openFile, closeTab,
    createFile, createFolder,
    renameFile, renameFolder,
    deleteFile, deleteFolder,
    setActiveFile,
  } = fs;
  const [editorKey, setEditorKey] = useState(0), [copied, setCopied] = useState(false), [showAll, setShowAll] = useState(false), [hoveredUser, setHoveredUser] = useState(null), [uploadStatus, setUploadStatus] = useState(null), [terminalOpen, setTerminalOpen] = useState(false), [showVideo, setShowVideo] = useState(false), [editorNotification, setEditorNotification] = useState(null), [filesLoaded, setFilesLoaded] = useState(false);
  const sidebarOpen = true;
  const uploadInputRef = useRef(null);

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
    monaco,
    setEditorKey,
  });
  const handleCreateFile = useCallback((name, parentId) => {
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
  }, [createFile, roomId, socketRef, setActiveFile]);
  const handleCreateFolder = useCallback((name, parentId) => {
    const folder = createFolder(name, parentId);
    socketRef.current?.emit("create-folder", { roomId, folder });
  }, [createFolder, roomId, socketRef]);
  const handleRenameFile = useCallback((fileId, name) => {
    renameFile(fileId, name);
    socketRef.current?.emit("rename-file", { roomId, fileId, name });
  }, [renameFile, roomId, socketRef]);

  const handleRenameFolder = useCallback((folderId, name) => {
    renameFolder(folderId, name);
    socketRef.current?.emit("rename-folder", { roomId, folderId, name });
  }, [renameFolder, roomId, socketRef]);

  const handleDeleteFile = useCallback((fileId) => {
    deleteFile(fileId);
    socketRef.current?.emit("delete-file", { roomId, fileId });
  }, [deleteFile, roomId, socketRef]);

  const handleDeleteFolder = useCallback((folderId) => {
    deleteFolder(folderId, folders);
    socketRef.current?.emit("delete-folder", { roomId, folderId, folders });
  }, [deleteFolder, folders, roomId, socketRef]);

  const usersRef = useRef([]);

  useEffect(() => {
    if (joined && Object.keys(files).length > 0) {
      setFilesLoaded(true);
    }
  }, [joined, files]);

  useEffect(() => {
    usersRef.current = users;
  }, [users]);

  useEffect(() => {
    const handler = (msg, source, line, col, error) => {
      if (msg && msg.includes("clipboard")) {
        setEditorNotification("Image paste not supported - paste as text instead");
        setTimeout(() => setEditorNotification(null), 3000);
        return true; // Suppress error
      }
      return false;
    };
    window.addEventListener("error", handler);
    return () => window.removeEventListener("error", handler);
  }, []);

  const {
    handleEditorMount,
  } = useMonacoModels({
    files,
    joined,
    activeFileId,
    monaco,
    socketRef,
    pendingRemoteUpdates,
    roomId,
  });

  const webrtc = useWebRTC({ socketRef, joined, usersRef });
  const {
    micOn, camOn, remoteStreams, localVideoRef, remoteVideoRefs,
    toggleMic, toggleCam, endCall,
    mutedPeers, setMutedPeers,
  } = webrtc;

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
    githubMeta, commitBranch, setCommitBranch,
    commitMessage, setCommitMessage,
    githubBusy, githubHint,
    handleCommitPush, handleDownloadZip,
    handleImportGithub,
  } = github;

  const activeFile = activeFileId ? files[activeFileId] : null;
  const visibleUsers = showAll ? users : users.slice(0, 5);

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
  }), [userRole]);

  const handleUpload = useCallback(async () => {
    if (!uploadInputRef.current?.files?.length) return;
    setUploadStatus("loading");
    try {
      console.log('[Upload] Processing', uploadInputRef.current.files.length, 'files');
      const { files: newFiles, folders: newFolders } = await readUploadedFiles(
        uploadInputRef.current.files
      );
      console.log('[Upload] Processed - files:', Object.keys(newFiles).length, 'folders:', Object.keys(newFolders).length);
      console.log('[Upload] Folder names:', Object.values(newFolders).map(f => f.name));
      loadFiles(newFiles, newFolders, Object.keys(newFiles)[0] || null);

      const sock = socketRef.current;
      const pendingData = { roomId, files: newFiles, folders: newFolders };

      if (sock?.connected) {
        sessionStorage.removeItem("syncdev_pending_upload");
        sock.emit("bulk-import", pendingData);
      } else {
        console.log("[Upload] Socket not connected, saving for retry...");
        sessionStorage.setItem("syncdev_pending_upload", JSON.stringify(pendingData));
      }
    } catch (e) {
      alert("Upload failed: " + e.message);
    } finally {
      setUploadStatus(null);
      uploadInputRef.current.value = "";
    }
  }, [loadFiles, roomId, socketRef]);

  const handleCopyRoom = () => {
    navigator.clipboard.writeText(roomId);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const getRunCode = useCallback(() => {
    const f = activeFile;
    if (!f) return "// No active file";
    if (f.language === "javascript" || f.language === "typescript") return f.content || "";
    return "// Select a JS/TS file to run";
  }, [activeFile]);

  return (
    <div className="editor-wrapper">
      <EditorHeader
        roomId={roomId}
        copied={copied}
        handleCopyRoom={handleCopyRoom}
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
      />

      <EditorWorkspace
        sidebarOpen={sidebarOpen}
        files={files}
        folders={folders}
        activeFileId={activeFileId}
        openTabs={openTabs}
        openFile={openFile}
        closeTab={closeTab}
        handleCreateFile={handleCreateFile}
        handleCreateFolder={handleCreateFolder}
        handleRenameFile={handleRenameFile}
        handleRenameFolder={handleRenameFolder}
        handleDeleteFile={handleDeleteFile}
        handleDeleteFolder={handleDeleteFolder}
        userRole={userRole}
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
        remoteStreams={remoteStreams}
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
        toggleCam={toggleCam}
        remoteStreams={remoteStreams}
        showVideo={showVideo}
        setShowVideo={setShowVideo}
        users={users}
        endCall={endCall}
      />
    </div>
  );
}
