function sanitizePathParts(parts) {
  return parts
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .map((part) => part.replace(/\\/g, "/"))
    .flatMap((part) => part.split("/").filter(Boolean));
}

export function resolveFilePath(file, folders) {
  if (!file) return [];

  if (file.repoPath && typeof file.repoPath === "string") {
    return sanitizePathParts(file.repoPath.split("/"));
  }

  const parts = [file.name];
  let parentId = file.parentId;
  let depth = 0;
  const visited = new Set();

  // FIX: Folder corruption must not trap WebContainer mounting in an infinite parent walk.
  while (parentId && depth < 50 && !visited.has(parentId)) {
    visited.add(parentId);
    depth += 1;
    const folder = folders[parentId];
    if (!folder) break;
    parts.unshift(folder.name);
    parentId = folder.parentId;
  }

  return sanitizePathParts(parts);
}

export function buildWebContainerTree(files, folders) {
  const tree = {};

  Object.values(files || {}).forEach((file) => {
    const pathParts = resolveFilePath(file, folders || {});
    if (!pathParts.length) return;

    let node = tree;
    for (let index = 0; index < pathParts.length - 1; index += 1) {
      const segment = pathParts[index];
      node[segment] ??= { directory: {} };
      node = node[segment].directory;
    }

    const fileName = pathParts[pathParts.length - 1];
    node[fileName] = { file: { contents: file.content || "" } };
  });

  return tree;
}

/**
 * Build a WebContainer file tree from flat repo paths.
 * @param {{ path: string, content: string }[]} entries
 */
export function pathsToWebContainerTree(entries) {
  const root = {};

  for (const { path, content } of entries) {
    const parts = sanitizePathParts(String(path || "").split("/"));
    if (!parts.length) continue;

    let node = root;
    for (let index = 0; index < parts.length; index += 1) {
      const name = parts[index];
      const isLast = index === parts.length - 1;

      if (isLast) {
        node[name] = { file: { contents: content ?? "" } };
      } else {
        node[name] ??= { directory: {} };
        if (!node[name].directory) break;
        node = node[name].directory;
      }
    }
  }

  return root;
}
