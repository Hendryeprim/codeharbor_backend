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
  importProjectGithubLink,
  rebuildProductPreview,
  toggleProductPreview,
  getProductPreviewLogs,
  getWebsiteSettings,
  updateWebsiteSetting,
} from '../controllers/adminController.js';
import {
  getAdminPortalDashboardStats,
  getAllEmployees,
  createEmployee,
  getEmployeeById,
  updateEmployee,
  toggleEmployeeStatus,
  deleteEmployee,
  getEmployeePerformance,
  getEmployeeSkills,
  getAllManagedProjects,
  createManagedProject,
  getManagedProjectById,
  updateManagedProject,
  deleteManagedProject,
  getAllProjectReviews,
  getProjectReviewById,
  runVersionExecution,
  stopVersionExecution,
  submitProjectReviewFeedback,
  downloadSubmissionVersionFile,
  getAdminProjectExecution,
  getAllTasks,
  createTask,
  updateTask,
  deleteTask,
  getAllExecutions,
  getExecutionById,
  getAdminNotifications,
  markNotificationRead,
  getAuditLogs,
} from '../controllers/adminPortalController.js';
import {
  getAdminSkills,
  createAdminSkill,
  getAdminTasks,
  createAdminTask,
  updateAdminTask,
  deleteAdminTask,
  assignEmployeeSkills,
  getAdminSubmissions,
  runAdminSubmissionCode,
  reviewTaskSubmission,
  getAdminSkillProgressDashboard,
  getAdminSkillStats,
  clearAllAdminTasks,
} from '../controllers/skillTaskController.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { uploadImage, uploadProjectArchive } from '../middleware/upload.js';

const router = express.Router();

// Strict server-side RBAC protection for all admin endpoints
router.use(authenticate, requireAdmin);

// Dashboard
router.get('/dashboard', getAdminPortalDashboardStats);
router.get('/marketplace-dashboard', getDashboardStats);

// Employees Management
router.get('/employees', getAllEmployees);
router.post('/employees', createEmployee);
router.get('/employees/performance', getEmployeePerformance);
router.get('/employees/skills', getEmployeeSkills);
router.get('/employees/:id', getEmployeeById);
router.patch('/employees/:id', updateEmployee);
router.put('/employees/:id', updateEmployee);
router.patch('/employees/:id/status', toggleEmployeeStatus);
router.delete('/employees/:id', deleteEmployee);

// Managed Projects Management
router.get('/managed-projects', getAllManagedProjects);
router.post('/managed-projects', createManagedProject);
router.get('/managed-projects/:id', getManagedProjectById);
router.patch('/managed-projects/:id', updateManagedProject);
router.delete('/managed-projects/:id', deleteManagedProject);

// Project Reviews & Executions
router.get('/project-reviews', getAllProjectReviews);
router.get('/project-reviews/:submissionId', getProjectReviewById);
router.get('/project-reviews/:versionId/execution', getAdminProjectExecution);
router.post('/project-reviews/:versionId/run', runVersionExecution);
router.post('/project-reviews/:versionId/stop', stopVersionExecution);
router.get('/project-reviews/:versionId/download', downloadSubmissionVersionFile);
router.post('/project-reviews/:submissionId/feedback', submitProjectReviewFeedback);

// Tasks Management
router.get('/tasks', getAllTasks);
router.post('/tasks', createTask);
router.patch('/tasks/:id', updateTask);
router.delete('/tasks/:id', deleteTask);

// Executions Log
router.get('/executions', getAllExecutions);
router.get('/executions/:id', getExecutionById);

// Notifications & Audit Logs
router.get('/notifications', getAdminNotifications);
router.patch('/notifications/:id/read', markNotificationRead);
router.get('/audit-logs', getAuditLogs);

// Products (Marketplace existing)
router.get('/products', getAdminProducts);
router.post('/products', createProduct);
router.get('/products/:id', getAdminProductById);
router.patch('/products/:id', updateProduct);
router.delete('/products/:id', deleteProduct);

// Product Live Preview Controls
router.post('/products/:id/preview/rebuild', rebuildProductPreview);
router.patch('/products/:id/preview/toggle', toggleProductPreview);
router.get('/products/:id/preview/logs', getProductPreviewLogs);

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
router.post('/upload/github-link', importProjectGithubLink);

// Settings
router.get('/settings', getWebsiteSettings);
router.patch('/settings', updateWebsiteSetting);

// ─── SKILL-BASED TASK & CURRICULUM MANAGEMENT (ADMIN) ─────────────────────────
router.get('/curriculum/skills', getAdminSkills);
router.post('/curriculum/skills', createAdminSkill);

router.get('/curriculum/tasks', getAdminTasks);
router.post('/curriculum/tasks', createAdminTask);
router.post('/curriculum/tasks/clear-all', clearAllAdminTasks);
router.patch('/curriculum/tasks/:taskId', updateAdminTask);
router.put('/curriculum/tasks/:taskId', updateAdminTask);
router.delete('/curriculum/tasks/:taskId', deleteAdminTask);

router.post('/curriculum/employees/:employeeProfileId/skills', assignEmployeeSkills);

router.get('/curriculum/submissions', getAdminSubmissions);
router.post('/curriculum/submissions/:submissionId/run', runAdminSubmissionCode);
router.post('/curriculum/submissions/:submissionId/review', reviewTaskSubmission);

router.get('/curriculum/progress-matrix', getAdminSkillProgressDashboard);
router.get('/curriculum/stats', getAdminSkillStats);

export default router;

