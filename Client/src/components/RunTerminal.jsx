import { useCallback, useEffect, useRef, useState } from "react";
import { executeCode, mapRunLanguage } from "../api/run";
import { bundleWorkspaceHtml } from "../utils/inlineWorkspaceHtmlAssets";
import { useTheme } from "../context/ThemeContext.jsx";

const SHARED_ARRAY_BUFFER_ERROR =
  "SharedArrayBuffer is unavailable. The server must send Cross-Origin-Opener-Policy: same-origin " +
  "and Cross-Origin-Embedder-Policy: require-corp headers on every response. " +
  "If running locally, use 'npm run dev' (not 'node server.js' alone). " +
  "If deployed, ensure your reverse proxy (nginx/Caddy) forwards these headers.";
const NON_RUNNABLE = /\.(png|jpg|jpeg|gif|webp|svg|ico|woff2?|ttf|eot|bin|zip)$/i;

function openHtmlInNewTab(html) {
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const popup = window.open(url, "_blank", "noopener,noreferrer");
  if (popup) {
    const revoke = () => URL.revokeObjectURL(url);
    popup.addEventListener("load", () => setTimeout(revoke, 30_000), { once: true });
  } else {
    URL.revokeObjectURL(url);
  }
}

function getTerminalTheme(isDark) {
  return {
    background: isDark ? "#050b12" : "#f8fbff",
    foreground: isDark ? "#e6edf3" : "#142233",
    cursor: isDark ? "#2dd4bf" : "#0c9488",
  };
}

export default function RunTerminal({ getCode, language, fileName, activeFileId, files, folders, disabled }) {
  const { isDark } = useTheme();
  const [lines, setLines] = useState([]);
  const [running, setRunning] = useState(false);
  const [wcPhase, setWcPhase] = useState("idle");
  const [wcError, setWcError] = useState("");
  const [syncBusy, setSyncBusy] = useState(false);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [inlinePreviewOpen, setInlinePreviewOpen] = useState(false);

  const outRef = useRef(null);
  const containerRef = useRef(null);
  const termRef = useRef(null);
  const fitRef = useRef(null);
  const wcRef = useRef(null);
  const shellRef = useRef(null);
  const inputWriterRef = useRef(null);
  const dataDisposableRef = useRef(null);
  const serverReadyCleanupRef = useRef(null);
  const filesRef = useRef(files);
  const foldersRef = useRef(folders);

  filesRef.current = files;
  foldersRef.current = folders;

  const isHtml = /\.html?$/i.test(fileName || "");

  useEffect(() => {
    const el = outRef.current;
    if (el) {
      requestAnimationFrame(() => {
        el.scrollTop = el.scrollHeight;
      });
    }
  }, [lines, running]);

  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    // FIX: Keep the same terminal instance when theme changes instead of rebuilding the whole shell.
    term.options.theme = getTerminalTheme(isDark);
  }, [isDark]);

  const disposeShellInput = useCallback(() => {
    dataDisposableRef.current?.dispose?.();
    dataDisposableRef.current = null;
    try {
      inputWriterRef.current?.releaseLock?.();
    } catch {
      /* writer may already be closed */
    }
    inputWriterRef.current = null;
  }, []);

  const registerServerReadyListener = useCallback((wc) => {
    serverReadyCleanupRef.current?.();
    const unsubscribe = wc.on("server-ready", (port, url) => {
      if (wcRef.current !== wc) return;
      setPreviewUrl(url);
      setWcPhase("ready");
      termRef.current?.writeln(
        `\r\n\x1b[32m[dev server ready on port ${port}]\x1b[0m - use Open preview tab or inline preview.\r\n`
      );
    });
    serverReadyCleanupRef.current = typeof unsubscribe === "function" ? unsubscribe : null;
  }, []);

  const ensureSharedArrayBuffer = useCallback(() => {
    if (typeof SharedArrayBuffer === "undefined") {
      setWcPhase("error");
      setWcError(SHARED_ARRAY_BUFFER_ERROR);
      termRef.current?.writeln(`\r\n\x1b[31m${SHARED_ARRAY_BUFFER_ERROR}\x1b[0m\r\n`);
      return false;
    }
    return true;
  }, []);

  const mountWorkspaceFiles = useCallback(async (wc, options = {}) => {
    const { announce = true } = options;
    setWcPhase("mounting");
    setWcError("");
    try {
      const { buildWebContainerTree } = await import("../utils/webContainerTree");
      const tree = buildWebContainerTree(filesRef.current, foldersRef.current);
      await wc.mount(tree);
      if (announce) {
        termRef.current?.writeln("\r\n\x1b[33m[workspace files synced into WebContainer]\x1b[0m\r\n");
      }
      return true;
    } catch (error) {
      setWcPhase("error");
      setWcError(`File mount failed: ${error.message || error}`);
      termRef.current?.writeln(`\r\n\x1b[31mFile mount failed: ${error.message || error}\x1b[0m\r\n`);
      return false;
    }
  }, []);

  const spawnShell = useCallback(async ({ isCancelled = () => false } = {}) => {
    const wc = wcRef.current;
    const term = termRef.current;
    if (!wc || !term) {
      setWcPhase("error");
      setWcError("WebContainer is not ready yet.");
      return;
    }

    try {
      setWcPhase("booting");
      setWcError("");
      disposeShellInput();
      shellRef.current?.kill();
      shellRef.current = null;

      const shellProc = await wc.spawn("jsh", {
        terminal: { cols: term.cols || 80, rows: term.rows || 24 },
      });
      if (isCancelled()) {
        shellProc.kill();
        return;
      }

      shellRef.current = shellProc;
      shellProc.output
        .pipeTo(
          new WritableStream({
            write(data) {
              term.write(data);
            },
          })
        )
        .catch(() => {});

      const input = shellProc.input.getWriter();
      inputWriterRef.current = input;
      dataDisposableRef.current = term.onData((data) => {
        input.write(data).catch(() => {});
      });

      // FIX: Detect shell crashes so the terminal does not fail silently.
      shellProc.exit.then((code) => {
        if (!isCancelled() && shellRef.current === shellProc) {
          setWcPhase("crashed");
          setWcError(`Shell exited with code ${code}. Click \"Restart shell\" to recover.`);
          shellRef.current = null;
          disposeShellInput();
          term.writeln(`\r\n\x1b[31m[shell exited: ${code}]\x1b[0m\r\n`);
        }
      });

      term.writeln("\x1b[36mWebContainer shell (jsh)\x1b[0m - try \x1b[33mnpm install\x1b[0m then \x1b[33mnpm run dev\x1b[0m.\r\n");
      setWcPhase("ready");
    } catch (error) {
      if (!isCancelled()) {
        setWcPhase("error");
        setWcError(error.message || "WebContainer shell failed to start");
        term.writeln(`\r\n\x1b[31m${error.message || error}\x1b[0m\r\n`);
      }
    }
  }, [disposeShellInput]);

  const mountAndSpawn = useCallback(async (wc, options = {}) => {
    const mounted = await mountWorkspaceFiles(wc, { announce: false });
    if (!mounted) return;
    await spawnShell(options);
  }, [mountWorkspaceFiles, spawnShell]);

  const handleQuickRun = useCallback(async () => {
    if (NON_RUNNABLE.test(fileName || "")) {
      // FIX: Binary and asset files should report a clear explanation instead of generic run failures.
      setLines([{ type: "info", text: `${fileName} is not a runnable file.` }]);
      return;
    }

    const code = getCode();
    if (!code || !code.trim()) {
      if (isHtml) {
        setLines([{ type: "error", text: "HTML file is empty or not loaded yet. Try again in a moment." }]);
      } else {
        setLines([{ type: "error", text: "Nothing to run." }]);
      }
      return;
    }

    if (isHtml) {
      const activeFile = filesRef.current[activeFileId];
      const { html: bundled, inlined, missing } = bundleWorkspaceHtml(
        code,
        activeFile || null,
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
    } catch (error) {
      setLines([{ type: "error", text: error.message || "Run failed" }]);
    } finally {
      setRunning(false);
    }
  }, [activeFileId, fileName, getCode, isHtml, language]);

  const handleSyncFiles = useCallback(async () => {
    setSyncBusy(true);
    setWcError("");
    try {
      if (!ensureSharedArrayBuffer()) return;
      const { getWebContainer } = await import("../lib/webContainerSingleton");
      const wc = wcRef.current || (await getWebContainer());
      wcRef.current = wc;
      registerServerReadyListener(wc);
      await mountWorkspaceFiles(wc);
      if (wcPhase !== "crashed" && wcPhase !== "error") {
        setWcPhase("ready");
      }
    } catch (error) {
      setWcPhase("error");
      setWcError(error.message || "Sync failed");
    } finally {
      setSyncBusy(false);
    }
  }, [ensureSharedArrayBuffer, mountWorkspaceFiles, registerServerReadyListener, wcPhase]);

  const openDevPreviewTab = useCallback(() => {
    if (previewUrl) {
      window.open(previewUrl, "_blank", "noopener,noreferrer");
    }
  }, [previewUrl]);

  const handleRestartShell = useCallback(() => {
    spawnShell();
  }, [spawnShell]);

  useEffect(() => {
    if (disabled) return undefined;

    const host = containerRef.current;
    if (!host) return undefined;

    let cancelled = false;
    let resizeObserver = null;

    (async () => {
      try {
        await import("@xterm/xterm/css/xterm.css");
        const { Terminal } = await import("@xterm/xterm");
        const { FitAddon } = await import("@xterm/addon-fit");
        const { getWebContainer } = await import("../lib/webContainerSingleton");

        if (cancelled || !containerRef.current) return;

        const term = new Terminal({
          convertEol: true,
          fontFamily: "JetBrains Mono, Consolas, monospace",
          fontSize: 13,
          theme: getTerminalTheme(isDark),
        });
        const fitAddon = new FitAddon();
        term.loadAddon(fitAddon);
        term.open(host);
        fitAddon.fit();
        termRef.current = term;
        fitRef.current = fitAddon;

        resizeObserver = new ResizeObserver(() => {
          fitAddon.fit();
          const shell = shellRef.current;
          if (shell) {
            shell.resize({ cols: term.cols, rows: term.rows });
          }
        });
        resizeObserver.observe(host);

        if (!ensureSharedArrayBuffer()) return;

        setWcPhase("booting");
        setWcError("");
        const wc = await getWebContainer();
        wcRef.current = wc;
        if (cancelled) return;

        // FIX: Register server-ready before shell spawn so fast dev servers cannot race the listener.
        registerServerReadyListener(wc);
        await mountAndSpawn(wc, { isCancelled: () => cancelled });
      } catch (error) {
        if (!cancelled) {
          setWcPhase("error");
          setWcError(error.message || "WebContainer failed to start");
          termRef.current?.writeln(`\r\n\x1b[31m${error.message || error}\x1b[0m\r\n`);
        }
      }
    })();

    return () => {
      cancelled = true;
      disposeShellInput();
      serverReadyCleanupRef.current?.();
      serverReadyCleanupRef.current = null;
      resizeObserver?.disconnect();
      shellRef.current?.kill();
      shellRef.current = null;
      termRef.current?.dispose();
      termRef.current = null;
      fitRef.current = null;
      wcRef.current = null;
      setWcPhase("idle");
      setPreviewUrl(null);
      setInlinePreviewOpen(false);
    };
  }, [disabled, disposeShellInput, ensureSharedArrayBuffer, mountAndSpawn, registerServerReadyListener]);

  return (
    <div className="run-terminal">
      <div className="run-terminal__toolbar">
        <button
          type="button"
          className="run-terminal__btn run-terminal__btn--primary"
          onClick={handleQuickRun}
          disabled={disabled || running}
        >
          {running ? "Running..." : isHtml ? "Run HTML (new tab)" : "Quick run"}
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
          onClick={handleSyncFiles}
          disabled={disabled || running || syncBusy || wcPhase !== "ready"}
          title="Push current editor files into the WebContainer"
        >
          {syncBusy ? "Syncing..." : "Sync files -> shell"}
        </button>
        {wcPhase === "crashed" && (
          <button
            type="button"
            className="run-terminal__btn run-terminal__btn--primary"
            onClick={handleRestartShell}
            disabled={disabled}
          >
            Restart shell
          </button>
        )}
        {previewUrl && (
          <>
            <button
              type="button"
              className="run-terminal__btn run-terminal__btn--accent"
              onClick={openDevPreviewTab}
            >
              Open preview tab
            </button>
            <button
              type="button"
              className="run-terminal__btn"
              onClick={() => setInlinePreviewOpen((open) => !open)}
            >
              Toggle inline preview
            </button>
          </>
        )}
        <span className="run-terminal__hint">
          {isHtml
            ? "HTML run inlines linked CSS/JS from the file tree (like Live Preview)."
            : "Quick run uses the server sandbox (console only)."}
          {" "}
          {wcPhase === "booting" && "Starting in-browser Node..."}
          {wcPhase === "mounting" && "Mounting current files into WebContainer..."}
          {wcPhase === "ready" && "Terminal: full npm / Node in WebContainer."}
          {wcPhase === "crashed" && `WebContainer: ${wcError}`}
          {wcPhase === "error" && `WebContainer: ${wcError}`}
        </span>
      </div>

      <div className="run-terminal__output-wrap" ref={outRef}>
        {lines.length === 0 && !running && (
          <div className="run-terminal__placeholder">Quick run output (sandbox) appears here.</div>
        )}
        {lines.map((row, index) => (
          <div key={index} className={`run-terminal__line run-terminal__line--${row.type}`}>
            {row.text}
          </div>
        ))}
      </div>

      <div className="run-terminal__xterm-host" ref={containerRef} />

      {previewUrl && inlinePreviewOpen && (
        <div className="run-terminal__preview-wrap">
          <iframe
            src={previewUrl}
            className="run-terminal__preview-frame"
            title="Dev server preview"
            allow="cross-origin-isolated"
          />
        </div>
      )}
    </div>
  );
}
