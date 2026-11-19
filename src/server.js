import app from './app.js';
import { config } from './config/index.js';
import prisma from './database/prisma.js';

const startServer = async () => {
  try {
    // Verify database connection
    await prisma.$connect();
    console.log('✓ Successfully connected to PostgreSQL database (coderharbor_db)');

    const server = app.listen(config.port, () => {
      console.log(`===============================================`);
      console.log(` CoderHarbor API Server running on port ${config.port}`);
      console.log(` Mode: ${config.nodeEnv}`);
      console.log(` Health Check: http://localhost:${config.port}/api/health`);
      console.log(` Purchasing Pipeline: [ COMING SOON ]`);
      console.log(`===============================================`);
    });

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

