import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { config } from '../config/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Storage directories
export const PUBLIC_UPLOADS_DIR = path.resolve(__dirname, '../../storage/uploads/images');
export const PRIVATE_STORAGE_DIR = path.resolve(__dirname, '../../storage/private/projects');

// Ensure directories exist
fs.mkdirSync(PUBLIC_UPLOADS_DIR, { recursive: true });
fs.mkdirSync(PRIVATE_STORAGE_DIR, { recursive: true });

// Image storage configuration (Public)
const imageStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, PUBLIC_UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const sanitizedBase = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_-]/g, '_');
    cb(null, `img_${sanitizedBase}_${uniqueSuffix}${ext}`);
  },
});

// Private ZIP/project file storage configuration (Strictly Private)
const privateFileStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, PRIVATE_STORAGE_DIR);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const sanitizedBase = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_-]/g, '_');
    cb(null, `pkg_${sanitizedBase}_${uniqueSuffix}${ext}`);
  },
});

const imageFilter = (req, file, cb) => {
  const allowed = /jpeg|jpg|png|webp|svg|gif/;
  const extname = allowed.test(path.extname(file.originalname).toLowerCase());
  const mimetype = allowed.test(file.mimetype);

  if (extname && mimetype) {
    return cb(null, true);
  }
  cb(new Error('Invalid file format. Only JPEG, PNG, WEBP, SVG, and GIF images are permitted.'));
};

const zipFilter = (req, file, cb) => {
  const allowedExts = ['.zip', '.tar', '.gz', '.7z', '.rar'];
  const ext = path.extname(file.originalname).toLowerCase();

  if (allowedExts.includes(ext)) {
    return cb(null, true);
  }
  cb(new Error('Invalid project file format. Only archive files (.zip, .tar.gz, .7z) are permitted.'));
};

export const uploadImage = multer({
  storage: imageStorage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit for images
  fileFilter: imageFilter,
});

export const uploadProjectArchive = multer({
  storage: privateFileStorage,
  limits: { fileSize: config.maxUploadSize }, // e.g. 50MB
  fileFilter: zipFilter,
});

