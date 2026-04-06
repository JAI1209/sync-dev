import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import MonacoEditor from "@monaco-editor/react";
import { io } from "socket.io-client";

export default function Editor({ username }) {
  const { roomId } = useParams();
  const navigate = useNavigate();
  const [code, setCode] = useState("");
  const socketRef = useRef();
  const [users, setUsers] = useState([]);
  const [joined, setJoined] = useState(false);
  const [language, setLanguage] = useState("javascript");
  const [copied, setCopied] = useState(false);
  const [showAllParticipants, setShowAllParticipants] = useState(false)
  const [micEnabled, setMicEnabled] = useState(true)
  const [cameraEnabled, setCameraEnabled] = useState(false)
  const [mutedUsers, setMutedUsers] = useState(new Set())
  const [hoveredUser, setHoveredUser] = useState(null)

  const pinnedUsers = users.slice(0, 2)
  const remainingUsers = users.slice(2)
  const activeSpeakerId = users[0]?.id

  const toggleMuteUser = (userId) => {
    setMutedUsers((prev) => {
      const next = new Set(prev)
      if (next.has(userId)) {
        next.delete(userId)
      } else {
        next.add(userId)
      }
      return next
    })
  }

  useEffect(() => {
    socketRef.current = io("http://localhost:3000");
    socketRef.current.emit("join-room", { roomId, username });

    socketRef.current.on("load-code", (existingCode) => {
      setCode(existingCode);
      setJoined(true);
    });

    socketRef.current.on("code-update", (newCode) => {
      setCode(newCode);
    });

    socketRef.current.on("users-update", (updatedUsers) => {
      setUsers(updatedUsers);
    });

    return () => {
      socketRef.current.disconnect();
    };
  }, [roomId, username]);

  const handleCodeChange = (value) => {
    setCode(value);
    socketRef.current.emit("code-change", { roomId, code: value });
  };

  const copyRoomId = () => {
    navigator.clipboard.writeText(roomId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="editor-shell">
      {/* Header */}
      <header className="editor-header">
        <div className="editor-header__left">
          <span className="editor-title">SyncDev</span>
          <span className="editor-room">Room: <strong>{roomId}</strong></span>
        </div>

        <div className="editor-header__center">
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            className="language-select"
          >
            <option value="javascript">JavaScript</option>
            <option value="typescript">TypeScript</option>
            <option value="python">Python</option>
            <option value="java">Java</option>
            <option value="cpp">C++</option>
            <option value="html">HTML</option>
            <option value="css">CSS</option>
          </select>

          <button className="button button--secondary" title="Show file structure">
            {'< File Structure />'}
          </button>
        </div>

        <div className="editor-header__right">
          <button
            onClick={copyRoomId}
            className={`button ${copied ? 'button--success' : 'button--secondary'}`}
            style={{ minWidth: '100px' }}
          >
            {copied ? '✓ Copied' : 'Copy Link'}
          </button>
          <button
            onClick={() => navigate("/dashboard")}
            className="button button--secondary"
          >
            Leave
          </button>
        </div>
      </header>

      {/* Main Editor Area */}
      <div className="editor-workspace">
        <div className="editor-viewport">
          {joined && (
            <MonacoEditor
              height="100%"
              language={language}
              theme="vs-dark"
              value={code}
              onChange={handleCodeChange}
              options={{
                fontSize: 14,
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                wordWrap: "on",
                fontFamily: "JetBrains Mono, monospace",
              }}
            />
          )}
        </div>

        {/* Participants Panel */}
        <aside className="participants-panel">
          <div className="participants-header">
            <div>
              <span className="participants-label">PARTICIPANTS</span>
              <p className="participants-subtitle">Live room members</p>
            </div>
            <span className="participants-count">{users.length}</span>
          </div>

          <div className="participants-pinned">
            {pinnedUsers.map((u) => (
              <div
                key={u.id}
                className={`participant-card ${mutedUsers.has(u.id) ? 'muted' : ''} ${u.id === activeSpeakerId ? 'active-speaker' : ''}`}
                onMouseEnter={() => setHoveredUser(u.id)}
                onMouseLeave={() => setHoveredUser(null)}
              >
                <div className={`participant-avatar ${u.username === username ? 'you' : ''}`} title={u.username}>
                  {u.username[0]?.toUpperCase()}
                </div>
                <div className="participant-info">
                  <p className="participant-name">{u.username}</p>
                  <p className="participant-state">
                    {u.username === username ? 'you' : 'team member'}
                  </p>
                </div>
                <span className={`participant-status ${u.username === username ? 'active' : 'active'}`} />

                {hoveredUser === u.id && u.username !== username && (
                  <div className="participant-actions">
                    <button
                      className="participant-action mute-btn"
                      onClick={() => toggleMuteUser(u.id)}
                      title={mutedUsers.has(u.id) ? 'Unmute' : 'Mute'}
                    >
                      {mutedUsers.has(u.id) ? '🔇' : '🔊'}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="participants-scroll">
            {remainingUsers.length > 0 && showAllParticipants && (
              remainingUsers.map((u) => (
                <div
                  key={u.id}
                  className={`participant-card ${mutedUsers.has(u.id) ? 'muted' : ''} ${u.id === activeSpeakerId ? 'active-speaker' : ''}`}
                  onMouseEnter={() => setHoveredUser(u.id)}
                  onMouseLeave={() => setHoveredUser(null)}
                >
                  <div className={`participant-avatar ${u.username === username ? 'you' : ''}`} title={u.username}>
                    {u.username[0]?.toUpperCase()}
                  </div>
                  <div className="participant-info">
                    <p className="participant-name">{u.username}</p>
                    <p className="participant-state">
                      {u.username === username ? 'you' : 'team member'}
                    </p>
                  </div>
                  <span className={`participant-status ${u.username === username ? 'active' : 'active'}`} />

                  {hoveredUser === u.id && u.username !== username && (
                    <div className="participant-actions">
                      <button
                        className="participant-action mute-btn"
                        onClick={() => toggleMuteUser(u.id)}
                        title={mutedUsers.has(u.id) ? 'Unmute' : 'Mute'}
                      >
                        {mutedUsers.has(u.id) ? '🔇' : '🔊'}
                      </button>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>

          {remainingUsers.length > 0 && (
            <button
              className="participants-toggle"
              onClick={() => setShowAllParticipants((prev) => !prev)}
            >
              {showAllParticipants ? 'Hide participants' : `Show ${remainingUsers.length} more`}
            </button>
          )}
        </aside>
      </div>

      {/* Bottom Toolbar */}
      <footer className="editor-toolbar">
        <div className="toolbar-section">
          <button
            className={`toolbar-button ${micEnabled ? 'active' : 'inactive'}`}
            onClick={() => setMicEnabled(!micEnabled)}
            title="Toggle microphone"
          >
            🎤 Mic
          </button>
          <button
            className={`toolbar-button ${cameraEnabled ? 'active' : 'inactive'}`}
            onClick={() => setCameraEnabled(!cameraEnabled)}
            title="Toggle camera"
          >
            📹 Camera
          </button>
          <button className="toolbar-button" title="Add emoji">
            😊 Emoji
          </button>
          <button className="toolbar-button" title="Caption">
            ✕ Caption
          </button>
          <button className="toolbar-button" title="Raise hand">
            ✋ Hand
          </button>
        </div>

        <div className="toolbar-section toolbar-section--center">
          <span className="toolbar-info">{users.length} peer{users.length !== 1 ? 's' : ''} connected</span>
        </div>

        <div className="toolbar-section toolbar-section--right">
          <button className="toolbar-button" title="Settings">
            ⚙ Settings
          </button>
          <button className="toolbar-button danger" title="End session">
            ⊗ End Call
          </button>
        </div>
      </footer>
    </div>
  );
}
