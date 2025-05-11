// utils/challenges/finalization.js
const { Telegraf } = require('telegraf');
const Challenge = require('../../models/challenge');
const Submission = require('../../models/submission');
const redisClient = require('../../services/redis');
const logger = require('../logger');

// Finalize a challenge and determine the winner
async function finalizeChallenge(challengeId) {
  try {
    const challenge = await Challenge.findById(challengeId);
    
    if (!challenge || challenge.completed) {
      logger.info('Challenge already completed or does not exist', {challengeId});
      return;
    }
    
    // Find winning submission (most votes)
    let winningSubmission;
    
    if (challenge.votingMethod === 'community') {
      winningSubmission = await Submission.findOne({ challengeId })
        .sort({ votes: -1 })
        .limit(1);
        
      // If there's a tie, get all tied submissions
      if (winningSubmission) {
        const tiedSubmissions = await Submission.find({ 
          challengeId, 
          votes: winningSubmission.votes 
        });
        
        if (tiedSubmissions.length > 1) {
          logger.info('Tie detected in community voting', {
            challengeId,
            votesCount: winningSubmission.votes,
            tiedSubmissionsCount: tiedSubmissions.length
          });
          
          // In case of a tie, choose randomly
          const randomIndex = Math.floor(Math.random() * tiedSubmissions.length);
          winningSubmission = tiedSubmissions[randomIndex];
          
          // Notify admin about the tie
          try {
            const bot = new Telegraf(process.env.BOT_TOKEN);
            await bot.telegram.sendMessage(
              challenge.creatorId,
              `
⚠️ There is a tie in the voting for your challenge "${challenge.title}"!

${tiedSubmissions.length} submissions have received ${winningSubmission.votes} votes each.

A winner has been randomly selected, but you can review all submissions in the group chat.
              `
            );
          } catch (error) {
            logger.error('Error notifying admin about tie', {
              error,
              challengeId,
              creatorId: challenge.creatorId
            });
          }
        }
      }
    } else if (challenge.votingMethod === 'admin') {
      // For admin selection, we need to send a message to the admin to select a winner
      try {
        const bot = new Telegraf(process.env.BOT_TOKEN);
        
        // Get all submissions
        const submissions = await Submission.find({ challengeId });
        
        if (submissions.length === 0) {
          logger.info('No submissions for challenge', {challengeId});
          
          // Notify admin that there are no submissions
          await bot.telegram.sendMessage(
            challenge.creatorId,
            `ℹ️ There were no submissions for your challenge "${challenge.title}".`
          );
          
          // Mark the challenge as completed without a winner
          challenge.completed = true;
          await challenge.save();
          
          return;
        }
        
        // Start admin selection voting flow
        await bot.telegram.sendMessage(
          challenge.creatorId,
          `
📊 It's time to select a winner for your challenge "${challenge.title}"!

You'll now receive all ${submissions.length} submissions. 
Review them and select a winner by clicking the "Select as Winner" button below the submission you choose.
          `
        );
        
        // Send all submissions to admin
        for (let i = 0; i < submissions.length; i++) {
          const submission = submissions[i];
          
          try {
            await bot.telegram.sendPhoto(
              challenge.creatorId,
              submission.imageFileId,
              {
                caption: `
Submission #${i + 1} of ${submissions.length} for "${challenge.title}"
${submission.caption ? `Caption: ${submission.caption}` : ''}
Submitted by: @${submission.username || `User_${submission.userId}`}
                `,
                parse_mode: 'Markdown',
                reply_markup: {
                  inline_keyboard: [
                    [{ text: '👑 Select as Winner', callback_data: `admin_select_${submission._id}` }]
                  ]
                }
              }
            );
            
            // Add a small delay to prevent rate limiting
            await new Promise(resolve => setTimeout(resolve, 500));
            
          } catch (error) {
            logger.error('Error sending submission to admin', {
              error,
              challengeId,
              submissionId: submission._id.toString(),
              adminId: challenge.creatorId
            });
          }
        }
        
        // Remind admin after sending all submissions
        await bot.telegram.sendMessage(
          challenge.creatorId,
          `
Please review all ${submissions.length} submissions above and select a winner.

If you don't select a winner within 48 hours, the system will automatically choose the winner based on community votes.
          `
        );
      } catch (error) {
        logger.error('Error in admin selection process', {
          error,
          challengeId
        });
      }
      
      // Don't mark challenge as completed yet - wait for admin selection
      return;
    }
    
    if (!winningSubmission) {
      logger.info('No winning submission found', {challengeId});
      
      // Mark challenge as completed with no winner
      challenge.completed = true;
      await challenge.save();
      
      try {
        // Notify the creator
        const bot = new Telegraf(process.env.BOT_TOKEN);
        await bot.telegram.sendMessage(
          challenge.creatorId,
          `
ℹ️ Your challenge "${challenge.title}" has ended, but there was no winner.
This could be because there were no submissions or no votes.
          `
        );
        
        // Notify the group
        await bot.telegram.sendMessage(
          challenge.groupId,
          `
ℹ️ The challenge "${challenge.title}" has ended without a winner.
Thank you to everyone who participated!
          `
        );
      } catch (error) {
        logger.error('Error notifying about no winner', {
          error,
          challengeId
        });
      }
      
      return;
    }
    
    // Mark challenge as completed and record winner
    challenge.completed = true;
    challenge.winner = winningSubmission._id;
    await challenge.save();
    
    // Announce winner
    await announceWinner(winningSubmission._id);
    
  } catch (error) {
    logger.error('Error finalizing challenge:', {error, challengeId});
  }
}

// Announce the winner of a challenge
async function announceWinner(submissionId) {
  try {
    const winningSubmission = await Submission.findById(submissionId)
      .populate('challengeId');
    
    if (!winningSubmission) {
      logger.warn('Cannot announce winner - submission not found', {submissionId});
      return;
    }
    
    const challenge = winningSubmission.challengeId;
    
    if (!challenge) {
      logger.warn('Cannot announce winner - challenge not found', {submissionId});
      return;
    }
    
    // Announce winner in group with clearer voting method indication
    try {
      const bot = new Telegraf(process.env.BOT_TOKEN);
      await bot.telegram.sendPhoto(
        challenge.groupId,
        winningSubmission.imageFileId,
        {
          caption: `
🏆 We have a winner for "${challenge.title}"! 🏆

Winning meme by: @${winningSubmission.username || `User_${winningSubmission.userId}`}
${winningSubmission.caption ? `Caption: ${winningSubmission.caption}` : ''}
${challenge.votingMethod === 'community' ? `Votes: ${winningSubmission.votes}` : '(Selected by admin)'}

Congratulations! 🎉
          `,
          parse_mode: 'Markdown'
        }
      );
      
      // Notify winner and ask for wallet address
      await bot.telegram.sendMessage(
        winningSubmission.userId,
        `
🎉 Congratulations! Your meme has won the "${challenge.title}" challenge!

Click the button below to claim your prize of ${challenge.prizePool} ${challenge.currency}:
        `,
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: '💰 Claim Prize', callback_data: `claim_${winningSubmission._id}` }]
            ]
          }
        }
      );
    } catch (error) {
      logger.error('Error sending winner notifications', {
        error,
        submissionId,
        challengeId: challenge._id.toString()
      });
    }
    
    logger.info('Winner announced', {
      submissionId, 
      challengeId: challenge._id.toString(),
      winner: winningSubmission.userId,
      votingMethod: challenge.votingMethod
    });
  } catch (error) {
    logger.error('Error announcing winner:', {error, submissionId});
  }
}

// Check for challenges that need to be finalized
async function checkForFinalizableChallenges(bot) {
  try {
    const processingKey = 'processing:finalization_check';
    
    // Prevent multiple instances running simultaneously
    try {
      const isProcessing = await redisClient.get(processingKey);
      if (isProcessing) {
        logger.info('Finalization check already in progress, skipping');
        return;
      }
      
      // Mark as processing with 15-minute timeout
      await redisClient.set(processingKey, 'true', 'EX', 900);
    } catch (redisError) {
      logger.warn('Redis error in finalization check', { error: redisError });
      // Continue even if Redis fails
    }
    
    const now = new Date();
    
    // Find active challenges whose end date has passed
    const challenges = await Challenge.find({
      active: true,
      completed: false,
      endDate: { $lt: now }
    });
    
    logger.info(`Found ${challenges.length} challenges to check for finalization`);
    
    for (const challenge of challenges) {
      try {
        // Add some buffer time after end date before finalizing (24 hours)
        const hoursAfterEnd = (now - challenge.endDate) / (1000 * 60 * 60);
        
        if (hoursAfterEnd >= 24) {
          logger.info(`Finalizing challenge ${challenge._id} (${challenge.title})`);
          await finalizeChallenge(challenge._id);
        } else {
          logger.info(`Challenge ${challenge._id} ended recently, waiting for more votes`);
        }
      } catch (challengeError) {
        logger.error('Error processing challenge finalization', {
          error: challengeError,
          challengeId: challenge._id.toString()
        });
        // Continue with other challenges even if one fails
      }
    }
    
    // Also check for admin selection challenges that need auto-finalization
    try {
      const { checkForPendingAdminSelections } = require('./admin');
      await checkForPendingAdminSelections(bot);
    } catch (error) {
      logger.error('Error checking for pending admin selections', { error });
    }
    
    // Clear processing flag
    try {
      await redisClient.del(processingKey);
    } catch (redisError) {
      logger.warn('Redis error clearing processing flag', { error: redisError });
    }
  } catch (error) {
    logger.error('Error checking for finalizable challenges:', {error});
    
    // Ensure processing flag is cleared even after error
    try {
      await redisClient.del('processing:finalization_check');
    } catch (redisError) {
      // Just log and continue
      logger.warn('Redis error clearing processing flag after error', { error: redisError });
    }
  }
}

module.exports = {
  finalizeChallenge,
  announceWinner,
  checkForFinalizableChallenges
};