import bcrypt from 'bcryptjs';
import prisma from '../database/prisma.js';

async function seed() {
  console.log('Seeding Employee and Managed Project Data...');

  // 1. Ensure Admin exists
  const adminHash = await bcrypt.hash('CoderHarbor@2026#Admin', 10);
  const admin = await prisma.user.upsert({
    where: { email: 'admin@coderharbor.com' },
    update: { role: 'ADMIN', status: 'ACTIVE', passwordHash: adminHash },
    create: {
      name: 'CoderHarbor Admin',
      email: 'admin@coderharbor.com',
      passwordHash: adminHash,
      role: 'ADMIN',
      status: 'ACTIVE',
      company: 'CoderHarbor Platform',
    },
  });

  // 2. Ensure Employee Rahul exists
  const empPasswordHash = await bcrypt.hash('Employee@2026#', 10);
  let rahulUser = await prisma.user.findUnique({
    where: { email: 'rahul@coderharbor.com' },
    include: { employeeProfile: true },
  });

  if (!rahulUser) {
    rahulUser = await prisma.user.create({
      data: {
        name: 'Rahul',
        email: 'rahul@coderharbor.com',
        passwordHash: empPasswordHash,
        role: 'EMPLOYEE',
        status: 'ACTIVE',
        employeeProfile: {
          create: {
            employeeId: 'EMP001',
            department: 'Development',
            designation: 'Python Developer',
            primarySkill: 'Python',
            joiningDate: new Date('2026-01-15'),
            status: 'ACTIVE',
          },
        },
      },
      include: { employeeProfile: true },
    });
  }

  // 3. Ensure a second employee exists (Priya - Java)
  let priyaUser = await prisma.user.findUnique({
    where: { email: 'priya@coderharbor.com' },
    include: { employeeProfile: true },
  });

  if (!priyaUser) {
    priyaUser = await prisma.user.create({
      data: {
        name: 'Priya Sharma',
        email: 'priya@coderharbor.com',
        passwordHash: empPasswordHash,
        role: 'EMPLOYEE',
        status: 'ACTIVE',
        employeeProfile: {
          create: {
            employeeId: 'EMP002',
            department: 'Engineering',
            designation: 'Java Backend Specialist',
            primarySkill: 'Java',
            joiningDate: new Date('2026-02-01'),
            status: 'ACTIVE',
          },
        },
      },
      include: { employeeProfile: true },
    });
  }

  // 4. Sample Managed Projects for Rahul (Python)
  const project1 = await prisma.project.upsert({
    where: { id: 'proj-emp-001' },
    update: {},
    create: {
      id: 'proj-emp-001',
      title: 'Employee Management System',
      description: 'Build an employee management system with authentication, CRUD operations, attendance tracking and reporting.',
      projectType: 'Real-Time Project',
      primarySkill: 'Python',
      framework: 'Django',
      database: 'PostgreSQL',
      frontend: 'React',
      difficulty: 'Medium',
      priority: 'High',
      startDate: new Date(),
      dueDate: new Date('2026-11-30'),
      objective: 'Build an employee management system with authentication, CRUD operations, attendance tracking and reporting.',
      technicalRequirements: 'Django REST framework, JWT tokens, PostgreSQL relationships, Docker support.',
      additionalRequirements: 'Write clean PEP8 compliant code with unittest test suite.',
      submissionRequirements: ['Source Code', 'README', 'Database / SQL', 'Screenshots', 'Documentation'],
      status: 'IN_PROGRESS',
      progress: 65,
      createdById: admin.id,
      requirements: {
        create: [
          { title: 'User Authentication & JWT Tokens', isCompleted: true },
          { title: 'Employee CRUD Operations & Filtering', isCompleted: true },
          { title: 'Attendance Tracking Module', isCompleted: false },
          { title: 'REST API Export & Reporting', isCompleted: false },
        ],
      },
      assignments: {
        create: {
          employeeProfileId: rahulUser.employeeProfile.id,
          status: 'IN_PROGRESS',
          startedAt: new Date(),
        },
      },
      tasks: {
        create: [
          {
            title: 'Complete Login Module',
            description: 'Implement JWT tokens and secure cookie handling.',
            priority: 'High',
            status: 'Completed',
            employeeProfileId: rahulUser.employeeProfile.id,
          },
          {
            title: 'Create Database Schema',
            description: 'Define relational models for departments and employees.',
            priority: 'High',
            status: 'Completed',
            employeeProfileId: rahulUser.employeeProfile.id,
          },
          {
            title: 'Write Attendance REST API',
            description: 'Build endpoints for punch-in, punch-out, and monthly reports.',
            priority: 'Medium',
            status: 'In Progress',
            employeeProfileId: rahulUser.employeeProfile.id,
          },
        ],
      },
    },
  });

  // Sample submission with version 1
  const sub1 = await prisma.projectSubmission.upsert({
    where: { id: 'sub-emp-001' },
    update: {},
    create: {
      id: 'sub-emp-001',
      projectId: project1.id,
      employeeProfileId: rahulUser.employeeProfile.id,
      currentVersion: 1,
      status: 'SUBMITTED',
      versions: {
        create: {
          versionNumber: 1,
          githubUrl: 'https://github.com/rahul-dev/employee-management-django',
          readmeContent: '# Employee Management System\n\nBuilt with Django REST Framework and React.',
          validationStatus: 'VALID',
          validationReport: {
            valid: true,
            detectedType: 'Django REST Project',
            hasTests: true,
          },
        },
      },
    },
  });

  console.log('✓ Employee seeding complete!');
  console.log('  Admin: admin@coderharbor.com (Password: CoderHarbor@2026#Admin)');
  console.log('  Employee: rahul@coderharbor.com (Password: Employee@2026#)');
  console.log('  Employee ID: EMP001 | Primary Skill: Python');
}

seed()
  .catch((e) => {
    console.error('Seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
