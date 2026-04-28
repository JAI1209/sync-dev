import { useState, useEffect, useCallback, useRef } from "react";
import { commitGitHubRepo, importGitHubRepo } from "../api/github";
import JSZip from "jszip";

export function parseGithubRepoInput(repoInput) {
  const raw = String(repoInput || "").trim();
  if (!raw) return null;

  const ownerRepoMatch = raw.match(/^([\w.-]+)\/([\w.-]+?)(?:\.git)?$/i);
  if (ownerRepoMatch) {
    return {
      owner: ownerRepoMatch[1],
      repo: ownerRepoMatch[2],
      refFromUrl: "",
    };
  }

  try {
    const normalizedUrl = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    const url = new URL(normalizedUrl);
    if (!/^(www\.)?github\.com$/i.test(url.hostname)) {
      return null;
    }

    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length < 2) {
      return null;
    }

    const owner = parts[0];
    const repo = parts[1].replace(/\.git$/i, "");
    const refFromUrl = parts[2] === "tree" && parts[3] ? decodeURIComponent(parts[3]) : "";

    return { owner, repo, refFromUrl };
  } catch {
    return null;
  }
}

export function useGitHub({ files, folders, roomId, socketRef, joined, loadFiles, activeFileId }) {
  const [githubMeta, setGithubMeta] = useState(null);
  const [commitBranch, setCommitBranch] = useState("");
  const [commitMessage, setCommitMessage] = useState("");
  const [githubBusy, setGithubBusy] = useState(null);
  const [githubHint, setGithubHint] = useState("");
  const [importProgress, setImportProgress] = useState(null);
  const importRetryCount = useRef(0);
  const mountingRef = useRef(false);
  const loadFilesRef = useRef(loadFiles);
  const [retryTick, setRetryTick] = useState(0);

  useEffect(() => {
    // FIX: Keep import confirmation using the latest loader without retriggering pending-import emits.
    loadFilesRef.current = loadFiles;
  }, [loadFiles]);

  useEffect(() => {
    mountingRef.current = false;
    try {
      const raw = sessionStorage.getItem(`syncdev_github_${roomId}`);
      if (raw) {
        const saved = JSON.parse(raw);
        setGithubMeta(saved);
        setCommitBranch(saved.commitBranch || saved.defaultBranch || "main");
      }
    } catch {
      /* ignore */
    }
  }, [roomId]);

  useEffect(() => {
    let cleanupListeners = null;
    let confirmationTimer = null;
    let retryTimer = null;

    const scheduleRetry = (reason) => {
      const retryIndex = importRetryCount.current;
      if (retryIndex >= 10) {
        // FIX: Clear stuck pending imports when the socket never reaches a joined state.
        setGithubHint(
          "Import failed after 10 retries - socket did not connect. Check your token and reload."
        );
        setImportProgress(null);
        sessionStorage.removeItem("syncdev_pending_import");
        importRetryCount.current = 0;
        mountingRef.current = false;
        return;
      }

      const delay = getImportRetryDelay(retryIndex);
      const attemptNumber = retryIndex + 1;
      importRetryCount.current += 1;
      setImportProgress(`Syncing files to room (attempt ${attemptNumber}/10)...`);
      if (reason) {
        setGithubHint(reason);
      }
      retryTimer = setTimeout(() => {
        setRetryTick((tick) => tick + 1);
      }, delay);
    };

    try {
      const raw = sessionStorage.getItem("syncdev_pending_import");
      if (raw) {
        const pending = JSON.parse(raw);
        if (pending.roomId === roomId) {
          const { files: newFiles, folders: newFolders, orderedFileIds, github: gh } = pending;
          if (newFiles && typeof newFiles === "object" && Object.keys(newFiles).length) {
            if (gh) {
              sessionStorage.setItem(`syncdev_github_${roomId}`, JSON.stringify(gh));
              setGithubMeta(gh);
              setCommitBranch(gh.commitBranch || gh.defaultBranch || "");
            }

            if (!joined) {
              scheduleRetry("Socket not connected - reconnecting...");
            } else {
              const sock = socketRef.current;
              if (!sock || !sock.connected) {
                scheduleRetry("Socket not connected - reconnecting...");
              } else if (!mountingRef.current) {
                // FIX: Prevent duplicate bulk-import emits while a prior import confirmation is still pending.
                mountingRef.current = true;
                setImportProgress(
                  `Syncing files to room (attempt ${Math.min(importRetryCount.current + 1, 10)}/10)...`
                );

                const onImportComplete = (result) => {
                  const preferredOpen = (orderedFileIds && orderedFileIds[0]) || null;
                  loadFilesRef.current(newFiles, newFolders || {}, preferredOpen);
                  sessionStorage.removeItem("syncdev_pending_import");
                  importRetryCount.current = 0;
                  mountingRef.current = false;
                  setImportProgress(null);
                  setGithubHint(
                    result?.alreadyExists
                      ? "GitHub repository is already mounted in this room."
                      : `Imported ${Object.keys(newFiles).length} files from ${gh?.repoPath || "GitHub"}.`
                  );
                  cleanup();
                };

                const onImportError = (err) => {
                  mountingRef.current = false;
                  scheduleRetry(err?.msg || "Import did not complete.");
                  cleanup();
                };

                const cleanup = () => {
                  if (confirmationTimer) clearTimeout(confirmationTimer);
                  sock.off("import-complete", onImportComplete);
                  sock.off("import-error", onImportError);
                };
                cleanupListeners = cleanup;

                sock.once("import-complete", onImportComplete);
                sock.once("import-error", onImportError);
                sock.emit("bulk-import", { roomId, files: newFiles, folders: newFolders || {} });
                confirmationTimer = setTimeout(
                  () => onImportError({ msg: "Import confirmation timed out." }),
                  10000
                );
              }
            }
          }
        }
      }
    } catch (err) {
      console.error("GitHub pending import", err);
      mountingRef.current = false;
      setImportProgress(null);
      setGithubHint("GitHub import failed to resume. Try importing again.");
    }

    return () => {
      if (confirmationTimer) clearTimeout(confirmationTimer);
      if (retryTimer) clearTimeout(retryTimer);
      cleanupListeners?.();
    };
  }, [joined, roomId, socketRef, retryTick]);

  const handleCommitPush = useCallback(async () => {
    if (!githubMeta) return;
    setGithubBusy("commit");
    setGithubHint("");
    try {
      const repoPath = buildRepoPath(githubMeta);
      const { owner, repo } = parseRepoPath(repoPath);
      const treeEntries = collectRepoFiles(files, folders).map((file) => ({
        path: file.path,
        content: file.content,
      }));

      const res = await commitGitHubRepo({
        owner,
        repo,
        branch: commitBranch,
        message: commitMessage || "Update from SyncDev",
        files: treeEntries,
      });

      setCommitMessage("");
      setGithubMeta((prev) =>
        prev
          ? {
              ...prev,
              commitBranch: res.branch,
              commitSha: res.commitSha,
            }
          : prev
      );

      try {
        const key = `syncdev_github_${roomId}`;
        const saved = JSON.parse(sessionStorage.getItem(key) || "{}");
        saved.commitBranch = res.branch;
        saved.commitSha = res.commitSha;
        sessionStorage.setItem(key, JSON.stringify(saved));
      } catch {
        /* ignore */
      }

      setGithubHint(`Pushed to ${res.branch} (${res.commitSha.slice(0, 7)})`);
    } catch (error) {
      setGithubHint(error?.message ? String(error.message) : "Commit failed.");
    } finally {
      setGithubBusy(null);
    }
  }, [githubMeta, commitBranch, commitMessage, files, folders, roomId]);

  const handleDownloadZip = useCallback(async () => {
    const zip = new JSZip();
    Object.values(files).forEach((file) => {
      const path = buildFullPath(folders, file);
      zip.file(path, file.content || "");
    });
    const blob = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${roomId || "syncdev"}-workspace.zip`;
    a.click();
    URL.revokeObjectURL(url);
  }, [files, folders, roomId]);

  const handleDownloadCurrentFile = useCallback(() => {
    const file = Object.values(files).find((entry) => entry.id === activeFileId);
    if (!file) return;
    const blob = new Blob([file.content || ""], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = file.name;
    a.click();
    URL.revokeObjectURL(url);
  }, [files, activeFileId]);

  const handleImportGithub = useCallback(async (repoUrl, ref = "") => {
    const parsedRepo = parseGithubRepoInput(repoUrl);
    if (!parsedRepo) {
      // FIX: Replace blocking browser alert with the existing inline GitHub hint UI.
      setImportProgress(null);
      setGithubHint("Invalid GitHub repo URL.");
      return;
    }
    const { owner, repo, refFromUrl } = parsedRepo;
    const resolvedRef = ref.trim() || refFromUrl || undefined;

    try {
      // FIX: Surface the API fetch phase so users can distinguish network and socket work.
      setImportProgress("Fetching repo from GitHub...");
      setGithubHint("");
      const data = await importGitHubRepo(owner, repo, resolvedRef);
      importRetryCount.current = 0;
      mountingRef.current = false;

      sessionStorage.setItem(
        "syncdev_pending_import",
        JSON.stringify({
          roomId,
          type: "github",
          files: data.files,
          folders: data.folders,
          orderedFileIds: data.orderedFileIds,
          github: data.meta,
        })
      );

      sessionStorage.setItem(`syncdev_github_${roomId}`, JSON.stringify(data.meta));
      setGithubMeta(data.meta);
      setCommitBranch(data.meta?.defaultBranch || "main");
      setGithubHint(
        `Importing ${Object.keys(data.files || {}).length} files from ${owner}/${repo}${resolvedRef ? `@${resolvedRef}` : ""}...`
      );
      setRetryTick((tick) => tick + 1);
    } catch (error) {
      setImportProgress(null);
      setGithubHint("Import failed: " + error.message);
    }
  }, [roomId]);

  return {
    githubMeta,
    setGithubMeta,
    commitBranch,
    setCommitBranch,
    commitMessage,
    setCommitMessage,
    githubBusy,
    githubHint,
    importProgress,
    handleCommitPush,
    handleDownloadZip,
    handleDownloadCurrentFile,
    handleImportGithub,
  };
}

export function getImportRetryDelay(retryCount) {
  return Math.min(500 * 2 ** retryCount, 8000);
}

function buildRepoPath(meta) {
  return meta?.repoPath || `${meta?.owner}/${meta?.repo}`;
}

function parseRepoPath(path) {
  const parts = path.split("/");
  return { owner: parts[0], repo: parts[1] };
}

function buildFullPath(folders, file) {
  const parts = [];
  let current = file;
  let depth = 0;
  const visited = new Set();
  // FIX: Corrupted parent chains must not loop forever while building GitHub paths.
  while (current?.parentId && depth < 50 && !visited.has(current.parentId)) {
    visited.add(current.parentId);
    depth += 1;
    const parent = folders[current.parentId];
    if (!parent) break;
    parts.unshift(parent.name);
    current = { parentId: parent.parentId };
  }
  return [...parts, file.name].join("/");
}

function collectRepoFiles(files, folders) {
  return Object.values(files).map((file) => ({
    path: buildFullPath(folders, file),
    content: file.content,
  }));
}
