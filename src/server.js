import app from './app.js';
import { config } from './config/index.js';
import prisma from './database/prisma.js';

const startServer = async () => {
  try {
    // Verify database connection
    await prisma.$connect();
    console.log('✓ Successfully connected to PostgreSQL database (coderharbor_db)');

    // Ensure core skill tracks exist (without any pre-seeded sample tasks)
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

    const server = app.listen(config.port, () => {
      console.log(`===============================================`);
      console.log(` CoderHarbor API Server running on port ${config.port}`);
      console.log(` Mode: ${config.nodeEnv}`);
      console.log(` Health Check: http://localhost:${config.port}/api/health`);
      console.log(` Purchasing Pipeline: [ COMING SOON ]`);
      console.log(`===============================================`);
    });

    const shutdown = async (signal) => {
      console.log(`\nReceived ${signal}. Gracefully closing server...`);
      server.close(async () => {
        console.log('HTTP server closed.');
        try {
          await prisma.$disconnect();
          console.log('Database disconnected.');
        } catch (e) {}
        process.exit(0);
      });
      setTimeout(() => {
        console.error('Force exiting after timeout.');
        process.exit(0);
      }, 3000).unref();
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`\n[PORT OCCUPIED] Port ${config.port} is already being used by an active process.`);
        console.error(`To release port ${config.port}, run: fuser -k ${config.port}/tcp or killall -9 node\n`);
      } else {
        console.error('Server error:', err);
      }
      process.exit(1);
    });
  } catch (error) {
    console.error('Fatal: Failed to connect to database or start server:', error);
    process.exit(1);
  }
};

startServer();

