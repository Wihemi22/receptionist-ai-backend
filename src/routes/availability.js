const express = require('express');
const prisma = require('../config/database');

const router = express.Router();

/**
 * GET /api/availability — Get available time slots
 * Query params: date (YYYY-MM-DD), service
 */
router.get('/', async (req, res, next) => {
  try {
    const { date, service } = req.query;

    // Get org availability rules
    const availability = await prisma.availability.findMany({
      where: { orgId: req.orgId, isActive: true },
      orderBy: { dayOfWeek: 'asc' },
    });

    if (!date) {
      return res.json({ availability });
    }

    // Calculate available slots for a specific date
    const targetDate = new Date(date);
    const dayOfWeek = targetDate.getDay();

    const dayAvail = availability.find(a => a.dayOfWeek === dayOfWeek);
    if (!dayAvail) {
      return res.json({ slots: [], message: 'Business is closed on this day' });
    }

    // Get service duration (default 30 min)
    let durationMin = 30;
    if (service) {
      const svc = await prisma.service.findFirst({
        where: { orgId: req.orgId, name: { contains: service, mode: 'insensitive' } },
      });
      if (svc) durationMin = svc.durationMinutes;
    }

    // Get existing appointments for this date
    const startOfDay = new Date(date + 'T00:00:00');
    const endOfDay = new Date(date + 'T23:59:59');
    const existingAppts = await prisma.appointment.findMany({
      where: {
        orgId: req.orgId,
        status: { in: ['PENDING', 'CONFIRMED'] },
        startTime: { gte: startOfDay, lte: endOfDay },
      },
      select: { startTime: true, endTime: true },
    });

    // Generate available slots
    const slots = [];
    const [startHour, startMin] = dayAvail.startTime.split(':').map(Number);
    const [endHour, endMin] = dayAvail.endTime.split(':').map(Number);

    let current = new Date(targetDate);
    current.setHours(startHour, startMin, 0, 0);

    const endTime = new Date(targetDate);
    endTime.setHours(endHour, endMin, 0, 0);

    while (current.getTime() + durationMin * 60000 <= endTime.getTime()) {
      const slotEnd = new Date(current.getTime() + durationMin * 60000);
      const isBooked = existingAppts.some(appt =>
        current < new Date(appt.endTime) && slotEnd > new Date(appt.startTime)
      );

      if (!isBooked) {
        slots.push({
          start: current.toISOString(),
          end: slotEnd.toISOString(),
          display: current.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
        });
      }
      current = new Date(current.getTime() + 30 * 60000); // 30 min increments
    }

    res.json({ date, slots, serviceDuration: durationMin });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/availability — Update availability rules
 */
router.put('/', async (req, res, next) => {
  try {
    const { availability: rules } = req.body; // Array of { dayOfWeek, startTime, endTime, isActive }

    if (!Array.isArray(rules)) {
      return res.status(400).json({ error: 'availability must be an array' });
    }

    await prisma.$transaction(
      rules.map(rule =>
        prisma.availability.upsert({
          where: { orgId_dayOfWeek: { orgId: req.orgId, dayOfWeek: rule.dayOfWeek } },
          update: { startTime: rule.startTime, endTime: rule.endTime, isActive: rule.isActive },
          create: { orgId: req.orgId, ...rule },
        })
      )
    );

    const updated = await prisma.availability.findMany({
      where: { orgId: req.orgId },
      orderBy: { dayOfWeek: 'asc' },
    });

    res.json({ availability: updated });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
