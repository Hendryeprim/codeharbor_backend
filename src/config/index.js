import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export const config = {
  port: process.env.PORT || 5000,
  databaseUrl: process.env.DATABASE_URL,
  jwtSecret: process.env.JWT_SECRET || 'coderharbor_default_secret_key_change_me',
  jwtExpiresIn: '7d',
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',
  nodeEnv: process.env.NODE_ENV || 'development',
  fileStoragePath: process.env.FILE_STORAGE_PATH || './storage',
  maxUploadSize: parseInt(process.env.MAX_UPLOAD_SIZE, 10) || 1024 * 1024 * 1024, // 1GB limit for project archives
};

