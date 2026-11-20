import fs from 'fs';
import path from 'path';
import net from 'net';
import http from 'http';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import AdmZip from 'adm-zip';
import prisma from '../database/prisma.js';
import { PREVIEWS_DIR } from './previewService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const EXECUTIONS_DIR = path.resolve(__dirname, '../../storage/executions');
fs.mkdirSync(EXECUTIONS_DIR, { recursive: true });

// In-memory registry of running isolated worker processes
// versionId -> { child, port, targetDir, type, startedAt }
export const activeExecutionsMap = new Map();

/**
 * Clean path normalization
 */
const normalize = (p) => (p || '').replace(/\\/g, '/');

const getTimestamp = () => {
  const now = new Date();
  return now.toTimeString().split(' ')[0];
};

/**
 * Find an available TCP port in range [41000, 49999]
 */
export const getAvailablePort = (startPort = 41000, endPort = 49999) => {
  return new Promise((resolve) => {
    const port = Math.floor(Math.random() * (endPort - startPort + 1)) + startPort;
    const server = net.createServer();
    server.unref();
    server.on('error', () => {
      resolve(getAvailablePort(startPort, endPort));
    });
    server.listen(port, '127.0.0.1', () => {
      server.close(() => resolve(port));
    });
  });
};

/**
 * Poll local port until HTTP responds or timeout
 */
export const waitForPort = (port, timeoutMs = 25000) => {
  const startTime = Date.now();
  return new Promise((resolve) => {
    const check = () => {
      const req = http.get(`http://127.0.0.1:${port}`, (res) => {
        resolve(true);
      });
      req.on('error', () => {
        if (Date.now() - startTime > timeoutMs) {
          resolve(false);
        } else {
          setTimeout(check, 800);
        }
      });
      req.end();
    };
    check();
  });
};

/**
 * Safely copy recursive directory
 */
const copyRecursiveSync = (src, dest, ignore = ['.git', 'node_modules', '_temp_clone']) => {
  if (!fs.existsSync(src)) return;
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const item of fs.readdirSync(src)) {
      if (ignore.includes(item)) continue;
      copyRecursiveSync(path.join(src, item), path.join(dest, item), ignore);
    }
  } else {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
};

/**
 * Recursively find index.html
 */
export const findIndexHtml = (dir) => {
  if (!fs.existsSync(dir)) return null;
  const rootIndex = path.join(dir, 'index.html');
  if (fs.existsSync(rootIndex)) return rootIndex;

  const candidates = ['dist', 'build', 'public', 'out', 'web'];
  for (const c of candidates) {
    const p = path.join(dir, c, 'index.html');
    if (fs.existsSync(p)) return p;
  }

  const findRecursive = (cur, depth = 0) => {
    if (depth > 4) return null;
    const entries = fs.readdirSync(cur, { withFileTypes: true });
    for (const e of entries) {
      if (e.isDirectory() && !['node_modules', '.git', '_temp_clone'].includes(e.name)) {
        const sub = path.join(cur, e.name, 'index.html');
        if (fs.existsSync(sub)) return sub;
        const deep = findRecursive(path.join(cur, e.name), depth + 1);
        if (deep) return deep;
      }
    }
    return null;
  };

  return findRecursive(dir);
};

/**
 * Recursively sync common image/asset folders from source repository into static preview folder
 */
export const syncCommonAssetDirectories = (sourceDir, targetPreviewDir) => {
  if (!fs.existsSync(sourceDir) || !fs.existsSync(targetPreviewDir)) return;
  const assetDirNames = [
    'images',
    'img',
    'imgs',
    'image',
    'assets',
    'public',
    'static',
    'media',
    'photos',
    'pic',
    'pictures',
    'icons',
    'uploads',
  ];

  for (const name of assetDirNames) {
    const srcAsset = path.join(sourceDir, name);
    if (fs.existsSync(srcAsset) && fs.statSync(srcAsset).isDirectory()) {
      const destAsset = path.join(targetPreviewDir, name);
      if (!fs.existsSync(destAsset)) {
        copyRecursiveSync(srcAsset, destAsset);
      }
    }
  }

  // Also check if sourceDir/public contains images, img, assets
  const publicDir = path.join(sourceDir, 'public');
  if (fs.existsSync(publicDir) && fs.statSync(publicDir).isDirectory()) {
    for (const name of ['images', 'img', 'imgs', 'image', 'assets', 'static', 'media', 'photos', 'icons']) {
      const srcSub = path.join(publicDir, name);
      if (fs.existsSync(srcSub) && fs.statSync(srcSub).isDirectory()) {
        const destSub = path.join(targetPreviewDir, name);
        if (!fs.existsSync(destSub)) {
          copyRecursiveSync(srcSub, destSub);
        }
      }
    }
  }
};

/**
 * Scan and rewrite root-relative asset URLs inside CSS files so background images load reliably
 */
export const rewriteCssFiles = (dir) => {
  if (!fs.existsSync(dir)) return;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const ent of entries) {
      if (['node_modules', '.git', '_temp_clone'].includes(ent.name)) continue;
      const fullPath = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        rewriteCssFiles(fullPath);
      } else if (ent.isFile() && ent.name.toLowerCase().endsWith('.css')) {
        let css = fs.readFileSync(fullPath, 'utf8');
        let modified = false;
        if (/url\(\s*["']?\/(assets|images|img|imgs|image|static|public|media|photos|pic|icons)\//i.test(css)) {
          css = css.replace(
            /url\(\s*(['"]?)\/(assets|images|img|imgs|image|static|public|media|photos|pic|icons)\/([^'")>]+)\1\s*\)/gi,
            'url($1../$2/$3$1)'
          );
          modified = true;
        }
        if (modified) {
          fs.writeFileSync(fullPath, css, 'utf8');
        }
      }
    }
  } catch (e) {}
};

/**
 * Inject base tag into head of HTML and rewrite absolute assets to relative
 */
export const injectBaseTag = (htmlPath, baseHref) => {
  try {
    let html = fs.readFileSync(htmlPath, 'utf8');
    const baseHrefClean = (baseHref || '').startsWith('/') ? baseHref : `/previews/${baseHref}/`;
    const normalizedBaseHref = baseHrefClean.endsWith('/') ? baseHrefClean : `${baseHrefClean}/`;
    const baseTag = `<base href="${normalizedBaseHref}">`;

    if (!html.includes('<base')) {
      if (html.includes('<head>')) {
        html = html.replace('<head>', `<head>\n  ${baseTag}`);
      } else if (html.includes('<HEAD>')) {
        html = html.replace('<HEAD>', `<HEAD>\n  ${baseTag}`);
      } else {
        html = `${baseTag}\n${html}`;
      }
    }

    // 1. Rewrite root-relative asset directories (/images/..., /img/..., /assets/...) to relative ./
    html = html.replace(
      /(href|src|data-src|poster)=["']\/(assets|images|img|imgs|image|static|public|media|photos|pic|pictures|icons|css|js|vendor|uploads)\/([^"'>]+)["']/gi,
      '$1="./$2/$3"'
    );

    // 2. Rewrite root-relative file extensions like src="/deal.png" or href="/style.css"
    html = html.replace(
      /(href|src|data-src|poster)=["']\/([^"' >/]+\.(?:png|jpg|jpeg|gif|svg|webp|ico|bmp|avif|css|js|mjs|woff2?|ttf|eot|mp4|webm))["']/gi,
      '$1="./$2"'
    );

    // 3. Rewrite CSS url('/...') inside <style> blocks or inline styles
    html = html.replace(
      /url\(\s*["']?\/(assets|images|img|imgs|image|static|public|media|photos|pic|pictures|icons)\/([^"')>]+)["']?\s*\)/gi,
      'url("./$1/$2")'
    );
    html = html.replace(
      /url\(\s*["']?\/([^"')>/]+\.(?:png|jpg|jpeg|gif|svg|webp|ico|bmp|avif))["']?\s*\)/gi,
      'url("./$1")'
    );

    // 4. Rewrite srcset attributes
    html = html.replace(/srcset=["']([^"']+)["']/gi, (match, srcsetValue) => {
      const rewritten = srcsetValue
        .split(',')
        .map((part) => {
          const trimmed = part.trim();
          if (trimmed.startsWith('/')) {
            return `./${trimmed.replace(/^\/+/, '')}`;
          }
          return trimmed;
        })
        .join(', ');
      return `srcset="${rewritten}"`;
    });

    fs.writeFileSync(htmlPath, html, 'utf8');

    // Also rewrite all CSS files in the project preview directory
    rewriteCssFiles(path.dirname(htmlPath));
  } catch (e) {
    console.warn('[ExecutionWorker] injectBaseTag error:', e.message);
  }
};

/**
 * Return canonical backend preview URL (guarantees preview goes to backend, never frontend SPA)
 */
export const getCanonicalPreviewUrl = (subpath) => {
  const cleanSubpath = (subpath || '').startsWith('/') ? subpath : `/${subpath || ''}`;
  if (process.env.BACKEND_PUBLIC_URL) {
    return `${process.env.BACKEND_PUBLIC_URL.replace(/\/$/, '')}${cleanSubpath}`;
  }
  if (process.env.NODE_ENV === 'production') {
    return `https://api.coderharbor.com${cleanSubpath}`;
  }
  const port = process.env.PORT || 5050;
  return `http://localhost:${port}${cleanSubpath}`;
};

/**
 * Run a command inside a directory with real-time log streaming
 */
const runCommandStream = ({ command, cwd, onLog, timeout = 90000 }) => {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const safeEnv = {
      ...process.env,
      NODE_ENV: 'development',
      CI: 'false',
    };

    const child = spawn(command, {
      cwd,
      env: safeEnv,
      shell: true,
      windowsHide: true,
    });

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill('SIGTERM');
      } catch (e) {}
      onLog(`[Timeout] Command exceeded ${timeout / 1000}s limit.`);
      resolve({ exitCode: 124, stdout, stderr, timedOut: true });
    }, timeout);

    child.stdout.on('data', (d) => {
      const text = d.toString();
      stdout += text;
      onLog(text);
    });

    child.stderr.on('data', (d) => {
      const text = d.toString();
      stderr += text;
      onLog(text);
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      onLog(`ERROR: ${err.message}`);
      resolve({ exitCode: 1, stdout, stderr, timedOut: false });
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (!timedOut) {
        resolve({ exitCode: code ?? 0, stdout, stderr, timedOut: false });
      }
    });
  });
};

/**
 * Isolated Project Execution Worker:
 * 1. Clones repository or unpacks ZIP into isolated folder.
 * 2. Automatically detects project type.
 * 3. Automatically installs dependencies.
 * 4. Automatically builds / runs project on allocated port.
 * 5. Streams real terminal logs to ProjectExecution.
 * 6. Sets preview URL to actual project UI.
 */
export const runIsolatedProjectExecution = async ({ versionId, executedById = null }) => {
  const version = await prisma.projectVersion.findUnique({
    where: { id: versionId },
    include: {
      submission: {
        include: {
          project: true,
        },
      },
    },
  });

  if (!version) {
    throw new Error(`ProjectVersion ${versionId} not found`);
  }

  const projectTitle = version.submission?.project?.title || 'Project';
  const githubUrl = version.githubUrl;
  const filePath = version.filePath;

  const targetDirName = `managed-${version.id}`;
  const targetDir = path.join(EXECUTIONS_DIR, targetDirName);
  const staticPreviewDir = path.join(PREVIEWS_DIR, targetDirName);

  // Stop previous running process if exists
  if (activeExecutionsMap.has(versionId)) {
    try {
      const prev = activeExecutionsMap.get(versionId);
      if (prev.child && !prev.child.killed) {
        prev.child.kill('SIGTERM');
      }
    } catch (e) {}
    activeExecutionsMap.delete(versionId);
  }

  // Clean target execution workspace
  if (fs.existsSync(targetDir)) {
    try {
      fs.rmSync(targetDir, { recursive: true, force: true });
    } catch (e) {}
  }
  fs.mkdirSync(targetDir, { recursive: true });

  const logBuffer = [];
  let executionRecord = await prisma.projectExecution.findFirst({
    where: { versionId },
    orderBy: { createdAt: 'desc' },
  });

  if (!executionRecord) {
    executionRecord = await prisma.projectExecution.create({
      data: {
        versionId,
        status: 'RUNNING',
        buildStatus: 'RUNNING',
        executedById,
        consoleLogs: '',
      },
    });
  } else {
    await prisma.projectExecution.update({
      where: { id: executionRecord.id },
      data: {
        status: 'RUNNING',
        buildStatus: 'RUNNING',
        consoleLogs: '',
      },
    });
  }

  let dbUpdateTimer = null;
  const flushLogsToDb = async () => {
    try {
      await prisma.projectExecution.update({
        where: { id: executionRecord.id },
        data: { consoleLogs: logBuffer.join('\n') },
      });
    } catch (e) {}
  };

  const log = (msg) => {
    const lines = String(msg).replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    for (const l of lines) {
      if (l.trim().length > 0) logBuffer.push(l);
    }
    if (!dbUpdateTimer) {
      dbUpdateTimer = setTimeout(() => {
        dbUpdateTimer = null;
        flushLogsToDb();
      }, 500);
    }
  };

  log(`[${getTimestamp()}] Initializing isolated execution environment for: ${projectTitle} (v${version.versionNumber})`);
  log(`[${getTimestamp()}] Workspace: ${targetDirName}`);

  let executionStatus = 'COMPLETED';
  let buildStatus = 'SUCCESS';
  let previewUrl = null;
  let allocatedPort = null;

  try {
    // ── 1. CLONE OR UNPACK REPOSITORY ───────────────────────────────────────
    let sourceAcquired = false;

    if (githubUrl && githubUrl.trim()) {
      const sanitizedUrl = githubUrl.trim();
      log(`$ git clone --depth 1 "${sanitizedUrl}" .`);
      log(`[${getTimestamp()}] Cloning remote repository...`);

      const tempClone = path.join(targetDir, '_temp_clone');
      if (fs.existsSync(tempClone)) try { fs.rmSync(tempClone, { recursive: true, force: true }); } catch (e) {}

      const cloneRes = await runCommandStream({
        command: `git clone --depth 1 --single-branch "${sanitizedUrl}" "${tempClone}"`,
        cwd: targetDir,
        onLog: log,
        timeout: 90000,
      });

      if (cloneRes.exitCode === 0 && fs.existsSync(tempClone)) {
        copyRecursiveSync(tempClone, targetDir);
        try { fs.rmSync(tempClone, { recursive: true, force: true }); } catch (e) {}
        sourceAcquired = true;
        log(`✓ Repository cloned successfully`);
      } else {
        log(`ERROR: Git clone failed (exit code ${cloneRes.exitCode})`);
        executionStatus = 'FAILED';
        buildStatus = 'FAILED';
      }
    } else if (filePath && fs.existsSync(filePath)) {
      log(`$ unzip ${path.basename(filePath)}`);
      try {
        const zip = new AdmZip(filePath);
        zip.extractAllTo(targetDir, true);
        sourceAcquired = true;
        log(`✓ Archive unpacked successfully`);
      } catch (zipErr) {
        log(`ERROR: Archive extraction failed: ${zipErr.message}`);
        executionStatus = 'FAILED';
        buildStatus = 'FAILED';
      }
    }

    if (!sourceAcquired) {
      log(`ERROR: No source repository or archive could be acquired.`);
      executionStatus = 'FAILED';
      buildStatus = 'FAILED';
      await flushLogsToDb();
      return;
    }

    // ── 2. DETECT PROJECT TYPE ──────────────────────────────────────────────
    const pkgJsonPath = path.join(targetDir, 'package.json');
    const hasPackageJson = fs.existsSync(pkgJsonPath);
    let pkg = {};
    if (hasPackageJson) {
      try {
        pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
      } catch (e) {}
    }

    const allFiles = fs.readdirSync(targetDir, { recursive: true }).map((f) => normalize(f));
    const hasPython = allFiles.some((f) => f.endsWith('.py'));
    const hasRequirements = fs.existsSync(path.join(targetDir, 'requirements.txt'));
    const existingHtml = findIndexHtml(targetDir);

    log(`[${getTimestamp()}] Analyzing project dependencies and configuration...`);

    // ── 3. INSTALL & BUILD & RUN ───────────────────────────────────────────

    // CASE A: Pure Static Web Application (no package.json or simple HTML/CSS/JS)
    if (existingHtml && !hasPackageJson) {
      log(`✓ Detected: Static Web Application (HTML5 / CSS / JavaScript)`);
      log(`✓ Entry point: ${path.relative(targetDir, existingHtml)}`);

      // Copy static assets to PREVIEWS_DIR
      if (fs.existsSync(staticPreviewDir)) {
        try { fs.rmSync(staticPreviewDir, { recursive: true, force: true }); } catch (e) {}
      }
      fs.mkdirSync(staticPreviewDir, { recursive: true });

      const htmlDir = path.dirname(existingHtml);
      copyRecursiveSync(htmlDir, staticPreviewDir);
      // Synchronize sibling/root image and asset folders into preview workspace
      syncCommonAssetDirectories(targetDir, staticPreviewDir);

      const rootHtml = path.join(staticPreviewDir, 'index.html');
      if (fs.existsSync(rootHtml)) {
        injectBaseTag(rootHtml, `/previews/${targetDirName}/`);
      }

      previewUrl = `/previews/${targetDirName}/`;
      log(`$ starting preview server...`);
      log(`✓ Server started`);
      log(`✓ Preview Ready: ${getCanonicalPreviewUrl(previewUrl)}`);
      executionStatus = 'COMPLETED';
      buildStatus = 'SUCCESS';
    }

    // CASE B: Node.js / React / Vite / Vue / Next.js
    else if (hasPackageJson) {
      const scripts = pkg.scripts || {};
      const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
      const isVite = Boolean(deps.vite || scripts.build?.includes('vite') || scripts.dev?.includes('vite'));
      const isNext = Boolean(deps.next || scripts.build?.includes('next'));
      const isCRA = Boolean(deps['react-scripts'] || scripts.build?.includes('react-scripts'));

      log(`✓ Detected: Node.js Application (${isVite ? 'Vite' : isNext ? 'Next.js' : isCRA ? 'Create React App' : 'Web Application'})`);

      // 3.1 Install dependencies
      log(`$ npm install`);
      const installRes = await runCommandStream({
        command: 'npm install --prefer-offline --no-audit',
        cwd: targetDir,
        onLog: log,
        timeout: 90000,
      });

      if (installRes.exitCode !== 0) {
        log(`WARNING: npm install finished with exit code ${installRes.exitCode}. Proceeding to build...`);
      } else {
        log(`✓ Dependencies installed successfully`);
      }

      // 3.2 Build project
      if (scripts.build) {
        log(`$ npm run build`);
        const buildRes = await runCommandStream({
          command: 'npm run build',
          cwd: targetDir,
          onLog: log,
          timeout: 90000,
        });

        if (buildRes.exitCode === 0) {
          log(`✓ Build successful`);
          buildStatus = 'SUCCESS';

          // Check if build generated dist or build folder with index.html
          const builtHtml = findIndexHtml(targetDir);
          if (builtHtml) {
            // Serve the exact built application directly via static preview!
            if (fs.existsSync(staticPreviewDir)) {
              try { fs.rmSync(staticPreviewDir, { recursive: true, force: true }); } catch (e) {}
            }
            fs.mkdirSync(staticPreviewDir, { recursive: true });

            const builtDir = path.dirname(builtHtml);
            copyRecursiveSync(builtDir, staticPreviewDir);
            // Synchronize root assets, images, and public folder into build preview
            syncCommonAssetDirectories(targetDir, staticPreviewDir);

            const rootHtml = path.join(staticPreviewDir, 'index.html');
            if (fs.existsSync(rootHtml)) {
              injectBaseTag(rootHtml, `/previews/${targetDirName}/`);
            }

            previewUrl = `/previews/${targetDirName}/`;
            log(`$ starting preview server...`);
            log(`✓ Server started`);
            log(`✓ Preview Ready: ${getCanonicalPreviewUrl(previewUrl)}`);
            executionStatus = 'COMPLETED';
          }
        } else {
          log(`ERROR: Build failed with exit code ${buildRes.exitCode}`);
          executionStatus = 'FAILED';
          buildStatus = 'FAILED';
        }
      }

      // If no build script or build failed, or it's a dynamic server (Next / dev mode):
      if (!previewUrl && (scripts.dev || scripts.start)) {
        allocatedPort = await getAvailablePort();
        const startCmd = scripts.dev
          ? (isVite ? `npx vite --host 127.0.0.1 --port ${allocatedPort}` : `npm run dev -- -p ${allocatedPort}`)
          : `npm start`;

        log(`$ ${startCmd}`);
        const child = spawn(startCmd, {
          cwd: targetDir,
          env: {
            ...process.env,
            PORT: String(allocatedPort),
            HOST: '127.0.0.1',
          },
          shell: true,
        });

        child.stdout.on('data', (d) => log(d.toString()));
        child.stderr.on('data', (d) => log(d.toString()));

        activeExecutionsMap.set(versionId, {
          child,
          port: allocatedPort,
          targetDir,
          type: 'SERVER',
          startedAt: Date.now(),
        });

        const isUp = await waitForPort(allocatedPort, 30000);
        if (isUp) {
          log(`✓ Server running at http://127.0.0.1:${allocatedPort}`);
          previewUrl = `/api/preview/${version.id}/`;
          log(`✓ Preview Ready: ${getCanonicalPreviewUrl(previewUrl)}`);
          executionStatus = 'COMPLETED';
          buildStatus = 'SUCCESS';
        } else {
          log(`ERROR: Server failed to respond on port ${allocatedPort} within timeout.`);
          executionStatus = 'FAILED';
          buildStatus = 'FAILED';
        }
      }
    }

    // CASE C: Python Application
    else if (hasPython) {
      log(`✓ Detected: Python Application`);
      if (hasRequirements) {
        log(`$ pip install -r requirements.txt`);
        await runCommandStream({
          command: 'pip install -r requirements.txt',
          cwd: targetDir,
          onLog: log,
          timeout: 60000,
        });
      }

      const pyFiles = allFiles.filter((f) => f.endsWith('.py'));
      const mainPy = pyFiles.find((f) => f.endsWith('main.py') || f.endsWith('app.py')) || pyFiles[0];

      allocatedPort = await getAvailablePort();
      log(`$ python "${mainPy}" (PORT: ${allocatedPort})`);

      const child = spawn(`python "${mainPy}"`, {
        cwd: targetDir,
        env: {
          ...process.env,
          PORT: String(allocatedPort),
        },
        shell: true,
      });

      child.stdout.on('data', (d) => log(d.toString()));
      child.stderr.on('data', (d) => log(d.toString()));

      activeExecutionsMap.set(versionId, {
        child,
        port: allocatedPort,
        targetDir,
        type: 'SERVER',
        startedAt: Date.now(),
      });

      const isUp = await waitForPort(allocatedPort, 15000);
      if (isUp) {
        log(`✓ Python server running on port ${allocatedPort}`);
        previewUrl = `/api/preview/${version.id}/`;
        log(`✓ Preview Ready: ${getCanonicalPreviewUrl(previewUrl)}`);
        executionStatus = 'COMPLETED';
        buildStatus = 'SUCCESS';
      } else {
        log(`ERROR: Application did not bind to port or exited.`);
        executionStatus = 'FAILED';
        buildStatus = 'FAILED';
      }
    }

    // Fallback: If no runnable web application or static index.html could be produced
    if (!previewUrl) {
      if (!executionStatus || executionStatus === 'COMPLETED') {
        executionStatus = 'FAILED';
        buildStatus = 'FAILED';
      }
      log(`ERROR: No runnable web UI or index.html detected in repository.`);
      // Write a clean, genuine error document (no fake replacement template)
      if (fs.existsSync(staticPreviewDir)) {
        try { fs.rmSync(staticPreviewDir, { recursive: true, force: true }); } catch (e) {}
      }
      fs.mkdirSync(staticPreviewDir, { recursive: true });
      fs.writeFileSync(
        path.join(staticPreviewDir, 'index.html'),
        `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Build / Execution Error</title>
  <style>
    body { background: #070A12; color: #f87171; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 80vh; margin: 0; }
    .box { max-width: 540px; background: #0E0A1C; border: 1px solid rgba(244, 63, 94, 0.4); border-radius: 16px; padding: 28px; text-align: center; }
    h2 { color: #ffffff; margin-top: 0; font-size: 18px; }
    p { font-size: 13px; color: #cbd5e1; line-height: 1.6; }
    .footer { margin-top: 16px; font-size: 11px; color: #f43f5e; font-family: monospace; }
  </style>
</head>
<body>
  <div class="box">
    <h2>Project Execution Failed</h2>
    <p>The application could not be rendered because the build or launch failed.</p>
    <p>Please inspect the <strong>Terminal Panel</strong> below for the exact compiler and runtime errors.</p>
    <div class="footer">STATUS: EXECUTION_FAILED</div>
  </div>
</body>
</html>`,
        'utf8'
      );
      previewUrl = `/previews/${targetDirName}/`;
    }

    const canonicalLiveDemoUrl = getCanonicalPreviewUrl(previewUrl);

    // Update ProjectVersion with canonical backend liveDemoUrl
    await prisma.projectVersion.update({
      where: { id: version.id },
      data: { liveDemoUrl: canonicalLiveDemoUrl },
    });

  } catch (err) {
    log(`[FATAL ERROR]: ${err.message}`);
    executionStatus = 'FAILED';
    buildStatus = 'FAILED';
  } finally {
    if (dbUpdateTimer) {
      clearTimeout(dbUpdateTimer);
      dbUpdateTimer = null;
    }

    await prisma.projectExecution.update({
      where: { id: executionRecord.id },
      data: {
        status: executionStatus,
        buildStatus,
        consoleLogs: logBuffer.join('\n'),
        completedAt: new Date(),
      },
    });
  }

  return previewUrl;
};
