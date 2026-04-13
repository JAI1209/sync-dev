import { useRef, useState, useCallback, useMemo, lazy, Suspense } from "react";
import { useParams, useNavigate } from "react-router-dom";
import MonacoEditor, { useMonaco } from "@monaco-editor/react";
import { useFileSystem } from "../hooks/useFileSystem";
import { useSocket } from "../hooks/useSocket";
import { useMonacoModels } from "../hooks/useMonacoModels";
import { useWebRTC } from "../hooks/useWebRTC";
import { useGitHub } from "../hooks/useGitHub";
import FileTree from "../components/FileTree";
import MemberManager from "../components/MemberManager";
import TabBar from "../components/TabBar";
import { readUploadedFiles, sortFoldersParentFirst } from "../utils/readFiles";
const RunTerminal = lazy(() => import("../components/RunTerminal.jsx"));

export default function Editor({ username }) {
  const { roomId }  = useParams();
  const navigate    = useNavigate();
  const monaco      = useMonaco();

  // ── file system state ──────────────────────────────────────────────────────
  const fs = useFileSystem();
  const {
    files, folders, activeFileId, openTabs,
    loadRoomState, loadFiles, openFile, closeTab,
    updateFileContent,
    createFile, createFolder,
    renameFile, renameFolder,
    deleteFile, deleteFolder,
  } = fs;

  // ── local UI state ─────────────────────────────────────────────────────────
  const [editorKey, setEditorKey] = useState(0);
  const [copied, setCopied] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [hoveredUser, setHoveredUser] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [uploadStatus, setUploadStatus] = useState(null);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [showVideo, setShowVideo] = useState(false);
  const uploadInputRef = useRef(null);

  // ── Socket (real-time collaboration) ─────────────────────────────────────────
  const {
    socketRef,
    joined,
    userRole,
    users,
    socketStatus,
    socketIssue,
    setSocketIssue,
    reconnecting,
    handleReconnectSocket,
    pendingRemoteUpdates,
    debounceTimer,
  } = useSocket({
    roomId,
    navigate,
    fs,
    monaco,
    setEditorKey,
  });

  // ── Monaco models ──────────────────────────────────────────────────────────
  const {
    modelsRef,
    mountedRef,
    getOrCreateModel,
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

  // ── WebRTC (voice/video) ───────────────────────────────────────────────────
  const webrtc = useWebRTC({ socketRef, roomId, joined });
  const {
    micOn, camOn, remoteStreams, localVideoRef, remoteVideoRefs,
    toggleMic, toggleCam, endCall, mediaError,
    mutedPeers, setMutedPeers,
  } = webrtc;

  // ── GitHub integration ──────────────────────────────────────────────────────
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

  // ── Derived values ─────────────────────────────────────────────────────────
  const activeFile = activeFileId ? files[activeFileId] : null;
  const visibleUsers = showAll ? users : users.slice(0, 5);

  // ── Monaco options (readOnly based on role) ──────────────────────────────────
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

  // ── Handlers ─────────────────────────────────────────────────────────────────
  const handleUpload = useCallback(async () => {
    if (!uploadInputRef.current?.files?.length) return;
    setUploadStatus("loading");
    try {
      const { files: newFiles, folders: newFolders } = await readUploadedFiles(
        uploadInputRef.current.files
      );
      loadFiles(newFiles, newFolders, Object.keys(newFiles)[0] || null);
      const sorted = sortFoldersParentFirst(Object.values(newFolders));
      const sock = socketRef.current;
      if (sock) {
        sorted.forEach((f) => sock.emit("create-folder", { roomId, folder: f }));
        Object.values(newFiles).forEach((f) => sock.emit("create-file", { roomId, file: f }));
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

  // ── JSX ───────────────────────────────────────────────────────────────────────
  return (
    <div className="editor-wrapper">
      {/* ── header ── */}
      <header className="editor-top">
        <div className="editor-brand">
          <span className="logo">SyncDev</span>
          <span className="room-badge" onClick={handleCopyRoom}>
            {roomId} {copied && "✓"}
          </span>
        </div>

        <div className="editor-actions">
          {/* GitHub import/push */}
          <button
            className="btn"
            onClick={() => {
              const url = prompt("GitHub repo URL (e.g., https://github.com/owner/repo)");
              if (url) handleImportGithub(url);
            }}
            disabled={githubBusy}
          >
            {githubBusy ? "⏳" : "📥 Import"}
          </button>

          {githubMeta && (
            <>
              <input
                className="input-small"
                placeholder="Branch"
                value={commitBranch}
                onChange={(e) => setCommitBranch(e.target.value)}
              />
              <input
                className="input-small"
                placeholder="Commit message"
                value={commitMessage}
                onChange={(e) => setCommitMessage(e.target.value)}
              />
              <button
                className="btn"
                onClick={handleCommitPush}
                disabled={githubBusy}
              >
                {githubBusy ? "⏳" : "⬆ Push"}
              </button>
            </>
          )}

          <button className="btn" onClick={handleDownloadZip}>⬇ Export ZIP</button>
          <button
            className="btn"
            onClick={() => setTerminalOpen((v) => !v)}
          >
            {terminalOpen ? "✕ Terminal" : "▶ Terminal"}
          </button>
          {socketStatus !== "connected" && (
            <button
              className="btn btn--primary"
              onClick={handleReconnectSocket}
              disabled={reconnecting}
            >
              {reconnecting ? "⏳ Connecting…" : "↻ Reconnect"}
            </button>
          )}
          {socketIssue && <span className="error-badge">{socketIssue}</span>}
          {githubHint && <span className="hint-badge">{githubHint}</span>}
        </div>
      </header>

      {/* ── workspace ── */}
      <div className="editor-workspace">
        {/* sidebar */}
        {sidebarOpen && (
          <aside className="editor-sidebar">
            <FileTree
              files={files}
              folders={folders}
              activeFileId={activeFileId}
              onOpen={openFile}
              onCreateFile={createFile}
              onCreateFolder={createFolder}
              onRenameFile={renameFile}
              onRenameFolder={renameFolder}
              onDeleteFile={deleteFile}
              onDeleteFolder={deleteFolder}
              userRole={userRole}
            />
            <div className="sidebar-upload">
              <input
                ref={uploadInputRef}
                type="file"
                webkitdirectory=""
                directory=""
                style={{ display: "none" }}
                onChange={handleUpload}
              />
              <button
                className="sidebar-upload-btn"
                onClick={() => uploadInputRef.current?.click()}
                disabled={uploadStatus === "loading" || userRole === "viewer"}
              >
                {uploadStatus === "loading" ? "⏳ Uploading…" : userRole === "viewer" ? "⬆ View Only" : "⬆ Upload Folder"}
              </button>
            </div>
            <MemberManager roomId={roomId} userRole={userRole} />
          </aside>
        )}

        {/* editor area */}
        <div className="editor-main">
          <TabBar
            files={files}
            openTabs={openTabs}
            activeFileId={activeFileId}
            onActivate={openFile}
            onClose={closeTab}
          />
          <div className={`editor-main__split${terminalOpen ? " editor-main__split--with-terminal" : ""}`}>
            <div className="editor-viewport">
              {joined ? (
                <MonacoEditor
                  key={editorKey}
                  height="100%"
                  theme="vs-dark"
                  path={activeFileId ? `syncdev://files/${activeFileId}` : undefined}
                  language={files[activeFileId]?.language ?? "plaintext"}
                  onMount={handleEditorMount}
                  options={monacoOptions}
                />
              ) : (
                <div className="editor-empty">Connecting…</div>
              )}
            </div>
            {terminalOpen && (
              <div className="run-terminal-wrap">
                <Suspense fallback={
                  <div className="run-terminal run-terminal--lazy">
                    <div className="run-terminal__toolbar">
                      <span className="run-terminal__hint">Loading terminal…</span>
                    </div>
                    <div className="run-terminal__xterm-host run-terminal__xterm-host--placeholder" />
                  </div>
                }>
                  <RunTerminal
                    getCode={getRunCode}
                    language={activeFile?.language}
                    fileName={activeFile?.name}
                    activeFileId={activeFileId}
                    files={files}
                    folders={folders}
                    disabled={!joined}
                  />
                </Suspense>
              </div>
            )}
          </div>
        </div>

        {/* participants panel */}
        <aside className="participants-panel">
          <div className="participants-header">
            <div>
              <span className="participants-label">PARTICIPANTS</span>
              <p className="participants-subtitle">Live room members</p>
            </div>
            <span className="participants-count">{users.length}</span>
          </div>
          <div className="participants-scroll">
            {visibleUsers.map((u) => (
              <div
                key={u.id}
                className={`participant-card ${mutedPeers.has(u.id) ? "muted" : ""}`}
                onMouseEnter={() => setHoveredUser(u.id)}
                onMouseLeave={() => setHoveredUser(null)}
              >
                <div className={`participant-avatar ${u.username === username ? "you" : ""}`}>
                  {u.username[0]?.toUpperCase()}
                </div>
                <div className="participant-info">
                  <p className="participant-name">{u.username}</p>
                  <p className="participant-state">{u.username === username ? "you" : "team member"}</p>
                </div>
                <span className="participant-status active" />
                {hoveredUser === u.id && u.username !== username && (
                  <button
                    className="participant-mute"
                    onClick={() =>
                      setMutedPeers((prev) => {
                        const next = new Set(prev);
                        if (next.has(u.id)) next.delete(u.id);
                        else next.add(u.id);
                        return next;
                      })
                    }
                  >
                    {mutedPeers.has(u.id) ? "🔇 Unmute" : "🔊 Mute"}
                  </button>
                )}
              </div>
            ))}
            {users.length > 5 && (
              <button className="participants-toggle" onClick={() => setShowAll((s) => !s)}>
                {showAll ? "Show less" : `Show all ${users.length}`}
              </button>
            )}
          </div>

          {/* video panel */}
          {(camOn || Object.keys(remoteStreams).length > 0) && showVideo && (
            <div className="video-panel">
              {camOn && (
                <div className="video-item">
                  <video ref={localVideoRef} muted auto playsInline className="video-local" />
                  <span className="video-label">You</span>
                </div>
              )}
              {Object.entries(remoteStreams).map(([peerId, stream]) => (
                <div key={peerId} className="video-item">
                  <video
                    ref={(el) => {
                      remoteVideoRefs.current[peerId] = el;
                      if (el) el.srcObject = stream;
                    }}
                    autoPlay
                    playsInline
                    className="video-remote"
                  />
                  <span className="video-label">Peer</span>
                </div>
              ))}
            </div>
          )}
        </aside>
      </div>

      {/* ── toolbar ── */}
      <footer className="editor-toolbar">
        <div className="toolbar-section">
          <button className={`toolbar-button ${micOn ? "active" : "inactive"}`} onClick={toggleMic}>
            {micOn ? "🎤 Mic On" : "🔇 Mic Off"}
          </button>
          <button className={`toolbar-button ${camOn ? "active" : "inactive"}`} onClick={toggleCam}>
            {camOn ? "📹 Cam On" : "📷 Cam Off"}
          </button>
          {(camOn || Object.keys(remoteStreams).length > 0) && (
            <button className="toolbar-button" onClick={() => setShowVideo((v) => !v)}>
              🖥 {showVideo ? "Hide" : "Show"} Video
            </button>
          )}
        </div>
        <div className="toolbar-section toolbar-section--center">
          <span className="toolbar-info">
            {users.length} peer{users.length !== 1 ? "s" : ""} connected
            {micOn && " · 🎤 Live"}{camOn && " · 📹 Live"}
          </span>
        </div>
        <div className="toolbar-section toolbar-section--right">
          <button className="toolbar-button danger" onClick={endCall}>⊗ End Call</button>
        </div>
      </footer>
    </div>
  );
}
