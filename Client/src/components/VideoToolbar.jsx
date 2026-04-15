export default function VideoToolbar({
  micOn,
  camOn,
  toggleMic,
  toggleCam,
  remoteStreams,
  showVideo,
  setShowVideo,
  users,
  endCall,
}) {
  return (
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
  );
}
