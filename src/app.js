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
import settingRoutes from './routes/settingRoutes.js';
import aiRoutes from './routes/aiRoutes.js';
import previewMockRoutes from './routes/previewMockRoutes.js';

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

// Serve isolated live preview projects with sandboxed security headers
app.use(
  '/previews/:productId',
  (req, res, next) => {
    const { productId } = req.params;
    // Strict alphanumeric/dash/underscore validation to prevent directory traversal
    if (!productId || !/^[a-zA-Z0-9_-]+$/.test(productId)) {
      return res.status(400).send('Invalid preview identifier.');
    }

    const previewPath = path.join(PREVIEWS_DIR, productId);
    if (!fs.existsSync(previewPath)) {
      return res.status(404).send('Live preview is not ready or has not been generated for this project.');
    }

    // Force trailing slash for preview root so relative ./assets resolve correctly
    if (req.originalUrl === `/previews/${productId}`) {
      return res.redirect(301, `/previews/${productId}/`);
    }

    // Security & Embedding Headers
    res.removeHeader('X-Frame-Options');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader(
      'Content-Security-Policy',
      "frame-ancestors 'self' http://localhost:* http://127.0.0.1:* https://coderharbor.com http://coderharbor.com *.coderharbor.com;"
    );
    next();
  },
  (req, res, next) => {
    const previewPath = path.join(PREVIEWS_DIR, req.params.productId);
    express.static(previewPath)(req, res, next);
  }
);

// Health Check API
app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'CoderHarbor REST API',
    purchasingStatus: 'Coming Soon',
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
app.use('/api/settings', settingRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api', previewMockRoutes);

// Error Handlers
app.use(notFoundHandler);
app.use(errorHandler);

export default app;

