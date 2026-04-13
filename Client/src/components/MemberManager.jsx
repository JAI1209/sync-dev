import { useState, useEffect, useCallback } from "react";
import { getAccessToken } from "../api/client";

export default function MemberManager({ roomId, userRole }) {
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [inviteUsername, setInviteUsername] = useState("");
  const [inviteRole, setInviteRole] = useState("viewer");
  const [message, setMessage] = useState("");
  const [isOpen, setIsOpen] = useState(false);

  const canManage = userRole === "owner" || userRole === "admin";
  const canInvite = userRole === "owner" || userRole === "admin";

  const fetchMembers = useCallback(async () => {
    if (!roomId) return;
    setLoading(true);
    try {
      const token = getAccessToken();
      const res = await fetch(`/api/rbac/rooms/${roomId}/members`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setMembers(data.members || []);
      }
    } catch (err) {
      console.error("[Members] Fetch error:", err);
    } finally {
      setLoading(false);
    }
  }, [roomId]);

  useEffect(() => {
    if (isOpen) fetchMembers();
  }, [isOpen, fetchMembers]);

  // Refresh when invite/role change completes
  useEffect(() => {
    if (message && message.includes("✓")) {
      // Success message shown, refresh list
      fetchMembers();
    }
  }, [message, fetchMembers]);

  const handleInvite = async () => {
    if (!inviteUsername.trim()) return;
    setMessage("");
    try {
      const token = getAccessToken();
      const res = await fetch(`/api/rbac/rooms/${roomId}/invite`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ username: inviteUsername, role: inviteRole }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage(`✓ Invited ${inviteUsername} as ${inviteRole}`);
        setInviteUsername("");
        fetchMembers();
      } else {
        setMessage(`✗ ${data.msg || "Failed to invite"}`);
      }
    } catch (err) {
      setMessage("✗ Network error");
    }
  };

  const handleChangeRole = async (username, newRole) => {
    if (!confirm(`Change ${username}'s role to ${newRole}?`)) return;
    try {
      const token = getAccessToken();
      const res = await fetch(`/api/rbac/rooms/${roomId}/members/${username}/role`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ role: newRole }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage(`✓ Changed ${username} to ${newRole}`);
        fetchMembers();
      } else {
        setMessage(`✗ ${data.msg || "Failed to change role"}`);
      }
    } catch (err) {
      setMessage("✗ Network error");
    }
  };

  const handleRemove = async (username) => {
    if (!confirm(`Remove ${username} from room?`)) return;
    try {
      const token = getAccessToken();
      const res = await fetch(`/api/rbac/rooms/${roomId}/members/${username}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (res.ok) {
        // Bug 19: Add success feedback and refresh list
        setMessage(`✓ Removed ${username}`);
        fetchMembers();
      } else {
        setMessage(`✗ ${data.msg || "Failed to remove"}`);
      }
    } catch (err) {
      setMessage("✗ Network error");
    }
  };

  const getRoleBadge = (role) => {
    const badges = {
      owner: "● owner",
      admin: "● admin",
      editor: "● editor",
      viewer: "● viewer",
    };
    return badges[role] || role;
  };

  if (!isOpen) {
    return (
      <div className="sidebar-github sidebar-members">
        <p className="sidebar-github__label">Members</p>
        <div className="sidebar-github__actions">
          <button
            type="button"
            className="sidebar-github__btn sidebar-github__btn--primary"
            onClick={() => setIsOpen(true)}
          >
            Manage ({userRole})
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="sidebar-github sidebar-members sidebar-members--open">
      <p className="sidebar-github__label">// Members</p>

      {canInvite && (
        <div className="sidebar-members__invite">
          <input
            className="sidebar-github__input"
            placeholder="Username to invite"
            value={inviteUsername}
            onChange={(e) => setInviteUsername(e.target.value)}
          />
          <select
            className="sidebar-github__input"
            value={inviteRole}
            onChange={(e) => setInviteRole(e.target.value)}
          >
            <option value="viewer">viewer</option>
            <option value="editor">editor</option>
            {userRole === "owner" && <option value="admin">admin</option>}
          </select>
          <button
            type="button"
            className="sidebar-github__btn sidebar-github__btn--primary"
            onClick={handleInvite}
            disabled={!inviteUsername.trim()}
          >
            Invite
          </button>
        </div>
      )}

      {message && <p className="sidebar-github__hint">{message}</p>}

      <div className="sidebar-members__list">
        {loading ? (
          <p className="sidebar-members__empty">Loading...</p>
        ) : members.length === 0 ? (
          <p className="sidebar-members__empty">No members yet</p>
        ) : (
          members.map((m) => (
            <div key={m.username} className="sidebar-members__item">
              <span className="sidebar-members__name" title={m.username}>
                {m.username}
                {m.isOnline && <span className="sidebar-members__online" />}
              </span>
              <span className={`sidebar-members__role sidebar-members__role--${m.role}`}>
                {getRoleBadge(m.role)}
              </span>

              {canManage && m.role !== "owner" && (
                <div className="sidebar-members__actions">
                  {userRole === "owner" && (
                    <select
                      className="sidebar-members__role-select"
                      value={m.role}
                      onChange={(e) => handleChangeRole(m.username, e.target.value)}
                    >
                      <option value="viewer">viewer</option>
                      <option value="editor">editor</option>
                      <option value="admin">admin</option>
                    </select>
                  )}
                  <button
                    className="sidebar-members__remove"
                    onClick={() => handleRemove(m.username)}
                    title="Remove"
                  >
                    ×
                  </button>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      <div className="sidebar-github__actions">
        <button
          type="button"
          className="sidebar-github__btn"
          onClick={() => setIsOpen(false)}
        >
          Close
        </button>
        <button
          type="button"
          className="sidebar-github__btn"
          onClick={fetchMembers}
        >
          Refresh
        </button>
      </div>
    </div>
  );
}
