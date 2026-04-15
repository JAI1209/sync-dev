export default function ParticipantsPanel({
  users,
  username,
  showAll,
  setShowAll,
  hoveredUser,
  setHoveredUser,
  mutedPeers,
  setMutedPeers,
  camOn,
  remoteStreams,
  showVideo,
  localVideoRef,
  remoteVideoRefs,
}) {
  const visibleUsers = showAll ? users : users.slice(0, 5);

  return (
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

      {(camOn || Object.keys(remoteStreams).length > 0) && showVideo && (
        <div className="video-panel">
          {camOn && (
            <div className="video-item">
              <video ref={localVideoRef} muted autoPlay playsInline className="video-local" />
              <span className="video-label">You</span>
            </div>
          )}
          {Object.entries(remoteStreams).map(([peerId, { stream, username: peerName }]) => (
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
              <span className="video-label">{peerName || "Peer"}</span>
            </div>
          ))}
        </div>
      )}
    </aside>
  );
}
