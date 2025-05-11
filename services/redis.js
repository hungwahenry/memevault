// services/redis.js
const Redis = require('ioredis');

// Log the Redis URI being used (excluding password for security)
const redisUri = process.env.REDIS_URI;
if (!redisUri) {
  console.warn('REDIS_URI environment variable is not set. Falling back to localhost.');
}

// Create a function to get a Redis client or a fallback implementation
function getRedisClient() {
  try {
    const client = new Redis(redisUri || 'redis://localhost:6379');
    
    client.on('connect', () => {
      console.log('Connected to Redis successfully');
    });
    
    client.on('error', (err) => {
      console.error('Redis connection error:', err);
    });
    
    return client;
  } catch (error) {
    console.error('Failed to initialize Redis client:', error);
    
    // Return a fallback implementation with no-op methods
    return {
      get: async () => null,
      set: async () => null,
      incr: async () => null,
      expire: async () => null,
      del: async () => null,
    };
  }
}

// Export the Redis client or fallback
module.exports = getRedisClient();