/**
 * Build a WebContainer file tree from flat repo paths.
 * @param {{ path: string, content: string }[]} entries
 */
export function pathsToWebContainerTree(entries) {
  const root = {};
  for (const { path, content } of entries) {
    const parts = path.split("/").filter(Boolean);
    let node = root;
    for (let i = 0; i < parts.length; i++) {
      const name = parts[i];
      const isLast = i === parts.length - 1;
      if (isLast) {
        node[name] = { file: { contents: content ?? "" } };
      } else {
        const existing = node[name];
        if (!existing) {
          node[name] = { directory: {} };
        } else if (!existing.directory) {
          break;
        }
        node = node[name].directory;
      }
    }
  }
  return root;
}
