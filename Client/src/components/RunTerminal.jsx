import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { mapRunLanguage } from "../api/run";
import { useTheme } from "../context/ThemeContext.jsx";

const NON_RUNNABLE = /\.(png|jpg|jpeg|gif|webp|svg|ico|woff2?|ttf|eot|bin|zip)$/i;
const LANGUAGE_OPTIONS = [
  { value: "javascript", label: "Node.js" },
  { value: "typescript", label: "TypeScript" },
  { value: "python", label: "Python" },
  { value: "shell", label: "Shell" },
];

function getTerminalTheme(isDark) {
  return {
    background: isDark ? "#050b12" : "#f8fbff",
    foreground: isDark ? "#e6edf3" : "#142233",
    cursor: isDark ? "#2dd4bf" : "#0c9488",
  };
}

function normalizeLanguage(value) {
  if (value === "tsx") return "typescript";
  return LANGUAGE_OPTIONS.some((option) => option.value === value) ? value : "javascript";
}

export default function RunTerminal({
  socketRef,
  roomId,
  language,
  fileName,
  userRole,
  disabled,
}) {
  const { isDark } = useTheme();
  const inferredLanguage = useMemo(
    () => normalizeLanguage(mapRunLanguage(language, fileName)),
    [language, fileName]
  );
  const [selectedLanguage, setSelectedLanguage] = useState(inferredLanguage);
  const [command, setCommand] = useState("");
  const [running, setRunning] = useState(false);

  const containerRef = useRef(null);
  const termRef = useRef(null);
  const fitRef = useRef(null);

  useEffect(() => {
    setSelectedLanguage(inferredLanguage);
  }, [inferredLanguage]);

  useEffect(() => {
    if (!containerRef.current) return undefined;

    const term = new Terminal({
      convertEol: true,
      cursorBlink: true,
      fontFamily: "JetBrains Mono, Fira Code, Consolas, monospace",
      fontSize: 13,
      theme: getTerminalTheme(isDark),
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);
    fit.fit();
    termRef.current = term;
    fitRef.current = fit;
    term.writeln("\x1b[90m[SyncDev] Docker terminal ready.\x1b[0m");

    let resizeObserver = null;
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(() => fit.fit());
      resizeObserver.observe(containerRef.current);
    }

    return () => {
      resizeObserver?.disconnect();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (termRef.current) {
      termRef.current.options.theme = getTerminalTheme(isDark);
    }
  }, [isDark]);

  useEffect(() => {
    const socket = socketRef?.current;
    if (!socket) return undefined;

    const onStarted = (payload = {}) => {
      if (payload.roomId && payload.roomId !== roomId) return;
      setRunning(true);
      termRef.current?.clear();
      termRef.current?.writeln("\x1b[90m[SyncDev] Running in Docker...\x1b[0m\r\n");
    };

    const onOutput = ({ type, payload }) => {
      if (!termRef.current) return;
      if (type === "stdout") {
        termRef.current.write(payload);
      } else if (type === "stderr") {
        termRef.current.write(`\x1b[31m${payload}\x1b[0m`);
      } else if (type === "exit") {
        const code = String(payload ?? "0");
        const color = code === "0" ? "\x1b[32m" : "\x1b[31m";
        termRef.current.writeln(`\r\n${color}[exit ${code}]\x1b[0m`);
      }
    };

    const onFinished = (payload = {}) => {
      if (payload.roomId && payload.roomId !== roomId) return;
      setRunning(false);
    };

    socket.on("run-started", onStarted);
    socket.on("run-output", onOutput);
    socket.on("run-finished", onFinished);

    return () => {
      socket.off("run-started", onStarted);
      socket.off("run-output", onOutput);
      socket.off("run-finished", onFinished);
    };
  }, [roomId, socketRef]);

  const canRun =
    !disabled &&
    !running &&
    userRole !== "viewer" &&
    !NON_RUNNABLE.test(fileName || "");

  const handleRun = useCallback(() => {
    const socket = socketRef?.current;
    if (!socket || !canRun) return;
    socket.emit("run-code", {
      roomId,
      language: selectedLanguage,
      command: command.trim() || null,
    });
  }, [canRun, command, roomId, selectedLanguage, socketRef]);

  const handleKill = useCallback(() => {
    const socket = socketRef?.current;
    if (!socket || !running) return;
    socket.emit("kill-run", { roomId });
  }, [roomId, running, socketRef]);

  const clearTerminal = useCallback(() => {
    termRef.current?.clear();
  }, []);

  return (
    <div className="run-terminal">
      <div className="run-terminal__toolbar">
        <button
          type="button"
          className="run-terminal__btn run-terminal__btn--primary"
          onClick={running ? handleKill : handleRun}
          disabled={running ? disabled || userRole === "viewer" : !canRun}
        >
          {running ? "Kill" : "Run"}
        </button>
        <button
          type="button"
          className="run-terminal__btn"
          onClick={clearTerminal}
          disabled={running}
        >
          Clear
        </button>
        <select
          className="run-terminal__select"
          value={selectedLanguage}
          onChange={(event) => setSelectedLanguage(event.target.value)}
          disabled={running}
          aria-label="Run language"
        >
          {LANGUAGE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <input
          className="run-terminal__command"
          value={command}
          onChange={(event) => setCommand(event.target.value)}
          disabled={running}
          placeholder="Auto command"
          aria-label="Run command"
        />
        <span className="run-terminal__hint">
          {running
            ? "Running in Docker..."
            : userRole === "viewer"
              ? "Viewer role cannot run code."
              : "Output is shared with collaborators in this room."}
        </span>
      </div>
      <div className="run-terminal__xterm-host" ref={containerRef} />
    </div>
  );
}
