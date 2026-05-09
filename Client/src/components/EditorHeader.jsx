import { useState } from "react";
import { ThemeToggle } from "./ui.jsx";

export default function EditorHeader({
  roomId,
  copied,
  handleCopyRoom,
  onLeaveRoom,
  userRole,
  permissions,
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
  importProgress,
}) {
  const [showImportForm, setShowImportForm] = useState(false);
  const [repoUrl, setRepoUrl] = useState("");
  const [repoRef, setRepoRef] = useState("");
  const [inviteCopied, setInviteCopied] = useState(false);

  const canImport = permissions?.canEditFiles ?? userRole !== "viewer";
  const canPush = permissions?.canPushGitHub ?? ["owner", "admin"].includes(userRole);
  const canInvite = permissions?.canInvite ?? ["owner", "admin"].includes(userRole);

  const handleImportSubmit = (event) => {
    event.preventDefault();
    const nextUrl = repoUrl.trim();
    if (!nextUrl || githubBusy) return;
    // FIX: Replace browser prompt import with an inline form that supports optional branch/ref.
    handleImportGithub(nextUrl, repoRef.trim());
    setRepoUrl("");
    setRepoRef("");
    setShowImportForm(false);
  };

  const handleImportFormKeyDown = (event) => {
    // FIX: Keep Enter handling scoped to the import form so the header row never submits unexpectedly.
    if (event.key === "Enter" && githubBusy) {
      event.preventDefault();
    }
  };

  const handleShareInvite = async () => {
    // FIX: Invite link copy is distinct from copying the raw room ID.
    const inviteUrl = `${window.location.origin}/editor/${roomId}`;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setInviteCopied(true);
      setTimeout(() => setInviteCopied(false), 1500);
    } catch {
      setInviteCopied(false);
    }
  };

  return (
    <header className="editor-header">
      <div className="editor-header__left">
        <div className="editor-brand">
          <span className="logo">SyncDev</span>
          <button type="button" className="room-badge button button--ghost" onClick={handleCopyRoom}>
            {roomId} {copied && "OK"}
          </button>
        </div>
      </div>

      <div className="editor-header__right editor-actions">
        <ThemeToggle />

        {userRole !== "owner" && (
          <button
            type="button"
            className="button button--danger"
            onClick={onLeaveRoom}
            title="Leave this collaborative session"
          >
            Leave Room
          </button>
        )}

        {canImport && (
          <>
            <button
              type="button"
              className="button button--secondary"
              onClick={() => setShowImportForm((open) => !open)}
              disabled={githubBusy}
            >
              {githubBusy ? "Working..." : "Import"}
            </button>

            {showImportForm && (
              <form className="editor-header__import-form" onKeyDown={handleImportFormKeyDown} onSubmit={handleImportSubmit}>
                <input
                  className="input input-small input-small--repo"
                  placeholder="https://github.com/owner/repo"
                  value={repoUrl}
                  onChange={(event) => setRepoUrl(event.target.value)}
                  autoComplete="off"
                  autoFocus
                />
                <input
                  className="input input-small input-small--ref"
                  placeholder="branch/ref optional"
                  value={repoRef}
                  onChange={(event) => setRepoRef(event.target.value)}
                />
                <button type="submit" className="button button--primary" disabled={githubBusy || !repoUrl.trim()}>
                  Import repo
                </button>
              </form>
            )}

            {githubMeta && canPush && (
              <>
                <input
                  className="input input-small"
                  placeholder="Branch"
                  value={commitBranch}
                  onChange={(event) => setCommitBranch(event.target.value)}
                />
                <input
                  className="input input-small"
                  placeholder="Commit message"
                  value={commitMessage}
                  onChange={(event) => setCommitMessage(event.target.value)}
                />
                <button type="button" className="button button--secondary" onClick={handleCommitPush} disabled={githubBusy}>
                  {githubBusy ? "Working..." : "Push"}
                </button>
              </>
            )}

            <button type="button" className="button button--secondary" onClick={handleDownloadZip}>Export ZIP</button>
          </>
        )}

        {canInvite && (
          <button type="button" className="button button--secondary" onClick={handleShareInvite}>
            {inviteCopied ? "Copied invite link!" : "Share invite"}
          </button>
        )}

        <button type="button" className="button button--secondary" onClick={() => setTerminalOpen((value) => !value)}>
          {terminalOpen ? "Hide Terminal" : "Show Terminal"}
        </button>

        <span className={`status-pill status-pill--neutral socket-status socket-status--${reconnecting ? "reconnecting" : socketStatus}`}>
          {/* FIX: Header status uses an explicit colored dot instead of text-only state. */}
          <span className={`status-dot status-dot--${reconnecting ? "reconnecting" : socketStatus}`} />
          {reconnecting ? "reconnecting" : socketStatus}
        </span>

        {socketStatus !== "connected" && (
          <button type="button" className="button button--primary" onClick={handleReconnectSocket} disabled={reconnecting}>
            {reconnecting ? "Connecting..." : "Reconnect"}
          </button>
        )}

        {socketIssue && <span className="error-badge">{socketIssue}</span>}
        {githubHint && <span className="hint-badge">{githubHint}</span>}
        {importProgress && <span className="hint-badge hint-badge--progress">{importProgress}</span>}
      </div>
    </header>
  );
}
