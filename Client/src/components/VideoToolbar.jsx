export default function VideoToolbar({
  micOn,
  camOn,
  toggleMic,
  toggleCam,
  remoteStreams,
  showVideo,
  setShowVideo,
  users,
  onEndCall,
  onTerminateRoom,
  userRole,
}) {
  const hasAnyVideo = camOn || Object.keys(remoteStreams).length > 0;

  return (
    <footer className="editor-toolbar">
      <div className="toolbar-section">
        <button type="button" className={`toolbar-button ${micOn ? "active" : "inactive"}`} onClick={toggleMic}>
          {micOn ? "Mic On" : "Mic Off"}
        </button>
        <button type="button" className={`toolbar-button ${camOn ? "active" : "inactive"}`} onClick={toggleCam}>
          {camOn ? "Cam On" : "Cam Off"}
        </button>
        {hasAnyVideo && (
          <button type="button" className="toolbar-button" onClick={() => setShowVideo((value) => !value)}>
            {showVideo ? "Hide Video" : "Show Video"}
          </button>
        )}
      </div>

      <div className="toolbar-section toolbar-section--center">
        <span className="toolbar-info">
          {users.length} peer{users.length !== 1 ? "s" : ""} connected
          {micOn && " - Mic live"}
          {camOn && " - Cam live"}
        </span>
      </div>

      <div className="toolbar-section toolbar-section--right">
        {/* FIX: Explicit button type prevents accidental form-submit behavior in embedded layouts. */}
        <button type="button" className="toolbar-button danger" onClick={onEndCall}>End Call</button>
        {userRole === "owner" && (
          <button
            type="button"
            className="toolbar-button danger toolbar-button--terminate"
            onClick={onTerminateRoom}
            title="Terminate the room and disconnect all participants"
          >
            End Room
          </button>
        )}
      </div>
    </footer>
  );
}
