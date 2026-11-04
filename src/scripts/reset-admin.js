import bcrypt from 'bcryptjs';
import prisma from '../database/prisma.js';

const email = process.argv[2] || 'admin@coderharbor.com';
const password = process.argv[3] || 'CoderHarbor@2026#Admin';

async function main() {
  console.log(`Setting up Admin account: ${email}...`);
  const passwordHash = await bcrypt.hash(password, 10);

  const admin = await prisma.user.upsert({
    where: { email },
    update: {
      passwordHash,
      role: 'ADMIN',
      status: 'ACTIVE',
    },
    create: {
      name: 'CoderHarbor Admin',
      email,
      passwordHash,
      role: 'ADMIN',
      status: 'ACTIVE',
      company: 'CoderHarbor Platform',
    },
  });

  console.log(`✓ Admin account is successfully active and ready!`);
  console.log(`  Email: ${admin.email}`);
  console.log(`  Password: ${password}`);
  console.log(`  Role: ${admin.role}`);
}

main()
  .catch((err) => {
    console.error('Error setting admin:', err.message);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

