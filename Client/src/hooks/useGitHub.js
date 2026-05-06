import { useState, useEffect, useCallback, useRef } from "react";
import { commitGitHubRepo } from "../api/github";
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
  const loadFilesRef = useRef(loadFiles);

  useEffect(() => {
    // Keep paged imports using the latest file loader.
    loadFilesRef.current = loadFiles;
  }, [loadFiles]);

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
      setImportProgress(null);
      setGithubHint("Invalid GitHub repo URL.");
      return;
    }
    const { owner, repo, refFromUrl } = parsedRepo;
    const resolvedRef = ref.trim() || refFromUrl || undefined;

    const sock = socketRef.current;
    if (!sock || !sock.connected || !joined) {
      setImportProgress(null);
      setGithubHint("Socket not connected. Wait for the room to load and try again.");
      return;
    }

    setImportProgress("Requesting import from server...");
    setGithubHint("");

    sock.off("import-progress");
    sock.off("import-ready");
    sock.off("import-error");
    sock.off("file-page");
    sock.off("file-page-error");

    let totalFiles = 0;
    let loadedFiles = 0;
    let importMeta = null;

    const fetchNextPage = (targetSocket, offset) => {
      targetSocket.emit("get-file-page", { roomId, offset, limit: 100 });
    };

    sock.on("import-progress", ({ message }) => {
      setImportProgress(message);
    });

    sock.once("import-error", (err) => {
      sock.off("import-progress");
      sock.off("import-ready");
      sock.off("file-page");
      sock.off("file-page-error");
      setImportProgress(null);
      setGithubHint("Import failed: " + (err?.msg || "Unknown error"));
    });

    sock.once("import-ready", ({ fileCount, meta }) => {
      sock.off("import-progress");
      totalFiles = fileCount;
      importMeta = meta;
      setGithubMeta(meta);
      setCommitBranch(meta?.defaultBranch || "main");
      try {
        sessionStorage.setItem(`syncdev_github_${roomId}`, JSON.stringify(meta));
      } catch {
        /* ignore */
      }
      setImportProgress(`Loading ${fileCount} files...`);
      fetchNextPage(sock, 0);
    });

    sock.on("file-page", ({ files: pageFiles, folders: pageFolders, offset, total }) => {
      loadFilesRef.current(pageFiles, offset === 0 ? pageFolders : {}, null);
      loadedFiles = offset + Object.keys(pageFiles).length;
      totalFiles = total;

      if (loadedFiles < totalFiles) {
        setImportProgress(`Loading ${loadedFiles}/${totalFiles} files...`);
        fetchNextPage(sock, loadedFiles);
      } else {
        sock.off("file-page");
        sock.off("file-page-error");
        sock.off("import-error");
        setImportProgress(null);
        setGithubHint(
          `Imported ${totalFiles} files from ${importMeta?.repoPath || `${owner}/${repo}`}.`
        );
      }
    });

    sock.on("file-page-error", (err) => {
      sock.off("file-page");
      sock.off("file-page-error");
      sock.off("import-error");
      setImportProgress(null);
      setGithubHint("Failed to load files: " + (err?.msg || "Unknown error"));
    });

    sock.emit("start-github-import", { roomId, owner, repo, ref: resolvedRef });
  }, [roomId, joined, socketRef]);

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
