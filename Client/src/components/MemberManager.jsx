import { useState, useEffect, useCallback } from "react";
import { authFetch } from "../api/client";

export default function MemberManager({ roomId, userRole }) {
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [inviteUsername, setInviteUsername] = useState("");
  const [inviteRole, setInviteRole] = useState("viewer");
  const [message, setMessage] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [pendingRemove, setPendingRemove] = useState(null);
  const [pendingRoleChange, setPendingRoleChange] = useState(null);

  const canManage = userRole === "owner" || userRole === "admin";
  const canInvite = userRole === "owner" || userRole === "admin";

  const fetchMembers = useCallback(async () => {
    if (!roomId) return;
    setLoading(true);
    try {
      const res = await authFetch(`/api/rbac/rooms/${roomId}/members`);
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
    if (message && message.startsWith("OK:")) {
      fetchMembers();
    }
  }, [message, fetchMembers]);

  useEffect(() => {
    if (!pendingRemove && !pendingRoleChange) return undefined;
    const timeout = setTimeout(() => {
      setPendingRemove(null);
      setPendingRoleChange(null);
    }, 4000);
    return () => clearTimeout(timeout);
  }, [pendingRemove, pendingRoleChange]);

  const handleInvite = async () => {
    if (!inviteUsername.trim()) return;
    setMessage("");
    try {
      const res = await authFetch(`/api/rbac/rooms/${roomId}/invite`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ username: inviteUsername, role: inviteRole }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage(`OK: Invited ${inviteUsername} as ${inviteRole}`);
        setInviteUsername("");
        fetchMembers();
      } else {
        setMessage(`Error: ${data.msg || "Failed to invite"}`);
      }
    } catch {
      setMessage("Error: Network error");
    }
  };

  const requestChangeRole = (username, newRole) => {
    // FIX: Replace native browser confirmation with an inline row-level confirmation state.
    setPendingRoleChange({ username, newRole });
    setMessage(`Confirm role change: ${username} -> ${newRole}`);
  };

  const handleChangeRole = async (username, newRole) => {
    try {
      const safeUsername = encodeURIComponent(username);
      const res = await authFetch(`/api/rbac/rooms/${roomId}/members/${safeUsername}/role`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ role: newRole }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage(`OK: Changed ${username} to ${newRole}`);
        setPendingRoleChange(null);
        fetchMembers();
      } else {
        setMessage(`Error: ${data.msg || "Failed to change role"}`);
      }
    } catch {
      setMessage("Error: Network error");
    }
  };

  const handleRemove = async (username) => {
    try {
      const safeUsername = encodeURIComponent(username);
      const res = await authFetch(`/api/rbac/rooms/${roomId}/members/${safeUsername}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (res.ok) {
        setMessage(`OK: Removed ${username}`);
        setPendingRemove(null);
        fetchMembers();
      } else {
        setMessage(`Error: ${data.msg || "Failed to remove"}`);
      }
    } catch {
      setMessage("Error: Network error");
    }
  };

  const getRoleBadge = (role) => {
    const badges = {
      owner: "* owner",
      admin: "* admin",
      editor: "* editor",
      viewer: "* viewer",
    };
    return badges[role] || role;
  };

  const canChangeMemberRole = (member) =>
    userRole === "owner" ||
    (userRole === "admin" && member.role !== "owner" && member.role !== "admin");

  const getAssignableRoles = () => (userRole === "owner" ? ["viewer", "editor", "admin"] : ["viewer", "editor"]);

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
            Members
            {members.length > 0 && <span className="sidebar-members__count-badge">{members.length}</span>}
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
            <div key={m.userId || m.username} className="sidebar-members__item">
              <span className="sidebar-members__name" title={m.username}>
                {m.username}
                {m.isOnline && <span className="sidebar-members__online" />}
              </span>
              <span className={`sidebar-members__role sidebar-members__role--${m.role}`}>
                {getRoleBadge(m.role)}
              </span>

              {canManage && m.role !== "owner" && (
                <div className="sidebar-members__actions">
                  {canChangeMemberRole(m) && (
                    <select
                      className="sidebar-members__role-select"
                      value={m.role}
                      onChange={(e) => requestChangeRole(m.username, e.target.value)}
                    >
                      {getAssignableRoles().map((role) => (
                        <option key={role} value={role}>{role}</option>
                      ))}
                    </select>
                  )}
                  {pendingRoleChange?.username === m.username && (
                    <button
                      type="button"
                      className="sidebar-members__remove sidebar-members__confirm"
                      onClick={() => handleChangeRole(m.username, pendingRoleChange.newRole)}
                    >
                      Confirm?
                    </button>
                  )}
                  <button
                    type="button"
                    className="sidebar-members__remove"
                    onClick={() => {
                      if (pendingRemove === m.username) {
                        handleRemove(m.username);
                        return;
                      }
                      // FIX: Replace native browser confirmation with a two-step inline remove confirmation.
                      setPendingRemove(m.username);
                    }}
                    title="Remove"
                  >
                    {pendingRemove === m.username ? "Confirm?" : "x"}
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
