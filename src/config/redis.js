const Redis = require('ioredis');

let redis;

try {
  redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
    maxRetriesPerRequest: 3,
    retryStrategy(times) {
      if (times > 3) return null;
      return Math.min(times * 200, 2000);
    },
  });

  redis.on('connect', () => console.log('[Redis] Connected'));
  redis.on('error', (err) => console.error('[Redis] Error:', err.message));
} catch (err) {
  console.warn('[Redis] Not available, using in-memory fallback');
  // Simple in-memory fallback for dev
  const store = new Map();
  redis = {
    get: async (key) => store.get(key) || null,
    set: async (key, value, ...args) => { store.set(key, value); return 'OK'; },
    del: async (key) => store.delete(key),
    incr: async (key) => { const v = (parseInt(store.get(key) || '0') + 1); store.set(key, String(v)); return v; },
  };
}

module.exports = redis;
