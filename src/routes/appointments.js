const express = require('express');
const prisma = require('../config/database');
const { sendSmsConfirmation } = require('../services/sms');

const router = express.Router();

/**
 * GET /api/appointments — List appointments
 */
router.get('/', async (req, res, next) => {
  try {
    const { status, from, to, page = 1, limit = 20 } = req.query;

    const where = { orgId: req.orgId };
    if (status) where.status = status.toUpperCase();
    if (from || to) {
      where.startTime = {};
      if (from) where.startTime.gte = new Date(from);
      if (to) where.startTime.lte = new Date(to);
    }

    const [appointments, total] = await prisma.$transaction([
      prisma.appointment.findMany({
        where,
        orderBy: { startTime: 'asc' },
        skip: (page - 1) * limit,
        take: parseInt(limit),
      }),
      prisma.appointment.count({ where }),
    ]);

    res.json({ appointments, pagination: { page: parseInt(page), limit: parseInt(limit), total } });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/appointments — Create appointment manually
 */
router.post('/', async (req, res, next) => {
  try {
    const { clientName, clientPhone, clientEmail, service, startTime, endTime, notes } = req.body;

    if (!clientName || !clientPhone || !service || !startTime || !endTime) {
      return res.status(400).json({ error: 'clientName, clientPhone, service, startTime, and endTime are required' });
    }

    // Check for scheduling conflicts
    const conflict = await prisma.appointment.findFirst({
      where: {
        orgId: req.orgId,
        status: { in: ['PENDING', 'CONFIRMED'] },
        startTime: { lt: new Date(endTime) },
        endTime: { gt: new Date(startTime) },
      },
    });

    if (conflict) {
      return res.status(409).json({ error: 'Time slot conflict with existing appointment' });
    }

    const appointment = await prisma.appointment.create({
      data: {
        orgId: req.orgId,
        clientName,
        clientPhone,
        clientEmail: clientEmail || null,
        service,
        startTime: new Date(startTime),
        endTime: new Date(endTime),
        notes: notes || null,
        status: 'CONFIRMED',
      },
    });

    // Send SMS confirmation (non-blocking)
    sendSmsConfirmation(appointment).catch(e => console.warn('[SMS] Failed:', e.message));

    // Emit real-time update
    const io = req.app.get('io');
    io.to(`org:${req.orgId}`).emit('appointment:created', appointment);

    res.status(201).json(appointment);
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/appointments/:id — Update/cancel appointment
 */
router.patch('/:id', async (req, res, next) => {
  try {
    const { status, startTime, endTime, notes } = req.body;

    const appointment = await prisma.appointment.update({
      where: { id: req.params.id },
      data: {
        ...(status && { status: status.toUpperCase() }),
        ...(startTime && { startTime: new Date(startTime) }),
        ...(endTime && { endTime: new Date(endTime) }),
        ...(notes !== undefined && { notes }),
      },
    });

    const io = req.app.get('io');
    io.to(`org:${req.orgId}`).emit('appointment:updated', appointment);

    res.json(appointment);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
