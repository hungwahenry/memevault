// utils/callbacks/funding.js
const Challenge = require('../../models/challenge');
const walletService = require('../../services/wallet');
const logger = require('../logger');

module.exports = function(bot) {
  // Add funding check callback
bot.action(/check_funding_(.+)/, async (ctx) => {
  await ctx.answerCbQuery('Checking funding status...');
  
  const challengeId = ctx.match[1];
  try {
    const challenge = await Challenge.findById(challengeId);
    
    if (!challenge) {
      return ctx.reply('Error: Challenge not found.');
    }
    
    // Security check: only the creator can check funding
    if (challenge.creatorId !== ctx.from.id.toString()) {
      logger.warn('Unauthorized funding check attempt', {
        userId: ctx.from.id,
        challengeId,
        creatorId: challenge.creatorId
      });
      return ctx.reply('Only the challenge creator can check funding status.');
    }
    
    // Check if challenge is already active
    if (challenge.active) {
      return ctx.reply(`This challenge is already active and announced in the group.`);
    }
    
    const balance = await walletService.checkBalance(
      challenge.currency, 
      challenge.trackId || challenge.walletAddress
    );
    
    logger.info('Challenge funding check from callback', {
      challengeId: challenge._id.toString(),
      walletAddress: challenge.walletAddress,
      trackId: challenge.trackId,
      requiredAmount: challenge.prizePool,
      currentBalance: balance
    });
    
    // Get current time for last checked timestamp
    const now = new Date();
    
    // Store original prize pool to check if it changed
    const originalPrizePool = challenge.prizePool;
    
    // Update prize pool if balance is higher
    if (parseFloat(balance) > parseFloat(challenge.prizePool)) {
      challenge.prizePool = balance;
      logger.info('Prize pool updated during funding check', {
        challengeId: challenge._id.toString(),
        originalAmount: originalPrizePool,
        newAmount: balance
      });
    }
    
    if (parseFloat(balance) >= parseFloat(challenge.prizePool)) {
      // Mark challenge as funded
      challenge.funded = true;
      await challenge.save();
      
      // Show activation button
      await ctx.editMessageText(`
✅ Funding received! Your challenge "${challenge.title}" is now ready to be activated.

Current balance: ${balance} ${challenge.currency}
${parseFloat(balance) > parseFloat(originalPrizePool) ? 
  `\n📈 We noticed you sent more than your original amount, so we've increased the prize pool to match your contribution.` : ''}

Last checked: ${now.toLocaleTimeString()}

Click the button below to activate and announce the challenge in your group.
        `, {
          reply_markup: {
            inline_keyboard: [
              [{ text: '🚀 Activate Challenge', callback_data: `activate_${challenge._id}` }]
            ]
          }
        });
    } else {
      // Get a rotation of messages to make it more interesting
      const messages = [
        "Still waiting for funds... Blockchain transactions may take some time to confirm.",
        "No funds received yet. Make sure you've sent to the correct address.",
        "Waiting for your payment to arrive. Crypto transactions may take a few minutes.",
        "Funds not yet received. Transaction delays can occur during network congestion."
      ];
      
      // Select a message based on a random index
      const message = messages[Math.floor(Math.random() * messages.length)];
      
      // Show funding not complete yet with updated timestamp
      await ctx.editMessageText(`
📋 Funding Status for "${challenge.title}":

To activate your challenge, please send exactly ${challenge.prizePool} ${challenge.currency} to:
\`${challenge.walletAddress}\`

Current balance: ${balance} ${challenge.currency}
Required amount: ${challenge.prizePool} ${challenge.currency}
Last checked: ${now.toLocaleTimeString()}

Status: ${message}
        `, {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '🔄 Check Again', callback_data: `check_funding_${challenge._id}` }],
              [{ text: '📈 Update Prize Pool', callback_data: `update_pool_${challenge._id}` }],
              [{ text: '❌ Delete Challenge', callback_data: `delete_challenge_${challenge._id}` }]
            ]
          }
        });
    }
  } catch (error) {
    logger.error('Error checking challenge balance from callback', {
      error,
      challengeId
    });
    
    // Get current time for timestamp
    const now = new Date();
    
    await ctx.editMessageText(`
⚠️ Error checking balance

Last checked: ${now.toLocaleTimeString()}
Error: Could not retrieve balance information

Please try again in a few moments.
      `, {
        reply_markup: {
          inline_keyboard: [
            [{ text: '🔄 Try Again', callback_data: `check_funding_${challengeId}` }],
            [{ text: '❌ Delete Challenge', callback_data: `delete_challenge_${challengeId}` }]
          ]
        }
      });
    }
  });

  // Add delete challenge callback
  bot.action(/delete_challenge_(.+)/, async (ctx) => {
    const challengeId = ctx.match[1];

    await ctx.answerCbQuery('Processing deletion request...');

    try {
      // First show a confirmation
      await ctx.editMessageText(`
⚠️ Are you sure you want to delete this challenge?

This action cannot be undone. Any funds sent to the challenge wallet will not be refunded automatically.
      `, {
        reply_markup: {
          inline_keyboard: [
            [
              { text: '✅ Yes, Delete', callback_data: `confirm_delete_${challengeId}` },
              { text: '❌ No, Cancel', callback_data: `check_funding_${challengeId}` }
            ]
          ]
        }
      });
    } catch (error) {
      logger.error('Error showing delete confirmation', {
        error,
        challengeId
      });
      await ctx.reply('An error occurred. Please try again.');
    }
  });

  // *** FIX START: update_pool_ handler ***
  bot.action(/update_pool_(.+)/, async (ctx) => {
    await ctx.answerCbQuery('Checking pool balance...');

    const challengeId = ctx.match[1];
    try {
      const challenge = await Challenge.findById(challengeId);

      if (!challenge) {
        return ctx.reply('Error: Challenge not found.');
      }

      // Security check: only the creator can update prize pool
      if (challenge.creatorId !== ctx.from.id.toString()) {
        logger.warn('Unauthorized prize pool update attempt', {
          userId: ctx.from.id,
          challengeId,
          creatorId: challenge.creatorId
        });
        return ctx.reply('Only the challenge creator can update the prize pool.');
      }

      // Check if challenge is already active
      if (challenge.active) {
        return ctx.reply(`This challenge is already active. The prize pool cannot be updated.`);
      }

      // Get current balance
      const balance = await walletService.checkBalance(
        challenge.currency,
        challenge.trackId || challenge.walletAddress
      );

      const originalPrizePool = challenge.prizePool;

      // Update prize pool if balance is higher
      if (parseFloat(balance) > parseFloat(challenge.prizePool)) {
        challenge.prizePool = balance;
        challenge.funded = parseFloat(balance) > 0; // Ensure funded is true if balance > 0
        await challenge.save();

        logger.info('Prize pool updated', {
          challengeId: challenge._id.toString(),
          originalPrizePool,
          newPrizePool: balance
        });

        // FIX 1: Changed multi-line string concatenation with '+' to a single template literal
        return ctx.reply(
`✅ Prize pool updated!

Challenge: "${challenge.title}"
Previous amount: ${originalPrizePool} ${challenge.currency}
New amount: ${balance} ${challenge.currency}

Status: ${challenge.funded ? '✅ Funded' : '⏳ Waiting for funds'}`
        );
      } else if (parseFloat(balance) === parseFloat(challenge.prizePool)) {
        // If balance equals prize pool, just update funded status if needed
        if (!challenge.funded && parseFloat(balance) > 0) {
          challenge.funded = true;
          await challenge.save();
        }

        // FIX 2: Changed multi-line string concatenation with '+' to a single template literal
        return ctx.reply(
`Challenge "${challenge.title}" already has the correct prize pool amount.

Current balance: ${balance} ${challenge.currency}
Status: ${challenge.funded ? '✅ Funded' : '⏳ Waiting for funds'}`
        );
      } else {
        // Balance is lower than prize pool
        // FIX 3: Changed multi-line string concatenation, fixed variable interpolation, and correctly passed options object
        return ctx.reply(
`⚠️ The current balance (${balance} ${challenge.currency}) is less than the prize pool (${challenge.prizePool} ${challenge.currency}).

Please send additional funds to:
\`${challenge.walletAddress}\`

Amount needed: ${(parseFloat(challenge.prizePool) - parseFloat(balance)).toFixed(8)} ${challenge.currency}`,
          { parse_mode: 'Markdown' } // Pass options as a separate argument
        );
      }
    } catch (error) {
      logger.error('Error updating prize pool:', {
        error,
        challengeId
      });

      return ctx.reply('An error occurred while updating the prize pool. Please try again later.');
    }
  });
  // *** FIX END: update_pool_ handler ***

  // Handle confirmed deletion
  bot.action(/confirm_delete_(.+)/, async (ctx) => {
    const challengeId = ctx.match[1];

    await ctx.answerCbQuery('Deleting challenge...');

    try {
      // Find the challenge first to ensure it exists and maybe perform checks
      const challenge = await Challenge.findById(challengeId);

      if (!challenge) {
          await ctx.editMessageText('Error: Challenge not found or already deleted.');
          return;
      }

      // Optional: Add security check again if necessary
      if (challenge.creatorId !== ctx.from.id.toString()) {
        logger.warn('Unauthorized delete confirmation attempt', {
          userId: ctx.from.id,
          challengeId,
          creatorId: challenge.creatorId
        });
        await ctx.editMessageText('Error: You do not have permission to delete this challenge.');
        return;
      }

      await Challenge.findByIdAndDelete(challengeId);

      await ctx.editMessageText('✅ Challenge deleted successfully.');

      logger.info('Challenge deleted by creator', {
        challengeId,
        userId: ctx.from.id
      });
    } catch (error) {
      logger.error('Error deleting challenge', {
        error,
        challengeId
      });
      // Use editMessageText if possible, otherwise reply
      try {
        await ctx.editMessageText('An error occurred while deleting the challenge.');
      } catch (editError) {
        logger.error('Error editing message during delete error handling', { editError, challengeId });
        await ctx.reply('An error occurred while deleting the challenge.');
      }
    }
  });

  // Add activate challenge callback
  bot.action(/activate_(.+)/, async (ctx) => {
    await ctx.answerCbQuery('Activating challenge...');

    const challengeId = ctx.match[1];
    try {
      const challenge = await Challenge.findById(challengeId);

      if (!challenge) {
        return ctx.editMessageText('Error: Challenge not found.');
      }

      // Security check: only the creator can activate
      if (challenge.creatorId !== ctx.from.id.toString()) {
        logger.warn('Unauthorized activation attempt', {
          userId: ctx.from.id,
          challengeId,
          creatorId: challenge.creatorId
        });
        return ctx.editMessageText('Only the challenge creator can activate the challenge.');
      }

      // Check if challenge is already active
      if (challenge.active) {
        return ctx.editMessageText(`This challenge is already active and announced in the group.`);
      }

      // Make sure it's funded
      if (!challenge.funded) {
        // Re-check balance before activating if not marked as funded
        const balance = await walletService.checkBalance(
          challenge.currency,
          challenge.trackId || challenge.walletAddress
        );

        if (parseFloat(balance) < parseFloat(challenge.prizePool)) {
          const now = new Date();

          return ctx.editMessageText(`
⚠️ Cannot activate: Challenge is not fully funded.

Current balance: ${balance} ${challenge.currency}
Required amount: ${challenge.prizePool} ${challenge.currency}
Last checked: ${now.toLocaleTimeString()}

Please fund the challenge first.
          `, {
            reply_markup: {
              inline_keyboard: [
                [{ text: '🔄 Check Again', callback_data: `check_funding_${challenge._id}` }],
                [{ text: '❌ Delete Challenge', callback_data: `delete_challenge_${challenge._id}` }]
              ]
            }
          });
        }

        // Mark challenge as funded if balance is sufficient
        challenge.funded = true;
        // No need to save yet, will be saved with active=true later
      }

      // Show a message that we're activating
      await ctx.editMessageText(`
🚀 Activating challenge "${challenge.title}"...

Announcing in the group chat...
      `);

      // Mark challenge as active and funded (if updated above)
      challenge.active = true;
      await challenge.save(); // Save both active and potentially funded status

      // Announce challenge in the group
      try {
        await ctx.telegram.sendMessage(
          challenge.groupId,
          `
🎉 New Meme Challenge: "${challenge.title}" 🎉

${challenge.description}

Prize: ${challenge.prizePool} ${challenge.currency}
Deadline: ${challenge.endDate.toLocaleDateString()}
Voting Method: ${challenge.votingMethod === 'admin' ? 'Admin Selection' : 'Community Voting'}
Maximum entries per user: ${challenge.entriesPerUser}
        `,
          {
            reply_markup: {
              inline_keyboard: [
                [{ text: '📷 Submit Your Meme', callback_data: `submit_${challenge._id}` }]
              ]
            }
          }
        );

        // Notify the creator
        await ctx.editMessageText(`
🚀 Your challenge "${challenge.title}" has been activated and announced in the group!

The challenge will run until ${challenge.endDate.toLocaleDateString()}.
        `);

        logger.info('Challenge activated and announced from callback', {
          challengeId: challenge._id.toString(),
          groupId: challenge.groupId
        });
      } catch (error) {
        logger.error('Error announcing challenge in group', {
          error: error.message, // Log specific error message
          description: error.description, // Log Telegram error description if available
          challengeId,
          groupId: challenge.groupId
        });

        // Revert active status since announcement failed
        challenge.active = false;
        await challenge.save();

        return ctx.editMessageText(`
⚠️ Error: Could not announce the challenge in the group (${error.description || 'Unknown error'}).

The bot may not have permission to send messages in the group, or the group ID might be invalid. Please check:
1. The bot is an administrator in the group with rights to send messages.
2. The group ID (${challenge.groupId}) is correct.

Then try again.
        `, {
          reply_markup: {
            inline_keyboard: [
              [{ text: '🚀 Try Again', callback_data: `activate_${challengeId}` }],
              [{ text: '❌ Delete Challenge', callback_data: `delete_challenge_${challengeId}` }] // Offer delete as an option
            ]
          }
        });
      }
    } catch (error) {
      logger.error('Error activating challenge from callback', {
        error: error.message, // Log specific error message
        challengeId
      });

      await ctx.editMessageText('An error occurred while activating the challenge. Please try again.', {
        reply_markup: {
          inline_keyboard: [
            [{ text: '🚀 Try Again', callback_data: `activate_${challengeId}` }]
          ]
        }
      });
    }
  });
};