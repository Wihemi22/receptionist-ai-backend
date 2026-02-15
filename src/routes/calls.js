const express = require('express');
const prisma = require('../config/database');

const router = express.Router();

/**
 * GET /api/calls — List calls with filters
 */
router.get('/', async (req, res, next) => {
  try {
    const { status, sentiment, from, to, page = 1, limit = 20 } = req.query;

    const where = { orgId: req.orgId };
    if (status) where.status = status.toUpperCase();
    if (sentiment) where.sentiment = sentiment.toUpperCase();
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to) where.createdAt.lte = new Date(to);
    }

    const [calls, total] = await prisma.$transaction([
      prisma.call.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: parseInt(limit),
        include: { appointment: { select: { id: true, status: true, startTime: true } } },
      }),
      prisma.call.count({ where }),
    ]);

    res.json({
      calls,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/calls/:id — Single call detail
 */
router.get('/:id', async (req, res, next) => {
  try {
    const call = await prisma.call.findFirst({
      where: { id: req.params.id, orgId: req.orgId },
      include: { appointment: true },
    });

    if (!call) return res.status(404).json({ error: 'Call not found' });
    res.json(call);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
