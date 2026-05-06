import { useEffect, useMemo, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { mapRunLanguage } from "../api/run";
import { useTheme } from "../context/ThemeContext.jsx";

const LANGUAGE_OPTIONS = [{ value: "javascript", label: "Node.js" },{ value: "typescript", label: "TypeScript" },{ value: "python", label: "Python" },{ value: "shell", label: "Shell" }];
const normalizeLanguage = (v) => (v === "tsx" ? "typescript" : v || "javascript");

export default function RunTerminal({ socketRef, roomId, language, fileName }) {
  const { isDark } = useTheme();
  const inferredLanguage = useMemo(() => normalizeLanguage(mapRunLanguage(language, fileName)), [language, fileName]);
  const [selectedLanguage, setSelectedLanguage] = useState(inferredLanguage);
  const [running, setRunning] = useState(false);
  const [previewUrl, setPreviewUrl] = useState("");
  const [previewOpen, setPreviewOpen] = useState(true);
  const hostRef = useRef(null); const termRef = useRef(null); const fitRef = useRef(null);

  useEffect(()=>{const term = new Terminal({cursorBlink:true, convertEol:true, theme:{background:isDark?"#050b12":"#fff"}}); const fit=new FitAddon(); term.loadAddon(fit); term.open(hostRef.current); fit.fit(); termRef.current=term; fitRef.current=fit;
    term.onData((data)=>socketRef.current?.emit("terminal-input", { roomId, data }));
    const ro=new ResizeObserver(()=>{fit.fit(); socketRef.current?.emit("terminal-resize", { roomId, cols: term.cols, rows: term.rows });}); ro.observe(hostRef.current);
    return ()=>{ro.disconnect(); term.dispose();};}, [roomId, socketRef, isDark]);

  useEffect(()=>{const s=socketRef.current; if(!s) return; const ready=({roomId:r,previewUrl})=>{if(r!==roomId)return; setPreviewUrl(previewUrl); setPreviewOpen(true); setRunning(true)};
    const out=({roomId:r,data})=>{if(r===roomId) termRef.current?.write(data)}; const ex=({roomId:r,code})=>{if(r===roomId){termRef.current?.writeln(`\r\n\x1b[33m[exited with code ${code}]\x1b[0m`); setRunning(false)}};
    s.on("terminal-ready", ready); s.on("terminal-output", out); s.on("terminal-exit", ex);
    return ()=>{s.off("terminal-ready",ready); s.off("terminal-output",out); s.off("terminal-exit",ex);};}, [roomId, socketRef]);

  return <div className="run-terminal"><div className="run-terminal__toolbar"><button className="run-terminal__btn run-terminal__btn--primary" onClick={()=>socketRef.current?.emit(running?"stop-terminal":"start-terminal", { roomId, language:selectedLanguage })}>{running?"Stop":"Run"}</button>
  <select className="run-terminal__select" value={selectedLanguage} onChange={(e)=>setSelectedLanguage(e.target.value)}>{LANGUAGE_OPTIONS.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select></div>
  <div className="run-terminal__xterm-host" ref={hostRef} />
  {previewUrl && previewOpen && <div className="run-terminal__preview"><div className="run-terminal__preview-bar"><span className="run-terminal__preview-url">{previewUrl}</span><button onClick={()=>setPreviewOpen(false)}>Hide preview</button><button onClick={()=>window.open(previewUrl, "_blank")}>Open in tab</button></div><iframe src={previewUrl} className="run-terminal__preview-frame" title="App preview" sandbox="allow-scripts allow-same-origin allow-forms" /></div>}
  </div>;
}
