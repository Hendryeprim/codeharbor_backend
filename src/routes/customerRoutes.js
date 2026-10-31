import express from 'express';
import {
  getProfile,
  updateProfile,
  getMyProjects,
  getMyOrders,
  getMyDownloads,
  downloadFreeProduct,
} from '../controllers/customerController.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

router.use(authenticate);

router.get('/profile', getProfile);
router.patch('/profile', updateProfile);
router.get('/projects', getMyProjects);
router.get('/orders', getMyOrders);
router.get('/downloads', getMyDownloads);
router.get('/downloads/:fileId', downloadFreeProduct);

export default router;

