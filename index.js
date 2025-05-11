// index.js
require('dotenv').config();
const { Telegraf, Scenes } = require('telegraf');
const mongoose = require('mongoose');
const { session: mongoSession } = require('telegraf-session-mongodb');
const fs = require('fs');
const path = require('path');

// Services
const { connectMongo } = require('./services/mongo');
const redisClient = require('./services/redis');

// Logging
const logger = require('./utils/logger');

// Scenes with updated imports
const setupScene = require('./scenes/setup/index');
const challengeScene = require('./scenes/challenge/index');
const submissionScene = require('./scenes/submission/index');
const walletScene = require('./scenes/wallet/index');

// Utils
const { setupCommands } = require('./utils/commands/index');
const { handleCallbacks } = require('./utils/callbacks/index');
const {
  checkChallengePayment,
  finalizeChallenge,
  checkForFinalizableChallenges,
  notifyVotingPhase
} = require('./utils/challenges/index');

// Middlewares
const auth = require('./middlewares/auth');
const createRateLimiter = require('./middlewares/ratelimiter');
const userTracker = require('./middlewares/userTracker');

// Models
const Challenge = require('./models/challenge');
const Submission = require('./models/submission');

// Create logs directory if it doesn't exist
const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Initialize bot
const bot = new Telegraf(process.env.BOT_TOKEN);

// Setup scenes
const stage = new Scenes.Stage([
  setupScene,
  challengeScene,
  submissionScene,
  walletScene
]);

// Global error handler
bot.catch((err, ctx) => {
  logger.error('Unexpected error', {
    error: err.stack || err,
    update: ctx.update
  });
  if (ctx.chat) {
    ctx.reply('An unexpected error occurred. Our team has been notified.')
      .catch(e => logger.error('Error sending error notification', {error: e}));
  }
});

/**
 * Check for challenges that entered voting phase
 */
async function checkForVotingPhase(bot) {
  const processingKey = 'processing:voting_phase_check';
  
  try {
    // Prevent multiple instances running simultaneously
    const isProcessing = await redisClient.get(processingKey);
    if (isProcessing) {
      logger.info('Voting phase check already in progress, skipping');
      return;
    }
    
    // Mark as processing with 5-minute timeout
    await redisClient.set(processingKey, 'true', 'EX', 300);
    
    const startTime = Date.now();
    const now = new Date();
    let transitionCount = 0;
    
    // Find active challenges whose end date has passed
    const challenges = await Challenge.find({
      active: true,
      completed: false,
      endDate: { $lt: now }
    });
    
    logger.info(`Found ${challenges.length} challenges that may need voting notifications`);
    
    for (const challenge of challenges) {
      try {
        const notificationKey = `voting_notification:${challenge._id}`;
        const notified = await redisClient.get(notificationKey);
        
        if (!notified) {
          await notifyVotingPhase(challenge, bot);
          
          // Mark as notified with 7-day expiry
          await redisClient.set(notificationKey, 'true', 'EX', 7 * 24 * 60 * 60);
          transitionCount++;
          
          // Schedule reminder for 20 hours after voting starts
          setTimeout(async () => {
            try {
              await sendVotingReminder(challenge._id, bot);
            } catch (reminderError) {
              logger.error('Error sending voting reminder', { 
                error: reminderError, 
                challengeId: challenge._id.toString() 
              });
            }
          }, 20 * 60 * 60 * 1000);
        }
      } catch (challengeError) {
        logger.error('Error transitioning challenge to voting phase', {
          error: challengeError,
          challengeId: challenge._id.toString()
        });
      }
    }
    
    const duration = Date.now() - startTime;
    logger.info('Voting phase check completed', {
      duration,
      challengesChecked: challenges.length,
      challengesTransitioned: transitionCount
    });
    
  } catch (error) {
    logger.error('Error in voting phase check:', {error});
  } finally {
    // Always clear the processing flag
    try {
      await redisClient.del(processingKey);
    } catch (redisError) {
      logger.error('Error clearing processing flag:', {error: redisError});
    }
  }
}

/**
 * Send a reminder about voting ending soon
 */
async function sendVotingReminder(challengeId, bot) {
  try {
    // Import the helpers directly to avoid potential circular dependencies
    const { countUniqueVoters } = require('./utils/callbacks/helpers');
    
    const challenge = await Challenge.findById(challengeId);
    if (!challenge || challenge.completed) return;
    
    // Only send reminder for community voting
    if (challenge.votingMethod !== 'community') return;
    
    const reminderKey = `voting_reminder:${challenge._id}`;
    const reminded = await redisClient.get(reminderKey);
    if (reminded) return;
    
    // Get voting stats
    const submissionCount = await Submission.countDocuments({ challengeId: challenge._id });
    const voteCount = await countUniqueVoters(challenge._id);
    
    await bot.telegram.sendMessage(
      challenge.groupId,
      `⏰ Last chance to vote in "${challenge.title}"!\n\n` +
      `${submissionCount} submissions received\n` +
      `${voteCount} votes cast so far\n\n` +
      `Voting ends soon. Don't miss your chance to pick the winner!`,
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: '🗳️ Vote Now', callback_data: `start_voting_${challenge._id}` }]
          ]
        }
      }
    );
    
    await redisClient.set(reminderKey, 'true', 'EX', 30 * 60 * 60);
    logger.info('Sent voting reminder', { challengeId: challenge._id.toString() });
  } catch (error) {
    logger.error('Error sending voting reminder', { error, challengeId });
  }
}

/**
 * Set up scheduled tasks with randomization to prevent exact synchronization
 */
function scheduleRandomizedCheck(checkFn, intervalMs, variationMs = 30000) {
  const scheduleNext = () => {
    // Add some random variation to prevent multiple checks running exactly in sync
    const randomVariation = Math.floor(Math.random() * variationMs);
    const timeout = intervalMs + randomVariation;
    
    setTimeout(async () => {
      try {
        await checkFn(bot);
      } catch (error) {
        logger.error(`Error in scheduled check ${checkFn.name}:`, { error });
      } finally {
        scheduleNext();
      }
    }, timeout);
  };
  
  scheduleNext();
}

/**
 * Initialize and start the bot
 */
async function startBot() {
  try {
    // 1. Connect to MongoDB
    await connectMongo();

    // 2. Get native Db instance from Mongoose
    const db = mongoose.connection.db;
    if (!db) {
      logger.error('Failed to get native MongoDB Db instance from Mongoose connection.');
      throw new Error('Failed to get native MongoDB Db instance.');
    }
    logger.info(`Mongoose connected to DB: ${db.databaseName}. Configuring session store.`);

    // 3. Configure MongoDB session middleware (Place BEFORE stage, auth)
    bot.use(mongoSession(db, {
      collectionName: 'sessions', // Collection for storing sessions
      sessionKeyFn: (ctx) => ctx.from && ctx.chat && `${ctx.from.id}:${ctx.chat.id}`,
    }));
    logger.info(`MongoDB session middleware configured for collection: 'sessions'`);

    // 4. Setup other middleware
    // Logger middleware
    bot.use((ctx, next) => { 
      ctx.logger = logger;
      if (process.env.NODE_ENV === 'development') {
        logger.debug('Incoming update', { update: ctx.update });
      }
      return next();
    });
    
    // Scene management
    bot.use(stage.middleware());
    
    // Auth, tracking and rate limiting
    bot.use(auth);
    bot.use(userTracker);
    const rateLimiter = createRateLimiter({
      windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000'),
      maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '20')
    });
    bot.use(rateLimiter);

    // 5. Register command and callback handlers
    setupCommands(bot);
    handleCallbacks(bot);

    // 6. Launch the bot
    await bot.launch();
    logger.info(`MemeVault bot is running! Polling started.`);

    // 7. Initial checks and scheduled tasks
    const pendingChallenges = await Challenge.find({
      funded: false,
      active: false,
      completed: false
    });
    logger.info(`Found ${pendingChallenges.length} pending challenges to check for funding.`);
    
    // Check for funding for all pending challenges
    for (const challenge of pendingChallenges) {
      checkChallengePayment(challenge._id);
    }

    // Clear any leftover processing flags that might have been left if the bot crashed
    try {
      await redisClient.del('processing:voting_phase_check');
      await redisClient.del('processing:finalization_check');
    } catch (redisError) {
      logger.warn('Error clearing processing flags on startup', { error: redisError });
    }

    // Run initial checks
    await checkForVotingPhase(bot);
    await checkForFinalizableChallenges(bot);
    
    // Start periodic checks with randomization
    scheduleRandomizedCheck(checkForVotingPhase, 5 * 60 * 1000);         // ~5 minutes
    scheduleRandomizedCheck(checkForFinalizableChallenges, 15 * 60 * 1000); // ~15 minutes

  } catch (error) {
    logger.error('Failed to initialize and start the bot:', { error: error.stack || error });
    if (mongoose.connection.readyState === 1 || mongoose.connection.readyState === 2) { // 1: connected, 2: connecting
      await mongoose.connection.close();
      logger.info('Mongoose connection closed due to startup error.');
    }
    process.exit(1);
  }
}

/**
 * Handle graceful shutdown
 */
function shutdown(signal) {
  logger.info(`${signal} received. Stopping bot...`);
  mongoose.connection.close(() => {
    logger.info(`Mongoose connection closed due to app termination (${signal}).`);
    bot.stop(signal);
    logger.info('Bot stopped.');
    process.exit(0);
  });
}

// Register shutdown handlers
process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));

// Start the bot
startBot();