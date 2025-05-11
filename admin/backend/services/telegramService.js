// admin/backend/services/telegramService.js
const { Telegraf } = require('telegraf');
const config = require('../config/config');

// Bot instance (initialized lazily)
let bot = null;
let botInfo = null;

// Initialize and validate bot
const initBot = async () => {
  if (bot !== null) {
    return bot; // Return existing instance if already initialized
  }

  if (!config.botToken) {
    console.error('Bot token is not provided in configuration');
    throw new Error('Bot token not configured');
  }

  try {
    // Create new bot instance
    bot = new Telegraf(config.botToken);
    
    // Verify the token by getting bot info
    botInfo = await bot.telegram.getMe();
    console.log(`Bot initialized: @${botInfo.username}`);
    
    return bot;
  } catch (error) {
    console.error('Failed to initialize Telegram bot:', error);
    bot = null;
    botInfo = null;
    throw error;
  }
};

// Get bot information
exports.getBotInfo = async () => {
  try {
    // Initialize bot if needed
    await initBot();
    return botInfo;
  } catch (error) {
    console.error('Error getting bot info:', error);
    return null;
  }
};

// Send message to a single user
exports.sendMessageToUser = async (userId, message, options = {}) => {
  try {
    // Initialize bot if needed
    const botInstance = await initBot();
    
    // Send message
    return await botInstance.telegram.sendMessage(userId, message, options);
  } catch (error) {
    console.error(`Error sending message to user ${userId}:`, error);
    throw error;
  }
};

// Send photo to a single user
exports.sendPhotoToUser = async (userId, photo, caption = '', options = {}) => {
  try {
    // Initialize bot if needed
    const botInstance = await initBot();
    
    // Send photo
    return await botInstance.telegram.sendPhoto(userId, photo, {
      caption: caption,
      ...options
    });
  } catch (error) {
    console.error(`Error sending photo to user ${userId}:`, error);
    throw error;
  }
};

// Send broadcast (supports both text and image broadcasts)
exports.sendBroadcast = async (userIds, content, options = {}) => {
    console.log(`Sending broadcast to ${userIds.length} users`);
    
    // Check content type (text or image)
    const isPhotoContent = content.type === 'photo';
    
    // Make sure bot is initialized
    try {
      await initBot();
    } catch (error) {
      console.error('Bot initialization failed:', error);
      return {
        total: userIds.length,
        successful: 0,
        failed: userIds.length,
        failures: [{ error: 'Bot initialization failed: ' + error.message }]
      };
    }
    
    const results = {
      total: userIds.length,
      successful: 0,
      failed: 0,
      failures: []
    };
    
    // Validate inputs
    if (isPhotoContent) {
      if (!content.photo) {
        console.error('Photo path not provided for photo broadcast');
        return {
          ...results,
          failed: userIds.length,
          failures: [{ error: 'Photo path not provided' }]
        };
      }
    } else {
      if (!content.message || content.message.trim() === '') {
        console.error('Empty message provided for text broadcast');
        return {
          ...results,
          failed: userIds.length,
          failures: [{ error: 'Empty message provided' }]
        };
      }
    }
    
    // Process each user
    for (const userId of userIds) {
      try {
        // Skip null, undefined or invalid user IDs
        if (!userId) {
          results.failed++;
          results.failures.push({
            userId: 'invalid',
            error: 'Invalid user ID'
          });
          continue;
        }
        
        // Send content based on type
        if (isPhotoContent) {
          // For local file uploads
          if (content.photo.startsWith('/uploads/')) {
            // Get the full server path to the file
            const fs = require('fs');
            const path = require('path');
            const filePath = path.join(__dirname, '..', content.photo);
            
            // Check if file exists
            if (!fs.existsSync(filePath)) {
              throw new Error(`File not found: ${filePath}`);
            }
            
            // Send photo from local file
            await bot.telegram.sendPhoto(userId, { 
              source: fs.createReadStream(filePath) 
            }, {
              caption: content.caption || '',
              ...options
            });
          } else {
            // For external URLs or Telegram file IDs
            await bot.telegram.sendPhoto(userId, content.photo, {
              caption: content.caption || '',
              ...options
            });
          }
        } else {
          // Send text message
          await bot.telegram.sendMessage(userId, content.message, options);
        }
        
        results.successful++;
      } catch (error) {
        results.failed++;
        results.failures.push({
          userId,
          error: error.message || 'Unknown error'
        });
      }
      
      // Add a short delay to avoid hitting rate limits
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    
    console.log(`Broadcast completed. Success: ${results.successful}, Failed: ${results.failed}`);
    return results;
  };

// Check if bot has access to a user
exports.checkUserAccess = async (userId) => {
  if (!userId) return false;
  
  try {
    // Initialize bot if needed
    await initBot();
    
    // Try to get chat information
    await bot.telegram.getChat(userId);
    return true;
  } catch (error) {
    // If 403 Forbidden, the user has blocked the bot
    if (error.description && error.description.includes('bot was blocked by the user')) {
      return false;
    }
    
    // For other errors, log but assume bot doesn't have access
    console.error(`Error checking access to user ${userId}:`, error);
    return false;
  }
};

// Stop the bot (useful for cleanup)
exports.stopBot = () => {
  if (bot) {
    bot.stop();
    bot = null;
    botInfo = null;
    console.log('Telegram bot stopped');
  }
};