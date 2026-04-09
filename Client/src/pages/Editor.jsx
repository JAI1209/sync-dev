import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import MonacoEditor from "@monaco-editor/react";
import { io } from "socket.io-client";

const RTC_CONFIG = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
};

const SERVER_URL = import.meta.env.VITE_API_URL || "http://localhost:3000";

export default function Editor({ username }) {
  const { roomId } = useParams();
  const navigate = useNavigate();

  const [code, setCode]         = useState("");
  const [users, setUsers]       = useState([]);
  const [joined, setJoined]     = useState(false);
  const [language, setLanguage] = useState("javascript");
  const [copied, setCopied]     = useState(false);
  const [showAll, setShowAll]   = useState(false);
  const [hoveredUser, setHoveredUser] = useState(null);

  const [micOn, setMicOn]           = useState(false);
  const [camOn, setCamOn]           = useState(false);
  const [mediaError, setMediaError] = useState(null);
  const [showVideo, setShowVideo]   = useState(false);
  const [mutedPeers, setMutedPeers] = useState(new Set());
  const [remoteStreams, setRemoteStreams] = useState({});

  const socketRef        = useRef(null);
  const localStreamRef   = useRef(null);
  const localVideoRef    = useRef(null);
  const pcsRef           = useRef({});
  const iceBufRef        = useRef({});
  const makingOfferRef   = useRef({});  // { [id]: bool } — lock per peer
  const usersRef         = useRef([]);
  const remoteVideoRefs  = useRef({});

  useEffect(() => { usersRef.current = users; }, [users]);

  /* ── drain buffered ICE candidates ── */
  const drainIce = useCallback(async (id) => {
    const pc = pcsRef.current[id];
    if (!pc?.remoteDescription) return;
    for (const c of (iceBufRef.current[id] || [])) {
      try { await pc.addIceCandidate(new RTCIceCandidate(c)); }
      catch (e) { console.warn("[ICE] drain", e); }
    }
    delete iceBufRef.current[id];
  }, []);

  /* ── send an offer to a specific peer (called explicitly, never via onnegotiationneeded) ── */
  const sendOffer = useCallback(async (remoteId) => {
    const pc = pcsRef.current[remoteId];
    if (!pc || makingOfferRef.current[remoteId]) return;
    makingOfferRef.current[remoteId] = true;
    try {
      console.log(`[RTC] sendOffer → ${remoteId}`);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socketRef.current.emit("webrtc-offer", { to: remoteId, offer: pc.localDescription });
    } catch (e) {
      console.error("[RTC] sendOffer error", e);
    } finally {
      makingOfferRef.current[remoteId] = false;
    }
  }, []);

  /* ── create a bare PC (no onnegotiationneeded — we control offer timing) ── */
  const createPC = useCallback((remoteId) => {
    if (pcsRef.current[remoteId]) return pcsRef.current[remoteId];
    console.log(`[RTC] createPC ${remoteId}`);
    const pc = new RTCPeerConnection(RTC_CONFIG);
    pcsRef.current[remoteId] = pc;

    pc.onicecandidate = ({ candidate }) => {
      if (candidate)
        socketRef.current.emit("webrtc-ice-candidate", { to: remoteId, candidate });
    };

    pc.ontrack = ({ streams }) => {
      const stream = streams[0];
      console.log(`[RTC] ✅ remote track from ${remoteId}`, stream.getTracks().map(t => t.kind));
      const user = usersRef.current.find((u) => u.id === remoteId);
      setRemoteStreams((prev) => ({
        ...prev,
        [remoteId]: { stream, username: user?.username || "Peer" },
      }));
      setShowVideo(true);
    };

    pc.onconnectionstatechange = () => {
      console.log(`[RTC] ${remoteId} → ${pc.connectionState}`);
      if (["disconnected", "failed", "closed"].includes(pc.connectionState)) {
        setRemoteStreams((prev) => { const n = { ...prev }; delete n[remoteId]; return n; });
        delete pcsRef.current[remoteId];
      }
    };

    // suppress onnegotiationneeded — we fire offers manually to avoid loops
    pc.onnegotiationneeded = null;

    return pc;
  }, []);

  /* ── push a new local track into every existing peer connection, then renegotiate ── */
  const addTrackToAll = useCallback(async (track, stream) => {
    for (const [id, pc] of Object.entries(pcsRef.current)) {
      if (!pc.getSenders().some((s) => s.track === track)) {
        pc.addTrack(track, stream);
        console.log(`[RTC] pushed ${track.kind} to ${id}`);
        // renegotiate now that we've added a track
        await sendOffer(id);
      }
    }
  }, [sendOffer]);

  /* ── replace a track kind (mic/cam toggle while connected) ── */
  const replaceTrackInAll = useCallback(async (kind, newTrack) => {
    for (const [id, pc] of Object.entries(pcsRef.current)) {
      const sender = pc.getSenders().find((s) => s.track?.kind === kind);
      if (sender && newTrack) {
        await sender.replaceTrack(newTrack);          // no renegotiation needed
        console.log(`[RTC] replaced ${kind} in ${id}`);
      } else if (sender && !newTrack) {
        pc.removeTrack(sender);
        await sendOffer(id);                          // removing needs renegotiation
      } else if (!sender && newTrack) {
        pc.addTrack(newTrack, localStreamRef.current);
        await sendOffer(id);
      }
    }
  }, [sendOffer]);

  /* ── socket + signaling setup ── */
  useEffect(() => {
    const socket = io(SERVER_URL);
    socketRef.current = socket;
    socket.emit("join-room", { roomId, username });

    socket.on("load-code",    (c) => { setCode(c); setJoined(true); });
    socket.on("code-update",  (c) => setCode(c));
    socket.on("users-update", (u) => setUsers(u));

    // existing peer → new joiner: WE initiate
    socket.on("peer-joined", ({ socketId }) => {
      console.log("[Signal] peer-joined", socketId);
      const pc = createPC(socketId);
      // add our tracks first, then offer
      localStreamRef.current?.getTracks().forEach((t) => {
        if (!pc.getSenders().some((s) => s.track === t))
          pc.addTrack(t, localStreamRef.current);
      });
      sendOffer(socketId);
    });

    // incoming offer → answer
    socket.on("webrtc-offer", async ({ from, offer }) => {
      console.log("[Signal] offer from", from);
      const pc = createPC(from);

      // add our tracks before answering so the other side gets them
      localStreamRef.current?.getTracks().forEach((t) => {
        if (!pc.getSenders().some((s) => s.track === t))
          pc.addTrack(t, localStreamRef.current);
      });

      try {
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        await drainIce(from);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit("webrtc-answer", { to: from, answer: pc.localDescription });
        console.log("[Signal] answer →", from);
      } catch (e) { console.error("[Signal] offer handler", e); }
    });

    // incoming answer
    socket.on("webrtc-answer", async ({ from, answer }) => {
      console.log("[Signal] answer from", from);
      const pc = pcsRef.current[from];
      if (!pc) return;
      try {
        if (pc.signalingState === "have-local-offer") {
          await pc.setRemoteDescription(new RTCSessionDescription(answer));
          await drainIce(from);
        } else {
          console.warn(`[Signal] ignoring stale answer, state=${pc.signalingState}`);
        }
      } catch (e) { console.error("[Signal] answer handler", e); }
    });

    // ICE candidates
    socket.on("webrtc-ice-candidate", async ({ from, candidate }) => {
      const pc = pcsRef.current[from];
      if (pc?.remoteDescription) {
        try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); }
        catch (e) { console.warn("[ICE]", e); }
      } else {
        if (!iceBufRef.current[from]) iceBufRef.current[from] = [];
        iceBufRef.current[from].push(candidate);
      }
    });

    socket.on("peer-left", ({ socketId }) => {
      console.log("[Signal] peer-left", socketId);
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

  useEffect(() => {
    Object.entries(remoteStreams).forEach(([id, { stream }]) => {
      const el = remoteVideoRefs.current[id];
      if (el && el.srcObject !== stream) el.srcObject = stream;
    });
  }, [remoteStreams]);

  /* ── mic toggle ── */
  const toggleMic = async () => {
    setMediaError(null);
    if (micOn) {
      const track = localStreamRef.current?.getAudioTracks()[0];
      if (track) {
        track.stop();
        localStreamRef.current.removeTrack(track);
        await replaceTrackInAll("audio", null);
      }
      setMicOn(false);
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        const track  = stream.getAudioTracks()[0];
        if (!localStreamRef.current) localStreamRef.current = new MediaStream();

        const existing = localStreamRef.current.getAudioTracks()[0];
        if (existing) {
          // already have an audio sender → just swap the track (no renegotiation)
          existing.stop();
          localStreamRef.current.removeTrack(existing);
          localStreamRef.current.addTrack(track);
          await replaceTrackInAll("audio", track);
        } else {
          localStreamRef.current.addTrack(track);
          await addTrackToAll(track, localStreamRef.current);
        }
        setMicOn(true);
        console.log("[Mic] ON:", track.label);
      } catch (err) {
        console.error("[Mic]", err);
        setMediaError(
          err.name === "NotAllowedError"
            ? "Microphone blocked — click 🔒 in the address bar, allow microphone, then try again."
            : `Microphone error: ${err.message}`
        );
      }
    }
  };

  /* ── camera toggle ── */
  const toggleCam = async () => {
    setMediaError(null);
    if (camOn) {
      const track = localStreamRef.current?.getVideoTracks()[0];
      if (track) {
        track.stop();
        localStreamRef.current.removeTrack(track);
        await replaceTrackInAll("video", null);
      }
      if (localVideoRef.current) localVideoRef.current.srcObject = null;
      setCamOn(false);
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        const track  = stream.getVideoTracks()[0];
        if (!localStreamRef.current) localStreamRef.current = new MediaStream();

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
        if (localVideoRef.current) localVideoRef.current.srcObject = localStreamRef.current;
        setCamOn(true);
        setShowVideo(true);
        console.log("[Cam] ON:", track.label);
      } catch (err) {
        console.error("[Cam]", err);
        setMediaError(
          err.name === "NotAllowedError"
            ? "Camera blocked — click 🔒 in the address bar, allow camera, then try again."
            : `Camera error: ${err.message}`
        );
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
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
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

  const handleCodeChange = (value) => {
    setCode(value);
    socketRef.current?.emit("code-change", { roomId, code: value });
  };

  const copyRoomId = () => {
    navigator.clipboard.writeText(roomId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const visibleUsers = showAll ? users : users.slice(0, 4);
  const hiddenCount  = users.length - 4;
  const hasAnyVideo  = camOn || Object.values(remoteStreams).some(({ stream }) => stream?.getVideoTracks().length > 0);

  return (
    <div className="editor-shell">
      <header className="editor-header">
        <div className="editor-header__left">
          <span className="editor-title">SyncDev</span>
          <span className="editor-room">Room: <strong>{roomId}</strong></span>
        </div>
        <div className="editor-header__center">
          <select value={language} onChange={(e) => setLanguage(e.target.value)} className="language-select">
            <option value="javascript">JavaScript</option>
            <option value="typescript">TypeScript</option>
            <option value="python">Python</option>
            <option value="java">Java</option>
            <option value="cpp">C++</option>
            <option value="html">HTML</option>
            <option value="css">CSS</option>
          </select>
          <button className="button button--secondary">{"< File Structure />"}</button>
        </div>
        <div className="editor-header__right">
          <button onClick={copyRoomId} className={`button ${copied ? "button--success" : "button--secondary"}`} style={{ minWidth: 100 }}>
            {copied ? "✓ Copied" : "Copy Link"}
          </button>
          <button onClick={() => { endCall(); navigate("/dashboard"); }} className="button button--secondary">Leave</button>
        </div>
      </header>

      {mediaError && (
        <div className="media-error-banner">
          ⚠ {mediaError}
          <button onClick={() => setMediaError(null)} className="media-error-close">✕</button>
        </div>
      )}

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
            const hasVid = stream?.getVideoTracks().length > 0;
            return (
              <div key={id} className="video-tile">
                {hasVid
                  ? <video ref={(el) => { remoteVideoRefs.current[id]=el; if(el&&el.srcObject!==stream)el.srcObject=stream; }} autoPlay playsInline muted={mutedPeers.has(id)} className="video-el" />
                  : <div className="video-avatar-placeholder">{rName?.[0]?.toUpperCase()}</div>
                }
                <span className="video-label">{rName}</span>
                <button className="video-mute-btn" onClick={() => toggleMutePeer(id)}>{mutedPeers.has(id) ? "🔇" : "🔊"}</button>
              </div>
            );
          })}
        </div>
      )}

      <div className="editor-workspace">
        <div className="editor-viewport">
          {joined && (
            <MonacoEditor
              height="100%"
              language={language}
              theme="vs-dark"
              value={code}
              onChange={handleCodeChange}
              options={{ fontSize: 14, minimap: { enabled: false }, scrollBeyondLastLine: false, wordWrap: "on", fontFamily: "JetBrains Mono, monospace" }}
            />
          )}
        </div>

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
          <button className="toolbar-button">😊 Emoji</button>
          <button className="toolbar-button">✋ Hand</button>
        </div>
        <div className="toolbar-section toolbar-section--center">
          <span className="toolbar-info">
            {users.length} peer{users.length !== 1 ? "s" : ""} connected
            {micOn && " · 🎤 Live"}{camOn && " · 📹 Live"}
          </span>
        </div>
        <div className="toolbar-section toolbar-section--right">
          <button className="toolbar-button">⚙ Settings</button>
          <button className="toolbar-button danger" onClick={endCall}>⊗ End Call</button>
        </div>
      </footer>
    </div>
  );
}