// Fetch repo tree via GitHub API and build the same file map shape as client upload.

const { GITHUB_MAX_FILE_BYTES, GITHUB_MAX_FILE_COUNT } = require('../config/constants');

const SKIP_DIRS = new Set([
  "node_modules", ".git", ".next", ".nuxt", "dist", "build",
  ".cache", "coverage", "__pycache__", ".venv", "venv",
]);

const SKIP_FILES = new Set([".DS_Store", "Thumbs.db"]);

const SKIP_EXTS = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "ico", "bmp",
  "mp4", "mp3", "wav", "ogg", "webm",
  "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx",
  "zip", "tar", "gz", "7z", "rar",
  "exe", "dll", "so", "bin", "wasm",
  "ttf", "woff", "woff2", "eot",
]);

const { extToLanguage } = require('../utils/extToLanguage');

function uid() {
  return "f_" + Math.random().toString(36).slice(2, 10);
}

async function ghFetchJson(url, token) {
  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) {
    // FIX: Public repository imports must work without a stored GitHub token.
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(url, {
    headers,
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { message: text };
  }
  if (!res.ok) {
    const err = new Error(data.message || res.statusText || "GitHub API error");
    err.status = res.status;
    throw err;
  }
  return data;
}

function pathShouldSkip(relPath) {
  const parts = relPath.split("/").filter(Boolean);
  const fileName = parts[parts.length - 1] || "";
  if (SKIP_FILES.has(fileName)) return "system file";
  const inSkippedDir = parts.some((p) => SKIP_DIRS.has(p) || p === ".git");
  if (inSkippedDir) return "skipped directory";
  const ext = fileName.includes(".") ? fileName.split(".").pop().toLowerCase() : "";
  if (ext && SKIP_EXTS.has(ext)) return "binary/media";
  return null;
}

/**
 * @param {{ owner: string, repo: string, ref?: string, token: string }} opts
 * @returns {Promise<{ files: object, folders: object, orderedFileIds: string[], skipped: string[], meta: object }>}
 */
async function importRepoFromGitHub({ owner, repo, ref, token }) {
  const files = {};
  const folders = {};
  const skipped = [];
  const dirIdMap = {};

  function getOrCreateFolder(dirPath) {
    if (dirIdMap[dirPath]) return dirIdMap[dirPath];
    const parts = dirPath.split("/").filter(Boolean);
    let parentId = null;
    let builtPath = "";
    for (const part of parts) {
      builtPath = builtPath ? `${builtPath}/${part}` : part;
      if (dirIdMap[builtPath]) {
        parentId = dirIdMap[builtPath];
      } else {
        const id = uid();
        folders[id] = { id, name: part, parentId };
        dirIdMap[builtPath] = id;
        parentId = id;
      }
    }
    return parentId;
  }

  const repoInfo = await ghFetchJson(
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
    token
  );
  const refToResolve = (ref && String(ref).trim()) || repoInfo.default_branch;
  const commitData = await ghFetchJson(
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits/${encodeURIComponent(refToResolve)}`,
    token
  );
  const treeSha = commitData.commit.tree.sha;
  const tree = await ghFetchJson(
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees/${treeSha}?recursive=1`,
    token
  );

  if (tree.truncated) {
    skipped.push("Repository tree was truncated by GitHub; only part of the tree was listed.");
  }

  const blobs = (tree.tree || []).filter((e) => e.type === "blob" && e.path);
  const orderedFileIds = [];

  for (const entry of blobs) {
    if (orderedFileIds.length >= GITHUB_MAX_FILE_COUNT) {
      skipped.push(
        `Import limit reached (${GITHUB_MAX_FILE_COUNT} files); additional matching files in the repo were not imported.`
      );
      break;
    }

    const relPath = entry.path;
    const skipReason = pathShouldSkip(relPath);
    if (skipReason) {
      skipped.push(`${relPath.split("/").pop()} (${skipReason})`);
      continue;
    }

    if (entry.size != null && entry.size > GITHUB_MAX_FILE_BYTES) {
      skipped.push(`${relPath.split("/").pop()} (too large: ${Math.round(entry.size / 1024)}KB)`);
      continue;
    }

    let blob;
    try {
      blob = await ghFetchJson(
        `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/blobs/${entry.sha}`,
        token
      );
    } catch (e) {
      skipped.push(`${relPath.split("/").pop()} (could not read: ${e.message})`);
      continue;
    }

    if (blob.encoding !== "base64" || !blob.content) {
      skipped.push(`${relPath.split("/").pop()} (non-text blob)`);
      continue;
    }

    let content;
    try {
      content = Buffer.from(blob.content.replace(/\n/g, ""), "base64").toString("utf8");
    } catch {
      skipped.push(`${relPath.split("/").pop()} (decode error)`);
      continue;
    }

    if (content.includes("\u0000")) {
      skipped.push(`${relPath.split("/").pop()} (binary)`);
      continue;
    }

    const pathParts = relPath.split("/").filter(Boolean);
    const fileName = pathParts[pathParts.length - 1];
    const dirParts = pathParts.slice(0, -1);

    let parentId = null;
    if (dirParts.length > 0) {
      parentId = getOrCreateFolder(dirParts.join("/"));
    }

    const id = uid();
    const repoPath = relPath.replace(/^\/+/, "");
    files[id] = {
      id,
      name: fileName,
      content,
      language: extToLanguage(fileName),
      parentId,
      repoPath,
    };
    orderedFileIds.push(id);
  }

  const meta = {
    owner,
    repo,
    // FIX: Persist the full repo path so client hints can confirm the imported target.
    repoPath: `${owner}/${repo}`,
    defaultBranch: repoInfo.default_branch,
    importRef: refToResolve,
    commitBranch: repoInfo.default_branch,
    commitSha: commitData.sha,
  };

  return { files, folders, orderedFileIds, skipped, meta };
}

module.exports = {
  importRepoFromGitHub,
  __testables: {
    ghFetchJson,
  },
};
