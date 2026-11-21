import prisma from '../database/prisma.js';
import { createAuditLog } from '../utils/auditLogger.js';
import { analyzeProjectStructure, extractZipSafely } from '../services/isolatedExecutionService.js';
import { generateManagedProjectPreview } from '../services/managedProjectPreviewService.js';
import { runIsolatedProjectExecution } from '../services/isolatedExecutionWorker.js';
import path from 'path';
import fs from 'fs';

// Helper to get authenticated employee's profile
const getAuthenticatedProfile = async (userId) => {
  return await prisma.employeeProfile.findUnique({
    where: { userId },
    include: {
      user: {
        select: { id: true, name: true, email: true, avatar: true, phone: true, company: true },
      },
    },
  });
};

// ==========================================
// 1. DASHBOARD
// ==========================================
export const getEmployeeDashboard = async (req, res, next) => {
  try {
    const profile = await getAuthenticatedProfile(req.user.id);
    if (!profile) {
      return res.status(404).json({
        success: false,
        message: 'Employee profile not found.',
      });
    }

    const assignments = await prisma.projectAssignment.findMany({
      where: { employeeProfileId: profile.id },
      include: {
        project: {
          include: {
            submissions: {
              include: {
                versions: {
                  orderBy: { versionNumber: 'desc' },
                  take: 1,
                  include: {
                    feedbacks: {
                      orderBy: { createdAt: 'desc' },
                      take: 1,
                    },
                  },
                },
              },
            },
          },
        },
      },
      orderBy: { assignedAt: 'desc' },
    });

    const now = new Date();
    const assignedCount = assignments.filter((a) => a.project.status === 'ASSIGNED').length;
    const inProgressCount = assignments.filter((a) => a.project.status === 'IN_PROGRESS').length;
    const submittedCount = assignments.filter((a) => ['SUBMITTED', 'UNDER_REVIEW'].includes(a.project.status)).length;
    const revisionCount = assignments.filter((a) => a.project.status === 'REVISION_REQUIRED').length;
    const approvedCount = assignments.filter((a) => a.project.status === 'APPROVED').length;
    const overdueCount = assignments.filter(
      (a) => a.project.dueDate && a.project.dueDate < now && a.project.status !== 'APPROVED'
    ).length;

    // Recent tasks
    const tasks = await prisma.projectTask.findMany({
      where: { employeeProfileId: profile.id },
      orderBy: { createdAt: 'desc' },
      take: 5,
      include: { project: { select: { title: true } } },
    });

    // Recent notifications
    const notifications = await prisma.notification.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: 'desc' },
      take: 6,
    });

    res.status(200).json({
      success: true,
      profile: {
        id: profile.id,
        employeeId: profile.employeeId,
        name: profile.user.name,
        email: profile.user.email,
        department: profile.department,
        designation: profile.designation,
        primarySkill: profile.primarySkill, // READ-ONLY!
        status: profile.status,
        joiningDate: profile.joiningDate,
      },
      cards: {
        assigned: assignedCount,
        inProgress: inProgressCount,
        submitted: submittedCount,
        revisionRequired: revisionCount,
        approved: approvedCount,
        overdue: overdueCount,
      },
      recentProjects: assignments.slice(0, 5).map((a) => ({
        id: a.project.id,
        title: a.project.title,
        projectType: a.project.projectType,
        technology: a.project.primarySkill,
        framework: a.project.framework,
        database: a.project.database,
        priority: a.project.priority,
        startDate: a.project.startDate,
        dueDate: a.project.dueDate,
        status: a.project.status,
        progress: a.project.progress,
      })),
      recentTasks: tasks,
      notifications,
    });
  } catch (error) {
    next(error);
  }
};

// ==========================================
// 2. MY PROJECTS
// ==========================================
export const getMyProjects = async (req, res, next) => {
  try {
    const profile = await getAuthenticatedProfile(req.user.id);
    if (!profile) {
      return res.status(404).json({ success: false, message: 'Employee profile not found.' });
    }

    const { status } = req.query;

    const where = {
      employeeProfileId: profile.id,
    };

    if (status && status !== 'ALL') {
      if (status === 'ASSIGNED') where.project = { status: 'ASSIGNED' };
      else if (status === 'IN_PROGRESS') where.project = { status: 'IN_PROGRESS' };
      else if (status === 'SUBMITTED') where.project = { status: { in: ['SUBMITTED', 'UNDER_REVIEW'] } };
      else if (status === 'REVISION_REQUIRED') where.project = { status: 'REVISION_REQUIRED' };
      else if (status === 'APPROVED') where.project = { status: 'APPROVED' };
    }

    const assignments = await prisma.projectAssignment.findMany({
      where,
      include: {
        project: {
          include: {
            requirements: true,
            submissions: {
              include: {
                versions: {
                  orderBy: { versionNumber: 'desc' },
                  take: 1,
                  include: {
                    feedbacks: { orderBy: { createdAt: 'desc' }, take: 1 },
                  },
                },
              },
            },
          },
        },
      },
      orderBy: { assignedAt: 'desc' },
    });

    const projects = assignments.map((a) => {
      const p = a.project;
      const latestSub = p.submissions[0] || null;
      const latestVer = latestSub?.versions[0] || null;
      const latestFeedback = latestVer?.feedbacks[0] || null;

      return {
        id: p.id,
        title: p.title,
        description: p.description,
        projectType: p.projectType,
        primaryTechnology: p.primarySkill,
        framework: p.framework,
        database: p.database,
        frontend: p.frontend,
        difficulty: p.difficulty,
        priority: p.priority,
        startDate: p.startDate,
        dueDate: p.dueDate,
        status: p.status,
        progress: p.progress,
        requirementsCount: p.requirements.length,
        completedRequirementsCount: p.requirements.filter((r) => r.isCompleted).length,
        currentVersion: latestVer ? `v${latestVer.versionNumber}` : null,
        liveDemoUrl: latestVer?.liveDemoUrl || null,
        feedback: latestFeedback
          ? {
              status: latestFeedback.status,
              comments: latestFeedback.comments,
              requiredChanges: latestFeedback.requiredChanges,
              overallScore: latestFeedback.overallScore,
            }
          : null,
      };
    });

    res.status(200).json({
      success: true,
      projects,
    });
  } catch (error) {
    next(error);
  }
};

export const getMyProjectDetails = async (req, res, next) => {
  try {
    const { id } = req.params;
    const profile = await getAuthenticatedProfile(req.user.id);
    if (!profile) {
      return res.status(404).json({ success: false, message: 'Employee profile not found.' });
    }

    // SECURITY CHECK: Verify project is assigned to this employee (prevent IDOR)
    const assignment = await prisma.projectAssignment.findUnique({
      where: {
        projectId_employeeProfileId: {
          projectId: id,
          employeeProfileId: profile.id,
        },
      },
      include: {
        project: {
          include: {
            requirements: {
              orderBy: { id: 'asc' },
            },
            submissions: {
              include: {
                versions: {
                  orderBy: { versionNumber: 'desc' },
                  include: {
                    executions: {
                      orderBy: { createdAt: 'desc' },
                      include: { testResults: true },
                    },
                    feedbacks: {
                      orderBy: { createdAt: 'desc' },
                    },
                  },
                },
              },
            },
            tasks: {
              where: { employeeProfileId: profile.id },
              orderBy: { createdAt: 'desc' },
            },
          },
        },
      },
    });

    if (!assignment) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You are not assigned to this project.',
      });
    }

    res.status(200).json({
      success: true,
      project: assignment.project,
      assignment: {
        id: assignment.id,
        status: assignment.status,
        score: assignment.score,
        assignedAt: assignment.assignedAt,
        startedAt: assignment.startedAt,
        completedAt: assignment.completedAt,
      },
    });
  } catch (error) {
    next(error);
  }
};

export const startProject = async (req, res, next) => {
  try {
    const { id } = req.params;
    const profile = await getAuthenticatedProfile(req.user.id);

    const assignment = await prisma.projectAssignment.findUnique({
      where: {
        projectId_employeeProfileId: {
          projectId: id,
          employeeProfileId: profile.id,
        },
      },
      include: { project: true },
    });

    if (!assignment) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }

    await prisma.project.update({
      where: { id },
      data: {
        status: 'IN_PROGRESS',
        progress: assignment.project.progress > 0 ? assignment.project.progress : 10,
      },
    });

    await prisma.projectAssignment.update({
      where: { id: assignment.id },
      data: {
        status: 'IN_PROGRESS',
        startedAt: new Date(),
      },
    });

    await createAuditLog({
      userId: req.user.id,
      action: 'PROJECT_STARTED',
      entity: 'Project',
      entityId: id,
      details: { startedBy: req.user.name, employeeId: profile.employeeId },
      ipAddress: req.ip,
    });

    res.status(200).json({
      success: true,
      message: 'Project status changed to In Progress.',
    });
  } catch (error) {
    next(error);
  }
};

export const updateProjectProgress = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { progress, completedRequirements } = req.body;
    const profile = await getAuthenticatedProfile(req.user.id);

    const assignment = await prisma.projectAssignment.findUnique({
      where: {
        projectId_employeeProfileId: {
          projectId: id,
          employeeProfileId: profile.id,
        },
      },
    });

    if (!assignment) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }

    if (progress !== undefined) {
      await prisma.project.update({
        where: { id },
        data: { progress: Number(progress) },
      });
    }

    if (completedRequirements && Array.isArray(completedRequirements)) {
      for (const reqId of completedRequirements) {
        await prisma.projectRequirement.updateMany({
          where: { id: reqId, projectId: id },
          data: { isCompleted: true },
        });
      }
    }

    res.status(200).json({
      success: true,
      message: 'Progress updated successfully.',
    });
  } catch (error) {
    next(error);
  }
};

// ==========================================
// 3. PROJECT UPLOAD & SUBMISSION (VERSIONING)
// ==========================================
export const uploadProjectSubmission = async (req, res, next) => {
  try {
    const { id } = req.params;
    const {
      title,
      projectType,
      primarySkill,
      framework,
      database,
      description,
      githubUrl,
      liveDemoUrl,
      readmeContent,
      documentation,
      notes,
    } = req.body;
    const file = req.file;
    const profile = await getAuthenticatedProfile(req.user.id);

    if (!profile) {
      return res.status(404).json({ success: false, message: 'Employee profile not found.' });
    }

    if (!file && !githubUrl && !liveDemoUrl) {
      return res.status(400).json({
        success: false,
        message: 'Please provide either a project archive file (.zip, .tar, .rar) or a GitHub repository link.',
      });
    }

    let targetProject = null;
    let targetAssignment = null;

    // Direct Employee Upload (New Project made by Employee)
    if (!id || id === 'new') {
      const projTitle = (title && title.trim()) || (file ? path.parse(file.originalname).name : 'Employee Project');
      targetProject = await prisma.project.create({
        data: {
          title: projTitle,
          projectType: projectType || 'Real-Time Project',
          primarySkill: primarySkill || profile.primarySkill,
          framework: framework ? framework.trim() : 'Standard Framework',
          database: database ? database.trim() : 'PostgreSQL',
          description: description ? description.trim() : `Project created and delivered by ${profile.user.name} (${profile.employeeId}).`,
          status: 'SUBMITTED',
          progress: 100,
          createdById: profile.userId,
        },
      });

      targetAssignment = await prisma.projectAssignment.create({
        data: {
          projectId: targetProject.id,
          employeeProfileId: profile.id,
          status: 'SUBMITTED',
          startedAt: new Date(),
        },
      });
    } else {
      // Existing Assigned Project
      targetAssignment = await prisma.projectAssignment.findUnique({
        where: {
          projectId_employeeProfileId: {
            projectId: id,
            employeeProfileId: profile.id,
          },
        },
        include: { project: true },
      });

      if (!targetAssignment) {
        return res.status(403).json({ success: false, message: 'Access denied. You are not assigned to this project.' });
      }
      targetProject = targetAssignment.project;
    }

    // Find or create ProjectSubmission container
    let submission = await prisma.projectSubmission.findFirst({
      where: {
        projectId: targetProject.id,
        employeeProfileId: profile.id,
      },
      include: {
        versions: {
          orderBy: { versionNumber: 'desc' },
          take: 1,
        },
      },
    });

    let nextVersionNumber = 1;
    if (submission) {
      nextVersionNumber = (submission.versions[0]?.versionNumber || 0) + 1;
    } else {
      submission = await prisma.projectSubmission.create({
        data: {
          projectId: targetProject.id,
          employeeProfileId: profile.id,
          currentVersion: 1,
          status: 'SUBMITTED',
        },
        include: { versions: true },
      });
    }

    // Automated structure validation
    let validationReport = {
      valid: true,
      checks: ['File type verified', 'Size check within policy limit'],
    };

    if (file) {
      const ext = path.extname(file.originalname).toLowerCase();
      validationReport.fileExtension = ext;
      validationReport.fileSizeFormatted = `${(file.size / (1024 * 1024)).toFixed(2)} MB`;
      if (ext === '.zip') {
        try {
          const zip = new (await import('adm-zip')).default(file.path);
          const entries = zip.getEntries().map((e) => e.entryName);
          validationReport.entriesCount = entries.length;
          validationReport.hasReadme = entries.some((e) => e.toLowerCase().includes('readme'));
          validationReport.hasManifest = entries.some(
            (e) =>
              e.endsWith('requirements.txt') ||
              e.endsWith('pom.xml') ||
              e.endsWith('package.json') ||
              e.endsWith('.sql')
          );
        } catch (e) {
          validationReport.zipWarning = 'Archive opened with warning: ' + e.message;
        }
      }
    }

    // CREATE NEW VERSION: Never overwrite old versions!
    const version = await prisma.projectVersion.create({
      data: {
        submissionId: submission.id,
        versionNumber: nextVersionNumber,
        filePath: file ? file.path : null,
        fileName: file ? file.originalname : null,
        fileSize: file ? BigInt(file.size) : null,
        githubUrl: githubUrl ? githubUrl.trim() : null,
        liveDemoUrl: liveDemoUrl ? liveDemoUrl.trim() : null,
        readmeContent: readmeContent || null,
        documentation: documentation || null,
        notes: notes || null,
        validationStatus: 'VALID',
        validationReport,
      },
    });

    // Automatically trigger Isolated Execution Worker (Clone -> Detect -> Install -> Build -> Run -> Port -> Preview)
    runIsolatedProjectExecution({
      versionId: version.id,
      executedById: req.user.id,
    }).catch((prevErr) => {
      console.warn('[Submission Preview] Error in execution worker:', prevErr.message);
    });

    const targetDirName = `managed-${version.id}`;
    const generatedPreviewUrl = version.liveDemoUrl || `/previews/${targetDirName}/`;

    // Update ProjectSubmission current version & status
    await prisma.projectSubmission.update({
      where: { id: submission.id },
      data: {
        currentVersion: nextVersionNumber,
        status: 'SUBMITTED',
      },
    });

    // Update Project and Assignment status to SUBMITTED and progress to 100%
    await prisma.project.update({
      where: { id: targetProject.id },
      data: { status: 'SUBMITTED', progress: 100 },
    });

    await prisma.projectAssignment.update({
      where: { id: targetAssignment.id },
      data: { status: 'SUBMITTED' },
    });

    // Notify Administrators
    const admins = await prisma.user.findMany({ where: { role: 'ADMIN' }, select: { id: true } });
    for (const adm of admins) {
      await prisma.notification.create({
        data: {
          userId: adm.id,
          title: `Project Uploaded: ${targetProject.title} (v${nextVersionNumber})`,
          message: `${profile.user.name} uploaded version ${nextVersionNumber} for "${targetProject.title}".`,
          type: nextVersionNumber > 1 ? 'RESUBMITTED' : 'PROJECT_SUBMITTED',
          link: `/admin/project-reviews/${submission.id}`,
        },
      });
    }

    // Audit Log
    await createAuditLog({
      userId: req.user.id,
      action: nextVersionNumber > 1 ? 'RESUBMISSION' : 'SUBMISSION_CREATED',
      entity: 'ProjectVersion',
      entityId: version.id,
      details: {
        projectId: targetProject.id,
        projectTitle: targetProject.title,
        versionNumber: nextVersionNumber,
        fileName: file?.originalname,
        previewUrl: generatedPreviewUrl,
      },
      ipAddress: req.ip,
    });

    res.status(201).json({
      success: true,
      message: `Project "${targetProject.title}" (v${nextVersionNumber}) uploaded and live output screen ready!`,
      project: {
        id: targetProject.id,
        title: targetProject.title,
        status: targetProject.status,
      },
      version: {
        id: version.id,
        versionNumber: version.versionNumber,
        fileName: version.fileName,
        githubUrl: version.githubUrl,
        liveDemoUrl: generatedPreviewUrl,
        submittedAt: version.createdAt,
        validationStatus: version.validationStatus,
      },
    });
  } catch (error) {
    next(error);
  }
};

// ==========================================
// 4. TASKS
// ==========================================
export const getMyTasks = async (req, res, next) => {
  try {
    const profile = await getAuthenticatedProfile(req.user.id);
    if (!profile) {
      return res.status(404).json({ success: false, message: 'Employee profile not found.' });
    }

    const tasks = await prisma.projectTask.findMany({
      where: { employeeProfileId: profile.id },
      orderBy: { createdAt: 'desc' },
      include: {
        project: {
          select: { id: true, title: true, primarySkill: true },
        },
      },
    });

    res.status(200).json({
      success: true,
      tasks: tasks.map((t) => ({
        id: t.id,
        title: t.title,
        description: t.description,
        priority: t.priority,
        status: t.status,
        startDate: t.startDate,
        dueDate: t.dueDate,
        project: t.project,
      })),
    });
  } catch (error) {
    next(error);
  }
};

export const updateMyTaskStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const profile = await getAuthenticatedProfile(req.user.id);

    // Verify task belongs to this employee
    const task = await prisma.projectTask.findFirst({
      where: { id, employeeProfileId: profile.id },
    });

    if (!task) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }

    const updated = await prisma.projectTask.update({
      where: { id },
      data: { status },
    });

    res.status(200).json({
      success: true,
      message: 'Task status updated.',
      task: updated,
    });
  } catch (error) {
    next(error);
  }
};

// ==========================================
// 5. SUBMISSIONS HISTORY
// ==========================================
export const getMySubmissions = async (req, res, next) => {
  try {
    const profile = await getAuthenticatedProfile(req.user.id);
    if (!profile) {
      return res.status(404).json({ success: false, message: 'Employee profile not found.' });
    }

    const submissions = await prisma.projectSubmission.findMany({
      where: { employeeProfileId: profile.id },
      orderBy: { submittedAt: 'desc' },
      include: {
        project: true,
        versions: {
          orderBy: { versionNumber: 'desc' },
          include: {
            executions: {
              orderBy: { createdAt: 'desc' },
              take: 1,
            },
            feedbacks: {
              orderBy: { createdAt: 'desc' },
            },
          },
        },
      },
    });

    res.status(200).json({
      success: true,
      submissions,
    });
  } catch (error) {
    next(error);
  }
};

// ==========================================
// 6. NOTIFICATIONS
// ==========================================
export const getMyNotifications = async (req, res, next) => {
  try {
    const notifications = await prisma.notification.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: 'desc' },
      take: 40,
    });

    res.status(200).json({
      success: true,
      notifications,
    });
  } catch (error) {
    next(error);
  }
};

export const markMyNotificationRead = async (req, res, next) => {
  try {
    const { id } = req.params;
    await prisma.notification.updateMany({
      where: { id, userId: req.user.id },
      data: { isRead: true },
    });
    res.status(200).json({ success: true, message: 'Notification marked as read.' });
  } catch (error) {
    next(error);
  }
};

// ==========================================
// 7. EMPLOYEE PROFILE (READ ONLY PRIMARY SKILL!)
// ==========================================
export const getMyProfile = async (req, res, next) => {
  try {
    const profile = await getAuthenticatedProfile(req.user.id);
    if (!profile) {
      return res.status(404).json({ success: false, message: 'Employee profile not found.' });
    }

    res.status(200).json({
      success: true,
      profile: {
        id: profile.id,
        employeeId: profile.employeeId,
        name: profile.user.name,
        email: profile.user.email,
        department: profile.department,
        designation: profile.designation,
        primarySkill: profile.primarySkill, // READ-ONLY!
        status: profile.status,
        joiningDate: profile.joiningDate,
        phone: profile.user.phone,
        company: profile.user.company,
        avatar: profile.user.avatar,
      },
    });
  } catch (error) {
    next(error);
  }
};

export const updateMyProfile = async (req, res, next) => {
  try {
    const { phone, company, avatar, primarySkill, employeeId, department, designation } = req.body;

    // IMPORTANT SECURITY RULE: Employee CANNOT change primarySkill, employeeId, department, designation!
    if (primarySkill || employeeId || department || designation) {
      return res.status(403).json({
        success: false,
        message: 'Security Violation: Primary Skill, Employee ID, Department, and Designation are strictly Admin-controlled and cannot be edited by the employee.',
      });
    }

    const updatedUser = await prisma.user.update({
      where: { id: req.user.id },
      data: {
        phone: phone !== undefined ? phone : undefined,
        company: company !== undefined ? company : undefined,
        avatar: avatar !== undefined ? avatar : undefined,
      },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        company: true,
        avatar: true,
      },
    });

    res.status(200).json({
      success: true,
      message: 'Profile updated successfully.',
      user: updatedUser,
    });
  } catch (error) {
    next(error);
  }
};

// ==========================================
// 8. EXECUTION & LOGS (REAL-TIME TERMINAL)
// ==========================================

export const getSubmissionExecution = async (req, res, next) => {
  try {
    const { versionId } = req.params;
    const execution = await prisma.projectExecution.findFirst({
      where: { versionId },
      orderBy: { createdAt: 'desc' },
      include: {
        testResults: true,
      },
    });

    const version = await prisma.projectVersion.findUnique({
      where: { id: versionId },
      select: {
        id: true,
        versionNumber: true,
        liveDemoUrl: true,
        githubUrl: true,
        fileName: true,
        filePath: true,
      },
    });

    res.status(200).json({
      success: true,
      execution: execution || null,
      version: version || null,
    });
  } catch (error) {
    next(error);
  }
};

export const rerunSubmissionExecution = async (req, res, next) => {
  try {
    const { versionId } = req.params;
    const previewUrl = await runIsolatedProjectExecution({
      versionId,
      executedById: req.user.id,
    });

    const updatedExecution = await prisma.projectExecution.findFirst({
      where: { versionId },
      orderBy: { createdAt: 'desc' },
      include: {
        testResults: true,
      },
    });

    res.status(200).json({
      success: true,
      message: 'Project execution completed.',
      previewUrl,
      execution: updatedExecution,
    });
  } catch (error) {
    next(error);
  }
};

// ==========================================
// 8. DELETE PROJECT & SUBMISSION (EMPLOYEE)
// ==========================================
export const deleteMyProject = async (req, res, next) => {
  try {
    const { id } = req.params;
    const profile = await getAuthenticatedProfile(req.user.id);
    if (!profile) {
      return res.status(404).json({ success: false, message: 'Employee profile not found.' });
    }

    // Verify employee has permission on this project
    const project = await prisma.project.findFirst({
      where: {
        id,
        OR: [
          { createdById: profile.userId },
          { assignments: { some: { employeeProfileId: profile.id } } },
        ],
      },
      include: {
        submissions: {
          include: {
            versions: {
              include: { executions: true },
            },
          },
        },
      },
    });

    if (!project) {
      return res.status(404).json({
        success: false,
        message: 'Project not found or you do not have permission to delete it.',
      });
    }

    // Clean up disk directories and files
    try {
      for (const sub of project.submissions || []) {
        for (const ver of sub.versions || []) {
          if (ver.filePath && fs.existsSync(ver.filePath)) {
            try { fs.unlinkSync(ver.filePath); } catch (e) {}
          }
          for (const exec of ver.executions || []) {
            if (exec.sandboxPath && fs.existsSync(exec.sandboxPath)) {
              try { fs.rmSync(exec.sandboxPath, { recursive: true, force: true }); } catch (e) {}
            }
          }
        }
      }
      const previewDir = path.resolve(process.cwd(), 'public/previews', `managed-${project.id.slice(0, 8)}`);
      if (fs.existsSync(previewDir)) {
        try { fs.rmSync(previewDir, { recursive: true, force: true }); } catch (e) {}
      }
    } catch (cleanErr) {
      console.warn('[DeleteProject] Cleanup warning:', cleanErr.message);
    }

    // Delete project from database (cascades to assignments, requirements, submissions, versions, executions, tasks)
    await prisma.project.delete({
      where: { id: project.id },
    });

    await createAuditLog({
      userId: req.user.id,
      action: 'PROJECT_DELETED',
      entity: 'Project',
      entityId: project.id,
      details: { deletedBy: profile.user.name, title: project.title },
      ipAddress: req.ip,
    });

    res.status(200).json({
      success: true,
      message: `Project "${project.title}" deleted successfully.`,
    });
  } catch (error) {
    next(error);
  }
};

export const deleteMySubmission = async (req, res, next) => {
  try {
    const { submissionId } = req.params;
    const profile = await getAuthenticatedProfile(req.user.id);
    if (!profile) {
      return res.status(404).json({ success: false, message: 'Employee profile not found.' });
    }

    const submission = await prisma.projectSubmission.findFirst({
      where: {
        id: submissionId,
        employeeProfileId: profile.id,
      },
      include: {
        versions: {
          include: { executions: true },
        },
        project: true,
      },
    });

    if (!submission) {
      return res.status(404).json({
        success: false,
        message: 'Submission not found or access denied.',
      });
    }

    // Cleanup files
    try {
      for (const ver of submission.versions || []) {
        if (ver.filePath && fs.existsSync(ver.filePath)) {
          try { fs.unlinkSync(ver.filePath); } catch (e) {}
        }
        for (const exec of ver.executions || []) {
          if (exec.sandboxPath && fs.existsSync(exec.sandboxPath)) {
            try { fs.rmSync(exec.sandboxPath, { recursive: true, force: true }); } catch (e) {}
          }
        }
      }
    } catch (e) {}

    // Delete submission
    await prisma.projectSubmission.delete({
      where: { id: submissionId },
    });

    // Check if remaining submissions exist for this project
    const remainingCount = await prisma.projectSubmission.count({
      where: { projectId: submission.projectId },
    });

    if (remainingCount === 0 && submission.project) {
      await prisma.project.update({
        where: { id: submission.projectId },
        data: { status: 'IN_PROGRESS', progress: 30 },
      });
    }

    res.status(200).json({
      success: true,
      message: 'Submission deleted successfully.',
    });
  } catch (error) {
    next(error);
  }
};
