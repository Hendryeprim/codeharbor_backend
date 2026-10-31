import express from 'express';
import {
  getProducts,
  getFeaturedProducts,
  getProductBySlug,
} from '../controllers/productController.js';
import { optionalAuth } from '../middleware/auth.js';

const router = express.Router();

router.get('/', getProducts);
router.get('/featured', getFeaturedProducts);
router.get('/:slug', optionalAuth, getProductBySlug);

export default router;

