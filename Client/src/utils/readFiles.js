// ── Constants ─────────────────────────────────────────────────────────────────
const MAX_FILE_SIZE  = 2 * 1024 * 1024; // 2 MB per file (align with server GitHub import default)
const MAX_FILE_COUNT = 5000;

const SKIP_DIRS = new Set([
  'node_modules', '.git', '.next', '.nuxt', 'dist', 'build',
  '.cache', 'coverage', '__pycache__', '.venv', 'venv',
]);
const SKIP_FILES = new Set(['.DS_Store', 'Thumbs.db', '.gitkeep']);

const SKIP_EXTS = new Set([
  'png','jpg','jpeg','gif','webp','ico','bmp',
  'mp4','mp3','wav','ogg','webm',
  'pdf','doc','docx','xls','xlsx','ppt','pptx',
  'zip','tar','gz','7z','rar',
  'exe','dll','so','bin','wasm',
  'ttf','woff','woff2','eot',
]);

import { extToLanguage } from "./extToLanguage";

function uid() {
  return 'f_' + Math.random().toString(36).slice(2, 10);
}

/** Parent folders before children — safe order for socket `create-folder` broadcasts. */
export function sortFoldersParentFirst(folders) {
  const list = Object.values(folders);
  const placed = new Set();
  const out = [];
  let remaining = list;
  const canPlace = (f) => f.parentId == null || placed.has(f.parentId);
  while (remaining.length) {
    const next = remaining.filter(canPlace);
    if (!next.length) {
      out.push(...remaining);
      break;
    }
    for (const f of next) {
      out.push(f);
      placed.add(f.id);
    }
    remaining = remaining.filter((f) => !placed.has(f.id));
  }
  return out;
}

export async function readUploadedFiles(fileList) {
  const files   = {};
  const folders = {};
  const skipped = [];
  const dirIdMap = {};

  function getOrCreateFolder(dirPath) {
    if (dirIdMap[dirPath]) return dirIdMap[dirPath];
    const parts = dirPath.split('/').filter(Boolean);
    let parentId = null;
    let builtPath = '';
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

  const allFiles = Array.from(fileList);
  if (allFiles.length > MAX_FILE_COUNT) {
    skipped.push(`${allFiles.length - MAX_FILE_COUNT} files skipped (limit: ${MAX_FILE_COUNT})`);
  }
  const toProcess = allFiles.slice(0, MAX_FILE_COUNT);

  const readSlot = async (file, index) => {
    const relativePath = file.webkitRelativePath || file.name;
    const pathParts    = relativePath.split('/').filter(Boolean);
    if (pathParts.length === 0) return { index, id: null };
    const fileName     = pathParts[pathParts.length - 1];
    const dirParts     = pathParts.slice(0, -1);

    const inSkippedDir = dirParts.some(p => SKIP_DIRS.has(p) || p === '.git');
    if (inSkippedDir) { skipped.push(`${fileName} (in skipped directory)`); return { index, id: null }; }
    if (SKIP_FILES.has(fileName)) { skipped.push(`${fileName} (system file)`); return { index, id: null }; }

    const ext = fileName.split('.').pop().toLowerCase();
    if (SKIP_EXTS.has(ext)) { skipped.push(`${fileName} (binary/media)`); return { index, id: null }; }
    if (file.size > MAX_FILE_SIZE) {
      skipped.push(`${fileName} (too large: ${Math.round(file.size / 1024)}KB)`);
      return { index, id: null };
    }

    let parentId = null;
    if (dirParts.length > 0) {
      parentId = getOrCreateFolder(dirParts.join('/'));
    }

    const content = await readFileAsText(file);
    if (content === null) { skipped.push(`${fileName} (could not read)`); return { index, id: null }; }

    const id = uid();
    files[id] = { id, name: fileName, content, language: extToLanguage(fileName), parentId };
    return { index, id };
  };

  const BATCH = 50;
  const slotResults = [];
  for (let i = 0; i < toProcess.length; i += BATCH) {
    const batch = toProcess.slice(i, i + BATCH);
    const results = await Promise.all(batch.map((file, j) => readSlot(file, i + j)));
    slotResults.push(...results);
  }

  const orderedFileIds = slotResults
    .filter((r) => r.id)
    .sort((a, b) => a.index - b.index)
    .map((r) => r.id);

  return { files, folders, skipped, orderedFileIds };
}

function readFileAsText(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload  = (e) => resolve(e.target.result);
    reader.onerror = () => resolve(null);
    reader.readAsText(file);
  });
}
