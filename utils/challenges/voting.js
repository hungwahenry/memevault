// utils/challenges/voting.js
const { Telegraf } = require('telegraf');
const Challenge = require('../../models/challenge');
const Submission = require('../../models/submission');
const redisClient = require('../../services/redis');
const logger = require('../logger');

// Notify group when a challenge enters voting phase
async function notifyVotingPhase(challenge, bot) {
  try {
    // Check if we've already sent a voting notification for this challenge
    const notificationKey = `voting_notification:${challenge._id}`;
    
    try {
      const notified = await redisClient.get(notificationKey);
      if (notified) {
        return; // Already notified about voting phase
      }
    } catch (redisError) {
      logger.warn('Redis error checking notification status', { 
        error: redisError,
        challengeId: challenge._id.toString()
      });
      // Continue even if Redis fails
    }
    
    const submissionCount = await Submission.countDocuments({ challengeId: challenge._id });
    
    if (submissionCount === 0) {
      // No submissions, so no voting phase needed
      logger.info('Challenge has no submissions, skipping voting notification', {
        challengeId: challenge._id.toString()
      });
      
      // Mark as notified to avoid checking again
      try {
        await redisClient.set(notificationKey, 'true', 'EX', 86400); // 24 hours
      } catch (redisError) {
        logger.warn('Redis error setting notification flag', { error: redisError });
      }
      return;
    }
    
    // Handle admin selection challenges differently from community voting
    if (challenge.votingMethod === 'admin') {
      // Send notification only to the admin/creator
      await bot.telegram.sendMessage(
        challenge.creatorId,
        `
📊 It's time to select a winner for your challenge "${challenge.title}"!

The submission phase has ended. As the challenge creator, you'll now receive all ${submissionCount} submissions to review.
Please select a winner within 48 hours, otherwise a random submission will be selected automatically.
        `
      );
      
      // Send all submissions to admin for selection
      const submissions = await Submission.find({ challengeId: challenge._id });
      
      for (let i = 0; i < submissions.length; i++) {
        const submission = submissions[i];
        
        await bot.telegram.sendPhoto(
          challenge.creatorId,
          submission.imageFileId,
          {
            caption: `
Submission #${i + 1} of ${submissions.length} for "${challenge.title}"
${submission.caption ? `Caption: ${submission.caption}` : ''}
Submitted by: @${submission.username || `User_${submission.userId}`}
            `,
            reply_markup: {
              inline_keyboard: [
                [{ text: '👑 Select as Winner', callback_data: `admin_select_${submission._id}` }]
              ]
            }
          }
        );
        
        // Add a small delay to prevent rate limiting
        await new Promise(resolve => setTimeout(resolve, 300));
      }
      
      // Notify the group that admin selection is in progress
      await bot.telegram.sendMessage(
        challenge.groupId,
        `
📋 The submission phase for "${challenge.title}" has ended!

This challenge uses admin selection for determining the winner.
The challenge creator will review all ${submissionCount} submissions and select a winner soon.
        `
      );
    } else {
      // Community voting notification - send to the group
      await bot.telegram.sendMessage(
        challenge.groupId,
        `
🗳️ Voting has begun for "${challenge.title}"!

The submission phase has ended with ${submissionCount} submissions.
Now it's time to vote for your favorite meme!

Prize: ${challenge.prizePool} ${challenge.currency}
Voting closes in: 24 hours

Click the button below to start voting:
        `,
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: '🗳️ Start Voting', callback_data: `start_voting_${challenge._id}` }]
            ]
          }
        }
      );
    }
    
    // Mark as notified in Redis to avoid duplicate notifications
    try {
      await redisClient.set(notificationKey, 'true', 'EX', 86400); // 24 hours
    } catch (redisError) {
      logger.warn('Redis error setting notification flag', { error: redisError });
    }
    
    logger.info('Sent voting phase notification', {
      challengeId: challenge._id.toString(),
      groupId: challenge.groupId,
      votingMethod: challenge.votingMethod
    });
  } catch (error) {
    logger.error('Error sending voting phase notification', {
      error,
      challengeId: challenge._id.toString()
    });
  }
}

module.exports = {
  notifyVotingPhase
};