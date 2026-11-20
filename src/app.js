import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

import { config } from './config/index.js';
import { PUBLIC_UPLOADS_DIR } from './middleware/upload.js';
import { PREVIEWS_DIR } from './services/previewService.js';
import { notFoundHandler, errorHandler } from './middleware/errorHandler.js';

import authRoutes from './routes/authRoutes.js';
import productRoutes from './routes/productRoutes.js';
import categoryRoutes from './routes/categoryRoutes.js';
import technologyRoutes from './routes/technologyRoutes.js';
import customerRoutes from './routes/customerRoutes.js';
import supportRoutes from './routes/supportRoutes.js';
import adminRoutes from './routes/adminRoutes.js';
import employeeRoutes from './routes/employeeRoutes.js';
import settingRoutes from './routes/settingRoutes.js';
import aiRoutes from './routes/aiRoutes.js';
import previewMockRoutes from './routes/previewMockRoutes.js';
import http from 'http';
import { activeExecutionsMap, EXECUTIONS_DIR } from './services/isolatedExecutionWorker.js';

// Handle BigInt serialization in JSON responses globally
BigInt.prototype.toJSON = function () {
  return Number(this);
};

const app = express();

// Security Middleware
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    frameguard: false,
  })
);

// CORS configuration
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow coderharbor.com, localhost dev, or any legitimate client
      callback(null, true);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  })
);

// Logging
if (config.nodeEnv !== 'test') {
  app.use(morgan('dev'));
}

// Body parsers
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Rate limiter for authentication routes
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many authentication attempts from this IP, please try again later.',
  },
});

// Serve only public images statically - strictly never private archives
app.use('/uploads/images', express.static(PUBLIC_UPLOADS_DIR));

// ─── MIME TYPES & PROJECT ASSET LOCATOR ─────────────────────────────────────────
const MIME_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.json': 'application/json',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject',
  '.otf': 'font/otf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
};

/**
 * Robust asset locator: Finds requested asset inside baseDir handling:
 * 1. Exact path
 * 2. Case-insensitive segment matching (crucial for Linux!)
 * 3. Standard asset subfolders (images/, img/, assets/, public/, media/, etc.)
 * 4. Recursive basename search as ultimate fallback
 */
const findFileInProject = (baseDir, reqSubpath) => {
  if (!baseDir || !fs.existsSync(baseDir)) return null;

  const clean = (reqSubpath || '').replace(/^\/+/, '').split('?')[0];
  if (!clean) return null;

  // 1. Direct path check
  const direct = path.join(baseDir, clean);
  if (fs.existsSync(direct) && fs.statSync(direct).isFile()) {
    return direct;
  }

  // 2. Case-insensitive segment-by-segment check
  const segments = clean.split(/[/\\]+/);
  let curDir = baseDir;
  let matchFailed = false;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i].toLowerCase();
    let entries = [];
    try {
      entries = fs.readdirSync(curDir, { withFileTypes: true });
    } catch (e) {
      matchFailed = true;
      break;
    }
    const found = entries.find((e) => e.name.toLowerCase() === seg);
    if (!found) {
      matchFailed = true;
      break;
    }
    curDir = path.join(curDir, found.name);
    if (i === segments.length - 1 && found.isFile()) {
      return curDir;
    }
  }

  // 3. Common asset folders search
  const basename = path.basename(clean);
  const commonFolders = [
    'images',
    'img',
    'imgs',
    'image',
    'assets',
    'assets/images',
    'assets/img',
    'dist/assets',
    'public',
    'public/images',
    'public/img',
    'static',
    'static/images',
    'static/img',
    'media',
    'photos',
    'icons',
    'css',
    'js',
  ];

  for (const folder of commonFolders) {
    const cand = path.join(baseDir, folder, basename);
    if (fs.existsSync(cand) && fs.statSync(cand).isFile()) {
      return cand;
    }
    const candSub = path.join(baseDir, folder, clean);
    if (fs.existsSync(candSub) && fs.statSync(candSub).isFile()) {
      return candSub;
    }
  }

  // 4. Recursive basename fallback (case-insensitive) across project directories
  const targetLower = basename.toLowerCase();
  const searchRecursive = (dir, depth = 0) => {
    if (depth > 5) return null;
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      return null;
    }
    for (const ent of entries) {
      if (['node_modules', '.git', '_temp_clone'].includes(ent.name)) continue;
      const full = path.join(dir, ent.name);
      if (ent.isFile()) {
        if (ent.name.toLowerCase() === targetLower) {
          return full;
        }
      } else if (ent.isDirectory()) {
        const found = searchRecursive(full, depth + 1);
        if (found) return found;
      }
    }
    return null;
  };

  return searchRecursive(baseDir);
};

// ─── PREVIEW ASSET RESOLVER (FOR ABSOLUTE PATHS LIKE /assets/...) ─────────────
// When loaded inside an iframe at `/previews/:id/` or `/api/preview/:id/`,
// any asset request to `api.coderharbor.com/images/...` or `api.coderharbor.com/assets/...`
// is automatically routed to the corresponding project preview folder or running port!
app.use((req, res, next) => {
  // Avoid intercepting core API endpoints, auth, previews or uploads
  if (req.path.startsWith('/api/') || req.path.startsWith('/previews/') || req.path.startsWith('/uploads/')) {
    return next();
  }

  const referer = req.headers.referer || '';
  const match = referer.match(/\/(?:previews|api\/preview|api\/proxy)\/([a-zA-Z0-9_-]+)/);

  let targetId = null;
  if (match && match[1]) {
    targetId = match[1];
  }

  // If no referer match, but request is clearly for an asset (e.g. image, css, js):
  // Check the most recently modified execution/preview directory as fallback
  const ext = path.extname(req.path).toLowerCase();
  const isAssetRequest =
    Boolean(MIME_TYPES[ext]) ||
    /^\/(?:assets|images|img|imgs|static|public|media|photos|icons)\//i.test(req.path);

  if (!targetId && isAssetRequest) {
    if (activeExecutionsMap.size > 0) {
      targetId = Array.from(activeExecutionsMap.keys()).pop();
    } else {
      try {
        if (fs.existsSync(PREVIEWS_DIR)) {
          const dirs = fs
            .readdirSync(PREVIEWS_DIR, { withFileTypes: true })
            .filter((d) => d.isDirectory())
            .map((d) => ({
              name: d.name,
              mtime: fs.statSync(path.join(PREVIEWS_DIR, d.name)).mtimeMs,
            }))
            .sort((a, b) => b.mtime - a.mtime);
          if (dirs.length > 0) {
            targetId = dirs[0].name;
          }
        }
      } catch (e) {}
    }
  }

  if (targetId) {
    const rawId = targetId;
    const cleanId = rawId.replace(/^managed-/, '');

    // 1. Check if there is an active running server on an allocated port for this project
    const active = activeExecutionsMap.get(cleanId) || activeExecutionsMap.get(rawId);
    if (active && active.port) {
      const proxyHeaders = { ...req.headers };
      proxyHeaders.host = `127.0.0.1:${active.port}`;
      const proxyReq = http.request(
        {
          hostname: '127.0.0.1',
          port: active.port,
          path: req.originalUrl,
          method: req.method,
          headers: proxyHeaders,
        },
        (proxyRes) => {
          const resHeaders = { ...proxyRes.headers };
          delete resHeaders['x-frame-options'];
          res.writeHead(proxyRes.statusCode, resHeaders);
          proxyRes.pipe(res, { end: true });
        }
      );
      proxyReq.on('error', () => next());
      req.pipe(proxyReq, { end: true });
      return;
    }

    // 2. Check static preview storage directories for this project
    const possibleDirs = [
      path.join(PREVIEWS_DIR, `managed-${cleanId}`),
      path.join(PREVIEWS_DIR, rawId),
      path.join(EXECUTIONS_DIR, `managed-${cleanId}`),
      path.join(EXECUTIONS_DIR, rawId),
    ];

    for (const pDir of possibleDirs) {
      if (!fs.existsSync(pDir)) continue;
      const foundFile = findFileInProject(pDir, req.path);
      if (foundFile) {
        const fileExt = path.extname(foundFile).toLowerCase();
        const mime = MIME_TYPES[fileExt] || 'application/octet-stream';
        res.setHeader('Content-Type', mime);
        res.setHeader('Cache-Control', 'public, max-age=3600');
        res.removeHeader('X-Frame-Options');
        return res.sendFile(foundFile);
      }
    }
  }

  next();
});

// ─── DEDICATED PREVIEW & PROXY HANDLER (GUARANTEES EMPLOYEE PROJECT UI) ───────
const handlePreviewOrProxy = (req, res, next) => {
  const rawId = req.params.versionId || req.params.productId;
  if (!rawId || !/^[a-zA-Z0-9_-]+$/.test(rawId)) {
    return res.status(400).send('Invalid preview identifier.');
  }

  const cleanId = rawId.replace(/^managed-/, '');

  // Frame embedding, Cache & Security Headers
  res.removeHeader('X-Frame-Options');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Content-Security-Policy', 'frame-ancestors *;');

  // 1. Check if there is an active running process on an allocated port (dynamic dev server / Python / Vite)
  const active = activeExecutionsMap.get(cleanId) || activeExecutionsMap.get(rawId);
  if (active && active.port) {
    const routePrefixRegex = new RegExp(`^/(?:previews|api/proxy|api/preview)/${rawId}`);
    const targetPath = req.originalUrl.replace(routePrefixRegex, '') || '/';
    const proxyHeaders = { ...req.headers };
    proxyHeaders.host = `127.0.0.1:${active.port}`;

    const proxyReq = http.request(
      {
        hostname: '127.0.0.1',
        port: active.port,
        path: targetPath,
        method: req.method,
        headers: proxyHeaders,
      },
      (proxyRes) => {
        const resHeaders = { ...proxyRes.headers };
        delete resHeaders['x-frame-options'];
        res.writeHead(proxyRes.statusCode, resHeaders);
        proxyRes.pipe(res, { end: true });
      }
    );

    proxyReq.on('error', (err) => {
      if (!res.headersSent) {
        res.status(502).send(`Live project communication error on port ${active.port}: ${err.message}`);
      }
    });

    req.pipe(proxyReq, { end: true });
    return;
  }

  // 2. Check static preview storage directories for the built / HTML application
  const candidateDirs = [
    path.join(PREVIEWS_DIR, `managed-${cleanId}`),
    path.join(PREVIEWS_DIR, rawId),
    path.join(EXECUTIONS_DIR, `managed-${cleanId}`),
    path.join(EXECUTIONS_DIR, rawId),
  ];

  // Force trailing slash for preview root so relative ./assets and scripts resolve correctly
  const baseRoute = req.originalUrl.split('?')[0];
  if (
    baseRoute === `/previews/${rawId}` ||
    baseRoute === `/api/preview/${rawId}` ||
    baseRoute === `/api/proxy/${rawId}`
  ) {
    return res.redirect(301, req.originalUrl.replace(baseRoute, baseRoute + '/'));
  }

  const validDir = candidateDirs.find((d) => fs.existsSync(d));
  if (validDir) {
    return express.static(validDir)(req, res, () => {
      const ext = path.extname(req.path).toLowerCase();
      // If it's an asset (image, style, script, font) that express.static missed:
      if (ext && ext !== '.html') {
        for (const candDir of candidateDirs) {
          const foundAsset = findFileInProject(candDir, req.path);
          if (foundAsset) {
            const mime = MIME_TYPES[ext] || 'application/octet-stream';
            res.setHeader('Content-Type', mime);
            res.setHeader('Cache-Control', 'public, max-age=3600');
            res.removeHeader('X-Frame-Options');
            return res.sendFile(foundAsset);
          }
        }
      }

      // SPA Fallback: If not a direct asset file with extension, serve the employee project's exact index.html
      const indexPath = path.join(validDir, 'index.html');
      if (fs.existsSync(indexPath)) {
        return res.sendFile(indexPath);
      }
      next();
    });
  }

  return res.status(404).send('Live preview is not ready or has not been generated for this project. Please click "Re-Run" in the toolbar.');
};

// Mount dedicated preview endpoints (all 100% isolated to the submitted project)
app.use('/previews/:productId', handlePreviewOrProxy);
app.use('/api/proxy/:versionId', handlePreviewOrProxy);
app.use('/api/preview/:versionId', handlePreviewOrProxy);

// Health Check API
app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'CoderHarbor REST API',
    purchasingStatus: 'Coming Soon',
    version: '2.1.0-build-fix',
    cwd: process.cwd(),
    node: process.version,
    platform: process.platform,
  });
});

// Mount Routes
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/technologies', technologyRoutes);
app.use('/api/customer', customerRoutes);
app.use('/api/support', supportRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/employee', employeeRoutes);
app.use('/api/settings', settingRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api', previewMockRoutes);

// Error Handlers
app.use(notFoundHandler);
app.use(errorHandler);

export default app;

