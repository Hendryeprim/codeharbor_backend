import express from 'express';
import { getTechnologies } from '../controllers/technologyController.js';

const router = express.Router();

router.get('/', getTechnologies);

export default router;

