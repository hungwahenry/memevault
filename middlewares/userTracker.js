// middlewares/userTracker.js
const User = require('../models/user');
const logger = require('../utils/logger');

module.exports = async (ctx, next) => {
  try {
    // Skip if this is not from a user
    if (!ctx.from) {
      return next();
    }
    
    const userId = ctx.from.id.toString();
    const updateData = {
      lastInteraction: new Date(),
      $inc: { interactionCount: 1 }
    };
    
    // Add user info if available
    if (ctx.from.username) updateData.username = ctx.from.username;
    if (ctx.from.first_name) updateData.firstName = ctx.from.first_name;
    if (ctx.from.last_name) updateData.lastName = ctx.from.last_name;
    if (ctx.from.language_code) updateData.languageCode = ctx.from.language_code;
    
    // Add group to user's groups if in a group chat
    if (ctx.chat && (ctx.chat.type === 'group' || ctx.chat.type === 'supergroup')) {
      const groupId = ctx.chat.id.toString();
      updateData.$addToSet = { groups: groupId };
    }
    
    // Create or update user document
    await User.findOneAndUpdate(
      { userId },
      updateData,
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    
  } catch (error) {
    logger.error('Error in user tracking middleware:', {error});
    // We don't want to block the bot's functionality if user tracking fails
  }
  
  return next();
};