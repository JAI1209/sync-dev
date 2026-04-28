import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { jwtDecode } from "jwt-decode";
import { AlertBox, Button, Field, SectionCard, StatusPill, TerminalSpinner, ThemeToggle } from "../components/ui";
import { authFetch, getAccessToken, refreshAccessToken } from "../api/client";

const ROOM_ID_REGEX = /^[A-HJ-NP-Z2-9]{8}$/;

function isTokenExpired(token) {
  try {
    const decoded = jwtDecode(token);
    return !decoded?.exp || decoded.exp * 1000 <= Date.now();
  } catch {
    return true;
  }
}

export default function Dashboard({ onLogout, username }) {
  const [roomId, setRoomId] = useState("");
  const [banner, setBanner] = useState(null);
  const [createError, setCreateError] = useState("");
  const [busy, setBusy] = useState(null);
  const [rooms, setRooms] = useState([]);
  const [roomsLoading, setRoomsLoading] = useState(true);
  const navigate = useNavigate();

  const fetchRooms = useCallback(async () => {
    setRoomsLoading(true);
    try {
      // FIX: Load recent rooms from RBAC membership instead of local-only state.
      const res = await authFetch("/api/auth/my-rooms");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setBanner({ tone: "danger", title: "Rooms", detail: data.msg || "Could not load rooms." });
        return;
      }
      setRooms(Array.isArray(data.rooms) ? data.rooms.slice(0, 5) : []);
    } catch {
      setBanner({ tone: "danger", title: "Rooms", detail: "Could not reach the server." });
    } finally {
      setRoomsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRooms();
  }, [fetchRooms]);

  const ensureFreshSession = useCallback(async () => {
    // FIX: Pre-check token expiry before opening the editor/socket path.
    const token = getAccessToken();
    if (token && !isTokenExpired(token)) return true;

    const refreshed = await refreshAccessToken();
    if (refreshed) return true;

    setBanner({ tone: "danger", title: "Session expired", detail: "Session expired. Please log in again." });
    navigate("/login");
    return false;
  }, [navigate]);

  const createRoom = async () => {
    if (!(await ensureFreshSession())) return;
    setBusy("create");
    setCreateError("");
    setBanner(null);
    try {
      // FIX: Use a server-backed room creation endpoint so failures are visible and ownership is persisted immediately.
      const res = await authFetch("/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.roomId) {
        const detail = data.msg || "Could not create a room.";
        setCreateError(detail);
        setBanner({ tone: "danger", title: "Create room failed", detail });
        return;
      }
      navigate(`/editor/${data.roomId}`);
    } catch {
      const detail = "Could not reach the server while creating the room.";
      setCreateError(detail);
      setBanner({ tone: "danger", title: "Create room failed", detail });
    } finally {
      setBusy(null);
    }
  };

  const joinRoom = async (event) => {
    event.preventDefault();
    const trimmed = roomId.trim().toUpperCase();
    setBanner(null);

    if (!trimmed) {
      setBanner({ tone: "danger", title: "No room ID", detail: "Enter a room code to connect." });
      return;
    }

    // FIX: Validate before navigation so invalid room codes never hit the editor/socket path.
    if (!ROOM_ID_REGEX.test(trimmed)) {
      setBanner({
        tone: "danger",
        title: "Invalid room ID",
        detail: "Room codes must be 8 characters using A-Z and 2-9, excluding I, O, 0, and 1.",
      });
      return;
    }

    if (!(await ensureFreshSession())) return;
    setBusy("join");
    navigate(`/editor/${trimmed}`);
  };

  const rejoinRoom = async (targetRoomId) => {
    if (!(await ensureFreshSession())) return;
    setBusy(targetRoomId);
    navigate(`/editor/${targetRoomId}`);
  };

  return (
    <main className="page page--dashboard">
      <section className="dashboard-shell" aria-label="SyncDev dashboard">
        <aside className="dashboard-rail">
          <div className="dashboard-rail__top">
            <p className="eyebrow">// workspace</p>
            <StatusPill label="online" tone="success" />
          </div>

          <div className="dashboard-rail__copy">
            <h1>SyncDev</h1>
            <p>Real-time collaborative coding environment</p>
          </div>

          <div className="rail-block">
            <span className="rail-block__label">{username || "operator"}</span>
            <p>Authenticated session ready for collaboration.</p>
          </div>

          <div className="rail-status">
            <div>
              <span>Transport</span>
              <strong>socket ready</strong>
            </div>
            <div>
              <span>Rooms</span>
              <strong>{roomsLoading ? "loading" : rooms.length}</strong>
            </div>
            <div>
              <span>Mode</span>
              <strong>collaborative</strong>
            </div>
          </div>
        </aside>

        <SectionCard className="dashboard-panel" eyebrow="< sessions />" stamp="{ }">
          <header className="dashboard-panel__topbar">
            <div>
              <p className="section-card__eyebrow">// active user</p>
              <h2 className="section-card__title">{username || "Engineer"}</h2>
            </div>
            <div className="dashboard-panel__controls">
              <ThemeToggle />
              <Button onClick={onLogout} variant="danger">
                Logout
              </Button>
            </div>
          </header>

          {banner ? <AlertBox {...banner} /> : null}
          {createError ? (
            <div className="dashboard-error-actions">
              <Button onClick={createRoom} variant="secondary">
                Retry create room
              </Button>
            </div>
          ) : null}

          <div className="dashboard-action-grid">
            <Button className="dashboard-create-btn" onClick={createRoom} variant="primary">
              {busy === "create" ? (
                <>
                  <TerminalSpinner />
                  Creating
                </>
              ) : (
                "Create Room"
              )}
            </Button>

            <form className="dashboard-join-form" onSubmit={joinRoom}>
              <Field
                hint="// target room"
                label="ROOM_ID"
                onChange={(event) => setRoomId(event.target.value.toUpperCase())}
                placeholder="ABCD2345"
                type="text"
                value={roomId}
              />
              <Button className="dashboard-join-form__button" type="submit" variant="secondary">
                {busy === "join" ? (
                  <>
                    <TerminalSpinner />
                    Joining
                  </>
                ) : (
                  "Join Room"
                )}
              </Button>
            </form>
          </div>

          <section className="dashboard-recent" aria-label="Recent rooms">
            <div className="dashboard-recent__header">
              <div>
                <p className="section-card__eyebrow">// membership</p>
                <h3>Recent Rooms</h3>
              </div>
              <Button onClick={fetchRooms} variant="secondary">
                Refresh
              </Button>
            </div>

            {roomsLoading ? (
              <div className="dashboard-room-skeletons" aria-label="Loading recent rooms">
                <span />
                <span />
                <span />
              </div>
            ) : rooms.length > 0 ? (
              <div className="dashboard-room-list">
                {rooms.map((room) => (
                  <article className="dashboard-room-card" key={room.roomId}>
                    <div>
                      <p className="session-card__label">ROOM ID</p>
                      <p className="session-card__value">{room.roomId}</p>
                    </div>
                    <StatusPill label={room.role || "viewer"} tone={room.role === "viewer" ? "neutral" : "success"} />
                    <Button onClick={() => rejoinRoom(room.roomId)} variant="secondary">
                      {busy === room.roomId ? "Opening" : "Rejoin"}
                    </Button>
                  </article>
                ))}
              </div>
            ) : (
              <div className="dashboard-empty">
                <p>No recent rooms yet.</p>
              </div>
            )}
          </section>
        </SectionCard>
      </section>
    </main>
  );
}
