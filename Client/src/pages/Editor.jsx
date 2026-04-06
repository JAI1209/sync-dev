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
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: "#0d0f14" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.75rem 1.5rem", borderBottom: "1px solid #2a2e3d", background: "#13161d" }}>

        <span style={{ color: "#4f8ef7", fontFamily: "monospace", fontWeight: "bold" }}>SyncDev</span>

        <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
          {users.map((u) => (
            <span key={u.id} style={{
              background: "#1a1e28",
              border: "1px solid #2a2e3d",
              borderRadius: "4px",
              padding: "3px 8px",
              fontSize: "11px",
              fontFamily: "monospace",
              color: u.username === username ? "#4f8ef7" : "#e8eaf0"
            }}>
              {u.username}
            </span>
          ))}
        </div>

        <select
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
          style={{
            background: "#1a1e28",
            border: "1px solid #2a2e3d",
            borderRadius: "4px",
            padding: "4px 8px",
            color: "#e8eaf0",
            fontFamily: "monospace",
            fontSize: "12px",
            cursor: "pointer"
          }}
        >
          <option value="javascript">JavaScript</option>
          <option value="typescript">TypeScript</option>
          <option value="python">Python</option>
          <option value="java">Java</option>
          <option value="cpp">C++</option>
          <option value="html">HTML</option>
          <option value="css">CSS</option>
        </select>

        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ color: "#6b7094", fontFamily: "monospace", fontSize: "13px" }}>
            Room: <strong style={{ color: "#e8eaf0" }}>{roomId}</strong>
          </span>
          <button
            onClick={copyRoomId}
            style={{
              width: "auto",
              padding: "4px 10px",
              background: copied ? "#1a3d2e" : "transparent",
              border: `1px solid ${copied ? "#3eb489" : "#2a2e3d"}`,
              color: copied ? "#3eb489" : "#6b7094",
              fontSize: "11px",
              fontFamily: "monospace"
            }}
          >
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>

        <button
          onClick={() => navigate("/dashboard")}
          style={{ width: "auto", padding: "6px 14px", background: "transparent", border: "1px solid #2a2e3d" }}
        >
          Leave
        </button>
      </div>

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
          }}
        />
      )}
    </div>
  );
}