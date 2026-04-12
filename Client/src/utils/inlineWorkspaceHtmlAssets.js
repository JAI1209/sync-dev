import { buildRepoPath } from "./repoPaths";

function dirname(posixPath) {
  if (!posixPath) return "";
  const i = posixPath.lastIndexOf("/");
  return i <= 0 ? "" : posixPath.slice(0, i);
}

/**
 * Resolve a relative or absolute-from-root path against baseDir (posix, no leading slash in result).
 * @param {string} baseDir
 * @param {string} relative href or src, query stripped
 * @returns {string | null} repo-relative path, or null if external / invalid
 */
function resolveWorkspaceAssetPath(baseDir, relative) {
  const raw = (relative || "").trim().split("#")[0].split("?")[0];
  if (!raw || /^(https?:|data:|blob:|mailto:|javascript:)/i.test(raw)) return null;
  if (raw.startsWith("//")) return null;
  const parts = baseDir ? baseDir.split("/").filter(Boolean) : [];
  if (raw.startsWith("/")) {
    return raw.replace(/^\/+/, "");
  }
  for (const seg of raw.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  return parts.join("/");
}

function buildPathToContent(files, folders) {
  const map = new Map();
  for (const file of Object.values(files)) {
    const p = buildRepoPath(file, files, folders).replace(/\\/g, "/");
    if (p) map.set(p, file.content ?? "");
  }
  return map;
}

/**
 * Inline same-workspace CSS/JS linked from HTML so blob preview can load assets (VS Code–style run).
 * @param {string} html - current editor HTML source
 * @param {object | null} activeFile - active file record (for folder path)
 * @param {Record<string, object>} files
 * @param {Record<string, object>} folders
 */
export function bundleWorkspaceHtml(html, activeFile, files, folders) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");

  const basePath = buildRepoPath(activeFile, files, folders);
  const baseDir = dirname(basePath);
  const pathMap = buildPathToContent(files, folders);

  const read = (repoPath) => {
    if (!repoPath) return undefined;
    return pathMap.get(repoPath);
  };

  const inlined = [];
  const missing = [];

  doc.querySelectorAll("link[href]").forEach((link) => {
    const rel = (link.getAttribute("rel") || "").toLowerCase();
    const href = link.getAttribute("href") || "";
    if (!href || /^(https?:|data:|blob:)/i.test(href)) return;
    const relTok = rel.split(/\s+/).filter(Boolean);
    if (relTok.includes("preload") || relTok.includes("preconnect") || relTok.includes("dns-prefetch")) return;
    const isStylesheet =
      relTok.includes("stylesheet") || /\.css$/i.test(href.split("?")[0]);
    if (!isStylesheet) return;
    const resolved = resolveWorkspaceAssetPath(baseDir, href);
    if (resolved == null) return;
    const content = read(resolved);
    if (content != null) {
      const style = doc.createElement("style");
      const media = link.getAttribute("media");
      if (media) style.setAttribute("media", media);
      style.textContent = content;
      link.replaceWith(style);
      inlined.push(resolved);
    } else {
      missing.push(href);
    }
  });

  doc.querySelectorAll("script[src]").forEach((script) => {
    const src = script.getAttribute("src") || "";
    if (!src || /^(https?:|data:|blob:)/i.test(src)) return;
    const resolved = resolveWorkspaceAssetPath(baseDir, src);
    if (resolved == null) return;
    const content = read(resolved);
    if (content != null) {
      const neu = doc.createElement("script");
      for (const attr of script.attributes) {
        if (attr.name === "src") continue;
        neu.setAttribute(attr.name, attr.value);
      }
      neu.removeAttribute("src");
      neu.textContent = content;
      script.replaceWith(neu);
      inlined.push(resolved);
    } else {
      missing.push(src);
    }
  });

  const doctype = doc.doctype ? `<!DOCTYPE ${doc.doctype.name}>` : "<!DOCTYPE html>";
  const out = `${doctype}\n${doc.documentElement.outerHTML}`;

  return { html: out, inlined, missing };
}
