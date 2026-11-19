import prisma from '../database/prisma.js';

export const createAuditLog = async ({
  userId = null,
  action,
  entity,
  entityId = null,
  details = null,
  ipAddress = null,
}) => {
  try {
    return await prisma.auditLog.create({
      data: {
        userId,
        action,
        entity,
        entityId,
        details: details || {},
        ipAddress,
      },
    });
  } catch (err) {
    console.error('AuditLog creation failed:', err.message);
    return null;
  }
};
