import { useCallback, useEffect, useState } from "react";
import { authFetch } from "../api/client";

export default function SnapshotPanel({ roomId, permissions, onRestored }) {
  const [isOpen, setIsOpen] = useState(false);
  const [snapshots, setSnapshots] = useState([]);
  const [loading, setLoading] = useState(false);
  const [snapshotName, setSnapshotName] = useState("");
  const [message, setMessage] = useState("");

  const canCreate = permissions?.canEditFiles;
  const canRestore = permissions?.canManageRoom;

  const fetchSnapshots = useCallback(async () => {
    if (!roomId) return;
    setLoading(true);
    setMessage("");
    try {
      // FIX: Wire existing snapshot list API into the editor sidebar.
      const res = await authFetch(`/api/snapshots/${roomId}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage(data.msg || "Could not load snapshots.");
        return;
      }
      setSnapshots(Array.isArray(data.snapshots) ? data.snapshots : []);
    } catch {
      setMessage("Could not reach snapshot service.");
    } finally {
      setLoading(false);
    }
  }, [roomId]);

  useEffect(() => {
    if (isOpen) fetchSnapshots();
  }, [isOpen, fetchSnapshots]);

  const handleSaveSnapshot = async (event) => {
    event.preventDefault();
    if (!snapshotName.trim()) return;
    setMessage("");
    try {
      // FIX: Save snapshot form uses styled inline UI instead of leaving the server feature unwired.
      const res = await authFetch(`/api/snapshots/${roomId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: snapshotName.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage(data.msg || "Could not save snapshot.");
        return;
      }
      setSnapshotName("");
      setMessage("Snapshot saved.");
      fetchSnapshots();
    } catch {
      setMessage("Could not save snapshot.");
    }
  };

  const handleRestoreSnapshot = async (snapshotId) => {
    setMessage("");
    try {
      // FIX: Restore is restricted to owner/admin and refreshes local state from server response.
      const res = await authFetch(`/api/snapshots/${roomId}/restore`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ snapshotId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage(data.msg || "Could not restore snapshot.");
        return;
      }
      onRestored?.(data.state);
      setMessage(`Restored ${data.restoredFrom || "snapshot"}.`);
    } catch {
      setMessage("Could not restore snapshot.");
    }
  };

  if (!canCreate) return null;

  if (!isOpen) {
    return (
      <div className="sidebar-github sidebar-snapshots">
        <p className="sidebar-github__label">Snapshots</p>
        <div className="sidebar-github__actions">
          <button
            type="button"
            className="sidebar-github__btn"
            onClick={() => setIsOpen(true)}
          >
            Snapshots
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="sidebar-github sidebar-snapshots sidebar-snapshots--open">
      <p className="sidebar-github__label">// Snapshots</p>

      <form className="sidebar-snapshots__form" onSubmit={handleSaveSnapshot}>
        <input
          className="sidebar-github__input"
          placeholder="Snapshot name"
          value={snapshotName}
          onChange={(event) => setSnapshotName(event.target.value)}
        />
        <button
          type="submit"
          className="sidebar-github__btn sidebar-github__btn--primary"
          disabled={!snapshotName.trim()}
        >
          Save snapshot
        </button>
      </form>

      {message && <p className="sidebar-github__hint">{message}</p>}

      <div className="sidebar-snapshots__list">
        {loading ? (
          <p className="sidebar-members__empty">Loading snapshots...</p>
        ) : snapshots.length === 0 ? (
          <p className="sidebar-members__empty">No snapshots yet</p>
        ) : (
          snapshots.map((snapshot) => (
            <article className="sidebar-snapshots__item" key={snapshot.snapshotId}>
              <div>
                <strong>{snapshot.name}</strong>
                <span>{new Date(snapshot.createdAt).toLocaleString()}</span>
                <span>{snapshot.fileCount || 0} files</span>
              </div>
              {canRestore && (
                <button
                  type="button"
                  className="sidebar-github__btn"
                  onClick={() => handleRestoreSnapshot(snapshot.snapshotId)}
                >
                  Restore
                </button>
              )}
            </article>
          ))
        )}
      </div>

      <div className="sidebar-github__actions">
        <button type="button" className="sidebar-github__btn" onClick={() => setIsOpen(false)}>
          Close
        </button>
        <button type="button" className="sidebar-github__btn" onClick={fetchSnapshots}>
          Refresh
        </button>
      </div>
    </div>
  );
}
