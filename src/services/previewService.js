import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
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
  const frontendUrl = process.env.FRONTEND_URL || '';
  if (frontendUrl.includes('coderharbor.com')) {
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

        for (const ie of innerEntries) {
          if (ie.isDirectory || isJunkOrVenv(ie.entryName)) continue;
          let relPath = ie.entryName;
          if (innerRootDir && relPath.startsWith(innerRootDir)) {
            relPath = relPath.substring(innerRootDir.length).replace(/^[\/\\]/, '');
          }
          if (!relPath) continue;

          const finalPath = `${targetFolder}/${relPath}`.replace(/\\/g, '/');
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

  // Find non-junk package.json candidates sorted by frontend relevance and depth
  const packageJsonCandidates = zipEntries
    .filter(
      (e) =>
        !e.isDirectory &&
        !isJunkOrVenv(e.entryName) &&
        (normalize(e.entryName).endsWith('/package.json') || normalize(e.entryName) === 'package.json')
    )
    .sort((a, b) => {
      const aFe = isFrontendPath(a.entryName) ? 0 : 1;
      const bFe = isFrontendPath(b.entryName) ? 0 : 1;
      if (aFe !== bFe) return aFe - bFe;
      return a.entryName.split(/[\/\\]/).length - b.entryName.split(/[\/\\]/).length;
    });

  const packageJsonEntry = packageJsonCandidates[0] || null;

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
      (inspection.type === 'FULLSTACK' &&
        (inspection.hasFrontendVite ||
          Boolean(inspection.packageJsonData?.scripts?.build) ||
          (inspection.buildDir && fs.existsSync(path.join(path.dirname(zipFilePath), inspection.buildDir)))));

    // Should we deploy static HTML?
    const shouldDeployStaticHtml =
      inspection.type === 'STATIC_HTML' ||
      (inspection.type === 'FULLSTACK' && !shouldBuildReactVite && Boolean(inspection.webDir));

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

        // Determine correct project root directory containing package.json
        let projectRoot = tempBuildDir;
        if (inspection.buildDir) {
          const candidate = path.join(tempBuildDir, inspection.buildDir);
          if (fs.existsSync(candidate) && fs.existsSync(path.join(candidate, 'package.json'))) {
            projectRoot = candidate;
          }
        } else if (inspection.rootDir) {
          const candidate = path.join(tempBuildDir, inspection.rootDir);
          if (fs.existsSync(candidate) && fs.existsSync(path.join(candidate, 'package.json'))) {
            projectRoot = candidate;
          }
        }

        logs += `Installing build dependencies in isolated sandbox...\n`;
        await prisma.product.update({
          where: { id: productId },
          data: { previewBuildLogs: logs, previewUpdatedAt: new Date() },
        });

        // 1. Install dependencies (including devDependencies like vite, tailwind)
        await runIsolatedCommand(
          'npm',
          ['install', '--include=dev', '--prefer-offline', '--no-audit'],
          projectRoot,
          300000
        );
        logs += `✓ Dependencies installed.\nRunning production build (npm run build)...\n`;

        await prisma.product.update({
          where: { id: productId },
          data: { previewBuildLogs: logs, previewUpdatedAt: new Date() },
        });

        // 2. Build production assets
        await runIsolatedCommand('npm', ['run', 'build'], projectRoot, 300000);
        logs += `✓ Production build completed.\n`;

        // 3. Locate dist or build directory
        let distDir = path.join(projectRoot, 'dist');
        if (!fs.existsSync(distDir) || !fs.existsSync(path.join(distDir, 'index.html'))) {
          distDir = path.join(projectRoot, 'build');
        }

        if (!fs.existsSync(distDir) || !fs.existsSync(path.join(distDir, 'index.html'))) {
          throw new Error('Build finished, but no dist/index.html or build/index.html was produced.');
        }

        // 4. Inject sandbox interceptor & ensure relative asset paths
        const distIndexPath = path.join(distDir, 'index.html');
        if (fs.existsSync(distIndexPath)) {
          let html = fs.readFileSync(distIndexPath, 'utf8');

          // Rewrite absolute root asset URLs to relative for /previews/:id/ hosting
          html = html.replace(/(href|src)="\/(assets|favicon|logo|static)/g, '$1="./$2');
          html = html.replace(/(href|src)='\/ (assets|favicon|logo|static)/g, "$1='./$2");

          if (!html.includes('coderharbor-preview-sandbox')) {
            const interceptor = getSandboxInterceptorScript();
            if (html.includes('<head>')) {
              html = html.replace('<head>', `<head>\n${interceptor}`);
            } else {
              html = `${interceptor}\n${html}`;
            }
          }
          fs.writeFileSync(distIndexPath, html, 'utf8');
        }

        // 5. Deploy to preview storage
        cleanDirectory(targetPreviewDir);
        copyDirectory(distDir, targetPreviewDir);

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
        cleanDirectory(tempBuildDir);
        throw buildErr;
      }
    }

    // Case 2: STATIC_HTML or Fullstack with Static Web Directory
    if (shouldDeployStaticHtml) {
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
      try {
        let htmlContent = fs.readFileSync(indexPath, 'utf8');
        if (!htmlContent.includes('coderharbor-preview-sandbox')) {
          const interceptor = getSandboxInterceptorScript();
          if (htmlContent.includes('<head>')) {
            htmlContent = htmlContent.replace('<head>', `<head>\n${interceptor}`);
          } else {
            htmlContent = `${interceptor}\n${htmlContent}`;
          }
          fs.writeFileSync(indexPath, htmlContent, 'utf8');
        }
      } catch (injectErr) {
        console.warn('Sandbox interceptor injection skipped:', injectErr.message);
      }

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
    }

    // Case 3: Pure FULLSTACK with no interactive web frontend
    if (inspection.type === 'FULLSTACK') {
      const isFullstackInfraConfigured = process.env.FULLSTACK_PREVIEW_ENABLED === 'true';

      if (!isFullstackInfraConfigured) {
        const msg =
          'Full-stack backend application detected (API / Database only).\n' +
          'Live interactive preview requires isolated container virtualization (Docker sandbox) and dedicated demo database provisioning, which is currently not configured on this host.\n' +
          'Source code archive is securely preserved and available for customer download upon acquisition.';

        await prisma.product.update({
          where: { id: productId },
          data: {
            previewStatus: 'REQUIRES_INFRASTRUCTURE',
            previewUrl: null,
            previewBuildLogs: msg,
            previewUpdatedAt: new Date(),
          },
        });

        return { success: false, status: 'REQUIRES_INFRASTRUCTURE', message: msg, type: 'FULLSTACK' };
      }
    }

    // Case 4: UNKNOWN
    const unknownMsg =
      'Could not identify a supported interactive web entry point (missing index.html or package.json with build script).';
    await prisma.product.update({
      where: { id: productId },
      data: {
        previewStatus: 'FAILED',
        previewUrl: null,
        previewBuildLogs: unknownMsg,
        previewUpdatedAt: new Date(),
      },
    });

    return { success: false, status: 'FAILED', message: unknownMsg, type: 'UNKNOWN' };
  } catch (err) {
    const errorMsg = `Preview generation failed: ${err.message}`;
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
};

/**
 * Rebuild preview from existing uploaded project file
 */
export const rebuildProjectPreview = async (productId) => {
  const latestFile = await prisma.productFile.findFirst({
    where: { productId },
    orderBy: { createdAt: 'desc' },
  });

  if (!latestFile) {
    throw new Error('No uploaded project archive (.zip) found for this project.');
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
