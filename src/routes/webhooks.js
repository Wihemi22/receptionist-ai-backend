const express = require('express');
const prisma = require('../config/database');
const { analyzeSentiment } = require('../services/openai');
const { sendSmsConfirmation } = require('../services/sms');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const router = express.Router();

// ================================================
// VAPI WEBHOOKS
// ================================================

/**
 * POST /api/webhooks/vapi — Main Vapi webhook handler
 * Vapi sends events: call.started, call.ended, call.analyzed, tool.call
 */
router.post('/vapi', async (req, res) => {
  try {
    const { type, call, tool_call } = req.body;
    console.log(`[Vapi Webhook] Event: ${type}, Call: ${call?.id}`);

    switch (type) {
      case 'call.started':
        await handleCallStarted(req, call);
        break;

      case 'call.ended':
        await handleCallEnded(req, call);
        break;

      case 'tool.call':
        // AI requested a tool action (check availability, book appointment)
        const result = await handleToolCall(tool_call, call);
        return res.json({ result });

      case 'status-update':
        // Live status updates during call
        const io = req.app.get('io');
        if (call?.orgId) {
          io.to(`org:${call.orgId}`).emit('call:status', {
            callId: call.id,
            status: call.status,
            transcript: call.transcript,
          });
        }
        break;
    }

    res.json({ success: true });
  } catch (err) {
    console.error('[Vapi Webhook Error]', err);
    res.status(200).json({ success: false, error: err.message }); // Always 200 for webhooks
  }
});

/**
 * POST /api/webhooks/call-started — Legacy endpoint
 */
router.post('/call-started', async (req, res) => {
  try {
    await handleCallStarted(req, req.body);
    res.json({ success: true });
  } catch (err) {
    console.error('[Call Started Error]', err);
    res.json({ success: false });
  }
});

/**
 * POST /api/webhooks/call-ended — Legacy endpoint
 */
router.post('/call-ended', async (req, res) => {
  try {
    await handleCallEnded(req, req.body);
    res.json({ success: true });
  } catch (err) {
    console.error('[Call Ended Error]', err);
    res.json({ success: false });
  }
});

// ================================================
// STRIPE WEBHOOK
// ================================================

router.post('/stripe', async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('[Stripe Webhook] Signature verification failed:', err.message);
    return res.status(400).json({ error: 'Invalid signature' });
  }

  switch (event.type) {
    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const sub = event.data.object;
      const priceId = sub.items.data[0]?.price?.id;
      let plan = 'STARTER';
      if (priceId === process.env.STRIPE_PRICE_PRO) plan = 'PROFESSIONAL';
      if (priceId === process.env.STRIPE_PRICE_ENTERPRISE) plan = 'ENTERPRISE';

      await prisma.organization.updateMany({
        where: { stripeCustomerId: sub.customer },
        data: { plan, stripeSubId: sub.id },
      });
      break;
    }
    case 'customer.subscription.deleted': {
      const sub = event.data.object;
      await prisma.organization.updateMany({
        where: { stripeCustomerId: sub.customer },
        data: { plan: 'STARTER', stripeSubId: null },
      });
      break;
    }
  }

  res.json({ received: true });
});

// ================================================
// HANDLER FUNCTIONS
// ================================================

async function handleCallStarted(req, callData) {
  const orgId = callData.assistantOverrides?.metadata?.orgId || callData.orgId;
  if (!orgId) {
    console.warn('[Call Started] No orgId found in call data');
    return;
  }

  const call = await prisma.call.create({
    data: {
      orgId,
      callerPhone: callData.customer?.number || callData.from || 'unknown',
      callerName: callData.customer?.name || null,
      status: 'IN_PROGRESS',
      vapiCallId: callData.id,
      metadata: callData.metadata || {},
    },
  });

  // Real-time notification
  const io = req.app.get('io');
  io.to(`org:${orgId}`).emit('call:started', {
    id: call.id,
    callerPhone: call.callerPhone,
    callerName: call.callerName,
    startedAt: call.createdAt,
  });

  // Track usage
  const redis = require('../config/redis');
  const monthKey = `usage:${orgId}:${new Date().toISOString().slice(0, 7)}`;
  await redis.incr(monthKey);
}

async function handleCallEnded(req, callData) {
  const vapiCallId = callData.id;

  const call = await prisma.call.findUnique({ where: { vapiCallId } });
  if (!call) {
    console.warn(`[Call Ended] No call found for Vapi ID: ${vapiCallId}`);
    return;
  }

  // Analyze sentiment from transcript
  const transcript = callData.transcript || callData.artifact?.transcript || '';
  const summary = callData.analysis?.summary || callData.artifact?.summary || '';
  let sentiment = 'UNKNOWN';
  if (transcript) {
    sentiment = await analyzeSentiment(transcript).catch(() => 'UNKNOWN');
  }

  const updatedCall = await prisma.call.update({
    where: { id: call.id },
    data: {
      status: callData.endedReason === 'customer-ended-call' && callData.duration < 5
        ? 'MISSED' : 'COMPLETED',
      duration: Math.round(callData.duration || 0),
      transcript,
      summary: summary || null,
      sentiment,
      recordingUrl: callData.recordingUrl || callData.artifact?.recordingUrl || null,
    },
  });

  // Real-time notification
  const io = req.app.get('io');
  io.to(`org:${call.orgId}`).emit('call:ended', {
    id: updatedCall.id,
    status: updatedCall.status,
    duration: updatedCall.duration,
    sentiment: updatedCall.sentiment,
    summary: updatedCall.summary,
    appointmentBooked: false, // Updated if tool call booked one
  });
}

/**
 * Handle Vapi tool calls (AI requesting actions during a call)
 */
async function handleToolCall(toolCall, callData) {
  const { name, parameters } = toolCall;

  switch (name) {
    case 'check_availability': {
      const { date, service } = parameters;
      const orgId = callData.assistantOverrides?.metadata?.orgId;

      const availability = await prisma.availability.findMany({
        where: { orgId, isActive: true },
      });

      const targetDate = new Date(date);
      const dayAvail = availability.find(a => a.dayOfWeek === targetDate.getDay());
      if (!dayAvail) return { available: false, message: 'We are closed on this day.' };

      // Get existing appointments
      const existing = await prisma.appointment.findMany({
        where: {
          orgId,
          status: { in: ['PENDING', 'CONFIRMED'] },
          startTime: {
            gte: new Date(date + 'T00:00:00'),
            lte: new Date(date + 'T23:59:59'),
          },
        },
        select: { startTime: true, endTime: true },
      });

      // Generate available slots
      const slots = [];
      const [sh, sm] = dayAvail.startTime.split(':').map(Number);
      const [eh, em] = dayAvail.endTime.split(':').map(Number);
      let cur = new Date(targetDate); cur.setHours(sh, sm, 0, 0);
      const end = new Date(targetDate); end.setHours(eh, em, 0, 0);

      while (cur.getTime() + 30 * 60000 <= end.getTime()) {
        const slotEnd = new Date(cur.getTime() + 30 * 60000);
        const booked = existing.some(a => cur < new Date(a.endTime) && slotEnd > new Date(a.startTime));
        if (!booked) {
          slots.push(cur.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }));
        }
        cur = new Date(cur.getTime() + 30 * 60000);
      }

      return {
        available: slots.length > 0,
        slots: slots.slice(0, 5), // Return up to 5 options
        message: slots.length > 0
          ? `Available times on ${date}: ${slots.slice(0, 3).join(', ')}`
          : 'No availability on this date. Please try another day.',
      };
    }

    case 'book_appointment': {
      const { clientName, clientPhone, service, date, time } = parameters;
      const orgId = callData.assistantOverrides?.metadata?.orgId;
      const vapiCallId = callData.id;

      const call = await prisma.call.findUnique({ where: { vapiCallId } });

      const startTime = new Date(`${date} ${time}`);
      const endTime = new Date(startTime.getTime() + 30 * 60000);

      const appointment = await prisma.appointment.create({
        data: {
          orgId,
          callId: call?.id || null,
          clientName,
          clientPhone: clientPhone || call?.callerPhone || 'unknown',
          service: service || 'General Appointment',
          startTime,
          endTime,
          status: 'CONFIRMED',
        },
      });

      // Send SMS confirmation
      sendSmsConfirmation(appointment).catch(e => console.warn('[SMS]', e.message));

      // Real-time update
      const io = req.app.get('io');
      io.to(`org:${orgId}`).emit('appointment:created', appointment);

      return {
        success: true,
        message: `Appointment booked for ${clientName} on ${date} at ${time}. A confirmation text will be sent shortly.`,
        appointmentId: appointment.id,
      };
    }

    default:
      return { error: `Unknown tool: ${name}` };
  }
}

module.exports = router;
