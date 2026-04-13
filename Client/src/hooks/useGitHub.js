import { useState, useEffect, useCallback, useRef } from "react";
import { commitGitHubRepo } from "../api/github";
import JSZip from "jszip";

export function useGitHub({ files, folders, roomId, socketRef, joined, loadFiles, activeFileId }) {
  const [githubMeta, setGithubMeta] = useState(null);
  const [commitBranch, setCommitBranch] = useState("");
  const [commitMessage, setCommitMessage] = useState("");
  const [githubBusy, setGithubBusy] = useState(null);
  const [githubHint, setGithubHint] = useState("");
  const importRetryCount = useRef(0);
  const [retryTick, setRetryTick] = useState(0);

  // Load saved GitHub metadata
  useEffect(() => {
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

  // Handle pending import from sessionStorage
  useEffect(() => {
    if (!joined) return;
    try {
      const raw = sessionStorage.getItem("syncdev_pending_import");
      if (!raw) return;
      const pending = JSON.parse(raw);
      if (pending.roomId !== roomId) return;

      sessionStorage.removeItem("syncdev_pending_import");
      const { files: newFiles, folders: newFolders, orderedFileIds, github: gh } = pending;
      if (!newFiles || typeof newFiles !== "object" || !Object.keys(newFiles).length) return;

      if (gh) {
        sessionStorage.setItem(`syncdev_github_${roomId}`, JSON.stringify(gh));
        setGithubMeta(gh);
        setCommitBranch(gh.commitBranch || gh.defaultBranch || "");
      }

      const preferredOpen = (orderedFileIds && orderedFileIds[0]) || null;
      loadFiles(newFiles, newFolders || {}, preferredOpen);

      // Use bulk-import for efficient persistence
      const sock = socketRef.current;
      if (!sock || !sock.connected) {
        console.log("[Import] Socket not connected, retrying in 500ms...");
        sessionStorage.setItem("syncdev_pending_import", JSON.stringify(pending));
        importRetryCount.current += 1;
        if (importRetryCount.current <= 10) {
          setTimeout(() => {
            setRetryTick(t => t + 1); // Bug 8: Actually trigger retry
          }, 500);
        }
        return;
      }

      const folderCount = Object.keys(newFolders || {}).length;
      console.log(`[Import] Emitting bulk-import: ${Object.keys(newFiles).length} files, ${folderCount} folders`);
      sock.emit("bulk-import", { roomId, files: newFiles, folders: newFolders || {} });

      // Listen for import confirmation
      const onImportComplete = (result) => {
        console.log(`[Import] Success! Saved ${result.filesImported} files, ${result.foldersImported} folders`);
        cleanup();
      };

      const onImportError = (err) => {
        console.error("[Import] Error:", err);
        cleanup();
      };

      const cleanup = () => {
        sock.off("import-complete", onImportComplete);
        sock.off("import-error", onImportError);
      };

      sock.once("import-complete", onImportComplete);
      sock.once("import-error", onImportError);
      setTimeout(cleanup, 10000);
    } catch (err) {
      console.error("GitHub pending import", err);
      sessionStorage.removeItem("syncdev_pending_import");
    }
  }, [joined, roomId, loadFiles, socketRef, retryTick]);

  const handleCommitPush = useCallback(async () => {
    if (!githubMeta) return;
    setGithubBusy("commit");
    setGithubHint("");
    try {
      const repoPath = buildRepoPath(githubMeta);
      const { owner, repo } = parseRepoPath(repoPath);

      const treeEntries = collectRepoFiles(files, folders).map((f) => ({
        path: f.path,
        content: f.content,
      }));

      // Bug 5: Server handles GitHub auth via stored token
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
    } catch (e) {
      setGithubHint(e?.message ? String(e.message) : "Commit failed.");
    } finally {
      setGithubBusy(null);
    }
  }, [githubMeta, commitBranch, commitMessage, files, folders, roomId]);

  const handleDownloadZip = useCallback(async () => {
    const zip = new JSZip();
    Object.values(files).forEach((f) => {
      const path = buildFullPath(folders, f);
      zip.file(path, f.content || "");
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
    const file = Object.values(files).find((f) => f.id === activeFileId);
    if (!file) return;
    const blob = new Blob([file.content || ""], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = file.name;
    a.click();
    URL.revokeObjectURL(url);
  }, [files]);

  const handleImportGithub = useCallback(async (repoUrl, ref = "") => {
    const match = repoUrl.match(/github\.com\/([^/]+)\/([^/]+)/);
    if (!match) {
      alert("Invalid GitHub repo URL");
      return;
    }
    const [, owner, repoRaw] = match;
    const repo = repoRaw.replace(/\.git$/, "");

    const token = sessionStorage.getItem("github_token");
    if (!token) {
      const oauthUrl = `https://github.com/login/oauth/authorize?client_id=${import.meta.env.VITE_GITHUB_CLIENT_ID}&scope=repo&redirect_uri=${encodeURIComponent(window.location.origin + "/github/callback")}`;
      sessionStorage.setItem(
        "syncdev_pending_import",
        JSON.stringify({ roomId, type: "github", owner, repo, ref })
      );
      window.location.href = oauthUrl;
      return;
    }

    try {
      const res = await fetch(`/api/github/import?owner=${owner}&repo=${repo}&ref=${ref}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();

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

      // Reload to apply import
      window.location.reload();
    } catch (e) {
      alert("Import failed: " + e.message);
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
    handleCommitPush,
    handleDownloadZip,
    handleDownloadCurrentFile,
    handleImportGithub,
  };
}

// Helpers
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
  while (current?.parentId) {
    const parent = folders[current.parentId];
    if (!parent) break;
    parts.unshift(parent.name);
    current = { parentId: parent.parentId };
  }
  return [...parts, file.name].join("/");
}

function collectRepoFiles(files, folders) {
  return Object.values(files).map((f) => ({
    path: buildFullPath(folders, f),
    content: f.content,
  }));
}
