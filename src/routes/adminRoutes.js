import express from 'express';
import {
  getDashboardStats,
  getAdminProducts,
  getAdminProductById,
  createProduct,
  updateProduct,
  deleteProduct,
  getAdminCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  getAdminTechnologies,
  createTechnology,
  deleteTechnology,
  getAdminCustomers,
  toggleCustomerStatus,
  getAdminOrders,
  uploadImageFile,
  uploadProjectZip,
  getWebsiteSettings,
  updateWebsiteSetting,
} from '../controllers/adminController.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { uploadImage, uploadProjectArchive } from '../middleware/upload.js';

const router = express.Router();

// Strict server-side RBAC protection for all admin endpoints
router.use(authenticate, requireAdmin);

// Dashboard
router.get('/dashboard', getDashboardStats);

// Products
router.get('/products', getAdminProducts);
router.post('/products', createProduct);
router.get('/products/:id', getAdminProductById);
router.patch('/products/:id', updateProduct);
router.delete('/products/:id', deleteProduct);

// Categories
router.get('/categories', getAdminCategories);
router.post('/categories', createCategory);
router.patch('/categories/:id', updateCategory);
router.delete('/categories/:id', deleteCategory);

// Technologies
router.get('/technologies', getAdminTechnologies);
router.post('/technologies', createTechnology);
router.delete('/technologies/:id', deleteTechnology);

// Customers
router.get('/customers', getAdminCustomers);
router.patch('/customers/:id/status', toggleCustomerStatus);

// Orders
router.get('/orders', getAdminOrders);

// Uploads
router.post('/upload/image', uploadImage.single('image'), uploadImageFile);
router.post('/upload/project-file', uploadProjectArchive.single('file'), uploadProjectZip);

// Settings
router.get('/settings', getWebsiteSettings);
router.patch('/settings', updateWebsiteSetting);

export default router;

