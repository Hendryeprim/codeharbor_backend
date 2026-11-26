import AdmZip from 'adm-zip';

const REPO_CACHE = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_FILES = 150;
const MAX_FILE_SIZE_BYTES = 300 * 1024; // 300 KB per file for editor

const IGNORED_SEGMENTS = new Set([
  '.git',
  'node_modules',
  '__pycache__',
  '.venv',
  'venv',
  'dist',
  'build',
  '.next',
  '.idea',
  '.vscode',
  'target',
]);

const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.svg', '.bmp',
  '.pdf', '.zip', '.tar', '.gz', '.rar', '.7z',
  '.exe', '.dll', '.so', '.dylib', '.bin', '.class', '.jar', '.pyc',
  '.woff', '.woff2', '.ttf', '.eot', '.otf',
  '.mp3', '.mp4', '.wav', '.avi', '.mov', '.webm',
  '.db', '.sqlite', '.sqlite3',
]);

/**
 * Parse a GitHub repository URL into owner, repo, and optional branch/subpath.
 */
export const parseGithubUrl = (rawUrl, fallbackBranch = 'main') => {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  try {
    const cleaned = rawUrl.trim().replace(/\.git$/i, '').replace(/\/+$/, '');
    const url = new URL(cleaned);
    if (!url.hostname.toLowerCase().includes('github.com')) return null;

    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length < 2) return null;

    const owner = parts[0];
    const repo = parts[1];
    let branch = fallbackBranch || 'main';
    let subPath = '';

    if (parts[2] === 'tree' && parts.length >= 4) {
      branch = parts[3];
      if (parts.length > 4) {
        subPath = parts.slice(4).join('/');
      }
    }

    return { owner, repo, branch, subPath };
  } catch {
    return null;
  }
};

const isIgnoredPath = (relPath) => {
  const segments = relPath.split('/');
  if (segments.some((seg) => IGNORED_SEGMENTS.has(seg))) return true;
  const fileName = segments[segments.length - 1] || '';
  if (fileName === '.DS_Store' || fileName === 'Thumbs.db') return true;
  return false;
};

const isBinaryFile = (relPath, buffer) => {
  const lower = relPath.toLowerCase();
  const dotIdx = lower.lastIndexOf('.');
  if (dotIdx !== -1 && BINARY_EXTENSIONS.has(lower.slice(dotIdx))) {
    return true;
  }
  // Quick null-byte check on first 1024 bytes
  const sampleLen = Math.min(buffer.length, 1024);
  for (let i = 0; i < sampleLen; i++) {
    if (buffer[i] === 0) return true;
  }
  return false;
};

const fetchZipBuffer = async (url) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'CoderHarbor-Workspace/1.0',
        Accept: 'application/vnd.github+json, application/zip, */*',
      },
      redirect: 'follow',
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const arrayBuf = await res.arrayBuffer();
    return Buffer.from(arrayBuf);
  } finally {
    clearTimeout(timeout);
  }
};

/**
 * Fetch and extract files from a public GitHub repository.
 */
export const fetchGithubRepoFiles = async (repoUrl, branchHint = 'main') => {
  const parsed = parseGithubUrl(repoUrl, branchHint);
  if (!parsed) {
    throw new Error('Invalid GitHub repository URL.');
  }

  const cacheKey = `${parsed.owner}/${parsed.repo}@${parsed.branch}:${parsed.subPath}`;
  const cached = REPO_CACHE.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.data;
  }

  const candidateUrls = [
    `https://github.com/${parsed.owner}/${parsed.repo}/archive/refs/heads/${encodeURIComponent(parsed.branch)}.zip`,
    `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/zipball/${encodeURIComponent(parsed.branch)}`,
  ];

  if (parsed.branch === 'main') {
    candidateUrls.push(
      `https://github.com/${parsed.owner}/${parsed.repo}/archive/refs/heads/master.zip`,
      `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/zipball`
    );
  } else {
    candidateUrls.push(`https://api.github.com/repos/${parsed.owner}/${parsed.repo}/zipball`);
  }

  let zipBuffer = null;
  let lastErr = null;
  for (const url of candidateUrls) {
    try {
      zipBuffer = await fetchZipBuffer(url);
      if (zipBuffer && zipBuffer.length > 0) break;
    } catch (err) {
      lastErr = err;
    }
  }

  if (!zipBuffer) {
    throw new Error(`Could not fetch GitHub repository (${lastErr?.message || 'network error'}). Make sure the repository is public.`);
  }

  const zip = new AdmZip(zipBuffer);
  const entries = zip.getEntries();

  const files = [];
  for (const entry of entries) {
    if (entry.isDirectory) continue;

    // Strip the GitHub archive top-level directory (e.g. "repo-main/")
    const rawName = entry.entryName.replace(/\\/g, '/');
    const firstSlash = rawName.indexOf('/');
    let relPath = firstSlash !== -1 ? rawName.slice(firstSlash + 1) : rawName;
    if (!relPath) continue;

    if (parsed.subPath) {
      if (!relPath.startsWith(parsed.subPath + '/')) continue;
      relPath = relPath.slice(parsed.subPath.length + 1);
    }

    if (!relPath || isIgnoredPath(relPath)) continue;

    const rawData = entry.getData();
    if (rawData.length > MAX_FILE_SIZE_BYTES) continue;
    if (isBinaryFile(relPath, rawData)) continue;

    files.push({
      path: relPath,
      filename: relPath,
      name: relPath.split('/').pop(),
      content: rawData.toString('utf8'),
      size: rawData.length,
    });

    if (files.length >= MAX_FILES) break;
  }

  // Sort: folders/files alphabetically, README/main first or natural tree sort
  files.sort((a, b) => a.path.localeCompare(b.path));

  const result = {
    owner: parsed.owner,
    repo: parsed.repo,
    branch: parsed.branch,
    files,
  };

  REPO_CACHE.set(cacheKey, { timestamp: Date.now(), data: result });
  return result;
};

/**
 * Create a ZIP buffer from an array of { filename, content } objects.
 */
export const buildWorkspaceZipBuffer = (files = []) => {
  const zip = new AdmZip();
  for (const file of files) {
    const cleanPath = String(file.filename || file.path || '')
      .replace(/\\/g, '/')
      .replace(/^\/+/, '');
    if (!cleanPath || cleanPath.includes('..')) continue;
    zip.addFile(cleanPath, Buffer.from(String(file.content ?? ''), 'utf8'));
  }
  return zip.toBuffer();
};
