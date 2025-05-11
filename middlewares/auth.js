// middlewares/auth.js
const Group = require('../models/group');
const User = require('../models/user');
const logger = require('../utils/logger');

module.exports = async (ctx, next) => {
  try {
    // Check if user is banned (for any type of chat)
    if (ctx.from) {
      const userId = ctx.from.id.toString();
      
      // Skip ban check for the bot owner
      if (userId !== process.env.BOT_OWNER_ID) {
        const user = await User.findOne({ userId });
        
        if (user && user.banned) {
          // Check if the ban has expired
          if (user.banExpires && new Date() > user.banExpires) {
            // Ban has expired, so unban the user
            user.banned = false;
            user.banReason = null;
            user.banExpires = null;
            await user.save();
            logger.info('User ban has expired, automatically unbanned', {
              userId,
              username: ctx.from.username
            });
          } else {
            // User is still banned, don't process their request
            const banMessage = user.banReason 
              ? `You have been banned from using this bot. Reason: ${user.banReason}`
              : 'You have been banned from using this bot.';
            
            const expiryInfo = user.banExpires 
              ? `\n\nYour ban will expire on ${user.banExpires.toLocaleString()}.` 
              : '\n\nThis is a permanent ban.';
              
            try {
              // Only notify in private chats to avoid spam in groups
              if (ctx.chat && ctx.chat.type === 'private') {
                await ctx.reply(banMessage + expiryInfo);
              }
            } catch (replyError) {
              logger.warn('Could not send ban notification', { replyError });
            }
            
            logger.info('Banned user attempted to use bot', {
              userId,
              username: ctx.from.username,
              updateType: ctx.updateType
            });
            
            return; // Don't proceed to next middleware
          }
        }
      }
    }
    
    // Skip middleware for private chats
    if (ctx.chat && ctx.chat.type === 'private') {
      return next();
    }

    // For group chats, check if the bot is set up
    if (ctx.chat && (ctx.chat.type === 'group' || ctx.chat.type === 'supergroup')) {
      const groupId = ctx.chat.id.toString();
      
      // Find group in database
      const group = await Group.findOne({ groupId });
      
      // Store group info in context for convenience
      ctx.state.group = group;
      
      // Check if this is a command that requires setup
      if (ctx.message && ctx.message.text && ctx.message.text.startsWith('/')) {
        const command = ctx.message.text.split(' ')[0];
        
        // If the command is not /setup and the group is not set up, remind them to set up
        if (command !== '/setup' && (!group || !group.setupComplete)) {
          await ctx.reply('Please set up the bot first using the /setup command.');
          logger.info('Command attempted in non-setup group', {
            groupId,
            command,
            userId: ctx.from.id
          });
          return;
        }
        
        // For /challenge command, check if the user is an admin
        if (command === '/challenge' && group) {
          const userId = ctx.from.id.toString();
          if (!group.adminIds.includes(userId)) {
            await ctx.reply('Only group admins can create challenges.');
            logger.warn('Non-admin attempted to create challenge', {
              groupId,
              userId,
              command
            });
            return;
          }
        }
      }
    }
    
    return next();
  } catch (error) {
    logger.error('Error in auth middleware:', {error, update: ctx.update});
    return next();
  }
};