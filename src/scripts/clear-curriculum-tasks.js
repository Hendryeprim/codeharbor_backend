import prisma from '../database/prisma.js';

async function clearTasks() {
  console.log('Clearing all curriculum task submissions and tasks...');
  const delSubs = await prisma.skillTaskSubmission.deleteMany({});
  console.log(`Deleted ${delSubs.count} submissions.`);
  
  const delTasks = await prisma.skillTask.deleteMany({});
  console.log(`Deleted ${delTasks.count} tasks.`);

  // Reset employee progress so levels start fresh
  const delProgress = await prisma.employeeSkillProgress.deleteMany({});
  console.log(`Reset ${delProgress.count} employee skill progress records.`);

  console.log('SUCCESS: All seeded tasks cleared! Only core skills remain with 0 tasks.');
  await prisma.$disconnect();
}

clearTasks().catch((err) => {
  console.error('Error clearing tasks:', err);
  process.exit(1);
});
