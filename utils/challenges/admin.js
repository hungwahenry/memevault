// utils/challenges/admin.js
const { Telegraf } = require('telegraf');
const Challenge = require('../../models/challenge');
const Submission = require('../../models/submission');
const logger = require('../logger');
const { announceWinner } = require('./finalization');

// Auto-finalize admin selection challenges after timeout
async function checkForPendingAdminSelections(bot) {
  try {
    const now = new Date();
    
    // Find challenges that are waiting for admin selection for more than 48 hours
    const challenges = await Challenge.find({
      active: true,
      completed: false,
      votingMethod: 'admin',
      endDate: { $lt: new Date(now - 48 * 60 * 60 * 1000) }
    });
    
    logger.info(`Found ${challenges.length} admin selection challenges pending for >48 hours`);
    
    for (const challenge of challenges) {
      try {
        // Get all submissions
        const submissions = await Submission.find({ challengeId: challenge._id });
        
        if (submissions.length === 0) {
          // No submissions case
          challenge.completed = true;
          await challenge.save();
          
          logger.info('Admin challenge completed with no submissions', {
            challengeId: challenge._id.toString()
          });
          continue;
        }
        
        // Select a random submission as winner
        const randomIndex = Math.floor(Math.random() * submissions.length);
        const winningSubmission = submissions[randomIndex];
        
        // Mark challenge as completed and record winner
        challenge.completed = true;
        challenge.winner = winningSubmission._id;
        await challenge.save();
        
        // Announce winner
        await announceWinner(winningSubmission._id);
        
        // Notify admin about auto-selection
        const telegramBot = bot || new Telegraf(process.env.BOT_TOKEN);
        await telegramBot.telegram.sendMessage(
          challenge.creatorId,
          `
ℹ️ Your challenge "${challenge.title}" has been automatically finalized because you didn't select a winner within 48 hours.

A random submission has been selected as the winner.
          `
        );
        
        logger.info('Auto-selected random winner for admin challenge', {
          challengeId: challenge._id.toString(),
          submissionId: winningSubmission._id.toString()
        });
      } catch (challengeError) {
        logger.error('Error auto-finalizing admin challenge', {
          error: challengeError,
          challengeId: challenge._id.toString()
        });
      }
    }
  } catch (error) {
    logger.error('Error checking for pending admin selections:', {error});
  }
}

module.exports = {
  checkForPendingAdminSelections
};