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
  const remoteEntries = Object.entries(remoteStreams || {});
  const showRemoteVideos = showVideo && remoteEntries.length > 0;
  const showVideoPanel = camOn || showRemoteVideos;

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
        {visibleUsers.map((user) => (
          <div
            key={user.userId ?? user.socketId}
            className={`participant-card ${mutedPeers.has(user.socketId) ? "muted" : ""}`}
            onMouseEnter={() => setHoveredUser(user.socketId)}
            onMouseLeave={() => setHoveredUser(null)}
          >
            <div className={`participant-avatar ${user.username === username ? "you" : ""}`}>
              {user.username[0]?.toUpperCase()}
            </div>
            <div className="participant-info">
              <p className="participant-name">{user.username}</p>
              <p className="participant-state">{user.username === username ? "you" : "team member"}</p>
              {/* FIX: Show role badge per participant instead of hiding RBAC state behind generic copy. */}
              <span className={`participant-role participant-role--${user.role || "viewer"}`}>
                {user.role || "viewer"}
              </span>
            </div>
            <span className="participant-status active" />

            {hoveredUser === user.socketId && user.username !== username && (
              <button
                type="button"
                className="participant-mute"
                onClick={() =>
                  setMutedPeers((previous) => {
                    const next = new Set(previous);
                    if (next.has(user.socketId)) {
                      next.delete(user.socketId);
                    } else {
                      next.add(user.socketId);
                    }
                    return next;
                  })
                }
              >
                {mutedPeers.has(user.socketId) ? "Unmute" : "Mute"}
              </button>
            )}
          </div>
        ))}

        {users.length > 5 && (
          <button className="participants-toggle" onClick={() => setShowAll((state) => !state)}>
            {showAll ? "Show less" : `Show all ${users.length}`}
          </button>
        )}
      </div>

      {showVideoPanel && (
        <div className="video-panel">
          {camOn && (
            <div className="video-item">
              <video ref={localVideoRef} muted autoPlay playsInline className="video-local" />
              <span className="video-label">You</span>
            </div>
          )}

          {showRemoteVideos &&
            remoteEntries.map(([peerId, { stream, username: peerName }]) => (
              <div key={peerId} className="video-item">
                <video
                  ref={(element) => {
                    remoteVideoRefs.current[peerId] = element;
                    if (element) {
                      element.srcObject = stream;
                      // FIX: Apply persisted peer mute state when remote video refs mount.
                      element.muted = mutedPeers.has(peerId);
                    }
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
