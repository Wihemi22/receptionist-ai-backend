/**
 * Database seed script — Creates demo data for development
 * Run: npm run db:seed
 */
const { PrismaClient } = require('@prisma/client');
const { v4: uuid } = require('uuid');

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...\n');

  // 1. Create demo organization
  const org = await prisma.organization.create({
    data: {
      name: 'Acme Dental',
      email: 'admin@acmedental.com',
      phone: '+15551234567',
      timezone: 'America/New_York',
      plan: 'PROFESSIONAL',
      settingsJson: { businessType: 'Dental / Medical', apiKey: uuid() },
    },
  });
  console.log(`Created org: ${org.name} (${org.id})`);

  // 2. Create owner user
  const user = await prisma.user.create({
    data: {
      orgId: org.id,
      email: 'dr.smith@acmedental.com',
      name: 'Dr. Jane Smith',
      role: 'OWNER',
    },
  });
  console.log(`Created user: ${user.name}`);

  // 3. Create AI config
  await prisma.aiConfig.create({
    data: {
      orgId: org.id,
      greetingMessage: "Thank you for calling Acme Dental! I'm your AI assistant and I'd be happy to help you schedule an appointment. How can I help you today?",
      personality: 'professional',
      voiceId: 'alloy',
      instructions: 'Always ask for the patient name and preferred date. Mention that new patients should arrive 15 minutes early.',
    },
  });

  // 4. Create availability (Mon-Fri 8am-5pm, Sat 9am-1pm)
  const hours = [
    { dayOfWeek: 1, startTime: '08:00', endTime: '17:00', isActive: true },
    { dayOfWeek: 2, startTime: '08:00', endTime: '17:00', isActive: true },
    { dayOfWeek: 3, startTime: '08:00', endTime: '17:00', isActive: true },
    { dayOfWeek: 4, startTime: '08:00', endTime: '17:00', isActive: true },
    { dayOfWeek: 5, startTime: '08:00', endTime: '17:00', isActive: true },
    { dayOfWeek: 6, startTime: '09:00', endTime: '13:00', isActive: true },
    { dayOfWeek: 0, startTime: '00:00', endTime: '00:00', isActive: false },
  ];

  for (const h of hours) {
    await prisma.availability.create({ data: { orgId: org.id, ...h } });
  }

  // 5. Create services
  const services = [
    { name: 'Dental Cleaning', durationMinutes: 60, price: 150, description: 'Standard teeth cleaning' },
    { name: 'Teeth Whitening', durationMinutes: 90, price: 350, description: 'Professional whitening treatment' },
    { name: 'Consultation', durationMinutes: 30, price: 75, description: 'Initial consultation' },
    { name: 'Annual Physical', durationMinutes: 45, price: 200, description: 'Annual check-up' },
    { name: 'Follow-up Visit', durationMinutes: 20, price: 50, description: 'Follow-up appointment' },
  ];

  for (const s of services) {
    await prisma.service.create({ data: { orgId: org.id, ...s } });
  }

  // 6. Create sample calls
  const calls = [
    { callerPhone: '+15552348901', callerName: 'Sarah Mitchell', duration: 222, status: 'COMPLETED', sentiment: 'POSITIVE', summary: 'Booked dental cleaning for March 5th at 2pm' },
    { callerPhone: '+15558764321', callerName: 'James Rodriguez', duration: 311, status: 'COMPLETED', sentiment: 'NEUTRAL', summary: 'Asked about pricing for dental services, requested callback' },
    { callerPhone: '+15553456789', callerName: 'Emily Chen', duration: 128, status: 'COMPLETED', sentiment: 'POSITIVE', summary: 'Rescheduled appointment from Wed to Friday 10am' },
    { callerPhone: '+15550001234', callerName: null, duration: 34, status: 'MISSED', sentiment: 'UNKNOWN', summary: 'Caller hung up before AI could assist' },
    { callerPhone: '+15555678901', callerName: 'David Park', duration: 263, status: 'COMPLETED', sentiment: 'POSITIVE', summary: 'Booked consultation for March 8th 11am' },
    { callerPhone: '+15554321098', callerName: 'Maria Gonzalez', duration: 115, status: 'COMPLETED', sentiment: 'NEGATIVE', summary: 'Complained about wait times. Transferred to manager.' },
    { callerPhone: '+15557890123', callerName: 'Tom Baker', duration: 190, status: 'COMPLETED', sentiment: 'POSITIVE', summary: 'Booked annual physical exam for March 12th at 9am' },
  ];

  for (let i = 0; i < calls.length; i++) {
    const createdAt = new Date();
    createdAt.setHours(createdAt.getHours() - i);
    await prisma.call.create({ data: { orgId: org.id, createdAt, ...calls[i] } });
  }

  // 7. Create sample appointments
  const appointments = [
    { clientName: 'Sarah Mitchell', clientPhone: '+15552348901', service: 'Dental Cleaning', startTime: new Date('2026-03-05T14:00:00'), endTime: new Date('2026-03-05T15:00:00'), status: 'CONFIRMED' },
    { clientName: 'Emily Chen', clientPhone: '+15553456789', service: 'Dental Cleaning', startTime: new Date('2026-03-07T10:00:00'), endTime: new Date('2026-03-07T11:00:00'), status: 'CONFIRMED' },
    { clientName: 'David Park', clientPhone: '+15555678901', service: 'Consultation', startTime: new Date('2026-03-08T11:00:00'), endTime: new Date('2026-03-08T11:30:00'), status: 'PENDING' },
    { clientName: 'Tom Baker', clientPhone: '+15557890123', service: 'Annual Physical', startTime: new Date('2026-03-12T09:00:00'), endTime: new Date('2026-03-12T09:45:00'), status: 'CONFIRMED' },
    { clientName: 'Lisa Wong', clientPhone: '+15559012345', service: 'Teeth Whitening', startTime: new Date('2026-03-14T15:30:00'), endTime: new Date('2026-03-14T17:00:00'), status: 'PENDING' },
    { clientName: 'Robert Kim', clientPhone: '+15556789012', service: 'Follow-up Visit', startTime: new Date('2026-03-15T13:00:00'), endTime: new Date('2026-03-15T13:20:00'), status: 'CONFIRMED' },
  ];

  for (const a of appointments) {
    await prisma.appointment.create({ data: { orgId: org.id, ...a } });
  }

  console.log('\nSeed complete!');
  console.log(`  Organization: ${org.name} (${org.id})`);
  console.log(`  User: ${user.email}`);
  console.log(`  Calls: ${calls.length}`);
  console.log(`  Appointments: ${appointments.length}`);
  console.log(`  Services: ${services.length}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
