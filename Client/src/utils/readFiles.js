// ── Constants ─────────────────────────────────────────────────────────────────
const MAX_FILE_SIZE  = 500 * 1024;   // 500 KB per file
const MAX_FILE_COUNT = 50;

const SKIP_DIRS = new Set([
  'node_modules', '.git', '.next', '.nuxt', 'dist', 'build',
  '.cache', 'coverage', '__pycache__', '.venv', 'venv',
]);
const SKIP_FILES = new Set(['.DS_Store', 'Thumbs.db', '.gitkeep']);

const SKIP_EXTS = new Set([
  'png','jpg','jpeg','gif','webp','svg','ico','bmp',
  'mp4','mp3','wav','ogg','webm',
  'pdf','doc','docx','xls','xlsx','ppt','pptx',
  'zip','tar','gz','7z','rar',
  'exe','dll','so','bin','wasm',
  'ttf','woff','woff2','eot',
  'lock',
]);

const EXT_LANG = {
  js:'javascript', jsx:'javascript', ts:'typescript', tsx:'typescript',
  py:'python', java:'java', cpp:'cpp', c:'cpp', cs:'csharp',
  html:'html', css:'css', json:'json', md:'markdown', sh:'shell',
  go:'go', rs:'rust', php:'php', rb:'ruby', yml:'yaml', yaml:'yaml',
};

function extToLanguage(name) {
  const ext = name.split('.').pop().toLowerCase();
  return EXT_LANG[ext] || 'plaintext';
}

function uid() {
  return 'f_' + Math.random().toString(36).slice(2, 10);
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

  await Promise.all(toProcess.map(async (file) => {
    const relativePath = file.webkitRelativePath || file.name;
    const pathParts    = relativePath.split('/');
    const fileName     = pathParts[pathParts.length - 1];
    const dirParts     = pathParts.slice(0, -1);

    const inSkippedDir = dirParts.some(p => SKIP_DIRS.has(p) || p.startsWith('.'));
    if (inSkippedDir) { skipped.push(`${fileName} (in skipped directory)`); return; }
    if (SKIP_FILES.has(fileName)) { skipped.push(`${fileName} (system file)`); return; }

    const ext = fileName.split('.').pop().toLowerCase();
    if (SKIP_EXTS.has(ext)) { skipped.push(`${fileName} (binary/media)`); return; }
    if (file.size > MAX_FILE_SIZE) {
      skipped.push(`${fileName} (too large: ${Math.round(file.size / 1024)}KB)`);
      return;
    }

    let parentId = null;
    const relevantDirParts = dirParts.length > 1 ? dirParts.slice(1) : [];
    if (relevantDirParts.length > 0) {
      parentId = getOrCreateFolder(relevantDirParts.join('/'));
    }

    const content = await readFileAsText(file);
    if (content === null) { skipped.push(`${fileName} (could not read)`); return; }

    const id = uid();
    files[id] = { id, name: fileName, content, language: extToLanguage(fileName), parentId };
  }));

  return { files, folders, skipped };
}

function readFileAsText(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload  = (e) => resolve(e.target.result);
    reader.onerror = () => resolve(null);
    reader.readAsText(file);
  });
}
