export default function EditorHeader({
  roomId,
  copied,
  handleCopyRoom,
  userRole,
  githubBusy,
  githubMeta,
  commitBranch,
  setCommitBranch,
  commitMessage,
  setCommitMessage,
  handleCommitPush,
  handleDownloadZip,
  handleImportGithub,
  terminalOpen,
  setTerminalOpen,
  socketStatus,
  reconnecting,
  handleReconnectSocket,
  socketIssue,
  githubHint,
}) {
  return (
    <header className="editor-header">
      <div className="editor-header__left">
        <div className="editor-brand">
          <span className="logo">SyncDev</span>
          <span className="room-badge" onClick={handleCopyRoom}>
            {roomId} {copied && "✓"}
          </span>
        </div>
      </div>

      <div className="editor-header__right editor-actions">
        {userRole !== "viewer" && (
          <>
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
                <button className="btn" onClick={handleCommitPush} disabled={githubBusy}>
                  {githubBusy ? "⏳" : "⬆ Push"}
                </button>
              </>
            )}

            <button className="btn" onClick={handleDownloadZip}>⬇ Export ZIP</button>
          </>
        )}
        <button className="btn" onClick={() => setTerminalOpen((v) => !v)}>
          {terminalOpen ? "✕ Terminal" : "▶ Terminal"}
        </button>
        {socketStatus !== "connected" && (
          <button className="btn btn--primary" onClick={handleReconnectSocket} disabled={reconnecting}>
            {reconnecting ? "⏳ Connecting…" : "↻ Reconnect"}
          </button>
        )}
        {socketIssue && <span className="error-badge">{socketIssue}</span>}
        {githubHint && <span className="hint-badge">{githubHint}</span>}
      </div>
    </header>
  );
}
