// scenes/challenge/funding.js
const { format } = require('date-fns');
const Challenge = require('../../models/challenge');
const User = require('../../models/user');
const walletService = require('../../services/wallet');
const logger = require('../../utils/logger');
const validation = require('./validation');

async function handleFundingSetup(ctx) {
  if (!ctx.callbackQuery) {
    await ctx.reply('Please use the buttons to confirm or cancel.');
    return;
  }
  
  const action = ctx.callbackQuery.data;
  await ctx.answerCbQuery();
  
  if (action === 'cancel_challenge') {
    await ctx.editMessageText('Challenge creation cancelled.');
    logger.info('Challenge creation cancelled', {
      userId: ctx.from.id,
      username: ctx.from.username
    });
    return ctx.scene.leave();
  } else if (action === 'confirm_challenge') {
    // Save the challenge with minimal info first, without wallet details
    try {
      const data = ctx.wizard.state.challengeData;
      
      if (!ctx.wizard.state.groupId) {
        await ctx.reply('Error: Group ID not provided. Please try creating the challenge from the group chat.');
        logger.error('Missing group ID during challenge creation', {
          userId: ctx.from.id
        });
        return ctx.scene.leave();
      }
      
      // Start with creating a waiting message to improve UX
      await ctx.editMessageText('Creating your challenge and preparing wallet...');
      
      // Create the challenge without wallet info first
      const challenge = new Challenge({
        groupId: ctx.wizard.state.groupId,
        creatorId: ctx.from.id.toString(),
        title: data.title,
        description: data.description,
        startDate: data.startDate,
        endDate: data.endDate,
        currency: data.currency,
        prizePool: data.prizePool,
        votingMethod: data.votingMethod,
        entriesPerUser: data.entriesPerUser,
        maxEntries: data.maxEntries,
        funded: false,
        active: false,
        completed: false
      });
      
      await challenge.save();

      await User.findOneAndUpdate(
        { userId: ctx.from.id.toString() },
        { 
          $inc: { challengesCreated: 1 }, 
          $addToSet: { tags: 'creator' }
        }
      );
      
      logger.info('Challenge created (pre-wallet)', {
        challengeId: challenge._id.toString(),
        creator: ctx.from.id,
        title: data.title
      });
      
      // Now create the wallet
      try {
        const walletCurrency = data.currency;
        const wallet = await walletService.createWallet(walletCurrency);
        
        logger.info('Created wallet for challenge', {
          challengeId: challenge._id.toString(),
          currency: walletCurrency,
          address: wallet.address,
          trackId: wallet.trackId
        });
        
        // Update the challenge with wallet info
        challenge.walletAddress = wallet.address;
        challenge.trackId = wallet.trackId;
        
        await challenge.save();
        
        logger.info('Challenge updated with wallet details', {
          challengeId: challenge._id.toString(),
          walletAddress: wallet.address,
          trackId: wallet.trackId
        });
        
        // Display funding information to the user
        const now = new Date();
        
        await ctx.editMessageText(`
📋 Funding Information:

To activate your challenge, please send exactly ${challenge.prizePool} ${challenge.currency} to:
\`${wallet.address}\`

Last checked: ${format(now, process.env.TIME_FORMAT || 'HH:mm:ss')}
Status: Waiting for funds...
        `, {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '🔄 Check Funding Status', callback_data: `check_funding_${challenge._id}` }],
              [{ text: '❌ Delete Challenge', callback_data: `delete_challenge_${challenge._id}` }]
            ]
          }
        });
        
        // Register funding check callback
        ctx.wizard.state.challenge = challenge;
        ctx.wizard.state.lastCheckTime = now;
        
        // Move to next step (waiting for funding)
        return ctx.wizard.next();
        
      } catch (error) {
        logger.error('Error creating wallet for challenge', {
          error,
          challengeId: challenge._id.toString()
        });
        
        // Delete the challenge if wallet creation failed
        await Challenge.findByIdAndDelete(challenge._id);
        
        await ctx.editMessageText(`${validation.getNextErrorEmoji()} An error occurred while creating the wallet. Please try again later.`);
        return ctx.scene.leave();
      }
    } catch (error) {
      logger.error('Error saving challenge', {error, userId: ctx.from.id});
      await ctx.editMessageText(`${validation.getNextErrorEmoji()} An error occurred while saving the challenge. Please try again later.`);
      return ctx.scene.leave();
    }
  }
}

module.exports = {
  handleFundingSetup
};