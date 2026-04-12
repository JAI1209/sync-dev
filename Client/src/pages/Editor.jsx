import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import MonacoEditor, { useMonaco } from "@monaco-editor/react";
import { io } from "socket.io-client";
import { useFileSystem, extToLanguage } from "../hooks/useFileSystem";
import FileTree from "../components/FileTree";
import TabBar from "../components/TabBar";
import { readUploadedFiles } from "../utils/readFiles";

const RTC_CONFIG = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
};
const SERVER_URL = import.meta.env.VITE_API_URL || "http://localhost:3000";
const DEBOUNCE_MS = 80;

export default function Editor({ username }) {
  const { roomId }  = useParams();
  const navigate    = useNavigate();
  const monaco      = useMonaco();

  // ── file system state ──────────────────────────────────────────────────────
  const fs = useFileSystem();
  const {
    files, folders, activeFileId, openTabs,
    loadRoomState, openFile, closeTab,
    updateFileContent,
    createFile, createFolder,
    renameFile, renameFolder,
    deleteFile, deleteFolder,
    applyFileCreated, applyFolderCreated,
    applyFileRenamed, applyFolderRenamed,
    applyFileDeleted, applyFolderDeleted,
    applyFileUpdated,
  } = fs;

  // ── refs ───────────────────────────────────────────────────────────────────
  const modelsRef    = useRef({});
  const editorRef    = useRef(null);
  const suppressRef  = useRef(false);
  const mountedRef   = useRef(false);
  const filesRef     = useRef(files);
  const debounceTimer = useRef(null);

  // keep filesRef in sync
  useEffect(() => { filesRef.current = files; }, [files]);

  // ── room / UI state ────────────────────────────────────────────────────────
  const [joined,      setJoined]      = useState(false);
  const [users,       setUsers]       = useState([]);
  const [copied,      setCopied]      = useState(false);
  const [showAll,     setShowAll]     = useState(false);
  const [hoveredUser, setHoveredUser] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [uploadStatus, setUploadStatus] = useState(null);
  const uploadInputRef = useRef(null);

  // ── WebRTC state ───────────────────────────────────────────────────────────
  const [micOn,         setMicOn]         = useState(false);
  const [camOn,         setCamOn]         = useState(false);
  const [mediaError,    setMediaError]    = useState(null);
  const [showVideo,     setShowVideo]     = useState(false);
  const [mutedPeers,    setMutedPeers]    = useState(new Set());
  const [remoteStreams, setRemoteStreams]  = useState({});

  const socketRef       = useRef(null);
  const localStreamRef  = useRef(null);
  const localVideoRef   = useRef(null);
  const pcsRef          = useRef({});
  const iceBufRef       = useRef({});
  const makingOfferRef  = useRef({});
  const usersRef        = useRef([]);
  const remoteVideoRefs = useRef({});

  useEffect(() => { usersRef.current = users; }, [users]);

  // ── Model helpers ──────────────────────────────────────────────────────────
  const getOrCreateModel = useCallback((fileId) => {
    if (!monaco) return null;

    const existing = modelsRef.current[fileId];
    if (existing && !existing.isDisposed()) return existing;

    const file = filesRef.current[fileId];
    if (!file) return null;

    const uri = monaco.Uri.parse(`syncdev://files/${fileId}`);
    const byUri = monaco.editor.getModel(uri);
    if (byUri && !byUri.isDisposed()) {
      modelsRef.current[fileId] = byUri;
      return byUri;
    }

    const model = monaco.editor.createModel(
      file.content ?? "",
      file.language || "plaintext",
      uri
    );
    modelsRef.current[fileId] = model;
    return model;
  }, [monaco]);

  // ── Switch active model in editor ─────────────────────────────────────────
  useEffect(() => {
    if (!editorRef.current || !monaco || !activeFileId || !mountedRef.current) return;
    const model = getOrCreateModel(activeFileId);
    if (!model) return;
    if (editorRef.current.getModel() !== model) {
      editorRef.current.setModel(model);
    }
  }, [activeFileId, monaco, getOrCreateModel]);

  // ── Create models for all files once Monaco + room are ready ──────────────
  useEffect(() => {
    if (!monaco || !joined) return;
    Object.keys(filesRef.current).forEach((id) => getOrCreateModel(id));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monaco, joined]);

  // ── Dispose models for deleted files ──────────────────────────────────────
  useEffect(() => {
    if (!monaco) return;
    const currentIds = new Set(Object.keys(files));
    Object.entries(modelsRef.current).forEach(([id, model]) => {
      if (!currentIds.has(id)) {
        if (!model.isDisposed()) model.dispose();
        delete modelsRef.current[id];
      }
    });
  }, [files, monaco]);

  // ── WebRTC helpers ─────────────────────────────────────────────────────────
  const drainIce = useCallback(async (id) => {
    const pc = pcsRef.current[id];
    if (!pc?.remoteDescription) return;
    for (const c of (iceBufRef.current[id] || [])) {
      try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch (e) { console.warn("[ICE] drain", e); }
    }
    delete iceBufRef.current[id];
  }, []);

  const sendOffer = useCallback(async (remoteId) => {
    const pc = pcsRef.current[remoteId];
    if (!pc || makingOfferRef.current[remoteId]) return;
    makingOfferRef.current[remoteId] = true;
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socketRef.current.emit("webrtc-offer", { to: remoteId, offer: pc.localDescription });
    } catch (e) { console.error("[RTC] sendOffer error", e); }
    finally { makingOfferRef.current[remoteId] = false; }
  }, []);

  const createPC = useCallback((remoteId) => {
    if (pcsRef.current[remoteId]) return pcsRef.current[remoteId];
    const pc = new RTCPeerConnection(RTC_CONFIG);
    pcsRef.current[remoteId] = pc;
    pc.onicecandidate = ({ candidate }) => {
      if (candidate) socketRef.current.emit("webrtc-ice-candidate", { to: remoteId, candidate });
    };
    pc.ontrack = ({ track, streams }) => {
      const stream = streams[0];
      const user   = usersRef.current.find((u) => u.id === remoteId);
      setRemoteStreams((prev) => ({ ...prev, [remoteId]: { stream, username: user?.username || "Peer" } }));
      if (track.kind === "video") setShowVideo(true);
    };
    pc.onconnectionstatechange = () => {
      if (["disconnected","failed","closed"].includes(pc.connectionState)) {
        setRemoteStreams((prev) => { const n = { ...prev }; delete n[remoteId]; return n; });
        delete pcsRef.current[remoteId];
      }
    };
    pc.onnegotiationneeded = null;
    return pc;
  }, []);

  const addTrackToAll = useCallback(async (track, stream) => {
    for (const [id, pc] of Object.entries(pcsRef.current)) {
      if (!pc.getSenders().some((s) => s.track === track)) {
        pc.addTrack(track, stream);
        await sendOffer(id);
      }
    }
  }, [sendOffer]);

  const replaceTrackInAll = useCallback(async (kind, newTrack) => {
    for (const [id, pc] of Object.entries(pcsRef.current)) {
      const sender = pc.getSenders().find((s) => s.track?.kind === kind);
      if (sender && newTrack)   { await sender.replaceTrack(newTrack); }
      else if (sender && !newTrack) { pc.removeTrack(sender); await sendOffer(id); }
      else if (!sender && newTrack) { pc.addTrack(newTrack, localStreamRef.current); await sendOffer(id); }
    }
  }, [sendOffer]);

  // ── BUG FIX: Helper to safely attach a MediaStream to a video element.
  //    Setting srcObject directly without waiting for browser readiness can
  //    cause a frozen/black frame. We also revoke any old object URL.       ──
  const attachStreamToVideo = useCallback((videoEl, stream) => {
    if (!videoEl) return;
    if (videoEl.srcObject === stream) return; // already attached — no-op
    videoEl.srcObject = null;                 // detach old stream first
    videoEl.load();                           // reset the element state
    videoEl.srcObject = stream;
    videoEl.play().catch((err) => {
      // Autoplay blocked — not a crash, browser will show play button
      if (err.name !== "AbortError") console.warn("[Video] play()", err);
    });
  }, []);

  // ── Socket setup ───────────────────────────────────────────────────────────
  useEffect(() => {
    const socket = io(SERVER_URL);
    socketRef.current = socket;
    socket.emit("join-room", { roomId, username });

    socket.on("room-state", (state) => {
      loadRoomState(state);
      setJoined(true);
    });

    socket.on("users-update", (u) => setUsers(u));

    socket.on("file-update", ({ fileId, content }) => {
      suppressRef.current = true;
      applyFileUpdated({ fileId, content });
      const model = modelsRef.current[fileId];
      if (model && !model.isDisposed() && model.getValue() !== content) {
        model.setValue(content);
      }
      suppressRef.current = false;
    });

    socket.on("file-created",   (file)   => { applyFileCreated(file);  });
    socket.on("folder-created", (folder) => { applyFolderCreated(folder); });
    socket.on("file-renamed",   (payload) => {
      applyFileRenamed(payload);
      const model = modelsRef.current[payload.fileId];
      if (model && !model.isDisposed() && monaco) {
        monaco.editor.setModelLanguage(model, payload.language || "plaintext");
      }
    });
    socket.on("folder-renamed", applyFolderRenamed);
    // BUG FIX: handle file-deleted with newActiveFile so remote peers
    // also switch away from a deleted file automatically
    socket.on("file-deleted", ({ fileId, newActiveFile }) => {
      applyFileDeleted({ fileId });
      if (newActiveFile) openFile(newActiveFile);
    });
    socket.on("folder-deleted", applyFolderDeleted);

    // BUG FIX: file-switched was emitted by server but never handled on client
    socket.on("file-switched", ({ fileId }) => {
      openFile(fileId);
    });

    socket.on("peer-joined", ({ socketId }) => {
      const pc = createPC(socketId);
      localStreamRef.current?.getTracks().forEach((t) => {
        if (!pc.getSenders().some((s) => s.track === t)) pc.addTrack(t, localStreamRef.current);
      });
      sendOffer(socketId);
    });

    socket.on("webrtc-offer", async ({ from, offer }) => {
      const pc = createPC(from);
      localStreamRef.current?.getTracks().forEach((t) => {
        if (!pc.getSenders().some((s) => s.track === t)) pc.addTrack(t, localStreamRef.current);
      });
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        await drainIce(from);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit("webrtc-answer", { to: from, answer: pc.localDescription });
      } catch (e) { console.error("[Signal] offer handler", e); }
    });

    socket.on("webrtc-answer", async ({ from, answer }) => {
      const pc = pcsRef.current[from];
      if (!pc) return;
      try {
        if (pc.signalingState === "have-local-offer") {
          await pc.setRemoteDescription(new RTCSessionDescription(answer));
          await drainIce(from);
        }
      } catch (e) { console.error("[Signal] answer handler", e); }
    });

    socket.on("webrtc-ice-candidate", async ({ from, candidate }) => {
      const pc = pcsRef.current[from];
      if (pc?.remoteDescription) {
        try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch (e) { console.warn("[ICE]", e); }
      } else {
        if (!iceBufRef.current[from]) iceBufRef.current[from] = [];
        iceBufRef.current[from].push(candidate);
      }
    });

    socket.on("peer-left", ({ socketId }) => {
      pcsRef.current[socketId]?.close();
      delete pcsRef.current[socketId];
      delete iceBufRef.current[socketId];
      setRemoteStreams((prev) => { const n = { ...prev }; delete n[socketId]; return n; });
    });

    return () => {
      socket.disconnect();
      Object.values(pcsRef.current).forEach((pc) => pc.close());
      pcsRef.current = {};
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, username]);

  // ── Cleanup all models on unmount ─────────────────────────────────────────
  useEffect(() => {
    return () => {
      clearTimeout(debounceTimer.current);
      Object.values(modelsRef.current).forEach((m) => { if (!m.isDisposed()) m.dispose(); });
      modelsRef.current = {};
      mountedRef.current = false;
    };
  }, []);

  // ── BUG FIX: Sync remote video refs — use attachStreamToVideo so that
  //    remote video elements don't freeze when the stream object changes.  ──
  useEffect(() => {
    Object.entries(remoteStreams).forEach(([id, { stream }]) => {
      const el = remoteVideoRefs.current[id];
      if (el) attachStreamToVideo(el, stream);
    });
  }, [remoteStreams, attachStreamToVideo]);

  // ── Editor mount callback ──────────────────────────────────────────────────
  const handleEditorMount = useCallback((editor) => {
    editorRef.current = editor;
    mountedRef.current = true;

    editor.onDidChangeModelContent(() => {
      if (suppressRef.current) return;
      const model = editor.getModel();
      if (!model) return;
      const fileId = Object.entries(modelsRef.current).find(([, m]) => m === model)?.[0];
      if (!fileId) return;
      const content = model.getValue();
      updateFileContent(fileId, content);
      clearTimeout(debounceTimer.current);
      debounceTimer.current = setTimeout(() => {
        socketRef.current?.emit("file-change", { roomId, fileId, content });
      }, DEBOUNCE_MS);
    });

    if (activeFileId) {
      const model = getOrCreateModel(activeFileId);
      if (model) editor.setModel(model);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── File tree actions (local + emit) ──────────────────────────────────────
  const handleCreateFile = useCallback((name, parentId) => {
    const file = createFile(name, parentId);
    socketRef.current?.emit("create-file", { roomId, file });
  }, [createFile, roomId]);

  const handleCreateFolder = useCallback((name, parentId) => {
    const folder = createFolder(name, parentId);
    socketRef.current?.emit("create-folder", { roomId, folder });
  }, [createFolder, roomId]);

  const handleRenameFile = useCallback((fileId, name) => {
    renameFile(fileId, name);
    const language = extToLanguage(name);
    socketRef.current?.emit("rename-file", { roomId, fileId, name });
    const model = modelsRef.current[fileId];
    if (model && !model.isDisposed() && monaco) {
      monaco.editor.setModelLanguage(model, language);
    }
  }, [renameFile, roomId, monaco]);

  const handleRenameFolder = useCallback((folderId, name) => {
    renameFolder(folderId, name);
    socketRef.current?.emit("rename-folder", { roomId, folderId, name });
  }, [renameFolder, roomId]);

  const handleDeleteFile = useCallback((fileId) => {
    deleteFile(fileId);
    socketRef.current?.emit("delete-file", { roomId, fileId });
  }, [deleteFile, roomId]);

  const handleDeleteFolder = useCallback((folderId) => {
    deleteFolder(folderId, folders);
    socketRef.current?.emit("delete-folder", { roomId, folderId });
  }, [deleteFolder, folders, roomId]);

  // ── Upload folder / files ──────────────────────────────────────────────────
  const handleUpload = useCallback(async (e) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;
    setUploadStatus("loading");
    try {
      const { files: newFiles, folders: newFolders, skipped } = await readUploadedFiles(fileList);
      fs.loadFiles(newFiles, newFolders);
      Object.values(newFolders).forEach((folder) => {
        socketRef.current?.emit("create-folder", { roomId, folder });
      });
      Object.values(newFiles).forEach((file) => {
        socketRef.current?.emit("create-file", { roomId, file });
      });
      setUploadStatus(skipped.length > 0 ? { skipped } : null);
      if (skipped.length > 0) setTimeout(() => setUploadStatus(null), 5000);
    } catch (err) {
      console.error("Upload error", err);
      setUploadStatus(null);
    }
    e.target.value = "";
  }, [roomId, fs]);

  // ── Mic toggle ─────────────────────────────────────────────────────────────
  const toggleMic = async () => {
    setMediaError(null);
    if (micOn) {
      const track = localStreamRef.current?.getAudioTracks()[0];
      if (track) { track.stop(); localStreamRef.current.removeTrack(track); await replaceTrackInAll("audio", null); }
      setMicOn(false);
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        const track  = stream.getAudioTracks()[0];
        if (!localStreamRef.current) localStreamRef.current = new MediaStream();
        const existing = localStreamRef.current.getAudioTracks()[0];
        if (existing) { existing.stop(); localStreamRef.current.removeTrack(existing); localStreamRef.current.addTrack(track); await replaceTrackInAll("audio", track); }
        else { localStreamRef.current.addTrack(track); await addTrackToAll(track, localStreamRef.current); }
        setMicOn(true);
      } catch (err) {
        setMediaError(err.name === "NotAllowedError" ? "Microphone blocked — allow it in your browser settings." : `Microphone error: ${err.message}`);
      }
    }
  };

  // ── Camera toggle — BUG FIX ────────────────────────────────────────────────
  // Original bug: when toggling camera off then on again, the video element
  // retained the old (stopped) MediaStream and would show a frozen frame.
  // Fix: always create a fresh MediaStream for the new camera session and use
  // attachStreamToVideo() which fully resets the element before reattaching.
  const toggleCam = async () => {
    setMediaError(null);
    if (camOn) {
      const track = localStreamRef.current?.getVideoTracks()[0];
      if (track) {
        track.stop();
        localStreamRef.current.removeTrack(track);
        await replaceTrackInAll("video", null);
      }
      // Detach cleanly so the element doesn't hold a ref to the stopped stream
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = null;
        localVideoRef.current.load();
      }
      setCamOn(false);
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        const track  = stream.getVideoTracks()[0];

        // Ensure localStreamRef exists and is a live MediaStream
        if (!localStreamRef.current || localStreamRef.current.active === false) {
          localStreamRef.current = new MediaStream();
        }

        const existing = localStreamRef.current.getVideoTracks()[0];
        if (existing) {
          existing.stop();
          localStreamRef.current.removeTrack(existing);
          localStreamRef.current.addTrack(track);
          await replaceTrackInAll("video", track);
        } else {
          localStreamRef.current.addTrack(track);
          await addTrackToAll(track, localStreamRef.current);
        }

        // Use attachStreamToVideo to avoid frozen-frame when re-enabling camera
        attachStreamToVideo(localVideoRef.current, localStreamRef.current);
        setCamOn(true);
        setShowVideo(true);
      } catch (err) {
        setMediaError(err.name === "NotAllowedError" ? "Camera blocked — allow it in your browser settings." : `Camera error: ${err.message}`);
      }
    }
  };

  const endCall = () => {
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    Object.values(pcsRef.current).forEach((pc) => pc.close());
    pcsRef.current = {};
    setMicOn(false); setCamOn(false);
    setRemoteStreams({}); setShowVideo(false);
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = null;
      localVideoRef.current.load();
    }
  };

  const toggleMutePeer = (id) => {
    setMutedPeers((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      const el = remoteVideoRefs.current[id];
      if (el) el.muted = next.has(id);
      return next;
    });
  };

  const copyRoomId = () => {
    navigator.clipboard.writeText(roomId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const activeFile   = files[activeFileId];
  const visibleUsers = showAll ? users : users.slice(0, 4);
  const hiddenCount  = users.length - 4;
  const hasAnyVideo  = camOn || Object.values(remoteStreams).some(({ stream }) => stream?.getVideoTracks().some((t) => t.readyState === "live"));

  return (
    <div className="editor-shell">
      {/* ── header ── */}
      <header className="editor-header">
        <div className="editor-header__left">
          <button className="sidebar-toggle" onClick={() => setSidebarOpen((p) => !p)} title="Toggle sidebar">
            {sidebarOpen ? "◀" : "▶"}
          </button>
          <span className="editor-title">SyncDev</span>
          <span className="editor-room">Room: <strong>{roomId}</strong></span>
        </div>
        <div className="editor-header__center">
          {activeFile && (
            <span className="editor-active-file">
              {activeFile.name}
              <span className="editor-active-lang">{activeFile.language}</span>
            </span>
          )}
        </div>
        <div className="editor-header__right">
          <button onClick={copyRoomId} className={`button ${copied ? "button--success" : "button--secondary"}`} style={{ minWidth: 100 }}>
            {copied ? "✓ Copied" : "Copy Link"}
          </button>
          <button onClick={() => { endCall(); navigate("/dashboard"); }} className="button button--secondary">Leave</button>
        </div>
      </header>

      {/* ── media error banner ── */}
      {mediaError && (
        <div className="media-error-banner">
          ⚠ {mediaError}
          <button onClick={() => setMediaError(null)} className="media-error-close">✕</button>
        </div>
      )}

      {/* ── video grid ── */}
      {showVideo && hasAnyVideo && (
        <div className="video-grid">
          <button className="video-grid-close" onClick={() => setShowVideo(false)}>✕</button>
          {camOn && (
            <div className="video-tile video-tile--self">
              <video ref={localVideoRef} autoPlay muted playsInline className="video-el video-el--mirror" />
              <span className="video-label">{username} (You)</span>
              <span className="video-mic-indicator">{micOn ? "🎤" : "🔇"}</span>
            </div>
          )}
          {Object.entries(remoteStreams).map(([id, { username: rName, stream }]) => {
            const hasVid = stream?.getVideoTracks().some((t) => t.readyState === "live");
            return (
              <div key={id} className="video-tile">
                <video
                  ref={(el) => {
                    remoteVideoRefs.current[id] = el;
                    if (el) attachStreamToVideo(el, stream);
                  }}
                  autoPlay playsInline muted={mutedPeers.has(id)} className="video-el"
                  style={{ display: hasVid ? "block" : "none" }}
                />
                {!hasVid && <div className="video-avatar-placeholder">{rName?.[0]?.toUpperCase()}</div>}
                <span className="video-label">{rName}</span>
                <button className="video-mute-btn" onClick={() => toggleMutePeer(id)}>{mutedPeers.has(id) ? "🔇" : "🔊"}</button>
              </div>
            );
          })}
        </div>
      )}

      {/* ── main workspace ── */}
      <div className="editor-workspace">
        {/* sidebar */}
        {sidebarOpen && (
          <aside className="editor-sidebar">
            <div className="sidebar-upload-bar">
              <input
                ref={uploadInputRef}
                type="file"
                multiple
                webkitdirectory=""
                style={{ display: "none" }}
                onChange={handleUpload}
              />
              <button
                className="sidebar-upload-btn"
                title="Upload folder or files"
                onClick={() => uploadInputRef.current?.click()}
                disabled={uploadStatus === "loading"}
              >
                {uploadStatus === "loading" ? "⏳ Uploading…" : "⬆ Upload Folder"}
              </button>
              {uploadStatus?.skipped && (
                <span className="sidebar-upload-hint">
                  {uploadStatus.skipped.length} file{uploadStatus.skipped.length !== 1 ? "s" : ""} skipped
                </span>
              )}
            </div>
            <FileTree
              files={files}
              folders={folders}
              activeFileId={activeFileId}
              onOpenFile={openFile}
              onCreateFile={handleCreateFile}
              onCreateFolder={handleCreateFolder}
              onRenameFile={handleRenameFile}
              onRenameFolder={handleRenameFolder}
              onDeleteFile={handleDeleteFile}
              onDeleteFolder={handleDeleteFolder}
            />
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
          <div className="editor-viewport">
            {joined ? (
              <MonacoEditor
                height="100%"
                theme="vs-dark"
                onMount={handleEditorMount}
                options={{
                  fontSize: 14,
                  minimap: { enabled: false },
                  scrollBeyondLastLine: false,
                  wordWrap: "on",
                  fontFamily: "JetBrains Mono, monospace",
                  renderLineHighlight: "all",
                  cursorBlinking: "smooth",
                  automaticLayout: true,
                }}
              />
            ) : (
              <div className="editor-empty">Connecting…</div>
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
              <div key={u.id} className={`participant-card ${mutedPeers.has(u.id) ? "muted" : ""}`}
                onMouseEnter={() => setHoveredUser(u.id)} onMouseLeave={() => setHoveredUser(null)}>
                <div className={`participant-avatar ${u.username === username ? "you" : ""}`}>{u.username[0]?.toUpperCase()}</div>
                <div className="participant-info">
                  <p className="participant-name">{u.username}</p>
                  <p className="participant-state">{u.username === username ? "you" : "team member"}</p>
                </div>
                <span className="participant-status active" />
                {hoveredUser === u.id && u.username !== username && (
                  <div className="participant-actions">
                    <button className="participant-action mute-btn" onClick={() => toggleMutePeer(u.id)}>
                      {mutedPeers.has(u.id) ? "🔇" : "🔊"}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
          {users.length > 4 && (
            <button className="participants-toggle" onClick={() => setShowAll((p) => !p)}>
              {showAll ? "Show less" : `Show ${hiddenCount} more`}
            </button>
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
