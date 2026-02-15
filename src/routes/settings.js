const express = require('express');
const prisma = require('../config/database');
const { updateVapiAssistant } = require('../services/vapi');

const router = express.Router();

/**
 * GET /api/settings/ai — Get AI configuration
 */
router.get('/ai', async (req, res, next) => {
  try {
    const config = await prisma.aiConfig.findUnique({ where: { orgId: req.orgId } });
    if (!config) return res.status(404).json({ error: 'AI config not found' });
    res.json(config);
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/settings/ai — Update AI configuration
 */
router.put('/ai', async (req, res, next) => {
  try {
    const { greetingMessage, personality, voiceId, instructions, escalationRules } = req.body;

    const config = await prisma.aiConfig.update({
      where: { orgId: req.orgId },
      data: {
        ...(greetingMessage && { greetingMessage }),
        ...(personality && { personality }),
        ...(voiceId && { voiceId }),
        ...(instructions !== undefined && { instructions }),
        ...(escalationRules !== undefined && { escalationRules }),
      },
    });

    // Sync with Vapi (non-blocking)
    updateVapiAssistant(req.orgId, config).catch(e => console.warn('[Vapi] Update deferred:', e.message));

    res.json(config);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/settings/services — Get services
 */
router.get('/services', async (req, res, next) => {
  try {
    const services = await prisma.service.findMany({ where: { orgId: req.orgId } });
    res.json({ services });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/settings/services — Add a service
 */
router.post('/services', async (req, res, next) => {
  try {
    const { name, durationMinutes, price, description } = req.body;
    const service = await prisma.service.create({
      data: { orgId: req.orgId, name, durationMinutes: durationMinutes || 30, price, description },
    });
    res.status(201).json(service);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
