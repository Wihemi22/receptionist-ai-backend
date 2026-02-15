require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const http = require('http');
const { Server } = require('socket.io');
const rateLimit = require('express-rate-limit');

// Route imports
const orgRoutes = require('./routes/organizations');
const callRoutes = require('./routes/calls');
const appointmentRoutes = require('./routes/appointments');
const availabilityRoutes = require('./routes/availability');
const settingsRoutes = require('./routes/settings');
const analyticsRoutes = require('./routes/analytics');
const webhookRoutes = require('./routes/webhooks');
const billingRoutes = require('./routes/billing');

// Middleware imports
const { authMiddleware } = require('./middleware/auth');
const { errorHandler } = require('./middleware/errorHandler');

const app = express();
const server = http.createServer(app);

// === SOCKET.IO (real-time call updates) ===
const io = new Server(server, {
  cors: { origin: process.env.FRONTEND_URL || '*', methods: ['GET', 'POST'] },
});
app.set('io', io);

io.on('connection', (socket) => {
  console.log(`[WS] Client connected: ${socket.id}`);
  socket.on('join-org', (orgId) => {
    socket.join(`org:${orgId}`);
    console.log(`[WS] ${socket.id} joined org:${orgId}`);
  });
  socket.on('disconnect', () => console.log(`[WS] Disconnected: ${socket.id}`));
});

// === MIDDLEWARE ===
app.use(helmet());
app.use(cors({ origin: process.env.FRONTEND_URL || '*' }));
app.use(morgan('short'));

// Raw body for Stripe webhooks (must be before json parser)
app.use('/api/webhooks/stripe', express.raw({ type: 'application/json' }));

// JSON parsing for everything else
app.use(express.json());

// Rate limiting
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 200 });
app.use('/api/', limiter);

// === ROUTES ===
// Public (no auth required)
app.use('/api/organizations', orgRoutes);
app.use('/api/webhooks', webhookRoutes);
app.use('/api/billing', billingRoutes);

// Protected (auth required)
app.use('/api/calls', authMiddleware, callRoutes);
app.use('/api/appointments', authMiddleware, appointmentRoutes);
app.use('/api/availability', authMiddleware, availabilityRoutes);
app.use('/api/settings', authMiddleware, settingsRoutes);
app.use('/api/analytics', authMiddleware, analyticsRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Error handler
app.use(errorHandler);

// === START ===
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`\n🤖 Receptionist AI API running on port ${PORT}`);
  console.log(`   Environment: ${process.env.NODE_ENV || 'development'}\n`);
});

module.exports = { app, server, io };
