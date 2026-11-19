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

// ─── PREVIEW ASSET RESOLVER (FOR ABSOLUTE PATHS LIKE /assets/...) ─────────────
// Many frontend SPAs reference assets with absolute paths like `/assets/app.js`,
// `/favicon.ico`, `/images/bg.jpg` instead of relative paths `./assets/app.js`.
// When loaded inside an iframe at `/previews/:id/` or `/api/preview/:id/`,
// the browser requests `api.coderharbor.com/assets/...`.
// We inspect the Referer header to automatically route the asset request to the
// corresponding employee/managed project's running server or preview folder!
app.use((req, res, next) => {
  const referer = req.headers.referer || '';
  const match = referer.match(/\/(?:previews|api\/preview|api\/proxy)\/([a-zA-Z0-9_-]+)/);
  if (match && match[1]) {
    const rawId = match[1];
    // Avoid intercepting core API endpoints or auth
    if (!req.path.startsWith('/api/') && !req.path.startsWith('/previews/') && !req.path.startsWith('/uploads/')) {
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

        const candidatePath = path.join(pDir, req.path);
        if (fs.existsSync(candidatePath) && fs.statSync(candidatePath).isFile()) {
          return res.sendFile(candidatePath);
        }

        const basename = path.basename(req.path);
        const subdirCandidates = [
          path.join(pDir, 'assets', basename),
          path.join(pDir, 'dist', 'assets', basename),
          path.join(pDir, 'images', basename),
          path.join(pDir, 'icons', basename),
          path.join(pDir, 'public', basename),
          path.join(pDir, 'static', basename),
          path.join(pDir, 'css', basename),
          path.join(pDir, 'js', basename),
        ];
        for (const sub of subdirCandidates) {
          if (fs.existsSync(sub) && fs.statSync(sub).isFile()) {
            return res.sendFile(sub);
          }
        }
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
  res.setHeader(
    'Content-Security-Policy',
    "frame-ancestors *;"
  );

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

  for (const staticPath of candidateDirs) {
    if (fs.existsSync(staticPath)) {
      // Force trailing slash for preview root so relative ./assets and scripts resolve correctly
      const baseRoute = req.originalUrl.split('?')[0];
      if (
        baseRoute === `/previews/${rawId}` ||
        baseRoute === `/api/preview/${rawId}` ||
        baseRoute === `/api/proxy/${rawId}`
      ) {
        return res.redirect(301, req.originalUrl.replace(baseRoute, baseRoute + '/'));
      }

      return express.static(staticPath)(req, res, () => {
        // SPA Fallback: If not a direct asset file with extension, serve the employee project's exact index.html
        const hasExt = Boolean(path.extname(req.path));
        if (!hasExt) {
          const indexPath = path.join(staticPath, 'index.html');
          if (fs.existsSync(indexPath)) {
            return res.sendFile(indexPath);
          }
        }
        next();
      });
    }
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

