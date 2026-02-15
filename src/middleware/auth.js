const jwt = require('jsonwebtoken');
const prisma = require('../config/database');

/**
 * Auth middleware — validates JWT and attaches user + org to request.
 * Supports: Bearer token in Authorization header or x-api-key header.
 */
async function authMiddleware(req, res, next) {
  try {
    // Check for API key (org-level access)
    const apiKey = req.headers['x-api-key'];
    if (apiKey) {
      const org = await prisma.organization.findFirst({
        where: { settingsJson: { path: ['apiKey'], equals: apiKey } },
      });
      if (org) {
        req.orgId = org.id;
        req.org = org;
        return next();
      }
    }

    // Check for Bearer token
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      include: { organization: true },
    });

    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    req.user = user;
    req.orgId = user.orgId;
    req.org = user.organization;
    next();
  } catch (err) {
    if (err.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: 'Invalid token' });
    }
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' });
    }
    next(err);
  }
}

/**
 * Role-based access control middleware
 */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

module.exports = { authMiddleware, requireRole };
