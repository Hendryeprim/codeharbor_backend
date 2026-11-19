import bcrypt from 'bcryptjs';
import prisma from '../database/prisma.js';
import { createAuditLog } from '../utils/auditLogger.js';
import { runIsolatedExecution } from '../services/isolatedExecutionService.js';
import { generateManagedProjectPreview } from '../services/managedProjectPreviewService.js';
import { runIsolatedProjectExecution } from '../services/isolatedExecutionWorker.js';

// ==========================================
// 1. DASHBOARD & STATS
// ==========================================
export const getAdminPortalDashboardStats = async (req, res, next) => {
  try {
    const totalEmployees = await prisma.employeeProfile.count();
    const activeEmployees = await prisma.employeeProfile.count({
      where: { status: 'ACTIVE' },
    });

    const totalProjects = await prisma.project.count();
    const assignedProjects = await prisma.project.count({
      where: { status: 'ASSIGNED' },
    });
    const projectsInProgress = await prisma.project.count({
      where: { status: 'IN_PROGRESS' },
    });
    const pendingReviews = await prisma.project.count({
      where: { status: { in: ['SUBMITTED', 'UNDER_REVIEW'] } },
    });
    const revisionRequired = await prisma.project.count({
      where: { status: 'REVISION_REQUIRED' },
    });
    const approvedProjects = await prisma.project.count({
      where: { status: 'APPROVED' },
    });

    const failedExecutions = await prisma.projectExecution.count({
      where: { status: 'FAILED' },
    });

    const now = new Date();
    const overdueProjects = await prisma.project.count({
      where: {
        dueDate: { lt: now },
        status: { notIn: ['APPROVED', 'COMPLETED'] },
      },
    });

    // Recent Projects
    const recentProjects = await prisma.project.findMany({
      take: 6,
      orderBy: { createdAt: 'desc' },
      include: {
        assignments: {
          include: {
            employeeProfile: {
              include: {
                user: {
                  select: { name: true, email: true, avatar: true },
                },
              },
            },
          },
        },
      },
    });

    // Recent Submissions
    const recentSubmissions = await prisma.projectSubmission.findMany({
      take: 6,
      orderBy: { submittedAt: 'desc' },
      include: {
        project: true,
        versions: {
          orderBy: { versionNumber: 'desc' },
          take: 1,
        },
      },
    });

    // Map recent submissions with employee details
    const mappedSubmissions = await Promise.all(
      recentSubmissions.map(async (sub) => {
        const empProfile = await prisma.employeeProfile.findUnique({
          where: { id: sub.employeeProfileId },
          include: { user: { select: { name: true, email: true } } },
        });
        const latestVer = sub.versions[0] || null;
        return {
          id: sub.id,
          project: sub.project.title,
          projectId: sub.projectId,
          employee: empProfile?.user?.name || 'Unknown',
          employeeId: empProfile?.employeeId || '',
          version: latestVer ? `v${latestVer.versionNumber}` : 'v1',
          versionId: latestVer?.id,
          liveDemoUrl: latestVer?.liveDemoUrl || null,
          submittedDate: sub.submittedAt,
          status: sub.status,
        };
      })
    );

    // Project Statistics for charts
    // 1. Status distribution
    const statusCounts = await prisma.project.groupBy({
      by: ['status'],
      _count: { status: true },
    });

    // 2. Technology distribution
    const techCounts = await prisma.project.groupBy({
      by: ['primarySkill'],
      _count: { primarySkill: true },
    });

    // 3. Employee performance summary
    const employeePerformances = await prisma.employeeProfile.findMany({
      take: 5,
      include: {
        user: { select: { name: true } },
        assignments: true,
      },
    });

    const mappedPerformance = employeePerformances.map((emp) => {
      const completed = emp.assignments.filter((a) => a.status === 'APPROVED').length;
      const total = emp.assignments.length;
      const scores = emp.assignments.filter((a) => a.score != null).map((a) => a.score);
      const avgScore = scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
      return {
        name: emp.user.name,
        assigned: total,
        completed,
        avgScore,
      };
    });

    // Approval rate calculation
    const reviewedTotal = approvedProjects + revisionRequired;
    const approvalRate = reviewedTotal > 0 ? Math.round((approvedProjects / reviewedTotal) * 100) : 100;

    res.status(200).json({
      success: true,
      cards: {
        totalEmployees,
        activeEmployees,
        totalProjects,
        assignedProjects,
        projectsInProgress,
        pendingReviews,
        revisionRequired,
        approvedProjects,
        failedExecutions,
        overdueProjects,
      },
      recentProjects: recentProjects.map((p) => {
        const emp = p.assignments[0]?.employeeProfile;
        return {
          id: p.id,
          title: p.title,
          employeeName: emp?.user?.name || 'Unassigned',
          employeeId: emp?.employeeId || '-',
          technology: p.primarySkill,
          framework: p.framework,
          status: p.status,
          dueDate: p.dueDate,
          priority: p.priority,
        };
      }),
      recentSubmissions: mappedSubmissions,
      charts: {
        projectStatus: statusCounts.map((s) => ({ status: s.status, count: s._count.status })),
        techDistribution: techCounts.map((t) => ({ technology: t.primarySkill, count: t._count.primarySkill })),
        employeePerformance: mappedPerformance,
        approvalRate,
      },
    });
  } catch (error) {
    next(error);
  }
};

// ==========================================
// 2. EMPLOYEE MANAGEMENT
// ==========================================
export const getAllEmployees = async (req, res, next) => {
  try {
    const { status, skill, search } = req.query;

    const where = {};
    if (status) {
      where.status = status;
    }
    if (skill) {
      where.primarySkill = skill;
    }
    if (search) {
      where.OR = [
        { employeeId: { contains: search, mode: 'insensitive' } },
        { department: { contains: search, mode: 'insensitive' } },
        { designation: { contains: search, mode: 'insensitive' } },
        { user: { name: { contains: search, mode: 'insensitive' } } },
        { user: { email: { contains: search, mode: 'insensitive' } } },
      ];
    }

    const profiles = await prisma.employeeProfile.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            status: true,
            avatar: true,
            phone: true,
          },
        },
        assignments: {
          select: {
            id: true,
            status: true,
            score: true,
          },
        },
      },
    });

    const employees = profiles.map((p) => {
      const assignedCount = p.assignments.length;
      const completedCount = p.assignments.filter((a) => a.status === 'APPROVED').length;
      const scores = p.assignments.filter((a) => a.score != null).map((a) => a.score);
      const avgScore = scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;

      return {
        id: p.id,
        userId: p.userId,
        employeeId: p.employeeId,
        name: p.user.name,
        email: p.user.email,
        department: p.department,
        designation: p.designation,
        primarySkill: p.primarySkill,
        joiningDate: p.joiningDate,
        status: p.status,
        assignedProjects: assignedCount,
        completedProjects: completedCount,
        averageScore: avgScore,
      };
    });

    res.status(200).json({
      success: true,
      employees,
    });
  } catch (error) {
    next(error);
  }
};

export const createEmployee = async (req, res, next) => {
  try {
    const {
      employeeId,
      name,
      email,
      password,
      confirmPassword,
      department,
      designation,
      primarySkill,
      joiningDate,
      status,
    } = req.body;

    if (!employeeId || !name || !email || !password || !department || !designation || !primarySkill) {
      return res.status(400).json({
        success: false,
        message: 'All fields are required to create an employee account.',
      });
    }

    if (confirmPassword && password !== confirmPassword) {
      return res.status(400).json({
        success: false,
        message: 'Password and Confirm Password do not match.',
      });
    }

    // Check duplicate email
    const existingUser = await prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
    });
    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: 'A user account with this email address already exists.',
      });
    }

    // Check duplicate employee ID
    const existingEmp = await prisma.employeeProfile.findUnique({
      where: { employeeId: employeeId.trim() },
    });
    if (existingEmp) {
      return res.status(409).json({
        success: false,
        message: 'An employee with this Employee ID already exists.',
      });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    // Create User with role EMPLOYEE and EmployeeProfile
    const user = await prisma.user.create({
      data: {
        name: name.trim(),
        email: email.toLowerCase().trim(),
        passwordHash,
        role: 'EMPLOYEE',
        status: status === 'DISABLED' ? 'RESTRICTED' : 'ACTIVE',
        employeeProfile: {
          create: {
            employeeId: employeeId.trim(),
            department: department.trim(),
            designation: designation.trim(),
            primarySkill: primarySkill.trim(),
            joiningDate: joiningDate ? new Date(joiningDate) : new Date(),
            status: status || 'ACTIVE',
          },
        },
      },
      include: {
        employeeProfile: true,
      },
    });

    await createAuditLog({
      userId: req.user.id,
      action: 'EMPLOYEE_CREATED',
      entity: 'Employee',
      entityId: user.employeeProfile.id,
      details: {
        employeeId: user.employeeProfile.employeeId,
        name: user.name,
        email: user.email,
        primarySkill: user.employeeProfile.primarySkill,
      },
      ipAddress: req.ip,
    });

    await createAuditLog({
      userId: req.user.id,
      action: 'SKILL_ASSIGNED',
      entity: 'EmployeeProfile',
      entityId: user.employeeProfile.id,
      details: {
        assignedSkill: primarySkill.trim(),
        assignedBy: req.user.name,
      },
      ipAddress: req.ip,
    });

    res.status(201).json({
      success: true,
      message: `Employee ${name} (${employeeId}) created successfully with Primary Skill: ${primarySkill}.`,
      employee: {
        id: user.employeeProfile.id,
        userId: user.id,
        employeeId: user.employeeProfile.employeeId,
        name: user.name,
        email: user.email,
        department: user.employeeProfile.department,
        designation: user.employeeProfile.designation,
        primarySkill: user.employeeProfile.primarySkill,
        joiningDate: user.employeeProfile.joiningDate,
        status: user.employeeProfile.status,
      },
    });
  } catch (error) {
    next(error);
  }
};

export const getEmployeeById = async (req, res, next) => {
  try {
    const { id } = req.params;

    const profile = await prisma.employeeProfile.findFirst({
      where: {
        OR: [{ id }, { employeeId: id }, { userId: id }],
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            avatar: true,
            phone: true,
            createdAt: true,
          },
        },
        skills: true,
        assignments: {
          include: {
            project: {
              include: {
                submissions: {
                  include: {
                    versions: {
                      orderBy: { versionNumber: 'desc' },
                      take: 1,
                    },
                  },
                },
              },
            },
          },
          orderBy: { assignedAt: 'desc' },
        },
      },
    });

    if (!profile) {
      return res.status(404).json({ success: false, message: 'Employee not found.' });
    }

    const assignedCount = profile.assignments.length;
    const completedCount = profile.assignments.filter((a) => a.status === 'APPROVED').length;
    const approvedCount = completedCount;
    const pendingCount = profile.assignments.filter((a) => ['ASSIGNED', 'IN_PROGRESS', 'SUBMITTED', 'UNDER_REVIEW'].includes(a.status)).length;
    const revisionCount = profile.assignments.filter((a) => a.status === 'REVISION_REQUIRED').length;

    const scores = profile.assignments.filter((a) => a.score != null).map((a) => a.score);
    const avgScore = scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;

    res.status(200).json({
      success: true,
      employee: {
        id: profile.id,
        userId: profile.userId,
        employeeId: profile.employeeId,
        name: profile.user.name,
        email: profile.user.email,
        department: profile.department,
        designation: profile.designation,
        primarySkill: profile.primarySkill,
        joiningDate: profile.joiningDate,
        status: profile.status,
        stats: {
          assignedProjects: assignedCount,
          completedProjects: completedCount,
          approvedProjects: approvedCount,
          pendingProjects: pendingCount,
          revisionRequired: revisionCount,
          averageScore: avgScore,
        },
        assignments: profile.assignments.map((a) => ({
          assignmentId: a.id,
          projectId: a.projectId,
          projectTitle: a.project.title,
          projectType: a.project.projectType,
          status: a.status,
          score: a.score,
          assignedAt: a.assignedAt,
          dueDate: a.project.dueDate,
          progress: a.project.progress,
        })),
        skills: profile.skills,
      },
    });
  } catch (error) {
    next(error);
  }
};

export const updateEmployee = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { department, designation, primarySkill, status, password } = req.body;

    const profile = await prisma.employeeProfile.findUnique({
      where: { id },
    });
    if (!profile) {
      return res.status(404).json({ success: false, message: 'Employee profile not found.' });
    }

    const data = {};
    if (department !== undefined) data.department = department.trim();
    if (designation !== undefined) data.designation = designation.trim();
    if (primarySkill !== undefined) data.primarySkill = primarySkill.trim();
    if (status !== undefined) {
      data.status = status;
      // Also sync User status
      await prisma.user.update({
        where: { id: profile.userId },
        data: { status: status === 'DISABLED' ? 'RESTRICTED' : 'ACTIVE' },
      });
    }

    // Update password if provided
    if (password && typeof password === 'string' && password.trim().length > 0) {
      const passwordHash = await bcrypt.hash(password.trim(), 10);
      await prisma.user.update({
        where: { id: profile.userId },
        data: { passwordHash },
      });
      await createAuditLog({
        userId: req.user.id,
        action: 'EMPLOYEE_PASSWORD_RESET',
        entity: 'User',
        entityId: profile.userId,
        details: { resetBy: req.user.email },
        ipAddress: req.ip,
      });
    }

    const updated = await prisma.employeeProfile.update({
      where: { id },
      data,
    });

    await createAuditLog({
      userId: req.user.id,
      action: 'EMPLOYEE_UPDATED',
      entity: 'EmployeeProfile',
      entityId: id,
      details: data,
      ipAddress: req.ip,
    });

    if (primarySkill && primarySkill !== profile.primarySkill) {
      await createAuditLog({
        userId: req.user.id,
        action: 'SKILL_ASSIGNED',
        entity: 'EmployeeProfile',
        entityId: id,
        details: { oldSkill: profile.primarySkill, newSkill: primarySkill },
        ipAddress: req.ip,
      });
    }

    res.status(200).json({
      success: true,
      message: 'Employee updated successfully.',
      employee: updated,
    });
  } catch (error) {
    next(error);
  }
};

export const toggleEmployeeStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const profile = await prisma.employeeProfile.findUnique({ where: { id } });
    if (!profile) {
      return res.status(404).json({ success: false, message: 'Employee not found.' });
    }

    const newStatus = profile.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE';

    await prisma.employeeProfile.update({
      where: { id },
      data: { status: newStatus },
    });

    await prisma.user.update({
      where: { id: profile.userId },
      data: { status: newStatus === 'DISABLED' ? 'RESTRICTED' : 'ACTIVE' },
    });

    await createAuditLog({
      userId: req.user.id,
      action: 'EMPLOYEE_UPDATED',
      entity: 'EmployeeProfile',
      entityId: id,
      details: { status: newStatus },
      ipAddress: req.ip,
    });

    res.status(200).json({
      success: true,
      message: `Employee status changed to ${newStatus}.`,
      status: newStatus,
    });
  } catch (error) {
    next(error);
  }
};

export const getEmployeePerformance = async (req, res, next) => {
  try {
    const profiles = await prisma.employeeProfile.findMany({
      include: {
        user: { select: { name: true, email: true } },
        assignments: true,
      },
    });

    const performance = profiles.map((p) => {
      const total = p.assignments.length;
      const completed = p.assignments.filter((a) => a.status === 'APPROVED').length;
      const inProgress = p.assignments.filter((a) => a.status === 'IN_PROGRESS').length;
      const revision = p.assignments.filter((a) => a.status === 'REVISION_REQUIRED').length;
      const scores = p.assignments.filter((a) => a.score != null).map((a) => a.score);
      const avgScore = scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
      const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0;

      return {
        id: p.id,
        employeeId: p.employeeId,
        name: p.user.name,
        department: p.department,
        designation: p.designation,
        primarySkill: p.primarySkill,
        totalAssigned: total,
        completed,
        inProgress,
        revisionRequired: revision,
        averageScore: avgScore,
        completionRate,
      };
    });

    res.status(200).json({
      success: true,
      performance,
    });
  } catch (error) {
    next(error);
  }
};

export const getEmployeeSkills = async (req, res, next) => {
  try {
    const profiles = await prisma.employeeProfile.findMany({
      select: {
        primarySkill: true,
        employeeId: true,
        user: { select: { name: true } },
      },
    });

    const skillMap = {};
    for (const p of profiles) {
      if (!skillMap[p.primarySkill]) {
        skillMap[p.primarySkill] = [];
      }
      skillMap[p.primarySkill].push({
        employeeId: p.employeeId,
        name: p.user.name,
      });
    }

    const skills = Object.keys(skillMap).map((skillName) => ({
      skill: skillName,
      employeeCount: skillMap[skillName].length,
      employees: skillMap[skillName],
    }));

    res.status(200).json({
      success: true,
      skills,
    });
  } catch (error) {
    next(error);
  }
};

// ==========================================
// 3. PROJECT MANAGEMENT
// ==========================================
export const getAllManagedProjects = async (req, res, next) => {
  try {
    const { status, skill, employeeId, search } = req.query;

    const where = {};
    if (status) {
      where.status = status;
    }
    if (skill) {
      where.primarySkill = skill;
    }
    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
        { framework: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (employeeId) {
      where.assignments = {
        some: {
          employeeProfile: {
            OR: [{ id: employeeId }, { employeeId }],
          },
        },
      };
    }

    const projects = await prisma.project.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        assignments: {
          include: {
            employeeProfile: {
              include: {
                user: { select: { name: true, email: true, avatar: true } },
              },
            },
          },
        },
        submissions: {
          include: {
            versions: {
              orderBy: { versionNumber: 'desc' },
              take: 1,
            },
          },
        },
        requirements: true,
      },
    });

    const mapped = projects.map((p) => {
      const assignment = p.assignments[0] || null;
      const emp = assignment?.employeeProfile || null;
      const latestSub = p.submissions[0] || null;
      const latestVer = latestSub?.versions[0] || null;

      return {
        id: p.id,
        title: p.title,
        description: p.description,
        projectType: p.projectType,
        primarySkill: p.primarySkill,
        framework: p.framework,
        database: p.database,
        frontend: p.frontend,
        difficulty: p.difficulty,
        priority: p.priority,
        status: p.status,
        progress: p.progress,
        startDate: p.startDate,
        dueDate: p.dueDate,
        createdAt: p.createdAt,
        assignedEmployee: emp
          ? {
              id: emp.id,
              employeeId: emp.employeeId,
              name: emp.user.name,
              email: emp.user.email,
              designation: emp.designation,
              primarySkill: emp.primarySkill,
            }
          : null,
        requirementsCount: p.requirements.length,
        completedRequirementsCount: p.requirements.filter((r) => r.isCompleted).length,
        latestSubmission: latestVer
          ? {
              versionNumber: latestVer.versionNumber,
              submittedAt: latestVer.createdAt,
              validationStatus: latestVer.validationStatus,
            }
          : null,
      };
    });

    res.status(200).json({
      success: true,
      projects: mapped,
    });
  } catch (error) {
    next(error);
  }
};

export const createManagedProject = async (req, res, next) => {
  try {
    const {
      title,
      description,
      projectType,
      employeeProfileId, // Admin selects employee
      framework,
      database,
      frontend,
      difficulty,
      priority,
      startDate,
      dueDate,
      objective,
      requirements, // Array of strings or { title, description }
      technicalRequirements,
      additionalRequirements,
      referenceFiles,
      submissionRequirements, // Array of strings e.g. ["Source Code", "README", ...]
      executionConfig,
    } = req.body;

    if (!title || !description || !projectType || !employeeProfileId) {
      return res.status(400).json({
        success: false,
        message: 'Project title, description, project type, and assigned employee are required.',
      });
    }

    // 1. Fetch employee profile to AUTO-LOAD Primary Skill directly from EmployeeProfile
    const employeeProfile = await prisma.employeeProfile.findUnique({
      where: { id: employeeProfileId },
      include: { user: true },
    });

    if (!employeeProfile) {
      return res.status(404).json({
        success: false,
        message: 'Selected employee profile not found.',
      });
    }

    // Rule: Primary Skill comes directly from Employee Profile!
    const primarySkill = employeeProfile.primarySkill;

    // 2. Create Project
    const project = await prisma.project.create({
      data: {
        title: title.trim(),
        description: description.trim(),
        projectType,
        primarySkill,
        framework: framework ? framework.trim() : null,
        database: database ? database.trim() : null,
        frontend: frontend ? frontend.trim() : null,
        difficulty: difficulty || 'Medium',
        priority: priority || 'Medium',
        startDate: startDate ? new Date(startDate) : new Date(),
        dueDate: dueDate ? new Date(dueDate) : null,
        objective: objective ? objective.trim() : null,
        technicalRequirements: technicalRequirements ? technicalRequirements.trim() : null,
        additionalRequirements: additionalRequirements ? additionalRequirements.trim() : null,
        referenceFiles: referenceFiles || [],
        submissionRequirements: submissionRequirements || [
          'Source Code',
          'README',
          'Database / SQL',
          'Documentation',
        ],
        executionConfig: executionConfig || {},
        status: 'ASSIGNED',
        progress: 0,
        createdById: req.user.id,
      },
    });

    // 3. Create Project Assignment
    await prisma.projectAssignment.create({
      data: {
        projectId: project.id,
        employeeProfileId: employeeProfile.id,
        status: 'ASSIGNED',
        assignedAt: new Date(),
      },
    });

    // 4. Create Project Requirements
    if (requirements && Array.isArray(requirements) && requirements.length > 0) {
      for (const reqItem of requirements) {
        const reqTitle = typeof reqItem === 'string' ? reqItem.trim() : reqItem.title;
        const reqDesc = typeof reqItem === 'object' ? reqItem.description : null;
        if (reqTitle) {
          await prisma.projectRequirement.create({
            data: {
              projectId: project.id,
              title: reqTitle,
              description: reqDesc,
            },
          });
        }
      }
    }

    // 5. Send Notification to Employee
    await prisma.notification.create({
      data: {
        userId: employeeProfile.userId,
        title: 'New Project Assigned',
        message: `You have been assigned to project "${project.title}" (${project.projectType}) with primary tech ${primarySkill}. Due date: ${dueDate ? new Date(dueDate).toLocaleDateString() : 'TBD'}.`,
        type: 'PROJECT_ASSIGNED',
        link: `/employee/projects/${project.id}`,
      },
    });

    // 6. Audit Logs
    await createAuditLog({
      userId: req.user.id,
      action: 'PROJECT_CREATED',
      entity: 'Project',
      entityId: project.id,
      details: {
        title: project.title,
        projectType: project.projectType,
        primarySkill: project.primarySkill,
      },
      ipAddress: req.ip,
    });

    await createAuditLog({
      userId: req.user.id,
      action: 'PROJECT_ASSIGNED',
      entity: 'ProjectAssignment',
      entityId: project.id,
      details: {
        projectId: project.id,
        employeeId: employeeProfile.employeeId,
        employeeName: employeeProfile.user.name,
      },
      ipAddress: req.ip,
    });

    res.status(201).json({
      success: true,
      message: `Project "${project.title}" created and successfully assigned to ${employeeProfile.user.name} (${employeeProfile.employeeId}).`,
      project,
    });
  } catch (error) {
    next(error);
  }
};

export const getManagedProjectById = async (req, res, next) => {
  try {
    const { id } = req.params;

    const project = await prisma.project.findUnique({
      where: { id },
      include: {
        assignments: {
          include: {
            employeeProfile: {
              include: {
                user: { select: { id: true, name: true, email: true, avatar: true } },
              },
            },
          },
        },
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
                  take: 1,
                  include: {
                    testResults: true,
                  },
                },
                feedbacks: {
                  orderBy: { createdAt: 'desc' },
                },
              },
            },
          },
          orderBy: { submittedAt: 'desc' },
        },
        tasks: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!project) {
      return res.status(404).json({ success: false, message: 'Project not found.' });
    }

    res.status(200).json({
      success: true,
      project,
    });
  } catch (error) {
    next(error);
  }
};

export const updateManagedProject = async (req, res, next) => {
  try {
    const { id } = req.params;
    const {
      title,
      description,
      projectType,
      framework,
      database,
      frontend,
      difficulty,
      priority,
      startDate,
      dueDate,
      objective,
      technicalRequirements,
      additionalRequirements,
      submissionRequirements,
      status,
      progress,
    } = req.body;

    const data = {};
    if (title !== undefined) data.title = title.trim();
    if (description !== undefined) data.description = description.trim();
    if (projectType !== undefined) data.projectType = projectType;
    if (framework !== undefined) data.framework = framework;
    if (database !== undefined) data.database = database;
    if (frontend !== undefined) data.frontend = frontend;
    if (difficulty !== undefined) data.difficulty = difficulty;
    if (priority !== undefined) data.priority = priority;
    if (startDate !== undefined) data.startDate = startDate ? new Date(startDate) : null;
    if (dueDate !== undefined) data.dueDate = dueDate ? new Date(dueDate) : null;
    if (objective !== undefined) data.objective = objective;
    if (technicalRequirements !== undefined) data.technicalRequirements = technicalRequirements;
    if (additionalRequirements !== undefined) data.additionalRequirements = additionalRequirements;
    if (submissionRequirements !== undefined) data.submissionRequirements = submissionRequirements;
    if (status !== undefined) data.status = status;
    if (progress !== undefined) data.progress = Number(progress);

    const updated = await prisma.project.update({
      where: { id },
      data,
    });

    res.status(200).json({
      success: true,
      message: 'Project updated successfully.',
      project: updated,
    });
  } catch (error) {
    next(error);
  }
};

export const deleteManagedProject = async (req, res, next) => {
  try {
    const { id } = req.params;
    await prisma.project.delete({ where: { id } });
    res.status(200).json({ success: true, message: 'Project deleted successfully.' });
  } catch (error) {
    next(error);
  }
};

// ==========================================
// 4. PROJECT REVIEWS & EXECUTION
// ==========================================
export const getAllProjectReviews = async (req, res, next) => {
  try {
    const submissions = await prisma.projectSubmission.findMany({
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
              take: 1,
            },
          },
        },
      },
    });

    const reviews = await Promise.all(
      submissions.map(async (sub) => {
        const empProfile = await prisma.employeeProfile.findUnique({
          where: { id: sub.employeeProfileId },
          include: { user: { select: { name: true, email: true, avatar: true } } },
        });

        const latestVersion = sub.versions[0] || null;
        const latestExec = latestVersion?.executions[0] || null;
        const latestFeedback = latestVersion?.feedbacks[0] || null;

        return {
          id: sub.id,
          submissionId: sub.id,
          projectId: sub.projectId,
          projectTitle: sub.project.title,
          projectType: sub.project.projectType,
          technology: sub.project.primarySkill,
          framework: sub.project.framework,
          database: sub.project.database,
          employee: {
            id: empProfile?.id,
            employeeId: empProfile?.employeeId,
            name: empProfile?.user?.name || 'Unknown',
            email: empProfile?.user?.email,
          },
          currentVersion: sub.currentVersion,
          latestVersionNumber: latestVersion?.versionNumber || 1,
          latestVersionId: latestVersion?.id,
          submittedAt: sub.submittedAt,
          status: sub.status,
          hasPackageFile: Boolean(latestVersion?.filePath),
          githubUrl: latestVersion?.githubUrl,
          liveDemoUrl: latestVersion?.liveDemoUrl,
          executionStatus: latestExec?.status || 'NOT_RUN',
          buildStatus: latestExec?.buildStatus,
          testStatus: latestExec?.testStatus,
          score: latestFeedback?.overallScore || null,
        };
      })
    );

    res.status(200).json({
      success: true,
      reviews,
    });
  } catch (error) {
    next(error);
  }
};

export const getProjectReviewById = async (req, res, next) => {
  try {
    const { submissionId } = req.params;

    const submission = await prisma.projectSubmission.findUnique({
      where: { id: submissionId },
      include: {
        project: {
          include: {
            requirements: true,
          },
        },
        versions: {
          orderBy: { versionNumber: 'desc' },
          include: {
            executions: {
              orderBy: { createdAt: 'desc' },
              include: {
                testResults: true,
              },
            },
            feedbacks: {
              orderBy: { createdAt: 'desc' },
            },
          },
        },
        feedbacks: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!submission) {
      return res.status(404).json({ success: false, message: 'Submission not found.' });
    }

    const empProfile = await prisma.employeeProfile.findUnique({
      where: { id: submission.employeeProfileId },
      include: { user: { select: { id: true, name: true, email: true, avatar: true } } },
    });

    res.status(200).json({
      success: true,
      submission,
      employee: empProfile,
    });
  } catch (error) {
    next(error);
  }
};

export const runVersionExecution = async (req, res, next) => {
  try {
    const { versionId } = req.params;

    await createAuditLog({
      userId: req.user.id,
      action: 'EXECUTION_STARTED',
      entity: 'ProjectVersion',
      entityId: versionId,
      details: { executedBy: req.user.name },
      ipAddress: req.ip,
    });

    const execution = await runIsolatedExecution(versionId, req.user.id);

    try {
      await generateManagedProjectPreview({ versionId, executedById: req.user.id });
    } catch (prevErr) {
      console.warn('[Admin Run] Preview generation failed:', prevErr.message);
    }

    await createAuditLog({
      userId: req.user.id,
      action: execution.status === 'COMPLETED' ? 'EXECUTION_COMPLETED' : 'EXECUTION_FAILED',
      entity: 'ProjectExecution',
      entityId: execution.id,
      details: {
        status: execution.status,
        buildStatus: execution.buildStatus,
        testStatus: execution.testStatus,
        runtimeMs: execution.runtimeMs,
      },
      ipAddress: req.ip,
    });

    // Notify employee of completed automated execution
    const version = await prisma.projectVersion.findUnique({
      where: { id: versionId },
      include: { submission: { include: { project: true } } },
    });
    if (version) {
      const empProfile = await prisma.employeeProfile.findUnique({
        where: { id: version.submission.employeeProfileId },
      });
      if (empProfile) {
        await prisma.notification.create({
          data: {
            userId: empProfile.userId,
            title: 'Project Execution & Testing Completed',
            message: `Automated sandbox verification completed for ${version.submission.project.title} (v${version.versionNumber}). Result: ${execution.status}.`,
            type: 'EXECUTION_COMPLETED',
            link: `/employee/projects/${version.submission.projectId}`,
          },
        });
      }
    }

    res.status(200).json({
      success: true,
      message: 'Isolated execution finished.',
      execution,
    });
  } catch (error) {
    next(error);
  }
};

export const stopVersionExecution = async (req, res, next) => {
  try {
    const { versionId } = req.params;
    const running = await prisma.projectExecution.findFirst({
      where: { versionId, status: 'RUNNING' },
    });

    if (running) {
      await prisma.projectExecution.update({
        where: { id: running.id },
        data: {
          status: 'STOPPED',
          completedAt: new Date(),
          consoleLogs: (running.consoleLogs || '') + '\n[Admin Action] Execution stopped by administrator.',
        },
      });
    }

    res.status(200).json({
      success: true,
      message: 'Execution stopped.',
    });
  } catch (error) {
    next(error);
  }
};

export const submitProjectReviewFeedback = async (req, res, next) => {
  try {
    const { submissionId } = req.params;
    const {
      versionId,
      status, // APPROVED, REVISION_REQUESTED, REJECTED, COMMENT
      comments,
      technicalFeedback,
      requiredChanges,
      testingFeedback,
      revisionDeadline,
      rejectionReason,
      scoreCodeQuality,
      scoreFunctionality,
      scoreUiUx,
      scoreDatabase,
      scoreTesting,
      scoreDocumentation,
      scorePerformance,
      scoreSecurity,
      overallScore,
    } = req.body;

    if (!status) {
      return res.status(400).json({ success: false, message: 'Review decision status is required.' });
    }

    const submission = await prisma.projectSubmission.findUnique({
      where: { id: submissionId },
      include: { project: true },
    });

    if (!submission) {
      return res.status(404).json({ success: false, message: 'Submission not found.' });
    }

    // 1. Create Feedback Record
    const feedback = await prisma.projectFeedback.create({
      data: {
        submissionId,
        versionId: versionId || null,
        reviewerId: req.user.id,
        status,
        comments: comments || null,
        technicalFeedback: technicalFeedback || null,
        requiredChanges: requiredChanges || null,
        testingFeedback: testingFeedback || null,
        revisionDeadline: revisionDeadline ? new Date(revisionDeadline) : null,
        rejectionReason: rejectionReason || null,
        scoreCodeQuality: scoreCodeQuality != null ? Number(scoreCodeQuality) : null,
        scoreFunctionality: scoreFunctionality != null ? Number(scoreFunctionality) : null,
        scoreUiUx: scoreUiUx != null ? Number(scoreUiUx) : null,
        scoreDatabase: scoreDatabase != null ? Number(scoreDatabase) : null,
        scoreTesting: scoreTesting != null ? Number(scoreTesting) : null,
        scoreDocumentation: scoreDocumentation != null ? Number(scoreDocumentation) : null,
        scorePerformance: scorePerformance != null ? Number(scorePerformance) : null,
        scoreSecurity: scoreSecurity != null ? Number(scoreSecurity) : null,
        overallScore: overallScore != null ? Number(overallScore) : null,
      },
    });

    // 2. Map submission and project statuses
    let newSubmissionStatus = 'UNDER_REVIEW';
    let newProjectStatus = submission.project.status;
    let newAssignmentStatus = submission.project.status;

    if (status === 'APPROVED') {
      newSubmissionStatus = 'APPROVED';
      newProjectStatus = 'APPROVED';
      newAssignmentStatus = 'APPROVED';
    } else if (status === 'REVISION_REQUESTED') {
      newSubmissionStatus = 'REVISION_REQUIRED';
      newProjectStatus = 'REVISION_REQUIRED';
      newAssignmentStatus = 'REVISION_REQUIRED';
    } else if (status === 'REJECTED') {
      newSubmissionStatus = 'REJECTED';
      newProjectStatus = 'REJECTED';
      newAssignmentStatus = 'REJECTED';
    }

    // Update ProjectSubmission
    await prisma.projectSubmission.update({
      where: { id: submissionId },
      data: { status: newSubmissionStatus },
    });

    // Update Project
    await prisma.project.update({
      where: { id: submission.projectId },
      data: {
        status: newProjectStatus,
        progress: status === 'APPROVED' ? 100 : submission.project.progress,
      },
    });

    // Update Assignment
    await prisma.projectAssignment.updateMany({
      where: {
        projectId: submission.projectId,
        employeeProfileId: submission.employeeProfileId,
      },
      data: {
        status: newAssignmentStatus,
        score: overallScore != null ? Number(overallScore) : undefined,
        completedAt: status === 'APPROVED' ? new Date() : undefined,
      },
    });

    // 3. Notify Employee
    const empProfile = await prisma.employeeProfile.findUnique({
      where: { id: submission.employeeProfileId },
    });

    if (empProfile) {
      let notifTitle = 'Project Feedback Received';
      let notifMsg = `Admin submitted review feedback for project "${submission.project.title}".`;
      let notifType = 'FEEDBACK_ADDED';

      if (status === 'APPROVED') {
        notifTitle = 'Project Approved Successfully!';
        notifMsg = `Congratulations! Your project "${submission.project.title}" has been reviewed and approved with a score of ${overallScore || 100}/100.`;
        notifType = 'PROJECT_APPROVED';
      } else if (status === 'REVISION_REQUESTED') {
        notifTitle = 'Project Revision Required';
        notifMsg = `Revision requested for "${submission.project.title}". Reason: ${requiredChanges || comments || 'Please review admin feedback.'} Deadline: ${revisionDeadline ? new Date(revisionDeadline).toLocaleDateString() : 'ASAP'}.`;
        notifType = 'REVISION_REQUIRED';
      } else if (status === 'REJECTED') {
        notifTitle = 'Project Rejected';
        notifMsg = `Project "${submission.project.title}" was rejected. Reason: ${rejectionReason || 'Please review admin feedback.'}`;
        notifType = 'PROJECT_REJECTED';
      }

      await prisma.notification.create({
        data: {
          userId: empProfile.userId,
          title: notifTitle,
          message: notifMsg,
          type: notifType,
          link: `/employee/projects/${submission.projectId}`,
        },
      });
    }

    // 4. Audit Log
    await createAuditLog({
      userId: req.user.id,
      action: status === 'APPROVED' ? 'APPROVED' : status === 'REVISION_REQUESTED' ? 'REVISION_REQUESTED' : status === 'REJECTED' ? 'REJECTED' : 'FEEDBACK_ADDED',
      entity: 'ProjectSubmission',
      entityId: submissionId,
      details: {
        status,
        overallScore,
        comments,
        requiredChanges,
      },
      ipAddress: req.ip,
    });

    res.status(200).json({
      success: true,
      message: `Review recorded: ${status}.`,
      feedback,
    });
  } catch (error) {
    next(error);
  }
};

// ==========================================
// 5. TASKS
// ==========================================
export const getAllTasks = async (req, res, next) => {
  try {
    const { projectId, employeeProfileId, status } = req.query;
    const where = {};
    if (projectId) where.projectId = projectId;
    if (employeeProfileId) where.employeeProfileId = employeeProfileId;
    if (status) where.status = status;

    const tasks = await prisma.projectTask.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        project: { select: { id: true, title: true, primarySkill: true } },
        employeeProfile: {
          include: {
            user: { select: { name: true, email: true } },
          },
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
        project: {
          id: t.project.id,
          title: t.project.title,
          technology: t.project.primarySkill,
        },
        employee: {
          id: t.employeeProfile.id,
          employeeId: t.employeeProfile.employeeId,
          name: t.employeeProfile.user.name,
        },
      })),
    });
  } catch (error) {
    next(error);
  }
};

export const createTask = async (req, res, next) => {
  try {
    const { title, description, projectId, employeeProfileId, priority, startDate, dueDate } = req.body;

    if (!title || !projectId || !employeeProfileId) {
      return res.status(400).json({
        success: false,
        message: 'Task title, project, and employee are required.',
      });
    }

    const task = await prisma.projectTask.create({
      data: {
        title: title.trim(),
        description: description ? description.trim() : null,
        projectId,
        employeeProfileId,
        priority: priority || 'Medium',
        startDate: startDate ? new Date(startDate) : new Date(),
        dueDate: dueDate ? new Date(dueDate) : null,
        status: 'Pending',
        createdById: req.user.id,
      },
      include: {
        project: true,
        employeeProfile: { include: { user: true } },
      },
    });

    // Notify employee
    await prisma.notification.create({
      data: {
        userId: task.employeeProfile.userId,
        title: 'New Task Assigned',
        message: `Task "${task.title}" has been assigned to you on project "${task.project.title}".`,
        type: 'TASK_ASSIGNED',
        link: `/employee/tasks`,
      },
    });

    res.status(201).json({
      success: true,
      message: 'Task created successfully.',
      task,
    });
  } catch (error) {
    next(error);
  }
};

export const updateTask = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { title, description, priority, status, startDate, dueDate } = req.body;

    const data = {};
    if (title !== undefined) data.title = title.trim();
    if (description !== undefined) data.description = description.trim();
    if (priority !== undefined) data.priority = priority;
    if (status !== undefined) data.status = status;
    if (startDate !== undefined) data.startDate = startDate ? new Date(startDate) : null;
    if (dueDate !== undefined) data.dueDate = dueDate ? new Date(dueDate) : null;

    const task = await prisma.projectTask.update({
      where: { id },
      data,
    });

    res.status(200).json({
      success: true,
      message: 'Task updated successfully.',
      task,
    });
  } catch (error) {
    next(error);
  }
};

export const deleteTask = async (req, res, next) => {
  try {
    const { id } = req.params;
    await prisma.projectTask.delete({ where: { id } });
    res.status(200).json({ success: true, message: 'Task deleted successfully.' });
  } catch (error) {
    next(error);
  }
};

// ==========================================
// 6. EXECUTIONS LOGS
// ==========================================
export const getAllExecutions = async (req, res, next) => {
  try {
    const executions = await prisma.projectExecution.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        version: {
          include: {
            submission: {
              include: {
                project: true,
              },
            },
          },
        },
        testResults: true,
      },
    });

    const mapped = await Promise.all(
      executions.map(async (exec) => {
        const empProfile = await prisma.employeeProfile.findUnique({
          where: { id: exec.version.submission.employeeProfileId },
          include: { user: { select: { name: true } } },
        });

        return {
          id: exec.id,
          versionNumber: exec.version.versionNumber,
          versionId: exec.versionId,
          projectTitle: exec.version.submission.project.title,
          projectId: exec.version.submission.projectId,
          employeeName: empProfile?.user?.name || 'Unknown',
          status: exec.status,
          buildStatus: exec.buildStatus,
          testStatus: exec.testStatus,
          runtimeMs: exec.runtimeMs,
          exitCode: exec.exitCode,
          createdAt: exec.createdAt,
          testsCount: exec.testResults.length,
          passedCount: exec.testResults.filter((t) => t.status === 'PASS').length,
        };
      })
    );

    res.status(200).json({
      success: true,
      executions: mapped,
    });
  } catch (error) {
    next(error);
  }
};

export const getExecutionById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const execution = await prisma.projectExecution.findUnique({
      where: { id },
      include: {
        version: {
          include: {
            submission: {
              include: {
                project: true,
              },
            },
          },
        },
        testResults: true,
      },
    });

    if (!execution) {
      return res.status(404).json({ success: false, message: 'Execution not found.' });
    }

    res.status(200).json({
      success: true,
      execution,
    });
  } catch (error) {
    next(error);
  }
};

// ==========================================
// 7. NOTIFICATIONS & AUDIT LOGS
// ==========================================
export const getAdminNotifications = async (req, res, next) => {
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

export const markNotificationRead = async (req, res, next) => {
  try {
    const { id } = req.params;
    await prisma.notification.update({
      where: { id },
      data: { isRead: true },
    });
    res.status(200).json({ success: true, message: 'Notification marked as read.' });
  } catch (error) {
    next(error);
  }
};

export const getAuditLogs = async (req, res, next) => {
  try {
    const logs = await prisma.auditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        user: { select: { name: true, email: true, role: true } },
      },
    });

    res.status(200).json({
      success: true,
      logs,
    });
  } catch (error) {
    next(error);
  }
};

export const downloadSubmissionVersionFile = async (req, res, next) => {
  try {
    const { versionId } = req.params;
    const version = await prisma.projectVersion.findUnique({
      where: { id: versionId },
    });
    if (!version || !version.filePath || !fs.existsSync(version.filePath)) {
      return res.status(404).json({ success: false, message: 'Archive file not found on disk.' });
    }
    return res.download(version.filePath, version.fileName || 'submission.zip');
  } catch (error) {
    next(error);
  }
};

export const getAdminProjectExecution = async (req, res, next) => {
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

export const rerunAdminProjectExecution = async (req, res, next) => {
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
      message: 'Project execution re-run completed.',
      previewUrl,
      execution: updatedExecution,
    });
  } catch (error) {
    next(error);
  }
};
