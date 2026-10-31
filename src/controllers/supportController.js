import prisma from '../database/prisma.js';

export const getTickets = async (req, res, next) => {
  try {
    const isUserAdmin = req.user.role === 'ADMIN';

    const where = isUserAdmin ? {} : { userId: req.user.id };

    const tickets = await prisma.supportTicket.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      include: {
        user: {
          select: { id: true, name: true, email: true },
        },
        product: {
          select: { id: true, title: true, slug: true },
        },
        _count: {
          select: { messages: true },
        },
      },
    });

    res.status(200).json({
      success: true,
      tickets,
    });
  } catch (error) {
    next(error);
  }
};

export const getTicketById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const isUserAdmin = req.user.role === 'ADMIN';

    const ticket = await prisma.supportTicket.findUnique({
      where: { id },
      include: {
        user: {
          select: { id: true, name: true, email: true, company: true },
        },
        product: {
          select: { id: true, title: true, slug: true, thumbnail: true },
        },
        messages: {
          orderBy: { createdAt: 'asc' },
          include: {
            user: {
              select: { id: true, name: true, role: true },
            },
          },
        },
      },
    });

    if (!ticket) {
      return res.status(404).json({ success: false, message: 'Ticket not found.' });
    }

    if (!isUserAdmin && ticket.userId !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }

    res.status(200).json({
      success: true,
      ticket,
    });
  } catch (error) {
    next(error);
  }
};

export const createTicket = async (req, res, next) => {
  try {
    const { productId, subject, message, priority = 'MEDIUM' } = req.body;

    if (!subject || !message) {
      return res.status(400).json({
        success: false,
        message: 'Subject and message are required.',
      });
    }

    const ticketNumber = `TKT-${Date.now().toString().slice(-6)}-${Math.floor(100 + Math.random() * 900)}`;

    const ticket = await prisma.supportTicket.create({
      data: {
        ticketNumber,
        userId: req.user.id,
        productId: productId || null,
        subject: subject.trim(),
        message: message.trim(),
        priority,
        status: 'OPEN',
        messages: {
          create: {
            userId: req.user.id,
            message: message.trim(),
            isAdmin: req.user.role === 'ADMIN',
          },
        },
      },
      include: {
        user: { select: { id: true, name: true, email: true } },
        product: { select: { id: true, title: true } },
      },
    });

    res.status(201).json({
      success: true,
      message: 'Support ticket opened successfully.',
      ticket,
    });
  } catch (error) {
    next(error);
  }
};

export const addMessage = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { message } = req.body;
    const isUserAdmin = req.user.role === 'ADMIN';

    if (!message || !message.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Message content cannot be empty.',
      });
    }

    const ticket = await prisma.supportTicket.findUnique({
      where: { id },
    });

    if (!ticket) {
      return res.status(404).json({ success: false, message: 'Ticket not found.' });
    }

    if (!isUserAdmin && ticket.userId !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }

    const newMessage = await prisma.supportMessage.create({
      data: {
        ticketId: id,
        userId: req.user.id,
        message: message.trim(),
        isAdmin: isUserAdmin,
      },
      include: {
        user: { select: { id: true, name: true, role: true } },
      },
    });

    // Update ticket status & updatedAt
    let newStatus = ticket.status;
    if (isUserAdmin && ticket.status === 'OPEN') {
      newStatus = 'IN_PROGRESS';
    } else if (!isUserAdmin && ticket.status === 'RESOLVED') {
      newStatus = 'OPEN';
    }

    await prisma.supportTicket.update({
      where: { id },
      data: { status: newStatus, updatedAt: new Date() },
    });

    res.status(201).json({
      success: true,
      message: newMessage,
    });
  } catch (error) {
    next(error);
  }
};

export const updateTicketStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, priority } = req.body;

    const data = {};
    if (status) data.status = status;
    if (priority) data.priority = priority;

    const updated = await prisma.supportTicket.update({
      where: { id },
      data,
    });

    res.status(200).json({
      success: true,
      message: 'Ticket updated successfully.',
      ticket: updated,
    });
  } catch (error) {
    next(error);
  }
};

