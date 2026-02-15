/**
 * Stripe Billing Service
 */
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const prisma = require('../config/database');

/**
 * Create a Stripe customer for a new organization
 */
async function createStripeCustomer(org) {
  if (!process.env.STRIPE_SECRET_KEY) {
    console.warn('[Stripe] No API key configured, skipping customer creation');
    return null;
  }

  const customer = await stripe.customers.create({
    email: org.email,
    name: org.name,
    metadata: { orgId: org.id },
  });

  await prisma.organization.update({
    where: { id: org.id },
    data: { stripeCustomerId: customer.id },
  });

  console.log(`[Stripe] Created customer ${customer.id} for org ${org.name}`);
  return customer;
}

/**
 * Check if org has exceeded their call limit
 */
async function checkUsageLimit(orgId) {
  const org = await prisma.organization.findUnique({ where: { id: orgId } });
  if (!org) return { allowed: false, reason: 'Organization not found' };

  const limits = { STARTER: 100, PROFESSIONAL: 500, ENTERPRISE: Infinity };
  const limit = limits[org.plan] || 100;

  const monthKey = new Date().toISOString().slice(0, 7); // YYYY-MM
  const redis = require('../config/redis');
  const usage = parseInt(await redis.get(`usage:${orgId}:${monthKey}`) || '0');

  return {
    allowed: usage < limit,
    usage,
    limit,
    remaining: Math.max(0, limit - usage),
  };
}

module.exports = { createStripeCustomer, checkUsageLimit };
