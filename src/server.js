import app from './app.js';
import { config } from './config/index.js';
import prisma from './database/prisma.js';

const startServer = async () => {
  try {
    // Verify database connection
    await prisma.$connect();
    console.log('✓ Successfully connected to PostgreSQL database (coderharbor_db)');

    app.listen(config.port, () => {
      console.log(`===============================================`);
      console.log(` CoderHarbor API Server running on port ${config.port}`);
      console.log(` Mode: ${config.nodeEnv}`);
      console.log(` Health Check: http://localhost:${config.port}/api/health`);
      console.log(` Purchasing Pipeline: [ COMING SOON ]`);
      console.log(`===============================================`);
    });
  } catch (error) {
    console.error('Fatal: Failed to connect to database or start server:', error);
    process.exit(1);
  }
};

startServer();

