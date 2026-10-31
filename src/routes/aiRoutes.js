import express from 'express';
import {
  matchProjectWithAI,
  analyzeProjectArchitecture,
  generateProjectBlueprint,
} from '../controllers/aiController.js';

const router = express.Router();

router.post('/match-project', matchProjectWithAI);
router.get('/analyze-project/:slug', analyzeProjectArchitecture);
router.post('/generate-blueprint', generateProjectBlueprint);

export default router;

