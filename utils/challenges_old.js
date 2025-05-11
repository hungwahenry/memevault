// utils/challenges.js
const { Telegraf } = require('telegraf');
const Challenge = require('../models/challenge');
const Submission = require('../models/submission');
const walletService = require('../services/wallet');
const redisClient = require('../services/redis');
const logger = require('./logger');

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

async function checkChallengePayment(challengeId) {
  try {
    const challenge = await Challenge.findById(challengeId);
    
    if (!challenge || challenge.funded) {
      logger.info('Challenge already funded or does not exist', {challengeId});
      return;
    }
    
    // Make sure we have wallet details
    if (!challenge.trackId) {
      logger.warn('Challenge has no track ID', {challengeId});
      return;
    }
    
    const balance = await walletService.checkBalance(challenge.currency, challenge.trackId);
    
    logger.info('Challenge payment check', {
      challengeId,
      trackId: challenge.trackId,
      walletAddress: challenge.walletAddress,
      requiredAmount: challenge.prizePool,
      currentBalance: balance
    });
    
    if (parseFloat(balance) >= parseFloat(challenge.prizePool)) {
      // Store original prize pool before updating
      const originalPrizePool = challenge.prizePool;
      
      // Mark challenge as funded
      challenge.funded = true;
      
      // If balance is higher than prize pool, update the prize pool
      if (parseFloat(balance) > parseFloat(challenge.prizePool)) {
        challenge.prizePool = balance;
        
        logger.info('Prize pool automatically increased', {
          challengeId,
          originalPrizePool,
          newPrizePool: balance
        });
      }
      
      await challenge.save();
      
      // Notify creator
      try {
        const bot = new Telegraf(process.env.BOT_TOKEN);
        await bot.telegram.sendMessage(
          challenge.creatorId,
          `
✅ Funding received for your challenge "${challenge.title}"!

Your payment of ${challenge.prizePool} ${challenge.currency} has been confirmed.
${parseFloat(balance) > parseFloat(originalPrizePool) ? 
  `\n📈 We noticed you sent more than the original amount, so we've increased the prize pool to ${balance} ${challenge.currency}.` : ''}

You can now activate the challenge and announce it in the group:
          `,
          {
            reply_markup: {
              inline_keyboard: [
                [{ text: '🚀 Activate Challenge', callback_data: `activate_${challenge._id}` }]
              ]
            }
          }
        );
      } catch (notifyError) {
        logger.error('Error notifying creator about funding', {
          error: notifyError,
          challengeId,
          creatorId: challenge.creatorId
        });
      }
      
      logger.info('Challenge funded', {challengeId});
    } else {
      logger.info('Challenge not yet funded, scheduling another check', {challengeId});
      
      const retryCount = challenge.retryCount || 0;
      const nextRetryDelay = Math.min(300000 * Math.pow(1.5, retryCount), 3600000);
      
      challenge.retryCount = retryCount + 1;
      await challenge.save();
      
      setTimeout(() => checkChallengePayment(challengeId), nextRetryDelay);
      
      if (retryCount % 3 === 0 && retryCount > 0) {
        try {
          const bot = new Telegraf(process.env.BOT_TOKEN);
          await bot.telegram.sendMessage(
            challenge.creatorId,
            `
⏳ Reminder: Your challenge "${challenge.title}" is still waiting for funding.

Required amount: ${challenge.prizePool} ${challenge.currency}
Current balance: ${balance} ${challenge.currency}

Please send the funds to:
\`${challenge.walletAddress}\`

You can check the status anytime:
            `,
            {
              parse_mode: 'Markdown',
              reply_markup: {
                inline_keyboard: [
                  [{ text: '🔄 Check Funding Status', callback_data: `check_funding_${challenge._id}` }]
                ]
              }
            }
          );
        } catch (notifyError) {
          logger.error('Error sending funding reminder', {
            error: notifyError,
            challengeId,
            creatorId: challenge.creatorId
          });
        }
      }
    }
  } catch (error) {
    logger.error('Error checking challenge payment:', {error, challengeId});
    setTimeout(() => checkChallengePayment(challengeId), 600000);
  }
}

async function processPrizePayment(submissionId) {
  try {
    const submission = await Submission.findById(submissionId)
      .populate('challengeId');
    
    if (!submission || !submission.winnerWalletAddress) {
      logger.warn('Cannot process payment - no wallet address', {submissionId});
      return;
    }
    
    const challenge = submission.challengeId;
    
    if (!challenge) {
      logger.warn('Cannot process payment - no challenge', {submissionId});
      return;
    }
    
    logger.info('Processing prize payment', {
      submissionId,
      challengeId: challenge._id.toString(),
      currency: challenge.currency,
      amount: challenge.prizePool
    });
    
    // Calculate amount to send (minus fee)
    const feePercentage = parseFloat(process.env.APP_FEE_PERCENTAGE || '5');
    const fee = parseFloat(challenge.prizePool) * (feePercentage / 100);
    const amountToSend = (parseFloat(challenge.prizePool) - fee).toFixed(8);
    
    // Transfer funds using OxaPay payout API
    const txId = await walletService.transferFunds(
      challenge.currency,
      submission.winnerWalletAddress,
      amountToSend.toString()
    );
    
    logger.info('Prize payment initiated', {
      submissionId,
      challengeId: challenge._id.toString(),
      txId,
      amount: amountToSend
    });
    
    // Notify winner
    const bot = new Telegraf(process.env.BOT_TOKEN);
    
    try {
      await bot.telegram.sendMessage(
        submission.userId,
        `
💸 Your prize payment has been initiated!

Amount: ${amountToSend} ${challenge.currency} (after ${feePercentage}% service fee)
Transaction ID: \`${txId}\`

Thank you for participating in the "${challenge.title}" challenge!
        `,
        { parse_mode: 'Markdown' }
      );
    } catch (notifyError) {
      logger.error('Error notifying winner about payment', {
        error: notifyError,
        submissionId,
        userId: submission.userId
      });
    }
    
    // Announce in group
    try {
      await bot.telegram.sendMessage(
        challenge.groupId,
        `
🏆 Prize payment initiated for "${challenge.title}"!

Winner: @${submission.username}
Amount: ${amountToSend} ${challenge.currency}
Transaction ID: \`${txId}\`

Thanks to everyone who participated!
        `,
        { parse_mode: 'Markdown' }
      );
    } catch (notifyError) {
      logger.error('Error announcing payment in group', {
        error: notifyError,
        challengeId: challenge._id.toString(),
        groupId: challenge.groupId
      });
    }
  } catch (error) {
    logger.error('Error processing payment:', {error, submissionId});
    
    // Try to notify the winner about the issue
    try {
      const submission = await Submission.findById(submissionId);
      if (submission) {
        const challenge = await Challenge.findById(submission.challengeId);
        const bot = new Telegraf(process.env.BOT_TOKEN);
        
        await bot.telegram.sendMessage(
          submission.userId,
          `
⚠️ There was an issue processing your prize payment. Our team has been notified and will resolve this as soon as possible.

Please contact the challenge organizer if you don't receive your prize within 24 hours.
          `
        );
        
        // Also notify the challenge creator
        if (challenge) {
          await bot.telegram.sendMessage(
            challenge.creatorId,
            `
⚠️ There was an issue processing the prize payment for your challenge "${challenge.title}".

Error: ${error.message}

Our system administrators have been notified. If this issue persists, please contact support.

Winner: @${submission.username || `User_${submission.userId}`}
Prize amount: ${challenge.prizePool} ${challenge.currency}
            `
          );
        }
      }
    } catch (notifyError) {
      logger.error('Error notifying about payment failure:', {
        error: notifyError, 
        submissionId
      });
    }
    
    // Schedule a retry after 30 minutes
    setTimeout(() => {
      logger.info('Retrying prize payment', {submissionId});
      processPrizePayment(submissionId);
    }, 1800000); // 30 minutes
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
  finalizeChallenge,
  announceWinner,
  checkChallengePayment,
  processPrizePayment,
  checkForFinalizableChallenges,
  checkForPendingAdminSelections,
  notifyVotingPhase,
};