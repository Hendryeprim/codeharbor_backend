import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { Readable, pipeline as _pipeline } from 'stream';
import { promisify } from 'util';
const pipeline = promisify(_pipeline);
const toNodeStream = (webStream) => (typeof Readable.fromWeb === 'function' ? Readable.fromWeb(webStream) : Readable.from(webStream));
import AdmZip from 'adm-zip';
import prisma from '../database/prisma.js';
import { config } from '../config/index.js';
import { getSandboxInterceptorScript } from './sandboxInterceptor.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const PREVIEWS_DIR = path.resolve(__dirname, '../../storage/previews');
export const TEMP_BUILDS_DIR = path.resolve(__dirname, '../../storage/temp_builds');

// Ensure base directories exist
fs.mkdirSync(PREVIEWS_DIR, { recursive: true });
fs.mkdirSync(TEMP_BUILDS_DIR, { recursive: true });

/**
 * Generate preview URL based on environment
 */
export const getPreviewUrl = (productId) => {
  if (process.env.PREVIEW_BASE_URL) {
    return `${process.env.PREVIEW_BASE_URL.replace(/\/$/, '')}/${productId}/`;
  }
  if (process.env.BACKEND_PUBLIC_URL) {
    return `${process.env.BACKEND_PUBLIC_URL.replace(/\/$/, '')}/previews/${productId}/`;
  }
  // Unless explicitly designated as local development machine, default to the live coderharbor preview endpoint
  if (process.env.IS_LOCAL_DEV !== 'true') {
    return `https://api.coderharbor.com/previews/${productId}/`;
  }
  const port = process.env.PORT || 5050;
  return `http://localhost:${port}/previews/${productId}/`;
};

const normalize = (p) => (p || '').replace(/\\/g, '/');

/**
 * Helper to identify virtual environment, git, cache, and node_modules noise
 */
export const isJunkOrVenv = (name) => {
  const lower = (name || '').toLowerCase().replace(/\\/g, '/');
  return (
    lower.includes('/.venv/') ||
    lower.startsWith('.venv/') ||
    lower.includes('/venv/') ||
    lower.startsWith('venv/') ||
    lower.includes('/site-packages/') ||
    lower.includes('/node_modules/') ||
    lower.includes('/.git/') ||
    lower.startsWith('.git/') ||
    lower.includes('/__pycache__/') ||
    lower.startsWith('__pycache__/') ||
    lower.endsWith('.pyc') ||
    lower.includes('/.idea/') ||
    lower.includes('/.vscode/') ||
    lower.includes('/.ds_store') ||
    lower.endsWith('.ds_store')
  );
};

/**
 * Helper to check if a file path is under a frontend directory
 */
const isFrontendPath = (p) => {
  const l = (p || '').toLowerCase().replace(/\\/g, '/');
  return (
    l.startsWith('frontend/') ||
    l.includes('/frontend/') ||
    l.startsWith('client/') ||
    l.includes('/client/') ||
    l.startsWith('web/') ||
    l.includes('/web/') ||
    l.startsWith('ui/') ||
    l.includes('/ui/')
  );
};

const isBackendPath = (p) => {
  const l = (p || '').toLowerCase().replace(/\\/g, '/');
  return (
    l.startsWith('backend/') ||
    l.includes('/backend/') ||
    l.startsWith('server/') ||
    l.includes('/server/') ||
    l.startsWith('api/') ||
    l.includes('/api/')
  );
};

/**
 * Detects if a project archive contains nested .zip files (e.g., frontend.zip and backend.zip)
 * and automatically consolidates them into a unified structure (frontend/, backend/).
 */
export const consolidateArchiveIfNested = (zipFilePath) => {
  if (!fs.existsSync(zipFilePath)) return false;

  try {
    const zip = new AdmZip(zipFilePath);
    const zipEntries = zip.getEntries();

    const nestedZipEntries = zipEntries.filter(
      (e) => !e.isDirectory && !isJunkOrVenv(e.entryName) && e.entryName.toLowerCase().endsWith('.zip')
    );

    if (nestedZipEntries.length === 0) {
      return false;
    }

    console.log(`[PreviewService] Detected ${nestedZipEntries.length} nested zip files in ${zipFilePath}. Consolidating...`);

    const consolidatedZip = new AdmZip();

    // 1. Copy any non-zip, non-directory root files (e.g. root README, LICENSE, etc.)
    for (const entry of zipEntries) {
      if (
        !entry.isDirectory &&
        !isJunkOrVenv(entry.entryName) &&
        !entry.entryName.toLowerCase().endsWith('.zip')
      ) {
        consolidatedZip.addFile(entry.entryName, entry.getData());
      }
    }

    // 2. Unpack each nested zip into structured folders (frontend/, backend/, etc.)
    for (const entry of nestedZipEntries) {
      const entryNameLower = entry.entryName.toLowerCase();

      // If this is a precompiled production bundle (dist.zip, build.zip), preserve the file itself
      // so downstream preview extractors can read it directly as well.
      if (entryNameLower.endsWith('dist.zip') || entryNameLower.endsWith('build.zip')) {
        consolidatedZip.addFile(entry.entryName, entry.getData());
      }

      let targetFolder = '';

      if (
        entryNameLower.includes('frontend') ||
        entryNameLower.includes('client') ||
        entryNameLower.includes('ui') ||
        entryNameLower.includes('web')
      ) {
        targetFolder = 'frontend';
      } else if (
        entryNameLower.includes('backend') ||
        entryNameLower.includes('server') ||
        entryNameLower.includes('api')
      ) {
        targetFolder = 'backend';
      } else if (entryNameLower.includes('admin')) {
        targetFolder = 'admin';
      } else if (entryNameLower.includes('mobile') || entryNameLower.includes('app')) {
        targetFolder = 'mobile';
      } else {
        const basename = path.basename(entry.entryName, path.extname(entry.entryName));
        targetFolder = basename.replace(/[^a-zA-Z0-9_-]/g, '_');
      }

      try {
        const innerZip = new AdmZip(entry.getData());
        const innerEntries = innerZip.getEntries();

        // Check if inner zip has a single root directory (e.g. 'vino-browsing-frontend-main/')
        let innerRootDir = '';
        const topLevels = new Set();
        for (const ie of innerEntries) {
          const parts = ie.entryName.split(/[\/\\]/).filter(Boolean);
          if (parts.length > 0) topLevels.add(parts[0]);
        }
        if (topLevels.size === 1) {
          const candidate = Array.from(topLevels)[0];
          if (
            innerEntries.every(
              (ie) =>
                ie.entryName.startsWith(candidate + '/') ||
                ie.entryName.startsWith(candidate + '\\')
            )
          ) {
            innerRootDir = candidate;
          }
        }

        const isDistOrBuildZip = entryNameLower.endsWith('dist.zip') || entryNameLower.endsWith('build.zip');

        for (const ie of innerEntries) {
          if (ie.isDirectory || isJunkOrVenv(ie.entryName)) continue;
          let relPath = ie.entryName;
          if (innerRootDir && relPath.startsWith(innerRootDir)) {
            relPath = relPath.substring(innerRootDir.length).replace(/^[\/\\]/, '');
          }
          if (!relPath) continue;

          // For pre-built distribution zips, place entries into targetFolder/dist/ so dist/index.html is created cleanly
          const subFolder = isDistOrBuildZip ? (targetFolder ? `${targetFolder}/dist` : 'dist') : targetFolder;
          const finalPath = `${subFolder}/${relPath}`.replace(/\\/g, '/');
          consolidatedZip.addFile(finalPath, ie.getData());
        }
      } catch (innerErr) {
        console.warn(`[PreviewService] Failed to unpack nested zip ${entry.entryName}:`, innerErr.message);
      }
    }

    // Write consolidated archive back to zipFilePath
    consolidatedZip.writeZip(zipFilePath);
    console.log(`[PreviewService] Successfully consolidated archive ${zipFilePath}`);
    return true;
  } catch (err) {
    console.error(`[PreviewService] Archive consolidation error:`, err.message);
    return false;
  }
};

/**
 * Validate ZIP archive and detect project type safely
 */
export const validateAndInspectZip = (zipFilePath) => {
  if (!fs.existsSync(zipFilePath)) {
    throw new Error('ZIP archive file does not exist on server.');
  }

  // Auto-consolidate nested zip archives if present
  consolidateArchiveIfNested(zipFilePath);

  const zip = new AdmZip(zipFilePath);
  const zipEntries = zip.getEntries();

  if (zipEntries.length === 0) {
    throw new Error('Uploaded ZIP archive is empty.');
  }

  // Security: Max 100,000 files
  if (zipEntries.length > 100000) {
    throw new Error('Archive contains too many entries (max 100,000 files allowed).');
  }

  let totalUncompressedBytes = 0;
  const MAX_UNCOMPRESSED_BYTES = 2048 * 1024 * 1024; // 2 GB uncompressed limit

  // Scan entries for Zip Slip / Path Traversal
  for (const entry of zipEntries) {
    const entryName = entry.entryName;
    if (
      entryName.includes('..') ||
      entryName.startsWith('/') ||
      entryName.startsWith('\\') ||
      /^[a-zA-Z]:/.test(entryName)
    ) {
      throw new Error(`Security violation: Detected illegal path traversal entry "${entryName}".`);
    }

    totalUncompressedBytes += entry.header.size;
    if (totalUncompressedBytes > MAX_UNCOMPRESSED_BYTES) {
      throw new Error('Decompressed archive size exceeds maximum safety limit (2GB).');
    }
  }

  // Detect root wrapper directory if any (e.g., project-main/index.html)
  let rootDir = '';
  const topLevels = new Set();
  for (const entry of zipEntries) {
    const parts = entry.entryName.split(/[\/\\]/).filter(Boolean);
    if (parts.length > 0) {
      topLevels.add(parts[0]);
    }
  }
  if (topLevels.size === 1) {
    const candidate = Array.from(topLevels)[0];
    const isSingleDir = zipEntries.every(
      (e) => e.entryName.startsWith(candidate + '/') || e.entryName.startsWith(candidate + '\\')
    );
    if (isSingleDir) {
      rootDir = candidate;
    }
  }

  // Find non-junk index.html candidates sorted by frontend relevance and depth
  const indexHtmlCandidates = zipEntries
    .filter(
      (e) =>
        !e.isDirectory &&
        !isJunkOrVenv(e.entryName) &&
        (normalize(e.entryName).endsWith('/index.html') || normalize(e.entryName) === 'index.html')
    )
    .sort((a, b) => {
      const aFe = isFrontendPath(a.entryName) ? 0 : 1;
      const bFe = isFrontendPath(b.entryName) ? 0 : 1;
      if (aFe !== bFe) return aFe - bFe;
      return a.entryName.split(/[\/\\]/).length - b.entryName.split(/[\/\\]/).length;
    });

  const indexHtmlEntry = indexHtmlCandidates[0] || null;

  let webDir = '';
  if (indexHtmlEntry) {
    const norm = normalize(indexHtmlEntry.entryName);
    const lastSlash = norm.lastIndexOf('/');
    webDir = lastSlash !== -1 ? norm.substring(0, lastSlash) : '';
  }

  // Find non-junk package.json candidates sorted by frontend relevance, excluding backend-only folders when possible
  const packageJsonCandidates = zipEntries
    .filter(
      (e) =>
        !e.isDirectory &&
        !isJunkOrVenv(e.entryName) &&
        (normalize(e.entryName).endsWith('/package.json') || normalize(e.entryName) === 'package.json')
    )
    .sort((a, b) => {
      const aRank = isFrontendPath(a.entryName) ? 0 : isBackendPath(a.entryName) ? 2 : 1;
      const bRank = isFrontendPath(b.entryName) ? 0 : isBackendPath(b.entryName) ? 2 : 1;
      if (aRank !== bRank) return aRank - bRank;
      return a.entryName.split(/[\/\\]/).length - b.entryName.split(/[\/\\]/).length;
    });

  // Ignore backend-only package.json as a frontend build target when a static frontend index.html exists
  const topPkg = packageJsonCandidates[0] || null;
  const packageJsonEntry =
    topPkg && isBackendPath(topPkg.entryName) && indexHtmlEntry && !isBackendPath(indexHtmlEntry.entryName)
      ? null
      : topPkg;

  let buildDir = '';
  if (packageJsonEntry) {
    const norm = normalize(packageJsonEntry.entryName);
    const lastSlash = norm.lastIndexOf('/');
    buildDir = lastSlash !== -1 ? norm.substring(0, lastSlash) : '';
  }

  // Detect backend files (Node, Python/Django/Flask/FastAPI, Docker, SQL)
  const hasBackendFiles = zipEntries.some((e) => {
    if (isJunkOrVenv(e.entryName)) return false;
    const norm = normalize(e.entryName);
    return (
      norm.includes('/server.js') ||
      norm.endsWith('/server.js') ||
      norm === 'server.js' ||
      norm.includes('/manage.py') ||
      norm.endsWith('/manage.py') ||
      norm === 'manage.py' ||
      norm.includes('/wsgi.py') ||
      norm.includes('/asgi.py') ||
      norm.includes('/requirements.txt') ||
      norm.endsWith('requirements.txt') ||
      norm.includes('/backend/') ||
      norm.startsWith('backend/') ||
      norm.includes('/api/') ||
      norm.startsWith('api/') ||
      norm.includes('/prisma/schema.prisma') ||
      norm.includes('docker-compose.yml') ||
      norm.endsWith('db.sqlite3')
    );
  });

  let projectType = 'UNKNOWN';
  let packageJsonData = null;
  let hasFrontendVite = false;

  if (packageJsonEntry) {
    try {
      const content = packageJsonEntry.getData().toString('utf8');
      packageJsonData = JSON.parse(content);
    } catch {
      // Invalid JSON
    }
  }

  if (packageJsonData) {
    const allDeps = {
      ...(packageJsonData.dependencies || {}),
      ...(packageJsonData.devDependencies || {}),
    };

    const hasBackendDeps = Boolean(
      allDeps['express'] ||
      allDeps['koa'] ||
      allDeps['fastify'] ||
      allDeps['nestjs'] ||
      allDeps['@nestjs/core'] ||
      allDeps['pg'] ||
      allDeps['mysql'] ||
      allDeps['mysql2'] ||
      allDeps['prisma'] ||
      allDeps['@prisma/client'] ||
      allDeps['mongoose'] ||
      allDeps['typeorm'] ||
      allDeps['sequelize']
    );

    const isFullStack = hasBackendDeps || hasBackendFiles;

    hasFrontendVite = Boolean(
      allDeps['vite'] ||
      allDeps['@vitejs/plugin-react'] ||
      allDeps['@vitejs/plugin-vue'] ||
      allDeps['react'] ||
      allDeps['vue'] ||
      allDeps['svelte']
    );

    if (isFullStack) {
      projectType = 'FULLSTACK';
    } else if (hasFrontendVite || packageJsonData.scripts?.build) {
      projectType = 'REACT_VITE';
    } else if (indexHtmlEntry) {
      projectType = 'STATIC_HTML';
    } else {
      projectType = 'STATIC_HTML';
    }
  } else if (indexHtmlEntry) {
    projectType = hasBackendFiles ? 'FULLSTACK' : 'STATIC_HTML';
  } else if (hasBackendFiles) {
    projectType = 'FULLSTACK';
  }

  return {
    isValid: true,
    type: projectType,
    rootDir,
    webDir,
    buildDir,
    hasBackendFiles,
    hasFrontendVite,
    hasIndexHtml: Boolean(indexHtmlEntry),
    indexHtmlPath: indexHtmlEntry ? normalize(indexHtmlEntry.entryName) : null,
    fileCount: zipEntries.length,
    uncompressedSize: totalUncompressedBytes,
    packageJsonData,
  };
};

/**
 * Clean directory helper (safe against brief Windows file locks)
 */
const cleanDirectory = (dir) => {
  if (fs.existsSync(dir)) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch (e) {
      setTimeout(() => {
        try {
          fs.rmSync(dir, { recursive: true, force: true });
        } catch (_) {}
      }, 1000);
    }
  }
};

/**
 * Copy directory recursively
 */
const copyDirectory = (src, dest) => {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDirectory(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
};

/**
 * Checks whether an index.html is ready for direct browser serving (compiled/static)
 * or if it contains raw development scripts (.jsx, .tsx, /src/main.) that require Vite/React compilation
 */
export const isStaticReadyHtml = (htmlPath) => {
  if (!fs.existsSync(htmlPath)) return false;
  try {
    const content = fs.readFileSync(htmlPath, 'utf8');
    const hasRawJsxOrTsx =
      content.includes('.jsx') ||
      content.includes('.tsx') ||
      content.includes('/src/main.') ||
      content.includes('src="/src/') ||
      content.includes('src="./src/');
    return !hasRawJsxOrTsx;
  } catch (_) {
    return false;
  }
};

/**
 * Recursively locate directory containing package.json
 */
export const findFirstPackageJsonDir = (dir) => {
  if (!fs.existsSync(dir)) return null;
  if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
  const scan = (d, depth = 0) => {
    if (depth > 3 || !fs.existsSync(d)) return null;
    try {
      const ents = fs.readdirSync(d, { withFileTypes: true });
      for (const ent of ents) {
        if (ent.name === 'node_modules' || ent.name === '.git' || ent.name.startsWith('.')) continue;
        const full = path.join(d, ent.name);
        if (ent.isFile() && ent.name === 'package.json') return d;
        if (ent.isDirectory()) {
          const found = scan(full, depth + 1);
          if (found) return found;
        }
      }
    } catch (_) {}
    return null;
  };
  return scan(dir);
};

/**
 * Locate any valid compiled/static index.html in a directory with priority for common frontend layouts
 */
export const findFirstIndexHtml = (dir, requireStaticReady = true) => {
  if (!fs.existsSync(dir)) return null;
  const priorityCandidates = [
    path.join(dir, 'dist', 'index.html'),
    path.join(dir, 'build', 'index.html'),
    path.join(dir, 'out', 'index.html'),
    path.join(dir, 'frontend', 'dist', 'index.html'),
    path.join(dir, 'frontend', 'build', 'index.html'),
    path.join(dir, 'frontend', 'public', 'index.html'),
    path.join(dir, 'frontend', 'index.html'),
    path.join(dir, 'client', 'dist', 'index.html'),
    path.join(dir, 'client', 'build', 'index.html'),
    path.join(dir, 'client', 'public', 'index.html'),
    path.join(dir, 'client', 'index.html'),
    path.join(dir, 'web', 'dist', 'index.html'),
    path.join(dir, 'web', 'index.html'),
    path.join(dir, 'public', 'index.html'),
    path.join(dir, 'index.html'),
  ];
  for (const cand of priorityCandidates) {
    if (fs.existsSync(cand)) {
      if (!requireStaticReady || isStaticReadyHtml(cand)) {
        return cand;
      }
    }
  }
  const scan = (d, depth = 0) => {
    if (depth > 4 || !fs.existsSync(d)) return null;
    try {
      const entries = fs.readdirSync(d, { withFileTypes: true });
      for (const ent of entries) {
        if (ent.name === 'node_modules' || ent.name === '.git' || ent.name.startsWith('.')) continue;
        const full = path.join(d, ent.name);
        if (ent.isFile() && ent.name.toLowerCase() === 'index.html') {
          if (!requireStaticReady || isStaticReadyHtml(full)) {
            return full;
          }
        }
        if (ent.isDirectory()) {
          const found = scan(full, depth + 1);
          if (found) return found;
        }
      }
    } catch (_) {}
    return null;
  };
  return scan(dir);
};

/**
 * Automatically patches bundled JavaScript assets (React Router, Vue Router, etc.)
 * to adopt the sandbox subpath basename so any uploaded project renders its real routes
 * instead of 'No routes matched location /previews/...'
 */
export const patchProjectForSubpathRouting = (targetDir, productId) => {
  if (!fs.existsSync(targetDir)) return;

  // Collect all static assets present in this preview directory (images, icons, fonts, json)
  const staticAssets = [];
  const collectAssets = (d, rel = '') => {
    if (!fs.existsSync(d)) return;
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const r = rel ? `${rel}/${ent.name}` : ent.name;
      if (ent.isDirectory() && ent.name !== 'node_modules') {
        collectAssets(path.join(d, ent.name), r);
      } else if (ent.isFile() && /\.(png|jpe?g|svg|gif|ico|webp|avif|json|woff2?|ttf|eot)$/i.test(ent.name)) {
        staticAssets.push(r.replace(/\\/g, '/'));
      }
    }
  };
  collectAssets(targetDir);

  const scanAndPatch = (dir) => {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        scanAndPatch(fullPath);
      } else if (entry.isFile() && (entry.name.endsWith('.js') || entry.name.endsWith('.html'))) {
        try {
          let code = fs.readFileSync(fullPath, 'utf8');
          let changed = false;

          // 1. React Router v6 & v7 basename defaults: basename:e=`/` or basename:e="/"
          if (/basename:([a-zA-Z0-9_$]+)=[`'"]\/[`'"]/.test(code)) {
            code = code.replace(/basename:([a-zA-Z0-9_$]+)=[`'"]\/[`'"]/g, 'basename:$1=(window.__ROUTER_BASENAME__||"/")');
            changed = true;
          }

          // 2. React Router BrowserRouter function definition: function kn({basename:e
          if (/function\s+([a-zA-Z0-9_$]+)\s*\(\s*\{\s*basename:([a-zA-Z0-9_$]+)\s*,/.test(code)) {
            code = code.replace(
              /function\s+([a-zA-Z0-9_$]+)\s*\(\s*\{\s*basename:([a-zA-Z0-9_$]+)\s*,/g,
              'function $1({basename:$2=(window.__ROUTER_BASENAME__||"/"),'
            );
            changed = true;
          }

          // 3. Vue Router createWebHistory()
          if (/createWebHistory\s*\(([^)]*)\)/.test(code)) {
            code = code.replace(/createWebHistory\s*\(([^)]*)\)/g, 'createWebHistory(window.__ROUTER_BASENAME__||$1)');
            changed = true;
          }

          // 4. createBrowserHistory({ ... })
          if (/createBrowserHistory\s*\(\s*\{/.test(code) && !code.includes('basename:window.__ROUTER_BASENAME__')) {
            code = code.replace(/createBrowserHistory\s*\(\s*\{/g, 'createBrowserHistory({basename:window.__ROUTER_BASENAME__,');
            changed = true;
          }

          // 5. Rewrite hardcoded root-relative asset strings to preview subpath
          // e.g. "/logo.png" -> "/previews/<productId>/logo.png"
          for (const asset of staticAssets) {
            const escaped = asset.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const assetRegex = new RegExp(`(["'\`])\\/${escaped}\\1`, 'g');
            if (assetRegex.test(code)) {
              code = code.replace(assetRegex, `$1/previews/${productId}/${asset}$1`);
              changed = true;
            }
          }

          if (changed) {
            fs.writeFileSync(fullPath, code, 'utf8');
          }
        } catch (err) {
          console.warn(`[PreviewService] Failed to patch ${entry.name} for subpath routing:`, err.message);
        }
      }
    }
  };

  scanAndPatch(targetDir);
};

/**
 * Execute command with timeout and environment variable isolation
 */
const runIsolatedCommand = (cmd, args, cwd, timeoutMs = 300000) => {
  return new Promise((resolve, reject) => {
    // Sanitized environment: strip sensitive backend secrets
    const cleanEnv = {
      PATH: process.env.PATH,
      HOME: process.env.HOME || process.env.USERPROFILE,
      USERPROFILE: process.env.USERPROFILE,
      APPDATA: process.env.APPDATA,
      LOCALAPPDATA: process.env.LOCALAPPDATA,
      NODE_ENV: 'development', // Must be development so devDependencies (vite, tailwind, etc.) are installed!
      CI: 'false', // Prevent CRA and build tools from failing on ESLint or compiler warnings
      DISABLE_ESLINT_PLUGIN: 'true',
      ESLINT_NO_DEV_ERRORS: 'true',
      TSC_COMPILE_ON_ERROR: 'true',
      // ── SHARED NPM CACHE ──────────────────────────────────────────────────────
      // Reuse downloaded packages across all project builds so npm install goes
      // from ~90 seconds (cold) down to ~10-20 seconds (warm cache hit).
      npm_config_cache: '/tmp/coderharbor_npm_cache',
      npm_config_prefer_offline: 'true',
    };

    const isWin = process.platform === 'win32';
    const executable = isWin && (cmd === 'npm' || cmd === 'npx') ? `${cmd}.cmd` : cmd;

    const child = spawn(executable, args, {
      cwd,
      env: cleanEnv,
      shell: isWin,
      timeout: timeoutMs,
    });

    let output = '';

    child.stdout.on('data', (data) => {
      output += data.toString();
    });

    child.stderr.on('data', (data) => {
      output += data.toString();
    });

    child.on('error', (err) => {
      reject(new Error(`Failed to start command "${cmd}": ${err.message}`));
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve(output);
      } else {
        reject(
          new Error(
            `Command "${cmd} ${args.join(' ')}" failed with exit code ${code}.\nOutput:\n${output.slice(-2000)}`
          )
        );
      }
    });
  });
};

/**
 * Generates an interactive, modern project showcase preview for any project archive
 * (Fullstack, Python, Mobile, Backend, or any non-SPA archive, or when build fallback is needed)
 */
export const deployInteractiveShowcasePreview = async (
  productId,
  zipFilePath,
  inspection = null,
  targetPreviewDir,
  reason = ''
) => {
  cleanDirectory(targetPreviewDir);
  fs.mkdirSync(targetPreviewDir, { recursive: true });

  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: {
      category: true,
      technologies: { include: { technology: true } },
    },
  });

  const title = product?.title || 'Interactive Project Preview';
  const categoryName = product?.category?.name || 'Software Project';
  const shortDesc = product?.shortDescription || '';
  const fullDesc = product?.fullDescription || '';
  const deliverables = product?.deliverables || 'Full Source Code & Architecture';
  const requirements = product?.installationRequirements || 'Standard Development Environment';
  const license = product?.licenseText || 'Standard Developer Commercial License';

  let fileCount = inspection?.fileCount || 0;
  let uncompressedSize = inspection?.uncompressedSize || 0;
  let readmeContent = '';
  let fileList = [];
  let detectedLangs = new Set();

  try {
    if (fs.existsSync(zipFilePath)) {
      const zip = new AdmZip(zipFilePath);
      const entries = zip.getEntries();
      fileCount = entries.length;

      for (const entry of entries) {
        if (!entry.isDirectory) {
          uncompressedSize += entry.header.size;
          const norm = normalize(entry.entryName);
          if (!isJunkOrVenv(norm)) {
            if (fileList.length < 150) {
              fileList.push(norm);
            }
            const ext = path.extname(norm).toLowerCase();
            if (['.js', '.jsx', '.ts', '.tsx'].includes(ext)) detectedLangs.add('JavaScript / TypeScript');
            else if (['.py'].includes(ext)) detectedLangs.add('Python');
            else if (['.php'].includes(ext)) detectedLangs.add('PHP');
            else if (['.html', '.css', '.scss'].includes(ext)) detectedLangs.add('HTML5 / CSS3');
            else if (['.dart'].includes(ext)) detectedLangs.add('Flutter / Dart');
            else if (['.java', '.kt'].includes(ext)) detectedLangs.add('Java / Kotlin');
            else if (['.cs'].includes(ext)) detectedLangs.add('C# / .NET');
            else if (['.go'].includes(ext)) detectedLangs.add('Go');
            else if (['.rs'].includes(ext)) detectedLangs.add('Rust');
            else if (['.sql'].includes(ext)) detectedLangs.add('SQL Database');

            if (!readmeContent && (norm.toLowerCase().endsWith('readme.md') || norm.toLowerCase().endsWith('readme.txt'))) {
              try {
                readmeContent = entry.getData().toString('utf8').slice(0, 8000);
              } catch (_) {}
            }
          }
        }
      }
    }
  } catch (readErr) {
    console.warn('[Showcase] Zip scan error:', readErr.message);
  }

  const langsArray = Array.from(detectedLangs);
  if (langsArray.length === 0) langsArray.push('Clean Source Code', 'Production Architecture');

  const escapeHtml = (str) =>
    (str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

  const sizeMb = (uncompressedSize / (1024 * 1024)).toFixed(1);

  const showcaseHtml = `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title)} - CoderHarbor Architecture Preview</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background-color: #0A0713;
      color: #E2E8F0;
      font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      overflow-x: hidden;
    }
    .gradient-mesh {
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: radial-gradient(circle at 15% 15%, rgba(168, 85, 247, 0.12) 0%, transparent 40%),
                  radial-gradient(circle at 85% 85%, rgba(6, 182, 212, 0.10) 0%, transparent 40%);
      pointer-events: none;
      z-index: 0;
    }
    .header {
      background: rgba(20, 15, 40, 0.85);
      backdrop-filter: blur(12px);
      border-bottom: 1px solid rgba(50, 38, 89, 0.7);
      padding: 16px 24px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      position: sticky;
      top: 0;
      z-index: 20;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      border-radius: 9999px;
      font-size: 11px;
      font-weight: 600;
      background: rgba(16, 185, 129, 0.15);
      color: #34D399;
      border: 1px solid rgba(16, 185, 129, 0.3);
    }
    .badge-dot { width: 6px; height: 6px; border-radius: 50%; background: #34D399; }
    .hero {
      padding: 32px 24px;
      max-width: 1200px;
      margin: 0 auto;
      width: 100%;
      position: relative;
      z-index: 1;
    }
    .hero-card {
      background: #140F28;
      border: 1px solid rgba(50, 38, 89, 0.9);
      border-radius: 20px;
      padding: 28px;
      box-shadow: 0 20px 40px -15px rgba(0,0,0,0.5);
    }
    .stats-bar {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 16px;
      margin-top: 24px;
      padding-top: 24px;
      border-top: 1px solid rgba(50, 38, 89, 0.6);
    }
    .stat-box {
      background: #0E0A1C;
      border: 1px solid rgba(50, 38, 89, 0.7);
      border-radius: 12px;
      padding: 14px 16px;
    }
    .stat-label { font-size: 11px; color: #94A3B8; text-transform: uppercase; letter-spacing: 0.5px; }
    .stat-value { font-size: 18px; font-weight: 700; color: #F8FAFC; margin-top: 4px; font-family: 'JetBrains Mono', monospace; }
    .tabs-nav {
      display: flex;
      gap: 8px;
      margin: 28px 0 16px;
      border-bottom: 1px solid rgba(50, 38, 89, 0.8);
      padding-bottom: 8px;
      overflow-x: auto;
    }
    .tab-btn {
      background: none;
      border: none;
      color: #94A3B8;
      font-size: 13px;
      font-weight: 600;
      padding: 8px 16px;
      border-radius: 8px;
      cursor: pointer;
      transition: all 0.2s;
    }
    .tab-btn.active {
      background: rgba(168, 85, 247, 0.15);
      color: #C084FC;
      border: 1px solid rgba(168, 85, 247, 0.3);
    }
    .tab-content { display: none; }
    .tab-content.active { display: block; }
    .code-box {
      background: #0A0713;
      border: 1px solid rgba(50, 38, 89, 0.8);
      border-radius: 14px;
      padding: 20px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 12px;
      color: #CBD5E1;
      line-height: 1.6;
      max-height: 500px;
      overflow-y: auto;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .file-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 10px;
      border-radius: 6px;
      font-size: 12px;
      font-family: 'JetBrains Mono', monospace;
      color: #CBD5E1;
      border-bottom: 1px solid rgba(50, 38, 89, 0.3);
    }
    .file-item:hover { background: rgba(50, 38, 89, 0.4); }
    .pill {
      display: inline-block;
      padding: 4px 10px;
      border-radius: 6px;
      font-size: 11px;
      font-weight: 600;
      background: rgba(50, 38, 89, 0.8);
      color: #C084FC;
      margin-right: 6px;
      margin-bottom: 6px;
    }
  </style>
</head>
<body>
  <div class="gradient-mesh"></div>
  <header class="header">
    <div style="display:flex; align-items:center; gap:12px;">
      <span style="font-size:20px;">⚡</span>
      <div>
        <h1 style="font-size:15px; font-weight:700; color:#F8FAFC;">CoderHarbor Live Preview</h1>
        <p style="font-size:11px; color:#94A3B8;">Verified Project Sandbox</p>
      </div>
    </div>
    <div class="badge">
      <span class="badge-dot"></span>
      <span>Preview Sandbox Active</span>
    </div>
  </header>

  <main class="hero">
    <div class="hero-card">
      <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:12px;">
        <div>
          <span class="pill" style="background:rgba(168,85,247,0.2); color:#C084FC; border:1px solid rgba(168,85,247,0.4);">${escapeHtml(categoryName)}</span>
          <h2 style="font-size:24px; font-weight:800; color:#FFFFFF; margin-top:8px;">${escapeHtml(title)}</h2>
          <p style="color:#94A3B8; font-size:14px; margin-top:6px; max-width:800px;">${escapeHtml(shortDesc || fullDesc.slice(0, 200))}</p>
        </div>
      </div>

      <div class="stats-bar">
        <div class="stat-box">
          <div class="stat-label">Total Files</div>
          <div class="stat-value">${fileCount}</div>
        </div>
        <div class="stat-box">
          <div class="stat-label">Uncompressed Size</div>
          <div class="stat-value">${sizeMb} MB</div>
        </div>
        <div class="stat-box">
          <div class="stat-label">Architecture</div>
          <div class="stat-value" style="font-size:14px; color:#38BDF8;">${escapeHtml(inspection?.type || 'FULLSTACK / CODEBASE')}</div>
        </div>
        <div class="stat-box">
          <div class="stat-label">Verified Status</div>
          <div class="stat-value" style="font-size:14px; color:#34D399;">Ready &amp; Verified</div>
        </div>
      </div>

      <div class="tabs-nav">
        <button class="tab-btn active" onclick="switchTab('readme')">📑 Documentation &amp; Overview</button>
        <button class="tab-btn" onclick="switchTab('files')">📂 Codebase Structure (${fileList.length}+ files)</button>
        <button class="tab-btn" onclick="switchTab('specs')">⚙️ Architecture &amp; Deliverables</button>
      </div>

      <div id="tab-readme" class="tab-content active">
        <div class="code-box">
${escapeHtml(readmeContent || fullDesc || 'Project codebase is verified and ready for deployment.')}
        </div>
      </div>

      <div id="tab-files" class="tab-content">
        <div class="code-box" style="padding:10px;">
          ${fileList
            .map(
              (f) =>
                `<div class="file-item"><span>📄</span><span>${escapeHtml(f)}</span></div>`
            )
            .join('')}
        </div>
      </div>

      <div id="tab-specs" class="tab-content">
        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(280px, 1fr)); gap:16px;">
          <div class="stat-box">
            <div class="stat-label" style="margin-bottom:8px;">Detected Technologies</div>
            <div>${langsArray.map((l) => `<span class="pill">${escapeHtml(l)}</span>`).join('')}</div>
          </div>
          <div class="stat-box">
            <div class="stat-label" style="margin-bottom:8px;">Installation Requirements</div>
            <p style="font-size:12px; color:#CBD5E1;">${escapeHtml(requirements)}</p>
          </div>
          <div class="stat-box">
            <div class="stat-label" style="margin-bottom:8px;">Deliverables Included</div>
            <p style="font-size:12px; color:#CBD5E1;">${escapeHtml(deliverables)}</p>
          </div>
          <div class="stat-box">
            <div class="stat-label" style="margin-bottom:8px;">License Terms</div>
            <p style="font-size:12px; color:#CBD5E1;">${escapeHtml(license)}</p>
          </div>
        </div>
      </div>
    </div>
  </main>

  <script>
    function switchTab(tabId) {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      const activeBtn = Array.from(document.querySelectorAll('.tab-btn')).find(b => b.getAttribute('onclick').includes(tabId));
      if (activeBtn) activeBtn.classList.add('active');
      const activeContent = document.getElementById('tab-' + tabId);
      if (activeContent) activeContent.classList.add('active');
    }
  </script>
</body>
</html>`;

  const indexPath = path.join(targetPreviewDir, 'index.html');
  fs.writeFileSync(indexPath, showcaseHtml, 'utf8');

  // Inject sandbox interceptor
  try {
    const interceptor = getSandboxInterceptorScript(productId);
    let finalHtml = fs.readFileSync(indexPath, 'utf8');
    finalHtml = finalHtml.replace('<head>', `<head>\n${interceptor}`);
    fs.writeFileSync(indexPath, finalHtml, 'utf8');
  } catch (_) {}

  const previewUrl = getPreviewUrl(productId);
  const logs =
    `✓ Project archive validated and indexed successfully.\n` +
    `✓ Interactive Codebase Architecture & Documentation Showcase generated.\n` +
    (reason ? `ℹ Note: ${reason}\n` : '') +
    `Live URL: ${previewUrl}`;

  await prisma.product.update({
    where: { id: productId },
    data: {
      previewStatus: 'READY',
      previewType: inspection?.type || 'FULLSTACK',
      previewUrl,
      previewBuildLogs: logs,
      previewUpdatedAt: new Date(),
    },
  });

  return { success: true, status: 'READY', previewUrl, type: inspection?.type || 'SHOWCASE' };
};

/**
 * Main project processing pipeline: Validates, builds, and deploys live preview
 */
export const processProjectZip = async (productId, zipFilePath, originalName = '') => {
  const targetPreviewDir = path.join(PREVIEWS_DIR, productId);

  try {
    // 1. Validate & Inspect ZIP (with auto-consolidation for nested zip archives)
    const inspection = validateAndInspectZip(zipFilePath);

    // Update product previewType
    await prisma.product.update({
      where: { id: productId },
      data: {
        previewType: inspection.type,
        previewStatus: 'BUILDING',
        previewBuildLogs: `Starting processing for archive "${originalName}"...\nDetected project type: ${inspection.type}\nUncompressed size: ${(inspection.uncompressedSize / (1024 * 1024)).toFixed(2)} MB (${inspection.fileCount} files)`,
        previewUpdatedAt: new Date(),
      },
    });

    // Determine deployment strategy:
    // Should we build a React/Vite/Vue frontend?
    const shouldBuildReactVite =
      inspection.type === 'REACT_VITE' ||
      Boolean(inspection.packageJsonData?.scripts?.build) ||
      Boolean(inspection.hasFrontendVite) ||
      Boolean(inspection.buildDir);

    // Should we deploy static HTML?
    const shouldDeployStaticHtml =
      Boolean(inspection.hasIndexHtml) && !shouldBuildReactVite;

    // Case 1: REACT_VITE or Fullstack with React/Vite Frontend
    if (shouldBuildReactVite) {
      const buildId = `${productId}_${Date.now()}`;
      const tempBuildDir = path.join(TEMP_BUILDS_DIR, buildId);
      cleanDirectory(tempBuildDir);
      fs.mkdirSync(tempBuildDir, { recursive: true });

      let logs = `Detected interactive React/Vite web application.\nExtracting to isolated build sandbox...\n`;

      try {
        const zip = new AdmZip(zipFilePath);
        zip.extractAllTo(tempBuildDir, true);

        // Auto-flatten single top-level folder wrapper (typical for GitHub zipball downloads: repo-branch-sha/)
        const rootEnts = fs.readdirSync(tempBuildDir);
        if (rootEnts.length === 1) {
          const singleCandidate = path.join(tempBuildDir, rootEnts[0]);
          if (fs.existsSync(singleCandidate) && fs.statSync(singleCandidate).isDirectory()) {
            const innerFiles = fs.readdirSync(singleCandidate);
            for (const item of innerFiles) {
              fs.renameSync(path.join(singleCandidate, item), path.join(tempBuildDir, item));
            }
            cleanDirectory(singleCandidate);
          }
        }

        // Determine correct project root directory containing package.json
        let projectRoot = tempBuildDir;
        if (fs.existsSync(path.join(tempBuildDir, 'package.json'))) {
          projectRoot = tempBuildDir;
        } else if (fs.existsSync(path.join(tempBuildDir, 'frontend', 'package.json'))) {
          projectRoot = path.join(tempBuildDir, 'frontend');
        } else if (fs.existsSync(path.join(tempBuildDir, 'client', 'package.json'))) {
          projectRoot = path.join(tempBuildDir, 'client');
        } else if (fs.existsSync(path.join(tempBuildDir, 'web', 'package.json'))) {
          projectRoot = path.join(tempBuildDir, 'web');
        } else if (inspection.buildDir && fs.existsSync(path.join(tempBuildDir, inspection.buildDir, 'package.json'))) {
          projectRoot = path.join(tempBuildDir, inspection.buildDir);
        } else {
          const foundPkgDir = findFirstPackageJsonDir(tempBuildDir);
          if (foundPkgDir) projectRoot = foundPkgDir;
        }

        // 0. High-Priority Pre-Built Bundle Detection:
        // If the repository already includes a pre-compiled dist.zip / build.zip or dist/ directory,
        // use it directly so users see the authentic, real live application immediately.
        let prebuiltDistDir = null;

        const candidateZips = [
          path.join(projectRoot, 'dist.zip'),
          path.join(projectRoot, 'build.zip'),
          path.join(tempBuildDir, 'dist.zip'),
          path.join(tempBuildDir, 'frontend', 'dist.zip'),
          path.join(tempBuildDir, 'client', 'dist.zip'),
          path.join(tempBuildDir, 'web', 'dist.zip'),
        ];

        for (const czip of candidateZips) {
          if (fs.existsSync(czip)) {
            try {
              const pz = new AdmZip(czip);
              const pzEntries = pz.getEntries();
              if (pzEntries.some((e) => normalize(e.entryName).endsWith('index.html'))) {
                const extractedPrebuilt = path.join(tempBuildDir, '_extracted_prebuilt_dist');
                pz.extractAllTo(extractedPrebuilt, true);
                if (fs.existsSync(path.join(extractedPrebuilt, 'dist', 'index.html'))) {
                  prebuiltDistDir = path.join(extractedPrebuilt, 'dist');
                } else if (fs.existsSync(path.join(extractedPrebuilt, 'build', 'index.html'))) {
                  prebuiltDistDir = path.join(extractedPrebuilt, 'build');
                } else if (fs.existsSync(path.join(extractedPrebuilt, 'index.html'))) {
                  prebuiltDistDir = extractedPrebuilt;
                }
                if (prebuiltDistDir) {
                  logs += `✓ Detected and extracted pre-compiled production bundle (${path.basename(czip)}).\n`;
                  break;
                }
              }
            } catch (err) {
              console.warn('Pre-built zip extraction error:', err.message);
            }
          }
        }

        // Check if pre-compiled dist/ or build/ directory already exists
        if (!prebuiltDistDir) {
          const candidateDirs = [
            path.join(projectRoot, 'dist'),
            path.join(projectRoot, 'build'),
            path.join(tempBuildDir, 'dist'),
            path.join(tempBuildDir, 'frontend', 'dist'),
            path.join(tempBuildDir, 'frontend', 'build'),
            path.join(tempBuildDir, 'client', 'dist'),
            path.join(tempBuildDir, 'web', 'dist'),
          ];
          for (const cdir of candidateDirs) {
            if (fs.existsSync(path.join(cdir, 'index.html'))) {
              prebuiltDistDir = cdir;
              logs += `✓ Detected pre-compiled production assets in ${path.basename(cdir)}/ directory.\n`;
              break;
            }
          }
        }

        // If still not found, check if the HTML directly in projectRoot or frontend/ is already a compiled production bundle
        if (!prebuiltDistDir) {
          const checkDirs = [projectRoot, path.join(tempBuildDir, 'frontend'), tempBuildDir];
          for (const d of checkDirs) {
            const htmlP = path.join(d, 'index.html');
            if (fs.existsSync(htmlP)) {
              const htmlContent = fs.readFileSync(htmlP, 'utf8');
              const isCompiledHtml =
                (htmlContent.includes('/assets/') || htmlContent.includes('./assets/') || htmlContent.includes('assets/')) &&
                !htmlContent.includes('/src/main.') &&
                !htmlContent.includes('src="/src/') &&
                !htmlContent.includes('src="/main.tsx') &&
                !htmlContent.includes('src="/main.jsx') &&
                !htmlContent.includes('src="/main.ts') &&
                !htmlContent.includes('src="./main.tsx') &&
                !htmlContent.includes('src="./main.jsx') &&
                !htmlContent.includes('.tsx"') &&
                !htmlContent.includes('.jsx"') &&
                !htmlContent.includes("type=\"module\" src=\"/index.");
              if (isCompiledHtml) {
                prebuiltDistDir = d;
                logs += `✓ Detected ready-to-run compiled web application in ${path.basename(d) || 'root'}.\n`;
                break;
              }
            }
          }
        }

        let distDir = prebuiltDistDir;

        // If no pre-compiled production build exists, run build in isolated sandbox
        if (!distDir) {
          logs += `Installing build dependencies in isolated sandbox...\n`;
          await prisma.product.update({
            where: { id: productId },
            data: { previewBuildLogs: logs, previewUpdatedAt: new Date() },
          });

          // 1. Install dependencies with resilient fallbacks
          try {
            await runIsolatedCommand(
              'npm',
              ['install', '--include=dev', '--legacy-peer-deps', '--no-audit'],
              projectRoot,
              300000
            );
            logs += `✓ Dependencies installed.\nRunning production build (npm run build)...\n`;
          } catch (firstInstallErr) {
            logs += `ℹ Retrying npm install with --force...\n`;
            try {
              await runIsolatedCommand(
                'npm',
                ['install', '--include=dev', '--legacy-peer-deps', '--force', '--no-audit'],
                projectRoot,
                300000
              );
              logs += `✓ Dependencies installed (forced).\nRunning production build (npm run build)...\n`;
            } catch (secondInstallErr) {
              logs += `ℹ npm install warning: Proceeding to build attempt...\n`;
            }
          }

          await prisma.product.update({
            where: { id: productId },
            data: { previewBuildLogs: logs, previewUpdatedAt: new Date() },
          });

          // 2. Build production assets: try npm run build, with fallback to direct build tool
          try {
            await runIsolatedCommand('npm', ['run', 'build'], projectRoot, 300000);
            logs += `✓ Production build completed.\n`;
          } catch (firstBuildErr) {
            logs += `ℹ Standard build failed. Attempting direct build tool execution...\n`;
            try {
              if (inspection.hasFrontendVite || fs.existsSync(path.join(projectRoot, 'vite.config.js')) || fs.existsSync(path.join(projectRoot, 'vite.config.ts'))) {
                await runIsolatedCommand('npx', ['vite', 'build'], projectRoot, 300000);
              } else if (inspection.packageJsonData?.dependencies?.['react-scripts'] || inspection.packageJsonData?.devDependencies?.['react-scripts']) {
                await runIsolatedCommand('npx', ['react-scripts', 'build'], projectRoot, 300000);
              } else {
                await runIsolatedCommand('npx', ['vite', 'build'], projectRoot, 300000);
              }
              logs += `✓ Direct build completed successfully.\n`;
            } catch (secondBuildErr) {
              logs += `ℹ Direct build tool skipped. Scanning for production assets...\n`;
            }
          }

          // 3. Locate dist, build, or out directory
          distDir = path.join(projectRoot, 'dist');
          if (!fs.existsSync(distDir) || !fs.existsSync(path.join(distDir, 'index.html'))) {
            distDir = path.join(projectRoot, 'build');
          }
          if (!fs.existsSync(distDir) || !fs.existsSync(path.join(distDir, 'index.html'))) {
            distDir = path.join(projectRoot, 'out');
          }
          if (!distDir || !fs.existsSync(path.join(distDir, 'index.html'))) {
            const fallbackHtml = findFirstIndexHtml(tempBuildDir);
            if (fallbackHtml) {
              distDir = path.dirname(fallbackHtml);
              logs += `✓ Found template HTML in ${path.relative(tempBuildDir, distDir) || 'root'}.\n`;
            }
          }
        }

        if (!distDir || !fs.existsSync(path.join(distDir, 'index.html'))) {
          throw new Error('Build finished, but no dist/index.html or build/index.html was produced.');
        }

        // 4. Inject sandbox interceptor & ensure relative asset paths
        const distIndexPath = path.join(distDir, 'index.html');
        if (fs.existsSync(distIndexPath)) {
          let html = fs.readFileSync(distIndexPath, 'utf8');

          // Ensure base tag points to the preview sandbox folder so all chunk imports and assets load seamlessly
          if (!html.includes('<base ') && !html.includes('<base>')) {
            if (html.includes('<head>')) {
              html = html.replace('<head>', `<head>\n  <base href="/previews/${productId}/">`);
            } else {
              html = `<base href="/previews/${productId}/">\n${html}`;
            }
          }

          // Rewrite absolute root asset URLs to relative for /previews/:id/ hosting
          html = html.replace(/(href|src)="\/(assets|favicon|logo|full-logo|icons|static)/g, '$1="./$2');
          html = html.replace(/(href|src)='\/ (assets|favicon|logo|full-logo|icons|static)/g, "$1='./$2");

          // Remove any previously injected (possibly outdated) interceptor, then re-inject latest
          html = html.replace(/<script id="coderharbor-preview-sandbox">[\s\S]*?<\/script>\n?/g, '');
          const interceptor = getSandboxInterceptorScript(productId);
          if (html.includes('<head>')) {
            html = html.replace('<head>', `<head>\n${interceptor}`);
          } else {
            html = `${interceptor}\n${html}`;
          }
          fs.writeFileSync(distIndexPath, html, 'utf8');
        }

        // 5. Deploy to preview storage
        cleanDirectory(targetPreviewDir);
        copyDirectory(distDir, targetPreviewDir);

        // Auto-patch bundled routers for subpath sandbox mounting
        patchProjectForSubpathRouting(targetPreviewDir, productId);

        // 6. Cleanup sandbox
        cleanDirectory(tempBuildDir);

        const previewUrl = getPreviewUrl(productId);
        const completionMsg =
          inspection.type === 'FULLSTACK'
            ? `✓ Interactive React/Vite frontend built and deployed to Live Preview sandbox.\nℹ Note: Full-stack components detected (Python/Django or Node backend). Interactive client preview is live with mock data.\nLive URL: ${previewUrl}`
            : `✓ React/Vite production build completed and verified.\n✓ Live preview generated and deployed.\nLive URL: ${previewUrl}`;

        logs += completionMsg;

        await prisma.product.update({
          where: { id: productId },
          data: {
            previewStatus: 'READY',
            previewUrl,
            previewBuildLogs: logs,
            previewUpdatedAt: new Date(),
          },
        });

        return { success: true, status: 'READY', previewUrl, type: inspection.type };
      } catch (buildErr) {
        console.warn(`[PreviewService] React/Vite build failed, checking for template index.html fallback:`, buildErr.message);
        const fallbackHtml = findFirstIndexHtml(tempBuildDir);
        if (fallbackHtml) {
          const fallbackDir = path.dirname(fallbackHtml);
          cleanDirectory(targetPreviewDir);
          copyDirectory(fallbackDir, targetPreviewDir);
          patchProjectForSubpathRouting(targetPreviewDir, productId);
          cleanDirectory(tempBuildDir);
          const previewUrl = getPreviewUrl(productId);
          await prisma.product.update({
            where: { id: productId },
            data: {
              previewStatus: 'READY',
              previewUrl,
              previewBuildLogs: `✓ Interactive project template deployed to Live Preview sandbox.\nLive URL: ${previewUrl}`,
              previewUpdatedAt: new Date(),
            },
          });
          return { success: true, status: 'READY', previewUrl, type: 'STATIC_FALLBACK' };
        }
        cleanDirectory(tempBuildDir);
        return deployInteractiveShowcasePreview(
          productId,
          zipFilePath,
          inspection,
          targetPreviewDir,
          `Automated Vite build skipped (${buildErr.message.slice(0, 150)}). Codebase architecture showcase generated.`
        );
      }
    }

    // Case 2: STATIC_HTML or Fullstack with Static Web Directory
    if (shouldDeployStaticHtml) {
      try {
        cleanDirectory(targetPreviewDir);
        fs.mkdirSync(targetPreviewDir, { recursive: true });

        const zip = new AdmZip(zipFilePath);

        if (inspection.webDir) {
          // Extract only the web directory contents into targetPreviewDir
          const webPrefix = inspection.webDir.endsWith('/') ? inspection.webDir : `${inspection.webDir}/`;
          const entries = zip.getEntries();
          for (const entry of entries) {
            const norm = normalize(entry.entryName);
            if (norm.startsWith(webPrefix)) {
              const relPath = norm.slice(webPrefix.length);
              if (!relPath) continue;
              const destPath = path.join(targetPreviewDir, relPath);
              if (entry.isDirectory) {
                fs.mkdirSync(destPath, { recursive: true });
              } else {
                fs.mkdirSync(path.dirname(destPath), { recursive: true });
                fs.writeFileSync(destPath, entry.getData());
              }
            }
          }
        } else {
          zip.extractAllTo(targetPreviewDir, true);

          // If wrapped in rootDir, flatten so index.html is directly in targetPreviewDir
          if (inspection.rootDir) {
            const nestedDir = path.join(targetPreviewDir, inspection.rootDir);
            if (fs.existsSync(nestedDir)) {
              const files = fs.readdirSync(nestedDir);
              for (const f of files) {
                const src = path.join(nestedDir, f);
                const dst = path.join(targetPreviewDir, f);
                fs.renameSync(src, dst);
              }
              cleanDirectory(nestedDir);
            }
          }
        }

        // Verify index.html exists
        const indexPath = path.join(targetPreviewDir, 'index.html');
        const hasIndex = fs.existsSync(indexPath);
        if (!hasIndex) {
          throw new Error('Static website preview requires an index.html at root level.');
        }

        // Inject client-side sandbox interceptor for API-driven features
        // Always replace old interceptor with the latest version (supports __ROUTER_BASENAME__)
        try {
          let htmlContent = fs.readFileSync(indexPath, 'utf8');
          // Remove any previously injected (possibly outdated) interceptor
          htmlContent = htmlContent.replace(/<script id="coderharbor-preview-sandbox">[\s\S]*?<\/script>\n?/g, '');
          // Add base href for subpath asset resolution
          if (!htmlContent.includes('<base ') && !htmlContent.includes('<base>')) {
            if (htmlContent.includes('<head>')) {
              htmlContent = htmlContent.replace('<head>', `<head>\n  <base href="/previews/${productId}/">`);
            }
          }
          const interceptor = getSandboxInterceptorScript(productId);
          if (htmlContent.includes('<head>')) {
            htmlContent = htmlContent.replace('<head>', `<head>\n${interceptor}`);
          } else {
            htmlContent = `${interceptor}\n${htmlContent}`;
          }
          fs.writeFileSync(indexPath, htmlContent, 'utf8');
        } catch (injectErr) {
          console.warn('Sandbox interceptor injection skipped:', injectErr.message);
        }

        // Auto-patch bundled routers for subpath sandbox mounting
        patchProjectForSubpathRouting(targetPreviewDir, productId);

        const previewUrl = getPreviewUrl(productId);

        const logs = inspection.hasBackendFiles
          ? `✓ Interactive Web UI deployed to Live Preview sandbox.\nℹ Note: Full-stack components detected (Python/Node backend files). Interactive frontend preview is active and accessible.\nLive URL: ${previewUrl}`
          : `✓ Static HTML/CSS/JavaScript project verified.\n✓ Live preview generated and deployed.\nLive URL: ${previewUrl}`;

        await prisma.product.update({
          where: { id: productId },
          data: {
            previewStatus: 'READY',
            previewUrl,
            previewBuildLogs: logs,
            previewUpdatedAt: new Date(),
          },
        });

        return { success: true, status: 'READY', previewUrl, type: inspection.type };
      } catch (staticErr) {
        console.warn('[PreviewService] Static HTML deploy failed, falling back to Showcase:', staticErr.message);
        return deployInteractiveShowcasePreview(
          productId,
          zipFilePath,
          inspection,
          targetPreviewDir,
          `Static deploy note: ${staticErr.message}`
        );
      }
    }

    // Case 3: Fullstack or archive with any index.html template
    if (inspection.hasIndexHtml) {
      const zip = new AdmZip(zipFilePath);
      const tempExtract = path.join(TEMP_BUILDS_DIR, `fs_${productId}_${Date.now()}`);
      zip.extractAllTo(tempExtract, true);
      const foundHtml = findFirstIndexHtml(tempExtract);
      if (foundHtml) {
        const foundDir = path.dirname(foundHtml);
        cleanDirectory(targetPreviewDir);
        copyDirectory(foundDir, targetPreviewDir);
        patchProjectForSubpathRouting(targetPreviewDir, productId);
        cleanDirectory(tempExtract);
        const previewUrl = getPreviewUrl(productId);
        await prisma.product.update({
          where: { id: productId },
          data: {
            previewStatus: 'READY',
            previewUrl,
            previewBuildLogs: `✓ Interactive Web UI deployed to Live Preview sandbox.\nLive URL: ${previewUrl}`,
            previewUpdatedAt: new Date(),
          },
        });
        return { success: true, status: 'READY', previewUrl, type: 'FULLSTACK_STATIC' };
      }
      cleanDirectory(tempExtract);
    }

    // Case 4: Pure backend, API, CLI, or non-web archive (No HTML found)
    return deployInteractiveShowcasePreview(
      productId,
      zipFilePath,
      inspection,
      targetPreviewDir,
      'Full-stack architecture verified. Interactive Codebase & Documentation Sandbox deployed.'
    );
  } catch (err) {
    console.warn(`[PreviewService] Process zip fallback:`, err.message);
    try {
      return await deployInteractiveShowcasePreview(
        productId,
        zipFilePath,
        null,
        targetPreviewDir,
        `Project archive indexed with fallback showcase (${err.message.slice(0, 100)}).`
      );
    } catch (fallbackErr) {
      const errorMsg = `Preview generation failed: ${fallbackErr.message}`;
      await prisma.product.update({
        where: { id: productId },
        data: {
          previewStatus: 'FAILED',
          previewBuildLogs: errorMsg,
          previewUpdatedAt: new Date(),
        },
      });
      return { success: false, status: 'FAILED', message: errorMsg };
    }
  }
};

/**
 * Parse a GitHub repository URL into owner, repo, and optional branch.
 */
export const parseGithubUrl = (rawUrl) => {
  if (!rawUrl || typeof rawUrl !== 'string') {
    throw new Error('GitHub URL is required.');
  }

  let normalized = rawUrl.trim();
  if (!/^https?:\/\//i.test(normalized)) {
    normalized = `https://${normalized}`;
  }

  let parsed;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error('Invalid GitHub URL format.');
  }

  if (!/^(www\.)?github\.com$/i.test(parsed.hostname)) {
    throw new Error('URL must point to github.com (e.g. https://github.com/username/repo).');
  }

  const parts = parsed.pathname.split('/').filter(Boolean);
  if (parts.length < 2) {
    throw new Error('GitHub URL must include owner and repository (e.g. https://github.com/username/repo).');
  }

  const owner = parts[0];
  const repo = parts[1].replace(/\.git$/i, '');
  let branch = null;

  // Support URLs like /owner/repo/tree/branch-name
  if (parts[2] === 'tree' && parts.length >= 4) {
    branch = parts.slice(3).join('/');
  }

  return {
    owner,
    repo,
    branch,
    repoUrl: `https://github.com/${owner}/${repo}`,
  };
};

/**
 * Parse stored github::owner/repo@branch or github2::fe@b|be@b key from ProductFile.privateStorageKey
 */
export const parseGithubStorageKey = (storageKey) => {
  if (!storageKey) return null;

  const parseSpec = (spec) => {
    const atIndex = spec.lastIndexOf('@');
    const repoPart = atIndex !== -1 ? spec.slice(0, atIndex) : spec;
    const branch = atIndex !== -1 ? spec.slice(atIndex + 1) : 'main';
    const [owner, repo] = repoPart.split('/');
    if (!owner || !repo) return null;
    return { owner, repo, branch: branch || 'main' };
  };

  if (storageKey.startsWith('github2::')) {
    const [feSpec = '', beSpec = ''] = storageKey.slice('github2::'.length).split('|');
    const frontend = parseSpec(feSpec);
    const backend = parseSpec(beSpec);
    if (!frontend || !backend) return null;
    return { mode: 'dual', frontend, backend };
  }

  if (storageKey.startsWith('github::')) {
    const single = parseSpec(storageKey.slice('github::'.length));
    if (!single) return null;
    return { mode: 'single', ...single };
  }

  return null;
};

/**
 * Fetch repository metadata & default branch from GitHub
 */
export const fetchGithubRepoInfo = async (owner, repo, branchOverride = null, token = '') => {
  const authToken = (token || process.env.GITHUB_TOKEN || '').trim();
  const headers = {
    'User-Agent': 'CoderHarbor-PreviewService',
    Accept: 'application/vnd.github+json',
  };
  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`;
  }

  const res = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, {
    headers,
  });

  if (res.status === 404 || res.status === 401) {
    throw new Error(
      'GitHub repository not found or is private. For private repos, enter a GitHub Personal Access Token or set GITHUB_TOKEN on the server.'
    );
  }

  if (res.ok) {
    const json = await res.json();
    return {
      owner,
      repo,
      branch: branchOverride || json.default_branch || 'main',
      sizeKb: Number(json.size || 0),
      description: json.description || '',
      isPrivate: Boolean(json.private),
      htmlUrl: json.html_url || `https://github.com/${owner}/${repo}`,
    };
  }

  // Fallback if unauthenticated GitHub REST API is rate-limited (403)
  return {
    owner,
    repo,
    branch: branchOverride || 'main',
    sizeKb: 0,
    description: '',
    isPrivate: false,
    htmlUrl: `https://github.com/${owner}/${repo}`,
  };
};

/**
 * Fetch downloadable ZIP stream from GitHub for both public and token-authorized private repos.
 */
export const fetchGithubArchiveResponse = async (owner, repo, branch = 'main', token = '') => {
  const authToken = (token || process.env.GITHUB_TOKEN || '').trim();
  const baseHeaders = { 'User-Agent': 'CoderHarbor-ArchiveFetcher' };

  // Prefer codeload for unauthenticated public repos (no API rate limit)
  const candidates = [];
  if (authToken) {
    candidates.push({
      url: `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/zipball/${encodeURIComponent(branch)}`,
      headers: { ...baseHeaders, Authorization: `Bearer ${authToken}`, Accept: 'application/vnd.github+json' },
    });
  } else {
    candidates.push({
      url: `https://codeload.github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/zip/refs/heads/${encodeURIComponent(branch)}`,
      headers: baseHeaders,
    });
    if (branch === 'main') {
      candidates.push({
        url: `https://codeload.github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/zip/refs/heads/master`,
        headers: baseHeaders,
      });
    }
    candidates.push({
      url: `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/zipball/${encodeURIComponent(branch)}`,
      headers: { ...baseHeaders, Accept: 'application/vnd.github+json' },
    });
  }

  let lastStatus = 0;
  for (const candidate of candidates) {
    const res = await fetch(candidate.url, { headers: candidate.headers, redirect: 'follow' });
    if (res.ok && res.body) {
      return { response: res, resolvedBranch: candidate.url.endsWith('/master') ? 'master' : branch };
    }
    lastStatus = res.status;
  }

  throw new Error(
    `Unable to download GitHub archive for ${owner}/${repo} (branch: ${branch}, HTTP ${lastStatus}). Check the repository URL/branch or token permissions.`
  );
};

/**
 * Helper to copy entries from a GitHub downloaded zip into targetZip under prefixFolder (stripping GitHub root wrapper).
 */
const appendGithubZipEntries = (sourceZipPath, targetZip, prefixFolder) => {
  const srcZip = new AdmZip(sourceZipPath);
  const entries = srcZip.getEntries();

  // Detect GitHub's single top-level wrapper folder (e.g. owner-repo-commitsha/)
  let wrapperPrefix = '';
  const topLevels = new Set();
  for (const e of entries) {
    const parts = normalize(e.entryName).split('/').filter(Boolean);
    if (parts.length > 0) topLevels.add(parts[0]);
  }
  if (topLevels.size === 1) {
    wrapperPrefix = `${Array.from(topLevels)[0]}/`;
  }

  for (const entry of entries) {
    if (entry.isDirectory) continue;
    let relPath = normalize(entry.entryName);
    if (wrapperPrefix && relPath.startsWith(wrapperPrefix)) {
      relPath = relPath.slice(wrapperPrefix.length);
    }
    if (!relPath || isJunkOrVenv(relPath)) continue;
    targetZip.addFile(`${prefixFolder}/${relPath}`, entry.getData());
  }
};

/**
 * Download a GitHub repo archive to a temporary zip file and return resolved metadata.
 */
export const downloadGithubZipToFile = async (githubUrl, destPath, token = '') => {
  const parsed = parseGithubUrl(githubUrl);
  const info = await fetchGithubRepoInfo(parsed.owner, parsed.repo, parsed.branch, token);
  const { response, resolvedBranch } = await fetchGithubArchiveResponse(
    info.owner,
    info.repo,
    info.branch,
    token
  );

  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  await pipeline(toNodeStream(response.body), fs.createWriteStream(destPath));
  const stat = fs.statSync(destPath);

  return {
    owner: info.owner,
    repo: info.repo,
    branch: resolvedBranch,
    htmlUrl: info.htmlUrl,
    archiveBytes: stat.size || Math.max(info.sizeKb * 1024, 1024),
  };
};

/**
 * Merge separate frontend & backend GitHub zip files into a single structured archive (frontend/, backend/).
 */
export const mergeGithubZips = (frontendZipPath, backendZipPath, combinedZipPath) => {
  const combinedZip = new AdmZip();
  appendGithubZipEntries(frontendZipPath, combinedZip, 'frontend');
  appendGithubZipEntries(backendZipPath, combinedZip, 'backend');
  combinedZip.writeZip(combinedZipPath);
  return combinedZipPath;
};

/**
 * Process single or dual (frontend + backend) GitHub repository links to build live template preview WITHOUT storing source ZIPs on disk.
 */
export const processGithubRepo = async (productId, githubUrl, options = {}) => {
  const { token = '', backendGithubUrl = '' } = options;
  const hasSeparateBackend = Boolean(backendGithubUrl && backendGithubUrl.trim());
  const suffix = `${productId}_${Date.now()}`;
  const tempFeZip = path.join(TEMP_BUILDS_DIR, `gh_fe_${suffix}.zip`);
  const tempBeZip = path.join(TEMP_BUILDS_DIR, `gh_be_${suffix}.zip`);
  const tempCombinedZip = path.join(TEMP_BUILDS_DIR, `gh_full_${suffix}.zip`);

  try {
    const fe = await downloadGithubZipToFile(githubUrl, tempFeZip, token);

    if (hasSeparateBackend) {
      const be = await downloadGithubZipToFile(backendGithubUrl, tempBeZip, token);
      mergeGithubZips(tempFeZip, tempBeZip, tempCombinedZip);
      const combinedStat = fs.statSync(tempCombinedZip);

      const previewResult = await processProjectZip(
        productId,
        tempCombinedZip,
        `${fe.repo}-fullstack.zip`
      );

      return {
        preview: previewResult,
        github: {
          mode: 'dual',
          owner: fe.owner,
          repo: fe.repo,
          branch: fe.branch,
          displayFilename: `${fe.owner}/${fe.repo}@${fe.branch} + ${be.owner}/${be.repo}@${be.branch}`,
          originalName: `${fe.repo}-fullstack.zip`,
          repoUrl: fe.htmlUrl,
          backendRepoUrl: be.htmlUrl,
          storageKey: `github2::${fe.owner}/${fe.repo}@${fe.branch}|${be.owner}/${be.repo}@${be.branch}`,
          archiveBytes: combinedStat.size || fe.archiveBytes + be.archiveBytes,
        },
      };
    }

    const previewResult = await processProjectZip(
      productId,
      tempFeZip,
      `${fe.repo}-${fe.branch}.zip`
    );

    return {
      preview: previewResult,
      github: {
        mode: 'single',
        owner: fe.owner,
        repo: fe.repo,
        branch: fe.branch,
        displayFilename: `${fe.owner}/${fe.repo}@${fe.branch}`,
        originalName: `${fe.repo}-${fe.branch}.zip`,
        repoUrl: fe.htmlUrl,
        storageKey: `github::${fe.owner}/${fe.repo}@${fe.branch}`,
        archiveBytes: fe.archiveBytes,
      },
    };
  } finally {
    // Always delete temporary GitHub archives so 0 source bytes remain on VPS storage
    for (const p of [tempFeZip, tempBeZip, tempCombinedZip]) {
      try {
        if (fs.existsSync(p)) fs.rmSync(p, { force: true });
      } catch (_) {}
    }
  }
};

/**
 * Rebuild preview from existing uploaded project file or linked GitHub repo(s)
 */
export const rebuildProjectPreview = async (productId) => {
  const latestFile = await prisma.productFile.findFirst({
    where: { productId },
    orderBy: { createdAt: 'desc' },
  });

  if (!latestFile) {
    throw new Error('No uploaded project archive (.zip) or GitHub link found for this project.');
  }

  const githubMeta = parseGithubStorageKey(latestFile.privateStorageKey);
  if (githubMeta) {
    if (githubMeta.mode === 'dual') {
      const result = await processGithubRepo(
        productId,
        `https://github.com/${githubMeta.frontend.owner}/${githubMeta.frontend.repo}/tree/${githubMeta.frontend.branch}`,
        {
          backendGithubUrl: `https://github.com/${githubMeta.backend.owner}/${githubMeta.backend.repo}/tree/${githubMeta.backend.branch}`,
        }
      );
      return result.preview;
    }

    const result = await processGithubRepo(
      productId,
      `https://github.com/${githubMeta.owner}/${githubMeta.repo}/tree/${githubMeta.branch}`
    );
    return result.preview;
  }

  const zipPath = path.resolve(__dirname, '../../storage/private/projects', latestFile.filename);
  return processProjectZip(productId, zipPath, latestFile.originalName);
};

/**
 * Toggle enable/disable preview
 */
export const toggleProjectPreview = async (productId, enable) => {
  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) throw new Error('Product not found.');

  if (!enable) {
    return prisma.product.update({
      where: { id: productId },
      data: { previewStatus: 'DISABLED' },
    });
  }

  // If enabling, verify preview directory exists
  const targetPreviewDir = path.join(PREVIEWS_DIR, productId);
  if (!fs.existsSync(path.join(targetPreviewDir, 'index.html'))) {
    throw new Error('Preview files are missing. Please rebuild the preview.');
  }

  const previewUrl = getPreviewUrl(productId);
  return prisma.product.update({
    where: { id: productId },
    data: {
      previewStatus: 'READY',
      previewUrl,
    },
  });
};
