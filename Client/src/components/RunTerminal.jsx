import { useCallback, useEffect, useRef, useState } from "react";
import { executeCode, mapRunLanguage } from "../api/run";
import { bundleWorkspaceHtml } from "../utils/inlineWorkspaceHtmlAssets";

function openHtmlInNewTab(html) {
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const w = window.open(url, "_blank", "noopener,noreferrer");
  if (w) {
    const revoke = () => URL.revokeObjectURL(url);
    w.addEventListener("load", () => setTimeout(revoke, 30_000), { once: true });
  } else {
    URL.revokeObjectURL(url);
  }
}

export default function RunTerminal({ getCode, language, fileName, activeFileId, files, folders, disabled }) {
  const [lines, setLines] = useState([]);
  const [running, setRunning] = useState(false);
  const [wcPhase, setWcPhase] = useState("idle");
  const [wcError, setWcError] = useState("");
  const [syncBusy, setSyncBusy] = useState(false);
  const [previewUrl, setPreviewUrl] = useState(null);

  const outRef = useRef(null);
  const containerRef = useRef(null);
  const termRef = useRef(null);
  const fitRef = useRef(null);
  const shellRef = useRef(null);
  const inputWriterRef = useRef(null);
  const filesRef = useRef(files);
  const foldersRef = useRef(folders);
  filesRef.current = files;
  foldersRef.current = folders;

  const isHtml = /\.html?$/i.test(fileName || "");

  useEffect(() => {
    const el = outRef.current;
    if (el) requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
  }, [lines, running]);

  const handleQuickRun = useCallback(async () => {
    const code = getCode();
    if (!code.trim()) {
      setLines([{ type: "error", text: "Nothing to run." }]);
      return;
    }

    if (isHtml) {
      const f = filesRef.current[activeFileId];
      const { html: bundled, inlined, missing } = bundleWorkspaceHtml(
        code,
        f || null,
        filesRef.current,
        foldersRef.current,
      );
      openHtmlInNewTab(bundled);
      const msg =
        inlined.length > 0
          ? `Ran HTML in a new tab (inlined ${inlined.length} file(s) from this workspace).`
          : "Ran HTML in a new tab.";
      const warn =
        missing.length > 0
          ? ` Could not find in workspace: ${missing.join(", ")} (use CDN URLs or Sync + dev server).`
          : "";
      setLines([{ type: missing.length ? "warn" : "log", text: msg + warn }]);
      return;
    }

    const lang = mapRunLanguage(language, fileName);
    setRunning(true);
    setLines([]);
    try {
      const { ok, logs, error } = await executeCode(code, lang);
      const next = [];
      for (const row of logs || []) {
        next.push({ type: row.type || "log", text: row.text });
      }
      if (error) next.push({ type: "error", text: error });
      if (!ok && !error) next.push({ type: "error", text: "Execution failed." });
      setLines(next);
    } catch (e) {
      setLines([{ type: "error", text: e.message || "Run failed" }]);
    } finally {
      setRunning(false);
    }
  }, [getCode, language, fileName, isHtml, activeFileId]);

  const handleSyncWorkspace = useCallback(async () => {
    setSyncBusy(true);
    setWcError("");
    try {
      const [{ getWebContainer }, { collectRepoFiles }, { pathsToWebContainerTree }] = await Promise.all([
        import("../lib/webContainerSingleton"),
        import("../utils/repoPaths"),
        import("../utils/webContainerTree"),
      ]);
      const wc = await getWebContainer();
      const entries = collectRepoFiles(filesRef.current, foldersRef.current);
      const tree = pathsToWebContainerTree(entries);
      await wc.mount(tree);
      const t = termRef.current;
      if (t) t.writeln("\r\n\x1b[33m[workspace files synced into WebContainer]\x1b[0m\r\n");
    } catch (e) {
      setWcError(e.message || "Sync failed");
    } finally {
      setSyncBusy(false);
    }
  }, []);

  const openDevPreviewTab = useCallback(() => {
    if (previewUrl) {
      window.open(previewUrl, "_blank", "noopener,noreferrer");
    } else {
      // Fallback: try localhost if WebContainer preview isn't ready
      window.open("http://localhost:5173", "_blank", "noopener,noreferrer");
    }
  }, [previewUrl]);

  useEffect(() => {
    if (disabled) return undefined;

    const el = containerRef.current;
    if (!el) return undefined;

    let cancelled = false;
    let unsubscribeServer = null;
    let ro = null;

    (async () => {
      try {
        await import("@xterm/xterm/css/xterm.css");
        const { Terminal } = await import("@xterm/xterm");
        const { FitAddon } = await import("@xterm/addon-fit");
        const { getWebContainer } = await import("../lib/webContainerSingleton");
        const { collectRepoFiles } = await import("../utils/repoPaths");
        const { pathsToWebContainerTree } = await import("../utils/webContainerTree");

        if (cancelled || !containerRef.current) return;

        const term = new Terminal({
          convertEol: true,
          fontFamily: "JetBrains Mono, Consolas, monospace",
          fontSize: 13,
          theme: {
            background: "#070a0f",
            foreground: "#e6edf3",
            cursor: "#3b82f6",
          },
        });
        const fitAddon = new FitAddon();
        term.loadAddon(fitAddon);
        term.open(el);
        fitAddon.fit();
        termRef.current = term;
        fitRef.current = fitAddon;

        ro = new ResizeObserver(() => {
          fitAddon.fit();
          const sp = shellRef.current;
          if (sp) sp.resize({ cols: term.cols, rows: term.rows });
        });
        ro.observe(el);

        if (cancelled) {
          ro.disconnect();
          ro = null;
          term.dispose();
          termRef.current = null;
          fitRef.current = null;
          return;
        }

        const cols = term.cols;
        const rows = term.rows;

        setWcPhase("booting");
        setWcError("");

        // WebContainer with hard timeout - fails fast if hanging
        const BOOT_TIMEOUT_MS = 10000;
        let bootTimeoutId;
        
        const bootPromise = Promise.race([
          getWebContainer(),
          new Promise((_, reject) => {
            bootTimeoutId = setTimeout(() => {
              reject(new Error(`WebContainer boot timeout after ${BOOT_TIMEOUT_MS}ms`));
            }, BOOT_TIMEOUT_MS);
          }),
        ]);

        let wc;
        try {
          wc = await bootPromise;
          clearTimeout(bootTimeoutId);
        } catch (bootErr) {
          clearTimeout(bootTimeoutId);
          if (!cancelled) {
            setWcPhase("error");
            setWcError("WebContainer failed — use external browser");
            term.writeln(`\r\n\x1b[33m[WebContainer Error]\x1b[0m ${bootErr.message}`);
            term.writeln("\x1b[36m→ Auto-opening localhost:5173...\x1b[0m\r\n");
            window.open("http://localhost:5173", "_blank", "noopener,noreferrer");
            // Don't throw - we handled it gracefully
            return;
          }
          return;
        }
        if (cancelled) return;

        unsubscribeServer = wc.on("server-ready", (port, url) => {
          setPreviewUrl(url);
          term.writeln(`\r\n\x1b[32m[dev server ready on port ${port}]\x1b[0m — use “Open preview tab” to view.\r\n`);
        });

        const entries = collectRepoFiles(filesRef.current, foldersRef.current);
        await wc.mount(pathsToWebContainerTree(entries));
        if (cancelled) return;

        const shellProc = await wc.spawn("jsh", {
          terminal: { cols, rows },
        });
        if (cancelled) {
          shellProc.kill();
          return;
        }

        shellRef.current = shellProc;

        shellProc.output.pipeTo(
          new WritableStream({
            write(data) {
              term.write(data);
            },
          }),
        );

        const input = shellProc.input.getWriter();
        inputWriterRef.current = input;
        term.onData((data) => {
          input.write(data).catch(() => {});
        });

        term.writeln("\x1b[36mWebContainer shell (jsh)\x1b[0m — try \x1b[33mnpm install\x1b[0m then \x1b[33mnpm run dev\x1b[0m.\r\n");
        setWcPhase("ready");
      } catch (e) {
        if (!cancelled) {
          setWcPhase("error");
          setWcError(e.message || "WebContainer failed to start");
          const t = termRef.current;
          if (t) t.writeln(`\r\n\x1b[31m${e.message || e}\x1b[0m\r\n`);
        }
      }
    })();

    return () => {
      cancelled = true;
      inputWriterRef.current = null;
      if (unsubscribeServer) unsubscribeServer();
      ro?.disconnect();
      shellRef.current?.kill();
      shellRef.current = null;
      termRef.current?.dispose();
      termRef.current = null;
      fitRef.current = null;
      setWcPhase("idle");
      setPreviewUrl(null);
    };
  }, [disabled]);

  return (
    <div className="run-terminal">
      <div className="run-terminal__toolbar">
        <button
          type="button"
          className="run-terminal__btn run-terminal__btn--primary"
          onClick={handleQuickRun}
          disabled={disabled || running}
        >
          {running ? "Running…" : isHtml ? "▶ Run HTML (new tab)" : "▶ Quick run"}
        </button>
        <button
          type="button"
          className="run-terminal__btn"
          onClick={() => setLines([])}
          disabled={running}
        >
          Clear log
        </button>
        <button
          type="button"
          className="run-terminal__btn"
          onClick={handleSyncWorkspace}
          disabled={disabled || running || syncBusy || wcPhase === "booting"}
        >
          {syncBusy ? "Syncing…" : "⬆ Sync workspace"}
        </button>
        <button
          type="button"
          className="run-terminal__btn run-terminal__btn--accent"
          onClick={openDevPreviewTab}
        >
          {previewUrl ? "Open preview tab" : "Open localhost:5173"}
        </button>
        <span className="run-terminal__hint">
          {isHtml
            ? "HTML run inlines linked CSS/JS from the file tree (like Live Preview)."
            : "Quick run uses the server sandbox (console only)."}
          {" "}
          {wcPhase === "booting" && "Starting in-browser Node… (fails after 15s)"}
          {wcPhase === "ready" && "Terminal: full npm / Node in WebContainer."}
          {wcPhase === "error" && `⚠️ ${wcError} — Click "Open localhost:5173"`}
        </span>
      </div>

      <div className="run-terminal__output-wrap" ref={outRef}>
        {lines.length === 0 && !running && (
          <div className="run-terminal__placeholder">Quick run output (sandbox) appears here.</div>
        )}
        {lines.map((row, i) => (
          <div key={i} className={`run-terminal__line run-terminal__line--${row.type}`}>
            {row.text}
          </div>
        ))}
      </div>

      <div className="run-terminal__xterm-host" ref={containerRef} />
    </div>
  );
}
