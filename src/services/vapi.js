/**
 * Vapi Voice AI Service
 * Handles creating/updating AI assistants and phone numbers on Vapi.
 * Docs: https://docs.vapi.ai
 */

const VAPI_BASE = 'https://api.vapi.ai';
const VAPI_KEY = process.env.VAPI_API_KEY;

async function vapiRequest(method, path, body) {
  const res = await fetch(`${VAPI_BASE}${path}`, {
    method,
    headers: {
      'Authorization': `Bearer ${VAPI_KEY}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Vapi API error (${res.status}): ${err}`);
  }

  return res.json();
}

/**
 * Create a Vapi assistant for a new organization
 */
async function setupVapiAssistant(org) {
  if (!VAPI_KEY) {
    console.warn('[Vapi] No API key configured, skipping assistant setup');
    return null;
  }

  const prisma = require('../config/database');
  const aiConfig = await prisma.aiConfig.findUnique({ where: { orgId: org.id } });
  const services = await prisma.service.findMany({ where: { orgId: org.id } });
  const availability = await prisma.availability.findMany({
    where: { orgId: org.id, isActive: true },
  });

  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const availText = availability.map(a =>
    `${dayNames[a.dayOfWeek]}: ${a.startTime} - ${a.endTime}`
  ).join('\n');

  const servicesText = services.length > 0
    ? services.map(s => `- ${s.name} (${s.durationMinutes} min, $${s.price || 'varies'})`).join('\n')
    : '- General Appointment (30 min)';

  // Build system prompt for the AI receptionist
  const systemPrompt = `You are a professional and friendly AI receptionist for ${org.name}.

Your greeting: "${aiConfig?.greetingMessage || `Thank you for calling ${org.name}! How can I help you today?`}"

Your personality: ${aiConfig?.personality || 'professional, warm, and efficient'}

BUSINESS HOURS:
${availText || 'Monday-Friday: 9:00 AM - 5:00 PM'}

SERVICES OFFERED:
${servicesText}

INSTRUCTIONS:
- Greet the caller warmly using the greeting above
- Identify the caller's intent (scheduling, questions, complaints, etc.)
- For scheduling requests: use the check_availability tool to find open slots, then book_appointment to confirm
- Always confirm appointment details before booking (date, time, service, caller name)
- After booking, inform the caller they'll receive an SMS confirmation
- For questions you can't answer, offer to take a message or transfer to the business
- Be concise but friendly; keep the conversation flowing naturally
- If the caller seems upset, be empathetic and offer to connect them with a manager
${aiConfig?.instructions || ''}`;

  // Create Vapi assistant
  const assistant = await vapiRequest('POST', '/assistant', {
    name: `${org.name} Receptionist`,
    model: {
      provider: 'openai',
      model: 'gpt-4o-mini',
      messages: [{ role: 'system', content: systemPrompt }],
      tools: [
        {
          type: 'function',
          function: {
            name: 'check_availability',
            description: 'Check available appointment slots for a given date',
            parameters: {
              type: 'object',
              properties: {
                date: { type: 'string', description: 'Date in YYYY-MM-DD format' },
                service: { type: 'string', description: 'Service type requested' },
              },
              required: ['date'],
            },
          },
        },
        {
          type: 'function',
          function: {
            name: 'book_appointment',
            description: 'Book an appointment after confirming with the caller',
            parameters: {
              type: 'object',
              properties: {
                clientName: { type: 'string', description: 'Caller full name' },
                clientPhone: { type: 'string', description: 'Caller phone number' },
                service: { type: 'string', description: 'Service being booked' },
                date: { type: 'string', description: 'Date in YYYY-MM-DD format' },
                time: { type: 'string', description: 'Time in HH:MM AM/PM format' },
              },
              required: ['clientName', 'service', 'date', 'time'],
            },
          },
        },
      ],
    },
    voice: {
      provider: 'openai',
      voiceId: aiConfig?.voiceId || 'alloy',
    },
    serverUrl: `${process.env.API_URL}/api/webhooks/vapi`,
    serverUrlSecret: process.env.VAPI_WEBHOOK_SECRET || undefined,
    metadata: { orgId: org.id },
    firstMessage: aiConfig?.greetingMessage || `Thank you for calling ${org.name}! How can I help you today?`,
    endCallFunctionEnabled: true,
    recordingEnabled: true,
    transcriptionEnabled: true,
  });

  // Save assistant ID to org
  await prisma.organization.update({
    where: { id: org.id },
    data: { vapiAssistantId: assistant.id },
  });

  console.log(`[Vapi] Created assistant ${assistant.id} for org ${org.name}`);
  return assistant;
}

/**
 * Update an existing Vapi assistant when settings change
 */
async function updateVapiAssistant(orgId, aiConfig) {
  if (!VAPI_KEY) return null;

  const prisma = require('../config/database');
  const org = await prisma.organization.findUnique({ where: { id: orgId } });

  if (!org?.vapiAssistantId) {
    console.warn(`[Vapi] No assistant found for org ${orgId}, creating new one`);
    return setupVapiAssistant(org);
  }

  // Rebuild system prompt (same logic as setup)
  const availability = await prisma.availability.findMany({
    where: { orgId, isActive: true },
  });
  const services = await prisma.service.findMany({ where: { orgId } });

  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const availText = availability.map(a =>
    `${dayNames[a.dayOfWeek]}: ${a.startTime} - ${a.endTime}`
  ).join('\n');

  const servicesText = services.length > 0
    ? services.map(s => `- ${s.name} (${s.durationMinutes} min)`).join('\n')
    : '- General Appointment (30 min)';

  const systemPrompt = `You are a professional and friendly AI receptionist for ${org.name}.

Your greeting: "${aiConfig.greetingMessage}"
Your personality: ${aiConfig.personality}

BUSINESS HOURS:
${availText}

SERVICES:
${servicesText}

INSTRUCTIONS:
- Greet caller warmly, identify intent, help with scheduling
- Use check_availability and book_appointment tools
- Confirm all details before booking
- Be concise, friendly, and natural
${aiConfig.instructions || ''}`;

  await vapiRequest('PATCH', `/assistant/${org.vapiAssistantId}`, {
    model: {
      messages: [{ role: 'system', content: systemPrompt }],
    },
    voice: { provider: 'openai', voiceId: aiConfig.voiceId || 'alloy' },
    firstMessage: aiConfig.greetingMessage,
  });

  console.log(`[Vapi] Updated assistant for org ${org.name}`);
}

module.exports = { setupVapiAssistant, updateVapiAssistant };
