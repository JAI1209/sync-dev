/** Build repo-relative path (posix) for a file using optional repoPath or folder chain. */
export function buildRepoPath(file, files, folders) {
  if (!file) return "";
  if (file.repoPath && typeof file.repoPath === "string") {
    return file.repoPath.replace(/^\/+/, "").replace(/\\/g, "/");
  }
  const parts = [];
  let parent = file.parentId;
  while (parent) {
    const folder = folders[parent];
    if (!folder) break;
    parts.unshift(folder.name);
    parent = folder.parentId;
  }
  parts.push(file.name);
  return parts.join("/");
}

/** All workspace files with computed repo paths (dedupe by path, last wins). */
export function collectRepoFiles(files, folders) {
  const map = new Map();
  for (const file of Object.values(files)) {
    const path = buildRepoPath(file, files, folders);
    if (path) map.set(path, file.content ?? "");
  }
  return [...map.entries()].map(([path, content]) => ({ path, content }));
}
