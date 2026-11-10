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
  const ext = path.extname(file.originalname).toLowerCase().replace('.', '');
  const isImageExt = /^(jpe?g|png|webp|svg|gif|jfif|bmp|ico|avif|tiff|heic)$/i.test(ext);
  const isImageMime = (file.mimetype || '').toLowerCase().startsWith('image/') || file.mimetype === 'application/octet-stream';

  if (isImageExt || isImageMime) {
    return cb(null, true);
  }
  cb(new Error('Invalid image format. Supported formats: JPG, PNG, WEBP, SVG, GIF, BMP, ICO, AVIF.'));
};

const zipFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  const allowedExts = ['.zip', '.tar', '.gz', '.tgz', '.7z', '.rar', '.bz2', '.xz'];
  const mime = (file.mimetype || '').toLowerCase();
  const isArchiveMime =
    mime.includes('zip') ||
    mime.includes('compressed') ||
    mime.includes('archive') ||
    mime.includes('tar') ||
    mime.includes('octet-stream');

  if (allowedExts.includes(ext) || isArchiveMime) {
    return cb(null, true);
  }
  cb(new Error('Invalid project file format. Supported archive formats: .zip, .tar, .gz, .7z, .rar.'));
};

export const uploadImage = multer({
  storage: imageStorage,
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB limit for images
  fileFilter: imageFilter,
});

export const uploadProjectArchive = multer({
  storage: privateFileStorage,
  limits: { fileSize: config.maxUploadSize || 1024 * 1024 * 1024 }, // 1GB archive limit
  fileFilter: zipFilter,
});

