const express = require('express');
const prisma = require('../config/database');
const redis = require('../config/redis');

const router = express.Router();

/**
 * GET /api/analytics/overview — Dashboard stats
 */
router.get('/overview', async (req, res, next) => {
  try {
    const { from, to } = req.query;
    const orgId = req.orgId;

    // Cache key
    const cacheKey = `analytics:${orgId}:overview`;
    const cached = await redis.get(cacheKey);
    if (cached) return res.json(JSON.parse(cached));

    const now = new Date();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay());
    startOfWeek.setHours(0, 0, 0, 0);

    const startOfLastWeek = new Date(startOfWeek);
    startOfLastWeek.setDate(startOfLastWeek.getDate() - 7);

    // This week's stats
    const [
      totalCallsThisWeek,
      completedCallsThisWeek,
      missedCallsThisWeek,
      appointmentsThisWeek,
      positiveSentimentThisWeek,
      totalCallsLastWeek,
      appointmentsLastWeek,
    ] = await Promise.all([
      prisma.call.count({ where: { orgId, createdAt: { gte: startOfWeek } } }),
      prisma.call.count({ where: { orgId, status: 'COMPLETED', createdAt: { gte: startOfWeek } } }),
      prisma.call.count({ where: { orgId, status: 'MISSED', createdAt: { gte: startOfWeek } } }),
      prisma.appointment.count({ where: { orgId, createdAt: { gte: startOfWeek } } }),
      prisma.call.count({ where: { orgId, sentiment: 'POSITIVE', createdAt: { gte: startOfWeek } } }),
      prisma.call.count({ where: { orgId, createdAt: { gte: startOfLastWeek, lt: startOfWeek } } }),
      prisma.appointment.count({ where: { orgId, createdAt: { gte: startOfLastWeek, lt: startOfWeek } } }),
    ]);

    // Average call duration
    const avgDuration = await prisma.call.aggregate({
      where: { orgId, status: 'COMPLETED', createdAt: { gte: startOfWeek } },
      _avg: { duration: true },
    });

    // Daily breakdown for chart
    const dailyCalls = await prisma.$queryRaw`
      SELECT 
        EXTRACT(DOW FROM created_at) as day_of_week,
        COUNT(*) as total_calls,
        COUNT(*) FILTER (WHERE status = 'COMPLETED') as completed,
        COUNT(*) FILTER (WHERE id IN (SELECT call_id FROM appointments WHERE call_id IS NOT NULL)) as booked
      FROM calls 
      WHERE org_id = ${orgId} AND created_at >= ${startOfWeek}
      GROUP BY EXTRACT(DOW FROM created_at)
      ORDER BY day_of_week
    `.catch(() => []); // Fallback if raw query fails

    const aiHandledRate = totalCallsThisWeek > 0
      ? Math.round((completedCallsThisWeek / totalCallsThisWeek) * 100)
      : 0;

    const satisfactionRate = completedCallsThisWeek > 0
      ? Math.round((positiveSentimentThisWeek / completedCallsThisWeek) * 100)
      : 0;

    const result = {
      totalCalls: totalCallsThisWeek,
      completedCalls: completedCallsThisWeek,
      missedCalls: missedCallsThisWeek,
      appointmentsBooked: appointmentsThisWeek,
      avgDurationSeconds: Math.round(avgDuration._avg.duration || 0),
      aiHandledRate,
      satisfactionRate,
      callsChange: totalCallsLastWeek > 0
        ? Math.round(((totalCallsThisWeek - totalCallsLastWeek) / totalCallsLastWeek) * 100)
        : 0,
      appointmentsChange: appointmentsLastWeek > 0
        ? Math.round(((appointmentsThisWeek - appointmentsLastWeek) / appointmentsLastWeek) * 100)
        : 0,
      dailyBreakdown: dailyCalls,
    };

    // Cache for 5 minutes
    await redis.set(cacheKey, JSON.stringify(result), 'EX', 300);

    res.json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
