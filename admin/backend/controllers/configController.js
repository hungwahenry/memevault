// admin/backend/controllers/configController.js
const models = require('../models/direct-access');
const { mongoose } = require('../utils/database');
const fs = require('fs').promises;
const path = require('path');

// Create a model for bot configuration
let BotConfig;
try {
  BotConfig = mongoose.model('BotConfig');
} catch (error) {
  const botConfigSchema = new mongoose.Schema({
    name: String,
    token: String,
    ownerId: String,
    settings: Object,
    lastStarted: Date,
    updatedAt: Date
  }, { collection: 'bot_config' });
  
  BotConfig = mongoose.model('BotConfig', botConfigSchema);
}

// Get configuration
exports.getConfig = async (req, res) => {
  try {
    // Get the bot configuration
    let botConfig = await BotConfig.findOne();
    
    // Create default config if none exists
    if (!botConfig) {
      botConfig = new BotConfig({
        name: 'MemeVault Bot',
        token: process.env.BOT_TOKEN,
        ownerId: process.env.BOT_OWNER_ID,
        settings: {
          challengeDuration: 7, // days
          maxSubmissionsPerUser: 5,
          defaultCurrency: 'Solana',
          minPrizeAmount: 0.1,
          fees: {
            platformFee: 5, // percent
            networkFee: 1  // percent
          }
        }
      });
      
      await botConfig.save();
    }
    
    // Remove sensitive info
    const safeConfig = {
      ...botConfig.toObject(),
      token: undefined
    };
    
    // Add system stats
    const systemStats = {
      users: await models.User.countDocuments(),
      groups: await models.Group.countDocuments(),
      challenges: await models.Challenge.countDocuments(),
      submissions: await models.Submission.countDocuments(),
      completedChallenges: await models.Challenge.countDocuments({ completed: true })
    };
    
    res.status(200).json({
      success: true,
      message: 'Configuration retrieved successfully',
      data: {
        config: safeConfig,
        systemStats
      }
    });
  } catch (error) {
    console.error('Error fetching configuration:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve configuration'
    });
  }
};

// Get environment variables
exports.getEnvVars = async (req, res) => {
  try {
    // Path to the main bot's .env file (adjust as needed)
    const envFilePath = path.join(__dirname, '../../../.env');
    
    // Read the .env file
    const envFileContent = await fs.readFile(envFilePath, 'utf8');
    
    // Parse the .env file content into key-value pairs
    const envVars = {};
    const lines = envFileContent.split('\n');
    
    lines.forEach(line => {
      // Skip empty lines and comments
      if (!line.trim() || line.trim().startsWith('#')) {
        return;
      }
      
      // Parse key-value pairs
      const match = line.match(/^([^=]+)=(.*)$/);
      if (match) {
        const key = match[1].trim();
        const value = match[2].trim();
        envVars[key] = value;
      }
    });
    
    // Return environment variables grouped by categories
    const categories = {
      bot: ['BOT_TOKEN', 'BOT_USERNAME'],
      database: ['MONGODB_URI', 'MONGODB_NAME', 'REDIS_URI'],
      payment: ['OXAPAY_MERCHANT_API_KEY', 'OXAPAY_PAYOUT_API_KEY'],
      security: ['LINK_SECRET'],
      app: ['APP_FEE_PERCENTAGE', 'LOG_LEVEL', 'NODE_ENV'],
      challenge: [
        'MIN_CHALLENGE_TITLE_LENGTH', 'MAX_CHALLENGE_TITLE_LENGTH',
        'MIN_CHALLENGE_DESCRIPTION_LENGTH', 'MAX_CHALLENGE_DESCRIPTION_LENGTH',
        'MIN_CHALLENGE_DURATION', 'MAX_CHALLENGE_DURATION',
        'MIN_ENTRIES_PER_USER', 'MAX_ENTRIES_PER_USER',
        'ABSOLUTE_MAX_ENTRIES'
      ],
      currency: ['MAX_REASONABLE_SOLANA_AMOUNT', 'MAX_REASONABLE_ETHEREUM_AMOUNT'],
      formatting: ['DATE_FORMAT', 'TIME_FORMAT'],
      performance: ['RATE_LIMIT_WINDOW_MS', 'RATE_LIMIT_MAX_REQUESTS']
    };
    
    // Group variables by category
    const categorizedVars = {};
    Object.keys(categories).forEach(category => {
      categorizedVars[category] = {};
      categories[category].forEach(key => {
        categorizedVars[category][key] = envVars[key] || '';
      });
    });
    
    // Add "other" category for any env vars not in predefined categories
    categorizedVars.other = {};
    Object.keys(envVars).forEach(key => {
      let found = false;
      Object.values(categories).forEach(categoryKeys => {
        if (categoryKeys.includes(key)) {
          found = true;
        }
      });
      
      if (!found) {
        categorizedVars.other[key] = envVars[key];
      }
    });
    
    // Remove empty categories
    Object.keys(categorizedVars).forEach(category => {
      if (Object.keys(categorizedVars[category]).length === 0) {
        delete categorizedVars[category];
      }
    });
    
    res.status(200).json({
      success: true,
      message: 'Environment variables retrieved successfully',
      data: {
        env: categorizedVars,
        categories: Object.keys(categorizedVars)
      }
    });
  } catch (error) {
    console.error('Error fetching environment variables:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve environment variables'
    });
  }
};

// Update environment variables
exports.updateEnvVars = async (req, res) => {
  try {
    // Check if user has superadmin role
    if (req.user.role !== 'superadmin') {
      return res.status(403).json({
        success: false,
        message: 'Only superadmins can update environment variables'
      });
    }
    
    const { env } = req.body;
    
    if (!env || typeof env !== 'object') {
      return res.status(400).json({
        success: false,
        message: 'Invalid environment variables data'
      });
    }
    
    // Path to the main bot's .env file
    const envFilePath = path.join(__dirname, '../../../.env');
    
    // Read the current .env file to preserve comments and formatting
    const currentEnvContent = await fs.readFile(envFilePath, 'utf8');
    const lines = currentEnvContent.split('\n');
    
    // Create a map of current environment variables
    const currentEnvVars = {};
    const lineMap = {};
    let commentBlock = [];
    
    lines.forEach((line, index) => {
      if (line.trim().startsWith('#')) {
        commentBlock.push(line);
      } else if (line.trim()) {
        const match = line.match(/^([^=]+)=(.*)$/);
        if (match) {
          const key = match[1].trim();
          currentEnvVars[key] = match[2].trim();
          lineMap[key] = {
            index,
            commentBlock: [...commentBlock]
          };
          commentBlock = [];
        }
      } else {
        // Empty line
        commentBlock = [];
      }
    });
    
    // Flatten the categorized env vars
    const flatEnv = {};
    Object.values(env).forEach(category => {
      Object.entries(category).forEach(([key, value]) => {
        flatEnv[key] = value;
      });
    });
    
    // Update the lines array with new values
    Object.entries(flatEnv).forEach(([key, value]) => {
      if (lineMap[key]) {
        // Update existing variable
        lines[lineMap[key].index] = `${key}=${value}`;
      } else {
        // Add new variable with a blank line before it if there are already lines
        if (lines.length > 0 && lines[lines.length - 1].trim() !== '') {
          lines.push('');
        }
        lines.push(`${key}=${value}`);
      }
    });
    
    // Write the updated content back to the .env file
    await fs.writeFile(envFilePath, lines.join('\n'));
    
    res.status(200).json({
      success: true,
      message: 'Environment variables updated successfully'
    });
  } catch (error) {
    console.error('Error updating environment variables:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update environment variables'
    });
  }
};

// Update configuration
exports.updateConfig = async (req, res) => {
  try {
    const updates = req.body;
    
    // Get current config
    let botConfig = await BotConfig.findOne();
    
    if (!botConfig) {
      return res.status(404).json({
        success: false,
        message: 'Configuration not found'
      });
    }
    
    // Only allow updating specific fields
    if (updates.name) botConfig.name = updates.name;
    
    // Update settings
    if (updates.settings) {
      const allowedSettings = [
        'challengeDuration',
        'maxSubmissionsPerUser',
        'defaultCurrency',
        'minPrizeAmount',
        'fees'
      ];
      
      for (const setting of allowedSettings) {
        if (updates.settings[setting] !== undefined) {
          if (!botConfig.settings) botConfig.settings = {};
          botConfig.settings[setting] = updates.settings[setting];
        }
      }
    }
    
    botConfig.updatedAt = new Date();
    await botConfig.save();
    
    // Remove sensitive data from response
    const safeConfig = {
      ...botConfig.toObject(),
      token: undefined
    };
    
    res.status(200).json({
      success: true,
      message: 'Configuration updated successfully',
      data: { config: safeConfig }
    });
  } catch (error) {
    console.error('Error updating configuration:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update configuration'
    });
  }
};

// Get bot information
exports.getBotInfo = async (req, res) => {
  try {
    const botConfig = await BotConfig.findOne();
    
    if (!botConfig) {
      return res.status(404).json({
        success: false,
        message: 'Bot configuration not found'
      });
    }
    
    // Get status from Telegram service
    const telegramService = require('../services/telegramService');
    let status = 'unknown';
    
    try {
      const botInfo = await telegramService.getBotInfo();
      status = botInfo ? 'active' : 'inactive';
    } catch (error) {
      status = 'error';
    }
    
    res.status(200).json({
        success: true,
        message: 'Bot information retrieved successfully',
        data: {
          name: botConfig.name,
          username: status === 'active' ? botConfig.botInfo?.username : null,
          status,
          lastStarted: botConfig.lastStarted,
          updatedAt: botConfig.updatedAt
        }
      });
    } catch (error) {
      console.error('Error fetching bot information:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to retrieve bot information'
      });
    }
  };