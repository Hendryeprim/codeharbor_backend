import express from 'express';
import {
  getTickets,
  getTicketById,
  createTicket,
  addMessage,
  updateTicketStatus,
} from '../controllers/supportController.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';

const router = express.Router();

router.use(authenticate);

router.get('/tickets', getTickets);
router.post('/tickets', createTicket);
router.get('/tickets/:id', getTicketById);
router.post('/tickets/:id/messages', addMessage);
router.patch('/tickets/:id/status', requireAdmin, updateTicketStatus);

export default router;

