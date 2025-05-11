// utils/challenges/payments.js
const { Telegraf } = require('telegraf');
const Challenge = require('../../models/challenge');
const Submission = require('../../models/submission');
const walletService = require('../../services/wallet');
const logger = require('../logger');

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

module.exports = {
  checkChallengePayment,
  processPrizePayment
};