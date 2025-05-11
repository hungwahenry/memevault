// middlewares/ratelimiter.js
const redisClient = require('../services/redis');
const logger = require('../utils/logger');

/**
 * Create a rate limiter middleware
 * @param {Object} options - Rate limiter options
 * @param {number} options.windowMs - Time window in milliseconds
 * @param {number} options.maxRequests - Maximum number of requests per window
 * @returns {Function} Middleware function
 */
function createRateLimiter(options = {}) {
  const windowMs = options.windowMs || 60000; // default: 1 minute
  const maxRequests = options.maxRequests || 20; // default: 20 requests per minute
  
  return async (ctx, next) => {
    try {
      // Skip rate limiting for text messages
      if (ctx.message && ctx.message.text) {
        return next();
      }
      
      const userId = ctx.from?.id;
      if (!userId) {
        return next();
      }
      
      const key = `ratelimit:${userId}`;
      
      // Get current count
      let count = await redisClient.get(key);
      count = count ? parseInt(count) : 0;
      
      if (count >= maxRequests) {
        logger.warn('Rate limit exceeded', { userId, count, maxRequests });
        
        // Only notify once per window
        const notifiedKey = `ratelimit:notified:${userId}`;
        const notified = await redisClient.get(notifiedKey);
        
        if (!notified && ctx.callbackQuery) {
          await ctx.answerCbQuery('Rate limit exceeded. Please wait a moment before trying again.', { show_alert: true });
          await redisClient.set(notifiedKey, '1', 'EX', Math.floor(windowMs / 1000));
        }
        
        return;
      }
      
      // Increment count
      await redisClient.incr(key);
      
      // Set expiry on first request
      if (count === 0) {
        await redisClient.expire(key, Math.floor(windowMs / 1000));
      }
      
      return next();
    } catch (error) {
      logger.error('Error in rate limiter middleware', { error });
      return next();
    }
  };
}

module.exports = createRateLimiter;