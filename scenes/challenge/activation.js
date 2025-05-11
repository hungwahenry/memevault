// scenes/challenge/activation.js
const { format } = require('date-fns');
const Challenge = require('../../models/challenge');
const walletService = require('../../services/wallet');
const { checkChallengePayment } = require('../../utils/challenges');
const logger = require('../../utils/logger');
const { formatDate } = require('../../utils/validation');
const validation = require('./validation');

async function handleActivation(ctx) {
  if (!ctx.callbackQuery) {
    await ctx.reply('Use the Check Funding Status button to verify if your payment has been received.');
    return;
  }
  
  const action = ctx.callbackQuery.data;
  
  // Handle funding check
  if (action.startsWith('check_funding_')) {
    await ctx.answerCbQuery('Checking funding status...');
    
    const challengeId = action.replace('check_funding_', '');
    const challenge = await Challenge.findById(challengeId);
    
    if (!challenge) {
      await ctx.editMessageText(`${validation.getNextErrorEmoji()} Error: Challenge not found.`);
      return ctx.scene.leave();
    }
    
    try {
      // Use trackId for checking balance with OxaPay
      const balance = await walletService.checkBalance(challenge.currency, challenge.trackId || challenge.walletAddress);
      
      logger.info('Challenge funding check', {
        challengeId: challenge._id.toString(),
        walletAddress: challenge.walletAddress,
        trackId: challenge.trackId,
        requiredAmount: challenge.prizePool,
        currentBalance: balance
      });
      
      const now = new Date();
      ctx.wizard.state.lastCheckTime = now;
      
      if (parseFloat(balance) >= parseFloat(challenge.prizePool)) {
        // Mark challenge as funded
        challenge.funded = true;
        await challenge.save();
        
        // Show activation button
        await ctx.editMessageText(`
✅ Funding received! Your challenge "${challenge.title}" is now ready to be activated.

Current balance: ${balance} ${challenge.currency}
Required amount: ${challenge.prizePool} ${challenge.currency}
Last checked: ${format(now, process.env.TIME_FORMAT || 'HH:mm:ss')}

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
        
        // Select a message based on check count
        const checkCount = ctx.wizard.state.checkCount || 0;
        const message = messages[checkCount % messages.length];
        ctx.wizard.state.checkCount = checkCount + 1;
        
        // Show funding not complete yet
        await ctx.editMessageText(`
📋 Funding Status for "${challenge.title}":

To activate your challenge, please send exactly ${challenge.prizePool} ${challenge.currency} to:
\`${challenge.walletAddress}\`

Current balance: ${balance} ${challenge.currency}
Required amount: ${challenge.prizePool} ${challenge.currency}
Last checked: ${format(now, process.env.TIME_FORMAT || 'HH:mm:ss')}

Status: ${message}
        `, {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '🔄 Check Again', callback_data: `check_funding_${challenge._id}` }],
              [{ text: '❌ Delete Challenge', callback_data: `delete_challenge_${challenge._id}` }]
            ]
          }
        });
      }
    } catch (error) {
      logger.error('Error checking challenge balance', {
          error,
          challengeId: challenge._id.toString()
        });
        
        const now = new Date();
        
        await ctx.editMessageText(`
⚠️ Error checking balance

To activate your challenge, please send exactly ${challenge.prizePool} ${challenge.currency} to:\`${challenge.walletAddress}\`

Last checked: ${format(now, process.env.TIME_FORMAT || 'HH:mm:ss')}
Error: Could not retrieve balance information

Please try again in a few moments.
        `, {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '🔄 Try Again', callback_data: `check_funding_${challenge._id}` }],
              [{ text: '❌ Delete Challenge', callback_data: `delete_challenge_${challenge._id}` }]
            ]
          }
        });
      }
    } 
    // Handle challenge deletion
    else if (action.startsWith('delete_challenge_')) {
      const challengeId = action.replace('delete_challenge_', '');
      
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
    }
    // Handle confirmed deletion
    else if (action.startsWith('confirm_delete_')) {
      const challengeId = action.replace('confirm_delete_', '');
      
      await ctx.answerCbQuery('Deleting challenge...');
      
      try {
        await Challenge.findByIdAndDelete(challengeId);
        
        await ctx.editMessageText('✅ Challenge deleted successfully.');
        
        logger.info('Challenge deleted by creator', {
          challengeId,
          userId: ctx.from.id
        });
        
        return ctx.scene.leave();
      } catch (error) {
        logger.error('Error deleting challenge', {
          error,
          challengeId
        });
        await ctx.reply(`${validation.getNextErrorEmoji()} An error occurred while deleting the challenge.`);
      }
    }
    // Handle activation
    else if (action.startsWith('activate_')) {
      await ctx.answerCbQuery('Activating challenge...');
      
      const challengeId = action.replace('activate_', '');
      const challenge = await Challenge.findById(challengeId);
      
      if (!challenge) {
        await ctx.editMessageText(`${validation.getNextErrorEmoji()} Error: Challenge not found.`);
        return ctx.scene.leave();
      }
      
      try {
        // Show an intermediate message to improve UX during verification
        await ctx.editMessageText('Verifying funding and preparing to activate challenge...');
        
        // Verify the challenge is actually funded
        if (!challenge.funded) {
          const balance = await walletService.checkBalance(
            challenge.currency, 
            challenge.trackId || challenge.walletAddress
          );
          
          if (parseFloat(balance) < parseFloat(challenge.prizePool)) {
            const now = new Date();
            
            await ctx.editMessageText(`
⚠️ Challenge cannot be activated because it's not fully funded.

Current balance: ${balance} ${challenge.currency}
Required amount: ${challenge.prizePool} ${challenge.currency}
Last checked: ${format(now, process.env.TIME_FORMAT || 'HH:mm:ss')}

Please fund the wallet first.
            `, {
              reply_markup: {
                inline_keyboard: [
                  [{ text: '🔄 Check Again', callback_data: `check_funding_${challengeId}` }],
                  [{ text: '❌ Delete Challenge', callback_data: `delete_challenge_${challenge._id}` }]
                ]
              }
            });
            return;
          } else {
            // Mark as funded if it wasn't already
            challenge.funded = true;
          }
        }
        
        // Mark challenge as active
        challenge.active = true;
        await challenge.save();
        
        // Show a message that we're activating
        await ctx.editMessageText(`
🚀 Activating challenge "${challenge.title}"...

Announcing in the group chat...
        `);
        
        // Announce challenge in the group
        await ctx.telegram.sendMessage(
          challenge.groupId,
          `
🎉 New Meme Challenge: "${challenge.title}" 🎉

${challenge.description}

Prize: ${challenge.prizePool} ${challenge.currency}
Deadline: ${formatDate(challenge.endDate)}
Voting Method: ${challenge.votingMethod === 'admin' ? 'Admin Selection' : 'Community Voting'}
Maximum entries per user: ${challenge.entriesPerUser}
${challenge.maxEntries > 0 ? `Maximum total entries: ${challenge.maxEntries}` : 'No limit on total entries'}
        `,
          {
            reply_markup: {
              inline_keyboard: [
                [{ text: '📷 Submit Your Meme', callback_data: `submit_${challenge._id}` }]
              ]
            }
          }
        );
        
        // Update message to show completion
        await ctx.editMessageText(`
🚀 Your challenge "${challenge.title}" has been activated and announced in the group!

The challenge will run until ${formatDate(challenge.endDate)}.

Thanks for creating a fun challenge for the community! 🙌
        `);
        
        logger.info('Challenge activated and announced', {
          challengeId: challenge._id.toString(),
          groupId: challenge.groupId,
          title: challenge.title
        });
        
        return ctx.scene.leave();
      } catch (error) {
        logger.error('Error activating challenge', {
          error,
          challengeId: challenge._id.toString()
        });
        
        await ctx.editMessageText(`${validation.getNextErrorEmoji()} An error occurred while activating the challenge. Please try again.`, {
          reply_markup: {
            inline_keyboard: [
              [{ text: '🚀 Try Again', callback_data: `activate_${challenge._id}` }]
            ]
          }
        });
      }
    }
}

module.exports = {
  handleActivation
};