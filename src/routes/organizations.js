const express = require('express');
const jwt = require('jsonwebtoken');
const { v4: uuid } = require('uuid');
const prisma = require('../config/database');
const { setupVapiAssistant } = require('../services/vapi');
const { createStripeCustomer } = require('../services/stripe');

const router = express.Router();

/**
 * POST /api/organizations — Create new business account (signup)
 */
router.post('/', async (req, res, next) => {
  try {
    const { businessName, name, email, phone, businessType, plan } = req.body;

    if (!businessName || !name || !email) {
      return res.status(400).json({ error: 'businessName, name, and email are required' });
    }

    // Check if email already exists
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return res.status(409).json({ error: 'An account with this email already exists' });
    }

    // Create organization + owner user in a transaction
    const result = await prisma.$transaction(async (tx) => {
      const org = await tx.organization.create({
        data: {
          name: businessName,
          email,
          phone: phone || null,
          plan: plan?.toUpperCase() || 'STARTER',
          settingsJson: { businessType: businessType || 'Other', apiKey: uuid() },
        },
      });

      const user = await tx.user.create({
        data: {
          orgId: org.id,
          email,
          name,
          role: 'OWNER',
        },
      });

      // Create default AI config
      await tx.aiConfig.create({
        data: {
          orgId: org.id,
          greetingMessage: `Thank you for calling ${businessName}! I'm an AI assistant and I'd be happy to help you schedule an appointment. How can I help you today?`,
          personality: 'professional',
          voiceId: 'alloy',
        },
      });

      // Create default availability (Mon-Fri 9-5)
      const days = [1, 2, 3, 4, 5]; // Mon-Fri
      await tx.availability.createMany({
        data: days.map(day => ({
          orgId: org.id,
          dayOfWeek: day,
          startTime: '09:00',
          endTime: '17:00',
          isActive: true,
        })),
      });

      return { org, user };
    });

    // Background tasks (non-blocking)
    Promise.allSettled([
      setupVapiAssistant(result.org).catch(e => console.warn('[Vapi] Setup deferred:', e.message)),
      createStripeCustomer(result.org).catch(e => console.warn('[Stripe] Setup deferred:', e.message)),
    ]);

    // Generate JWT token
    const token = jwt.sign(
      { userId: result.user.id, orgId: result.org.id },
      process.env.JWT_SECRET || 'dev-secret',
      { expiresIn: '30d' }
    );

    res.status(201).json({
      success: true,
      token,
      organization: {
        id: result.org.id,
        name: result.org.name,
        plan: result.org.plan,
      },
      user: {
        id: result.user.id,
        email: result.user.email,
        name: result.user.name,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/organizations/:id — Get organization details (requires auth)
 */
router.get('/:id', async (req, res, next) => {
  try {
    const org = await prisma.organization.findUnique({
      where: { id: req.params.id },
      include: {
        aiConfig: true,
        services: true,
        availability: { orderBy: { dayOfWeek: 'asc' } },
        _count: { select: { calls: true, appointments: true } },
      },
    });

    if (!org) return res.status(404).json({ error: 'Organization not found' });
    res.json(org);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
