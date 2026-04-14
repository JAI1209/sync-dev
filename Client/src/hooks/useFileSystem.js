import { useState, useCallback } from "react";
import { extToLanguage } from "../utils/extToLanguage";

export { extToLanguage };

// ── Helpers (exported so FileTree / TabBar can use them too) ──────────────────
export function uid() {
  return "f_" + Math.random().toString(36).slice(2, 10);
}

export const FILE_ICONS = {
  js: "js", jsx: "jsx", ts: "ts", tsx: "tsx", py: "py", java: "java",
  cpp: "cpp", c: "c", cs: "cs", html: "html", css: "css", json: "json",
  md: "md", sh: "sh", go: "go", rs: "rs", php: "php", rb: "rb",
};

export function fileIcon(name) {
  const ext = (name || "").split(".").pop().toLowerCase();
  return FILE_ICONS[ext] || "file";
}

function collectDescendantFolderIds(folders, rootId) {
  const ids = [rootId];
  for (const [id, f] of Object.entries(folders)) {
    if (f.parentId === rootId) {
      ids.push(...collectDescendantFolderIds(folders, id));
    }
  }
  return ids;
}

// ── Hook ──────────────────────────────────────────────────────────────────────
export function useFileSystem() {
  const [files,        setFiles]        = useState({});
  const [folders,      setFolders]      = useState({});
  const [activeFileId, setActiveFileId] = useState(null);
  const [openTabs,     setOpenTabs]     = useState([]);

  // ── Load full room state on join ───────────────────────────────────────────
  const loadRoomState = useCallback(({ files: f, folders: fo, activeFile }) => {
    setFiles(f   || {});
    setFolders(fo || {});
    const first = activeFile && f[activeFile]
      ? activeFile
      : Object.keys(f || {})[0] || null;
    setActiveFileId(first);
    setOpenTabs(first ? [first] : []);
  }, []);

  // ── Open file — adds tab if not already open ───────────────────────────────
  const openFile = useCallback((fileId) => {
    setActiveFileId(fileId);
    setOpenTabs((prev) => prev.includes(fileId) ? prev : [...prev, fileId]);
  }, []);

  // ── Close tab ──────────────────────────────────────────────────────────────
  const closeTab = useCallback((fileId) => {
    setOpenTabs((prev) => {
      const next = prev.filter((id) => id !== fileId);
      setActiveFileId((cur) => {
        if (cur !== fileId) return cur;
        const idx = prev.indexOf(fileId);
        return next[idx] ?? next[idx - 1] ?? next[0] ?? null;
      });
      return next;
    });
  }, []);

  // ── Update file content (Monaco onChange + server push) ────────────────────
  const updateFileContent = useCallback((fileId, content) => {
    setFiles((prev) => {
      if (!prev[fileId]) return prev;
      return { ...prev, [fileId]: { ...prev[fileId], content } };
    });
  }, []);

  // ── Create file locally — return object so caller can emit socket ──────────
  const createFile = useCallback((name, parentId = null) => {
    const id   = uid();
    const file = { id, name, content: "", language: extToLanguage(name), parentId };
    setFiles((prev) => ({ ...prev, [id]: file }));
    return file;
  }, []);

  // ── Create folder locally — return object so caller can emit socket ─────────
  const createFolder = useCallback((name, parentId = null) => {
    const id     = uid();
    const folder = { id, name, parentId };
    setFolders((prev) => ({ ...prev, [id]: folder }));
    return folder;
  }, []);

  // ── Rename file locally ────────────────────────────────────────────────────
  const renameFile = useCallback((fileId, name) => {
    setFiles((prev) => {
      if (!prev[fileId]) return prev;
      const cur = prev[fileId];
      const { repoPath: _rp, ...rest } = cur;
      return { ...prev, [fileId]: { ...rest, name, language: extToLanguage(name) } };
    });
  }, []);

  // ── Rename folder locally ──────────────────────────────────────────────────
  const renameFolder = useCallback((folderId, name) => {
    setFolders((prev) => {
      if (!prev[folderId]) return prev;
      return { ...prev, [folderId]: { ...prev[folderId], name } };
    });
  }, []);

  // ── Delete file locally ────────────────────────────────────────────────────
  const deleteFile = useCallback((fileId) => {
    setFiles((prev) => { const n = { ...prev }; delete n[fileId]; return n; });
    closeTab(fileId);
  }, [closeTab]);

  // ── Delete folder + all descendants locally ────────────────────────────────
  const deleteFolder = useCallback((folderId, currentFolders) => {
    const folderSnapshot = currentFolders || {};
    const folderIds = collectDescendantFolderIds(folderSnapshot, folderId);
    setFolders((prev) => {
      const n = { ...prev };
      folderIds.forEach((id) => delete n[id]);
      return n;
    });
    setFiles((prev) => {
      const n = { ...prev };
      Object.keys(n).forEach((fid) => {
        if (folderIds.includes(n[fid].parentId)) {
          closeTab(fid);
          delete n[fid];
        }
      });
      return n;
    });
  }, [closeTab]);

  // ── BUG FIX: Bulk load files (upload) — MERGE into existing state instead
  //    of replacing it. Replacing caused the tree to lose all prior files.  ──
  const loadFiles = useCallback((newFiles, newFolders = {}, preferredActiveFileId = null) => {
    setFiles((prev) => ({ ...prev, ...newFiles }));
    setFolders((prev) => ({ ...prev, ...newFolders }));
    // Prefer stable upload order (picker order); else any new key.
    const firstNew =
      (preferredActiveFileId && newFiles[preferredActiveFileId] ? preferredActiveFileId : null) ||
      Object.keys(newFiles)[0] ||
      null;
    if (firstNew) {
      setActiveFileId(firstNew);
      setOpenTabs((prev) => (prev.includes(firstNew) ? prev : [...prev, firstNew]));
    }
  }, []);

  // ── Apply events pushed from other peers ───────────────────────────────────
  const applyFileCreated   = useCallback((file)   => setFiles((p)   => ({ ...p, [file.id]:   file   })), []);
  const applyFolderCreated = useCallback((folder) => setFolders((p) => ({ ...p, [folder.id]: folder })), []);

  const applyFileRenamed = useCallback(({ fileId, name, language }) => {
    setFiles((p) => p[fileId] ? { ...p, [fileId]: { ...p[fileId], name, language } } : p);
  }, []);

  const applyFolderRenamed = useCallback(({ folderId, name }) => {
    setFolders((p) => p[folderId] ? { ...p, [folderId]: { ...p[folderId], name } } : p);
  }, []);

  const applyFileDeleted = useCallback(({ fileId }) => {
    setFiles((p) => { const n = { ...p }; delete n[fileId]; return n; });
    closeTab(fileId);
  }, [closeTab]);

  const applyFolderDeleted = useCallback(({ folderId, deletedFiles = [], deletedFolders }) => {
    const folderIds =
      deletedFolders && deletedFolders.length ? deletedFolders : [folderId];
    setFolders((p) => {
      const n = { ...p };
      folderIds.forEach((id) => { delete n[id]; });
      return n;
    });
    setFiles((p) => {
      const n = { ...p };
      deletedFiles.forEach((fid) => delete n[fid]);
      return n;
    });
    deletedFiles.forEach((fid) => closeTab(fid));
  }, [closeTab]);

  const applyFileUpdated = useCallback(({ fileId, content }) => {
    updateFileContent(fileId, content);
  }, [updateFileContent]);

  return {
    // state
    files, folders, activeFileId, openTabs,
    // actions (caller emits socket for mutations)
    loadRoomState, loadFiles,
    openFile, setActiveFile: openFile, closeTab,
    updateFileContent,
    createFile, createFolder,
    renameFile, renameFolder,
    deleteFile, deleteFolder,
    // apply remote peer events
    applyFileCreated, applyFolderCreated,
    applyFileRenamed, applyFolderRenamed,
    applyFileDeleted, applyFolderDeleted,
    applyFileUpdated,
  };
}
