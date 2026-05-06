import { useEffect, useMemo, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { mapRunLanguage } from "../api/run";
import { useTheme } from "../context/ThemeContext.jsx";

const LANGUAGE_OPTIONS = [{ value: "javascript", label: "Node.js" }, { value: "typescript", label: "TypeScript" }, { value: "python", label: "Python" }, { value: "shell", label: "Shell" }];
const normalizeLanguage = (v) => (v === "tsx" ? "typescript" : v || "javascript");
const isWebProject = (files = {}) =>
  Object.entries(files).some(
    ([name, content]) =>
      name?.split("/").pop() === "package.json" &&
      typeof content === "string" &&
      ["react", "vite", "next", "express"].some((dep) => content.toLowerCase().includes(dep))
  );

export default function RunTerminal({ socketRef, roomId, language, fileName, files }) {
  const { isDark } = useTheme();
  const inferredLanguage = useMemo(() => normalizeLanguage(mapRunLanguage(language, fileName)), [language, fileName]);
  const [selectedLanguage, setSelectedLanguage] = useState(inferredLanguage);
  const [running, setRunning] = useState(false);
  const [previewUrl, setPreviewUrl] = useState("");
  const [portMap, setPortMap] = useState({});
  const [previewOpen, setPreviewOpen] = useState(true);
  const [scriptMode, setScriptMode] = useState(!isWebProject(files));
  const [socketConnected, setSocketConnected] = useState(false);
  const hostRef = useRef(null); const termRef = useRef(null); const fitRef = useRef(null); const pendingInputRef = useRef([]); const filesRef = useRef(files);


  useEffect(() => { filesRef.current = files; }, [files]);

  useEffect(() => {
    const term = new Terminal({ cursorBlink: true, convertEol: true, theme: { background: "#050b12" } });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(hostRef.current);
    fit.fit();
    term.focus();
    termRef.current = term;
    fitRef.current = fit;

    const ro = new ResizeObserver(() => {
      fit.fit();
      socketRef.current?.emit("terminal-resize", { roomId, cols: term.cols, rows: term.rows });
    });
    ro.observe(hostRef.current);
    return () => { ro.disconnect(); term.dispose(); };
  }, [roomId]);

  useEffect(() => {
    if (!termRef.current) return;
    termRef.current.options = {
      theme: {
        background: isDark ? "#050b12" : "#ffffff",
        foreground: isDark ? "#d4d4d4" : "#1e1e1e",
        cursor: isDark ? "#ffffff" : "#000000",
      },
    };
  }, [isDark]);

  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    const onData = (data) => {
      const s = socketRef.current;
      if (!s || !socketConnected) { pendingInputRef.current.push(data); return; }
      if (pendingInputRef.current.length) { pendingInputRef.current.forEach((chunk) => s.emit("terminal-input", { roomId, data: chunk })); pendingInputRef.current = []; }
      s.emit("terminal-input", { roomId, data });
    };
    const disposable = term.onData(onData);
    return () => disposable.dispose();
  }, [roomId, socketRef, socketConnected]);

  useEffect(() => {
    const s = socketRef.current;
    if (!s) return;
    setSocketConnected(true);
    if (pendingInputRef.current.length) { pendingInputRef.current.forEach((data) => s.emit("terminal-input", { roomId, data })); pendingInputRef.current = []; }

    const ready = ({ roomId: r, previewUrl: p, portMap: pm }) => {
      if (r !== roomId) return;
      setPreviewUrl(p);
      setPortMap(pm || {});
      setPreviewOpen(true);
      setRunning(true);
    };
    const out = ({ roomId: r, data }) => { if (r === roomId) termRef.current?.write(data); };
    const ex = ({ roomId: r, code }) => { if (r === roomId) { termRef.current?.writeln(`\r\n\x1b[33m[exited with code ${code}]\x1b[0m`); setRunning(false); } };
    const runStarted = ({ roomId: r }) => { if (r === roomId) setRunning(true); };
    const runFinished = ({ roomId: r }) => { if (r === roomId) setRunning(false); };
    const runOut = ({ type, payload }) => {
      const term = termRef.current;
      if (!term) return;
      if (typeof payload === "string" && payload.includes("__SYNCDEV_HTML_PREVIEW__:")) {
        const filePath = payload.split("__SYNCDEV_HTML_PREVIEW__:")[1]?.trim();
        const fileContent = filesRef.current?.[filePath] || filesRef.current?.["index.html"] || "";
        // Revoke previous blob URL if it exists
        setPreviewUrl((prev) => {
          if (prev?.startsWith("blob:")) URL.revokeObjectURL(prev);
          return prev;
        });
        const blob = new Blob([fileContent], { type: "text/html" });
        const url = URL.createObjectURL(blob);
        setPreviewUrl(url);
        setPreviewOpen(true);
        setScriptMode(false);
        setRunning(false);
        return;
      }
      term.write(typeof payload === "string" ? payload : String(payload ?? ""));
      if (type === "exit") setRunning(false);
    };
    const stopped = ({ roomId: r }) => { if (r !== roomId) return; setRunning(false); setPreviewUrl(""); setPreviewOpen(false); };

    s.on("terminal-ready", ready); s.on("terminal-output", out); s.on("terminal-exit", ex); s.on("terminal-stopped", stopped); s.on("run-output", runOut); s.on("run-started", runStarted); s.on("run-finished", runFinished);
    return () => {
      setSocketConnected(false);
      s.off("terminal-ready", ready); s.off("terminal-output", out); s.off("terminal-exit", ex); s.off("terminal-stopped", stopped); s.off("run-output", runOut); s.off("run-started", runStarted); s.off("run-finished", runFinished);
    };
  }, [roomId, socketRef, socketRef.current]);


  useEffect(() => {
    return () => {
      setPreviewUrl((prev) => {
        if (prev?.startsWith("blob:")) URL.revokeObjectURL(prev);
        return "";
      });
    };
  }, []);

  const onRunClick = () => {
    const webMode = isWebProject(files);
    const htmlMode = !webMode && Object.keys(files || {}).some((f) => f.endsWith(".html"));

    if (running) {
      if (webMode) {
        socketRef.current?.emit("stop-terminal", { roomId });
      } else {
        socketRef.current?.emit("kill-run", { roomId });
        setRunning(false);
      }
      return;
    }

    termRef.current?.clear();
    setRunning(true);
    setScriptMode(!webMode && !htmlMode);

    if (webMode) {
      socketRef.current?.emit("start-terminal", { roomId, language: selectedLanguage });
    } else {
      setPreviewUrl("");
      setPreviewOpen(htmlMode);
      socketRef.current?.emit("run-code", { roomId, language: htmlMode ? "html" : selectedLanguage });
    }
  };

  return <div className="run-terminal"><div className="run-terminal__toolbar"><button className="run-terminal__btn run-terminal__btn--primary" onClick={onRunClick}>{running ? "Stop" : "Run"}</button>
    <select className="run-terminal__select" value={selectedLanguage} onChange={(e) => setSelectedLanguage(e.target.value)}>{LANGUAGE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></div>
    <div className="run-terminal__xterm-host" ref={hostRef} />
    {!scriptMode && previewUrl && previewOpen && <div className="run-terminal__preview"><div className="run-terminal__preview-bar"><span className="run-terminal__preview-url">{previewUrl}</span>{Object.keys(portMap).map((p) => (
      <button key={p} onClick={() => setPreviewUrl(portMap[p])}>:{p}</button>
    ))}<button onClick={() => setPreviewOpen(false)}>Hide preview</button><button onClick={() => window.open(previewUrl, "_blank")}>Open in tab</button></div><iframe src={previewUrl} className="run-terminal__preview-frame" title="App preview" sandbox="allow-scripts allow-same-origin allow-forms" /></div>}
  </div>;
}
