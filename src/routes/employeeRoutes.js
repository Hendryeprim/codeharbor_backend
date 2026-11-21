import express from 'express';
import {
  getEmployeeDashboard,
  getMyProjects,
  getMyProjectDetails,
  startProject,
  updateProjectProgress,
  uploadProjectSubmission,
  getMyTasks,
  updateMyTaskStatus,
  getMySubmissions,
  getMyNotifications,
  markMyNotificationRead,
  getMyProfile,
  updateMyProfile,
  getSubmissionExecution,
  rerunSubmissionExecution,
  deleteMyProject,
  deleteMySubmission,
} from '../controllers/employeePortalController.js';
import {
  getMyAssignedSkills,
  getMySkillLevelTasks,
  getMyTaskDetails,
  runTaskCode,
  submitTask,
} from '../controllers/skillTaskController.js';
import { authenticate, requireEmployee } from '../middleware/auth.js';
import { uploadProjectArchive } from '../middleware/upload.js';

const router = express.Router();

// Strict RBAC middleware: Authenticated and role must be EMPLOYEE
router.use(authenticate, requireEmployee);

// Dashboard
router.get('/dashboard', getEmployeeDashboard);

// Projects
router.get('/projects', getMyProjects);
router.get('/projects/:id', getMyProjectDetails);
router.delete('/projects/:id', deleteMyProject);
router.patch('/projects/:id/start', startProject);
router.patch('/projects/:id/progress', updateProjectProgress);
router.post('/projects/upload', uploadProjectArchive.single('file'), uploadProjectSubmission);
router.post('/projects/:id/upload', uploadProjectArchive.single('file'), uploadProjectSubmission);

// Tasks
router.get('/tasks', getMyTasks);
router.patch('/tasks/:id/status', updateMyTaskStatus);

// Submissions
router.get('/submissions', getMySubmissions);
router.delete('/submissions/:submissionId', deleteMySubmission);
router.get('/submissions/:versionId/execution', getSubmissionExecution);
router.post('/submissions/:versionId/run', rerunSubmissionExecution);

// Notifications
router.get('/notifications', getMyNotifications);
router.patch('/notifications/:id/read', markMyNotificationRead);

// Profile (Primary skill is read-only)
router.get('/profile', getMyProfile);
router.patch('/profile', updateMyProfile);

// ─── SKILL-BASED CURRICULUM & TASKS (EMPLOYEE-SPECIFIC) ──────────────────────
router.get('/curriculum/skills', getMyAssignedSkills);
router.get('/curriculum/skills/:skillSlug/tasks', getMySkillLevelTasks);
router.get('/curriculum/tasks/:taskId', getMyTaskDetails);
router.post('/curriculum/tasks/:taskId/run', runTaskCode);
router.post('/curriculum/tasks/:taskId/submit', submitTask);

export default router;
