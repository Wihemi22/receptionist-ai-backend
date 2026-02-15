/**
 * SMS Service — Sends appointment confirmations and reminders via Twilio
 */

const TWILIO_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_FROM = process.env.TWILIO_SMS_FROM;

let twilioClient = null;

function getTwilioClient() {
  if (!twilioClient && TWILIO_SID && TWILIO_TOKEN) {
    const twilio = require('twilio');
    twilioClient = twilio(TWILIO_SID, TWILIO_TOKEN);
  }
  return twilioClient;
}

/**
 * Send appointment confirmation SMS
 */
async function sendSmsConfirmation(appointment) {
  const client = getTwilioClient();
  if (!client) {
    console.warn('[SMS] Twilio not configured, skipping SMS');
    return null;
  }

  const prisma = require('../config/database');
  const org = await prisma.organization.findUnique({ where: { id: appointment.orgId } });

  const date = new Date(appointment.startTime);
  const dateStr = date.toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });
  const timeStr = date.toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit',
  });

  const message = `Appointment Confirmed! 

${appointment.service} at ${org?.name || 'our office'}
Date: ${dateStr}
Time: ${timeStr}

To reschedule or cancel, please call us back. See you then!`;

  const result = await client.messages.create({
    body: message,
    from: TWILIO_FROM,
    to: appointment.clientPhone,
  });

  // Update reminder count
  await prisma.appointment.update({
    where: { id: appointment.id },
    data: { remindersSent: { increment: 1 } },
  });

  console.log(`[SMS] Sent confirmation to ${appointment.clientPhone}: ${result.sid}`);
  return result;
}

/**
 * Send appointment reminder SMS (e.g., 24 hours before)
 */
async function sendSmsReminder(appointment) {
  const client = getTwilioClient();
  if (!client) return null;

  const prisma = require('../config/database');
  const org = await prisma.organization.findUnique({ where: { id: appointment.orgId } });

  const date = new Date(appointment.startTime);
  const timeStr = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

  const message = `Reminder: You have a ${appointment.service} appointment tomorrow at ${timeStr} with ${org?.name || 'us'}. Reply CANCEL to cancel.`;

  const result = await client.messages.create({
    body: message,
    from: TWILIO_FROM,
    to: appointment.clientPhone,
  });

  await prisma.appointment.update({
    where: { id: appointment.id },
    data: { remindersSent: { increment: 1 } },
  });

  return result;
}

module.exports = { sendSmsConfirmation, sendSmsReminder };
