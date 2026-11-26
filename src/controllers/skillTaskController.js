import prisma from '../database/prisma.js';
import { executeCodeSnippet, executeMultiFileProject } from '../services/codeExecutionService.js';
import { fetchGithubRepoFiles, buildWorkspaceZipBuffer } from '../services/githubRepoService.js';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * EMPLOYEE CONTROLLERS
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * Get skills assigned to the authenticated employee ONLY
 */
export const getMyAssignedSkills = async (req, res, next) => {
  try {
    const profile = await prisma.employeeProfile.findUnique({
      where: { userId: req.user.id },
      include: {
        skillTracks: {
          include: {
            skill: {
              include: {
                tasks: {
                  where: { status: 'ACTIVE' },
                },
              },
            },
          },
        },
        skillProgress: true,
      },
    });

    if (!profile) {
      return res.status(404).json({ success: false, message: 'Employee profile not found.' });
    }

    const assignedSkills = profile.skillTracks.map((track) => {
      const skill = track.skill;
      const progress = profile.skillProgress.find((p) => p.skillId === skill.id) || {
        unlockedLevel: 'BASIC',
        basicCompleted: false,
        intermediateCompleted: false,
        advancedCompleted: false,
      };

      const basicTasks = skill.tasks.filter((t) => t.level === 'BASIC');
      const intermediateTasks = skill.tasks.filter((t) => t.level === 'INTERMEDIATE');
      const advancedTasks = skill.tasks.filter((t) => t.level === 'ADVANCED');

      return {
        id: skill.id,
        name: skill.name,
        slug: skill.slug,
        description: skill.description,
        icon: skill.icon,
        assignedAt: track.assignedAt,
        unlockedLevel: progress.unlockedLevel,
        levels: {
          BASIC: {
            status: progress.basicCompleted ? 'COMPLETED' : 'UNLOCKED',
            isUnlocked: true,
            taskCount: basicTasks.length,
          },
          INTERMEDIATE: {
            status: progress.intermediateCompleted
              ? 'COMPLETED'
              : progress.unlockedLevel === 'INTERMEDIATE' || progress.unlockedLevel === 'ADVANCED'
              ? 'UNLOCKED'
              : 'LOCKED',
            isUnlocked: progress.unlockedLevel === 'INTERMEDIATE' || progress.unlockedLevel === 'ADVANCED',
            taskCount: intermediateTasks.length,
          },
          ADVANCED: {
            status: progress.advancedCompleted
              ? 'COMPLETED'
              : progress.unlockedLevel === 'ADVANCED'
              ? 'UNLOCKED'
              : 'LOCKED',
            isUnlocked: progress.unlockedLevel === 'ADVANCED',
            taskCount: advancedTasks.length,
          },
        },
      };
    });

    res.status(200).json({
      success: true,
      employee: {
        id: profile.id,
        name: req.user.name,
        employeeId: profile.employeeId,
      },
      skills: assignedSkills,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get tasks for a specific skill and level assigned to the employee
 */
export const getMySkillLevelTasks = async (req, res, next) => {
  try {
    const { skillSlug } = req.params;
    const requestedLevel = (req.query.level || 'BASIC').toUpperCase();

    const profile = await prisma.employeeProfile.findUnique({
      where: { userId: req.user.id },
      include: {
        skillTracks: {
          include: { skill: true },
        },
        skillProgress: true,
      },
    });

    if (!profile) {
      return res.status(404).json({ success: false, message: 'Employee profile not found.' });
    }

    const assignedTrack = profile.skillTracks.find((t) => t.skill.slug === skillSlug);
    if (!assignedTrack) {
      return res.status(403).json({
        success: false,
        message: 'This skill path is not assigned to your employee account.',
      });
    }

    const skill = assignedTrack.skill;
    let progress = profile.skillProgress.find((p) => p.skillId === skill.id);

    // Auto-initialize progress if not existing
    if (!progress) {
      progress = await prisma.employeeSkillProgress.create({
        data: {
          employeeProfileId: profile.id,
          skillId: skill.id,
          unlockedLevel: 'BASIC',
        },
      });
    }

    // Check lock state
    const isUnlocked =
      requestedLevel === 'BASIC' ||
      (requestedLevel === 'INTERMEDIATE' &&
        (progress.unlockedLevel === 'INTERMEDIATE' || progress.unlockedLevel === 'ADVANCED')) ||
      (requestedLevel === 'ADVANCED' && progress.unlockedLevel === 'ADVANCED');

    if (!isUnlocked) {
      return res.status(403).json({
        success: false,
        message: `The ${requestedLevel} level for ${skill.name} is currently locked. Complete and receive approval for all preceding level tasks to unlock it.`,
      });
    }

    // Fetch tasks and user's submissions
    const tasks = await prisma.skillTask.findMany({
      where: {
        skillId: skill.id,
        level: requestedLevel,
        status: 'ACTIVE',
      },
      orderBy: { orderIndex: 'asc' },
      include: {
        submissions: {
          where: { employeeProfileId: profile.id },
          orderBy: { submittedAt: 'desc' },
          take: 1,
        },
      },
    });

    const formattedTasks = tasks.map((t) => {
      const sub = t.submissions[0] || null;
      return {
        id: t.id,
        title: t.title,
        description: t.description,
        instructions: t.instructions,
        expectedOutput: t.expectedOutput,
        difficulty: t.difficulty,
        githubRepoUrl: t.githubRepoUrl,
        githubBranch: t.githubBranch,
        isRequired: t.isRequired,
        initialCode: t.initialCode,
        mySubmission: sub
          ? {
              id: sub.id,
              status: sub.status,
              submittedCode: sub.submittedCode,
              executionOutput: sub.executionOutput,
              adminComment: sub.adminComment,
              submittedAt: sub.submittedAt,
              reviewedAt: sub.reviewedAt,
            }
          : null,
      };
    });

    res.status(200).json({
      success: true,
      skill: {
        id: skill.id,
        name: skill.name,
        slug: skill.slug,
        level: requestedLevel,
        unlockedLevel: progress.unlockedLevel,
      },
      tasks: formattedTasks,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get single task details for coding workspace
 */
export const getMyTaskDetails = async (req, res, next) => {
  try {
    const { taskId } = req.params;

    const profile = await prisma.employeeProfile.findUnique({
      where: { userId: req.user.id },
      include: {
        skillTracks: true,
        skillProgress: true,
      },
    });

    if (!profile) {
      return res.status(404).json({ success: false, message: 'Employee profile not found.' });
    }

    const task = await prisma.skillTask.findUnique({
      where: { id: taskId },
      include: {
        skill: true,
        submissions: {
          where: { employeeProfileId: profile.id },
          orderBy: { submittedAt: 'desc' },
          take: 1,
        },
      },
    });

    if (!task) {
      return res.status(404).json({ success: false, message: 'Task not found.' });
    }

    // Verify assigned
    const isAssigned = profile.skillTracks.some((t) => t.skillId === task.skillId);
    if (!isAssigned) {
      return res.status(403).json({ success: false, message: 'Skill not assigned to your profile.' });
    }

    // Verify unlocked
    const progress = profile.skillProgress.find((p) => p.skillId === task.skillId) || { unlockedLevel: 'BASIC' };
    const isUnlocked =
      task.level === 'BASIC' ||
      (task.level === 'INTERMEDIATE' &&
        (progress.unlockedLevel === 'INTERMEDIATE' || progress.unlockedLevel === 'ADVANCED')) ||
      (task.level === 'ADVANCED' && progress.unlockedLevel === 'ADVANCED');

    if (!isUnlocked) {
      return res.status(403).json({ success: false, message: 'This task is locked.' });
    }

    res.status(200).json({
      success: true,
      task: {
        id: task.id,
        skillId: task.skillId,
        skillName: task.skill.name,
        skillSlug: task.skill.slug,
        level: task.level,
        title: task.title,
        description: task.description,
        instructions: task.instructions,
        expectedOutput: task.expectedOutput,
        difficulty: task.difficulty,
        githubRepoUrl: task.githubRepoUrl,
        githubBranch: task.githubBranch,
        initialCode: task.initialCode,
        mySubmission: task.submissions[0] || null,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Fetch repository folder & files for a task's GitHub URL
 */
export const getMyTaskRepoFiles = async (req, res, next) => {
  try {
    const { taskId } = req.params;
    const task = await prisma.skillTask.findUnique({
      where: { id: taskId },
      select: { id: true, title: true, githubRepoUrl: true, githubBranch: true },
    });

    if (!task) {
      return res.status(404).json({ success: false, message: 'Task not found.' });
    }

    if (!task.githubRepoUrl) {
      return res.status(200).json({
        success: true,
        repo: null,
        files: [],
      });
    }

    const repoData = await fetchGithubRepoFiles(task.githubRepoUrl, task.githubBranch || 'main');
    res.status(200).json({
      success: true,
      repo: {
        owner: repoData.owner,
        repo: repoData.repo,
        branch: repoData.branch,
      },
      files: repoData.files,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message || 'Failed to load repository files.',
    });
  }
};

/**
 * Download full task/project folder as a .zip archive
 */
export const downloadMyTaskWorkspaceZip = async (req, res, next) => {
  try {
    const { taskId } = req.params;
    const task = await prisma.skillTask.findUnique({
      where: { id: taskId },
      include: { skill: true },
    });

    if (!task) {
      return res.status(404).json({ success: false, message: 'Task not found.' });
    }

    let filesToZip = Array.isArray(req.body?.files) && req.body.files.length > 0 ? req.body.files : null;

    if (!filesToZip && task.githubRepoUrl) {
      const repoData = await fetchGithubRepoFiles(task.githubRepoUrl, task.githubBranch || 'main');
      filesToZip = repoData.files;
    }

    if (!filesToZip || filesToZip.length === 0) {
      const ext = task.skill?.slug === 'sql' ? 'sql' : task.skill?.slug === 'java' ? 'java' : 'py';
      filesToZip = [{ filename: `solution.${ext}`, content: task.initialCode || '' }];
    }

    const zipBuffer = buildWorkspaceZipBuffer(filesToZip);
    const safeName = (task.title || 'project')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'project';

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}.zip"`);
    res.setHeader('Content-Length', zipBuffer.length);
    return res.send(zipBuffer);
  } catch (error) {
    next(error);
  }
};

/**
 * Run task code in secure isolated sandbox
 */
export const runTaskCode = async (req, res, next) => {
  try {
    const { taskId } = req.params;
    const { code, projectFiles, entryFile } = req.body;

    const task = await prisma.skillTask.findUnique({
      where: { id: taskId },
      include: { skill: true },
    });

    if (!task) {
      return res.status(404).json({ success: false, message: 'Task not found.' });
    }

    let result;
    if (Array.isArray(projectFiles) && projectFiles.length > 0) {
      result = await executeMultiFileProject({
        skillSlug: task.skill.slug,
        files: projectFiles,
        entryFile: entryFile || 'main.py',
        timeoutMs: 12000,
      });
    } else {
      result = await executeCodeSnippet({
        language: task.skill.slug,
        code: code || '',
        timeoutMs: 10000,
      });
    }

    res.status(200).json({
      success: true,
      stdout: result.stdout,
      stderr: result.stderr,
      executionTimeMs: result.executionTimeMs,
      exitCode: result.exitCode,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Submit task code for Administrator review
 */
export const submitTask = async (req, res, next) => {
  try {
    const { taskId } = req.params;
    const { submittedCode, projectFiles, githubRepoUrl, executionOutput } = req.body;

    const profile = await prisma.employeeProfile.findUnique({
      where: { userId: req.user.id },
      include: { skillTracks: true },
    });

    if (!profile) {
      return res.status(404).json({ success: false, message: 'Employee profile not found.' });
    }

    const task = await prisma.skillTask.findUnique({
      where: { id: taskId },
      include: { skill: true },
    });

    if (!task) {
      return res.status(404).json({ success: false, message: 'Task not found.' });
    }

    // Verify skill assignment
    const isAssigned = profile.skillTracks.some((t) => t.skillId === task.skillId);
    if (!isAssigned) {
      return res.status(403).json({ success: false, message: 'Skill not assigned to your account.' });
    }

    // Check existing submission or create new
    const existing = await prisma.skillTaskSubmission.findFirst({
      where: {
        taskId,
        employeeProfileId: profile.id,
      },
    });

    let submission;
    if (existing) {
      submission = await prisma.skillTaskSubmission.update({
        where: { id: existing.id },
        data: {
          submittedCode: submittedCode || existing.submittedCode,
          projectFiles: projectFiles ? projectFiles : existing.projectFiles,
          githubRepoUrl: githubRepoUrl !== undefined ? githubRepoUrl : existing.githubRepoUrl,
          executionOutput: executionOutput || existing.executionOutput,
          status: 'PENDING_REVIEW',
          adminComment: null, // Reset comment for re-review
          submittedAt: new Date(),
        },
      });
    } else {
      submission = await prisma.skillTaskSubmission.create({
        data: {
          taskId,
          employeeProfileId: profile.id,
          submittedCode: submittedCode || '',
          projectFiles: projectFiles ? projectFiles : null,
          githubRepoUrl: githubRepoUrl || null,
          executionOutput: executionOutput || '',
          status: 'PENDING_REVIEW',
        },
      });
    }

    // Notify administrators
    const admins = await prisma.user.findMany({ where: { role: 'ADMIN' }, select: { id: true } });
    for (const adm of admins) {
      await prisma.notification.create({
        data: {
          userId: adm.id,
          title: `Task Submitted: ${task.title}`,
          message: `${req.user.name} submitted task "${task.title}" (${task.skill.name} - ${task.level}) for review.`,
          type: 'TASK_SUBMITTED',
          link: `/admin/tasks/submissions?status=PENDING_REVIEW`,
        },
      });
    }

    res.status(200).json({
      success: true,
      message: 'Task submitted successfully! Awaiting Administrator review.',
      submission,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * ADMIN CONTROLLERS
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * Get all curriculum skills with employee and task counts
 */
export const getAdminSkills = async (req, res, next) => {
  try {
    let skills = await prisma.skill.findMany({
      orderBy: { name: 'asc' },
      include: {
        tasks: true,
        employeeTracks: {
          include: {
            employeeProfile: {
              include: { user: { select: { id: true, name: true, email: true } } },
            },
          },
        },
      },
    });

    // If no skills exist yet, auto-create the 5 core foundational skills
    if (!skills || skills.length === 0) {
      const coreSkills = [
        { name: 'Python', slug: 'python', description: 'Python programming & problem solving' },
        { name: 'Java', slug: 'java', description: 'Java object-oriented application development' },
        { name: 'SQL', slug: 'sql', description: 'Relational database queries & data management' },
        { name: 'Data Analysis', slug: 'data-analysis', description: 'Data analytics, reporting, and metrics' },
        { name: 'Software Testing', slug: 'software-testing', description: 'Quality assurance, test cases, and validation' },
      ];
      for (const s of coreSkills) {
        await prisma.skill.upsert({
          where: { slug: s.slug },
          update: {},
          create: { name: s.name, slug: s.slug, description: s.description },
        }).catch(() => {});
      }

      skills = await prisma.skill.findMany({
        orderBy: { name: 'asc' },
        include: {
          tasks: true,
          employeeTracks: {
            include: {
              employeeProfile: {
                include: { user: { select: { id: true, name: true, email: true } } },
              },
            },
          },
        },
      });
    }

    const formatted = skills.map((s) => ({
      id: s.id,
      name: s.name,
      slug: s.slug,
      description: s.description,
      icon: s.icon,
      status: s.status,
      totalTasks: s.tasks.length,
      basicTasksCount: s.tasks.filter((t) => t.level === 'BASIC').length,
      intermediateTasksCount: s.tasks.filter((t) => t.level === 'INTERMEDIATE').length,
      advancedTasksCount: s.tasks.filter((t) => t.level === 'ADVANCED').length,
      assignedEmployeeCount: s.employeeTracks.length,
      assignedEmployees: s.employeeTracks.map((t) => ({
        id: t.employeeProfile.id,
        name: t.employeeProfile.user?.name || 'Staff',
        employeeId: t.employeeProfile.employeeId,
      })),
    }));

    res.status(200).json({ success: true, skills: formatted });
  } catch (error) {
    next(error);
  }
};

/**
 * Create a new skill in the database
 */
export const createAdminSkill = async (req, res, next) => {
  try {
    const { name, slug, description, icon } = req.body;
    if (!name) {
      return res.status(400).json({ success: false, message: 'Skill name is required.' });
    }

    const cleanSlug = (slug || name.toLowerCase().replace(/[^a-z0-9]+/g, '-')).replace(/^-|-$/g, '');

    const skill = await prisma.skill.create({
      data: {
        name: name.trim(),
        slug: cleanSlug,
        description: description || null,
        icon: icon || 'Code2',
        status: 'ACTIVE',
      },
    });

    res.status(201).json({ success: true, message: 'Skill created successfully.', skill });
  } catch (error) {
    next(error);
  }
};

/**
 * Get tasks by skill and level
 */
export const getAdminTasks = async (req, res, next) => {
  try {
    const { skillId, level, status } = req.query;

    const where = {};
    if (skillId) where.skillId = skillId;
    if (level) where.level = level;
    if (status) where.status = status;

    const tasks = await prisma.skillTask.findMany({
      where,
      orderBy: [{ skill: { name: 'asc' } }, { level: 'asc' }, { orderIndex: 'asc' }],
      include: {
        skill: true,
        submissions: {
          select: { id: true, status: true },
        },
      },
    });

    res.status(200).json({
      success: true,
      tasks: tasks.map((t) => ({
        ...t,
        submissionCount: t.submissions.length,
        approvedCount: t.submissions.filter((s) => s.status === 'APPROVED').length,
        pendingCount: t.submissions.filter((s) => s.status === 'PENDING_REVIEW').length,
      })),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Create a task under a specific Skill + Level
 */
export const createAdminTask = async (req, res, next) => {
  try {
    const {
      skillId,
      level,
      title,
      description,
      instructions,
      expectedOutput,
      difficulty,
      githubRepoUrl,
      githubBranch,
      initialCode,
      isRequired,
      status,
    } = req.body;

    const desc = (description || instructions || '').trim();
    const inst = (instructions || description || '').trim();

    if (!skillId || !title || (!desc && !inst)) {
      return res.status(400).json({
        success: false,
        message: 'Please provide skill, task title, and instructions.',
      });
    }

    // Resolve skill by id, slug or name
    let skill = await prisma.skill.findFirst({
      where: {
        OR: [
          { id: skillId },
          { slug: String(skillId).toLowerCase() },
          { name: { equals: String(skillId), mode: 'insensitive' } },
        ],
      },
    });

    if (!skill) {
      skill = await prisma.skill.create({
        data: {
          name: String(skillId),
          slug: String(skillId).toLowerCase().replace(/[^a-z0-9]+/g, '-'),
          description: `${skillId} skill track`,
        },
      });
    }

    const resolvedSkillId = skill.id;

    const count = await prisma.skillTask.count({
      where: { skillId: resolvedSkillId, level: level || 'BASIC' },
    });

    const task = await prisma.skillTask.create({
      data: {
        skillId: resolvedSkillId,
        level: level || 'BASIC',
        title: title.trim(),
        description: desc,
        instructions: inst,
        expectedOutput: expectedOutput ? expectedOutput.trim() : null,
        difficulty: difficulty || 'EASY',
        githubRepoUrl: githubRepoUrl ? githubRepoUrl.trim() : null,
        githubBranch: githubBranch ? githubBranch.trim() : 'main',
        initialCode: initialCode ? initialCode.trim() : null,
        isRequired: isRequired !== undefined ? Boolean(isRequired) : true,
        status: status || 'ACTIVE',
        orderIndex: count + 1,
      },
    });

    res.status(201).json({ success: true, message: 'Task created successfully.', task });
  } catch (error) {
    next(error);
  }
};

/**
 * Update task
 */
export const updateAdminTask = async (req, res, next) => {
  try {
    const { taskId } = req.params;
    const data = { ...req.body };

    const task = await prisma.skillTask.update({
      where: { id: taskId },
      data,
    });

    res.status(200).json({ success: true, message: 'Task updated successfully.', task });
  } catch (error) {
    next(error);
  }
};

/**
 * Delete task (safe & idempotent)
 */
export const deleteAdminTask = async (req, res, next) => {
  try {
    const { taskId } = req.params;

    if (!taskId) {
      return res.status(400).json({ success: false, message: 'Task ID is required.' });
    }

    const existingTask = await prisma.skillTask.findUnique({
      where: { id: taskId },
    });

    if (!existingTask) {
      return res.status(200).json({
        success: true,
        message: 'Task already deleted or does not exist.',
      });
    }

    // Cascade delete any submissions linked to this task
    try {
      await prisma.skillTaskSubmission.deleteMany({
        where: { taskId },
      });
    } catch (subErr) {
      console.warn('Submissions cascade delete note:', subErr.message);
    }

    try {
      await prisma.skillTask.delete({
        where: { id: taskId },
      });
    } catch (taskErr) {
      if (taskErr.code !== 'P2025') {
        console.warn('Task delete note:', taskErr.message);
      }
    }

    return res.status(200).json({
      success: true,
      message: 'Task deleted successfully.',
    });
  } catch (error) {
    if (error.code === 'P2025') {
      return res.status(200).json({
        success: true,
        message: 'Task already deleted.',
      });
    }
    return res.status(200).json({
      success: true,
      message: 'Task removed or already cleaned up.',
    });
  }
};

/**
 * Clear all curriculum tasks and submissions (reset back to 0 tasks)
 */
export const clearAllAdminTasks = async (req, res, next) => {
  try {
    const delSubs = await prisma.skillTaskSubmission.deleteMany({});
    const delTasks = await prisma.skillTask.deleteMany({});
    await prisma.employeeSkillProgress.deleteMany({});

    res.status(200).json({
      success: true,
      message: `Cleared all tasks successfully (${delTasks.count} tasks removed). Skills are now reset to 0 tasks.`,
      deletedTasks: delTasks.count,
      deletedSubmissions: delSubs.count,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Assign skills to an employee
 */
export const assignEmployeeSkills = async (req, res, next) => {
  try {
    const { employeeProfileId } = req.params;
    const { skillIds } = req.body; // Array of skill IDs

    if (!Array.isArray(skillIds)) {
      return res.status(400).json({ success: false, message: 'skillIds must be an array.' });
    }

    const profile = await prisma.employeeProfile.findUnique({
      where: { id: employeeProfileId },
      include: { user: true },
    });

    if (!profile) {
      return res.status(404).json({ success: false, message: 'Employee profile not found.' });
    }

    // Delete tracks not in skillIds
    await prisma.employeeSkillTrack.deleteMany({
      where: {
        employeeProfileId,
        skillId: { notIn: skillIds },
      },
    });

    // Add new tracks and initialize progress
    for (const sid of skillIds) {
      await prisma.employeeSkillTrack.upsert({
        where: {
          employeeProfileId_skillId: {
            employeeProfileId,
            skillId: sid,
          },
        },
        update: {},
        create: {
          employeeProfileId,
          skillId: sid,
        },
      });

      await prisma.employeeSkillProgress.upsert({
        where: {
          employeeProfileId_skillId: {
            employeeProfileId,
            skillId: sid,
          },
        },
        update: {},
        create: {
          employeeProfileId,
          skillId: sid,
          unlockedLevel: 'BASIC',
          basicCompleted: false,
          intermediateCompleted: false,
          advancedCompleted: false,
        },
      });
    }

    // In-app notification
    await prisma.notification.create({
      data: {
        userId: profile.userId,
        title: 'Skills Curriculum Updated',
        message: 'Your administrator has updated your assigned technical skills curriculum.',
        type: 'SKILL_ASSIGNED',
        link: '/employee/dashboard',
      },
    });

    res.status(200).json({ success: true, message: 'Employee skills assigned successfully.' });
  } catch (error) {
    next(error);
  }
};

/**
 * Get submissions for Admin review
 */
export const getAdminSubmissions = async (req, res, next) => {
  try {
    const { skillId, level, status, employeeId } = req.query;

    const where = {};
    if (status && status !== 'ALL') where.status = status;
    if (skillId && skillId !== 'ALL') where.task = { skillId };
    if (level && level !== 'ALL') {
      where.task = { ...(where.task || {}), level };
    }
    if (employeeId && employeeId !== 'ALL') {
      where.employeeProfileId = employeeId;
    }

    const submissions = await prisma.skillTaskSubmission.findMany({
      where,
      orderBy: { submittedAt: 'desc' },
      include: {
        task: {
          include: { skill: true },
        },
        employeeProfile: {
          include: {
            user: { select: { id: true, name: true, email: true, avatar: true } },
          },
        },
        reviewer: {
          select: { id: true, name: true },
        },
      },
    });

    res.status(200).json({ success: true, submissions });
  } catch (error) {
    next(error);
  }
};

/**
 * Admin: Run submitted code to verify output
 */
export const runAdminSubmissionCode = async (req, res, next) => {
  try {
    const { submissionId } = req.params;

    const sub = await prisma.skillTaskSubmission.findUnique({
      where: { id: submissionId },
      include: { task: { include: { skill: true } } },
    });

    if (!sub) {
      return res.status(404).json({ success: false, message: 'Submission not found.' });
    }

    let result;
    if (Array.isArray(sub.projectFiles) && sub.projectFiles.length > 0) {
      result = await executeMultiFileProject({
        skillSlug: sub.task.skill.slug,
        files: sub.projectFiles,
        entryFile: 'main.py',
        timeoutMs: 12000,
      });
    } else {
      result = await executeCodeSnippet({
        language: sub.task.skill.slug,
        code: sub.submittedCode || '',
        timeoutMs: 10000,
      });
    }

    res.status(200).json({
      success: true,
      stdout: result.stdout,
      stderr: result.stderr,
      executionTimeMs: result.executionTimeMs,
      exitCode: result.exitCode,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Helper: Automatic Level Unlock Calculation
 * Called when an admin approves a task submission
 */
const checkAndUnlockNextLevel = async (employeeProfileId, skillId, currentLevel) => {
  // 1. Get all active and required tasks for this skill + level
  const requiredTasks = await prisma.skillTask.findMany({
    where: {
      skillId,
      level: currentLevel,
      status: 'ACTIVE',
      isRequired: true,
    },
    select: { id: true },
  });

  if (requiredTasks.length === 0) return { unlocked: false };

  // 2. Count how many of these required tasks have APPROVED submissions by this employee
  const approvedCount = await prisma.skillTaskSubmission.count({
    where: {
      employeeProfileId,
      taskId: { in: requiredTasks.map((t) => t.id) },
      status: 'APPROVED',
    },
  });

  const allApproved = approvedCount >= requiredTasks.length;

  if (allApproved) {
    let nextLevel = currentLevel;
    const progressUpdate = {};

    if (currentLevel === 'BASIC') {
      nextLevel = 'INTERMEDIATE';
      progressUpdate.unlockedLevel = 'INTERMEDIATE';
      progressUpdate.basicCompleted = true;
    } else if (currentLevel === 'INTERMEDIATE') {
      nextLevel = 'ADVANCED';
      progressUpdate.unlockedLevel = 'ADVANCED';
      progressUpdate.intermediateCompleted = true;
    } else if (currentLevel === 'ADVANCED') {
      progressUpdate.advancedCompleted = true;
      progressUpdate.completedAt = new Date();
    }

    await prisma.employeeSkillProgress.upsert({
      where: {
        employeeProfileId_skillId: {
          employeeProfileId,
          skillId,
        },
      },
      update: progressUpdate,
      create: {
        employeeProfileId,
        skillId,
        ...progressUpdate,
      },
    });

    return {
      unlocked: true,
      nextLevel,
      allCompleted: currentLevel === 'ADVANCED',
    };
  }

  return { unlocked: false, remainingTasks: requiredTasks.length - approvedCount };
};

/**
 * Review task submission: APPROVE or REJECT with comment and automatic level unlock
 */
export const reviewTaskSubmission = async (req, res, next) => {
  try {
    const { submissionId } = req.params;
    const { action, adminComment } = req.body; // action: 'APPROVE' | 'REJECT'

    if (!['APPROVE', 'REJECT'].includes(action)) {
      return res.status(400).json({ success: false, message: 'Action must be APPROVE or REJECT.' });
    }

    const sub = await prisma.skillTaskSubmission.findUnique({
      where: { id: submissionId },
      include: {
        task: { include: { skill: true } },
        employeeProfile: { include: { user: true } },
      },
    });

    if (!sub) {
      return res.status(404).json({ success: false, message: 'Submission not found.' });
    }

    const newStatus = action === 'APPROVE' ? 'APPROVED' : 'REJECTED';

    const updated = await prisma.skillTaskSubmission.update({
      where: { id: submissionId },
      data: {
        status: newStatus,
        adminComment: adminComment || (action === 'APPROVE' ? 'Approved by Administrator.' : 'Changes requested.'),
        reviewedById: req.user.id,
        reviewedAt: new Date(),
      },
    });

    let unlockResult = { unlocked: false };
    if (action === 'APPROVE') {
      unlockResult = await checkAndUnlockNextLevel(sub.employeeProfileId, sub.task.skillId, sub.task.level);
    }

    // In-app Notification for Employee
    const notifTitle = action === 'APPROVE' ? `✓ Task Approved: ${sub.task.title}` : `⚠ Revisions Needed: ${sub.task.title}`;
    let notifMsg = `Your submission for "${sub.task.title}" has been ${action === 'APPROVE' ? 'approved' : 'rejected'}.`;
    if (unlockResult.unlocked) {
      notifMsg += ` Congratulations! You completed all ${sub.task.level} tasks. ${unlockResult.nextLevel} level is now automatically unlocked!`;
    }
    if (adminComment) {
      notifMsg += ` Admin feedback: "${adminComment}"`;
    }

    await prisma.notification.create({
      data: {
        userId: sub.employeeProfile.userId,
        title: notifTitle,
        message: notifMsg,
        type: action === 'APPROVE' ? 'TASK_APPROVED' : 'TASK_REJECTED',
        link: `/employee/dashboard`,
      },
    });

    res.status(200).json({
      success: true,
      message: `Task submission ${newStatus.toLowerCase()} successfully.${unlockResult.unlocked ? ` Automatically unlocked ${unlockResult.nextLevel} level!` : ''}`,
      submission: updated,
      unlockResult,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Admin: Get employee progress matrix across all skills
 */
export const getAdminSkillProgressDashboard = async (req, res, next) => {
  try {
    const employees = await prisma.employeeProfile.findMany({
      include: {
        user: { select: { id: true, name: true, email: true } },
        skillTracks: {
          include: {
            skill: {
              include: {
                tasks: { where: { status: 'ACTIVE' } },
              },
            },
          },
        },
        skillProgress: true,
        taskSubmissions: {
          select: { id: true, taskId: true, status: true },
        },
      },
      orderBy: { employeeId: 'asc' },
    });

    const matrix = employees.map((emp) => {
      const skillsData = emp.skillTracks.map((st) => {
        const skill = st.skill;
        const prog = emp.skillProgress.find((p) => p.skillId === skill.id) || {
          unlockedLevel: 'BASIC',
          basicCompleted: false,
          intermediateCompleted: false,
          advancedCompleted: false,
        };

        const totalTasks = skill.tasks.length;
        const approvedCount = emp.taskSubmissions.filter(
          (s) => s.status === 'APPROVED' && skill.tasks.some((t) => t.id === s.taskId)
        ).length;

        const pct = totalTasks > 0 ? Math.round((approvedCount / totalTasks) * 100) : 0;

        return {
          skillId: skill.id,
          name: skill.name,
          slug: skill.slug,
          unlockedLevel: prog.unlockedLevel,
          basicCompleted: prog.basicCompleted,
          intermediateCompleted: prog.intermediateCompleted,
          advancedCompleted: prog.advancedCompleted,
          completedPercent: pct,
          approvedTasks: approvedCount,
          totalTasks,
        };
      });

      return {
        id: emp.id,
        name: emp.user?.name || 'Employee',
        email: emp.user?.email || '',
        employeeId: emp.employeeId,
        department: emp.department,
        designation: emp.designation,
        assignedSkillsCount: emp.skillTracks.length,
        skills: skillsData,
      };
    });

    res.status(200).json({ success: true, progressMatrix: matrix });
  } catch (error) {
    next(error);
  }
};

/**
 * Admin: Statistics Overview
 */
export const getAdminSkillStats = async (req, res, next) => {
  try {
    const [
      totalEmployees,
      totalSkills,
      totalTasks,
      pendingReviews,
      approvedSubmissions,
      rejectedSubmissions,
      completedLevels,
      activeAdvancedProjects,
    ] = await Promise.all([
      prisma.employeeProfile.count(),
      prisma.skill.count(),
      prisma.skillTask.count({ where: { status: 'ACTIVE' } }),
      prisma.skillTaskSubmission.count({ where: { status: 'PENDING_REVIEW' } }),
      prisma.skillTaskSubmission.count({ where: { status: 'APPROVED' } }),
      prisma.skillTaskSubmission.count({ where: { status: 'REJECTED' } }),
      prisma.employeeSkillProgress.count({
        where: {
          OR: [{ basicCompleted: true }, { intermediateCompleted: true }, { advancedCompleted: true }],
        },
      }),
      prisma.employeeSkillProgress.count({ where: { unlockedLevel: 'ADVANCED' } }),
    ]);

    res.status(200).json({
      success: true,
      stats: {
        totalEmployees,
        totalSkills,
        totalTasks,
        pendingReviews,
        approvedSubmissions,
        rejectedSubmissions,
        completedLevels,
        activeAdvancedProjects,
      },
    });
  } catch (error) {
    next(error);
  }
};
