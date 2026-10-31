import express from 'express';
import prisma from '../database/prisma.js';

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const settings = await prisma.websiteSetting.findMany();
    const settingsMap = {};
    settings.forEach((s) => {
      settingsMap[s.key] = s.value;
    });
    res.status(200).json({ success: true, settings: settingsMap });
  } catch (error) {
    next(error);
  }
});

export default router;

