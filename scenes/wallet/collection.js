// scenes/wallet/collection.js
const Submission = require('../../models/submission');
const { validateWalletAddress } = require('../../utils/validation');
const { processPrizePayment } = require('../../utils/challenges');
const logger = require('../../utils/logger');
const processing = require('./processing');

async function handleWalletCollection(ctx) {
  try {
    // Handle wallet address entry callback
    if (ctx.callbackQuery && ctx.callbackQuery.data === "enter_wallet_address") {
      await ctx.answerCbQuery();
      
      // Edit message to prompt for wallet address input and remove keyboard
      await ctx.editMessageText(
        `🎉 Congratulations! Your meme has won the "${ctx.wizard.state.challenge.title}" challenge!\n\n` +
        `You have won ${ctx.wizard.state.challenge.prizePool} ${ctx.wizard.state.challenge.currency}.\n\n` +
        `Please reply with your ${ctx.wizard.state.challenge.currency} wallet address:`,
        { reply_markup: { inline_keyboard: [] } }
      );
      
      // Set state to waiting for address input
      ctx.wizard.state.waitingForAddress = true;
      return;
    }
    
    // Process wallet address input
    if (ctx.message && ctx.message.text && ctx.wizard.state.waitingForAddress) {
      const walletAddress = ctx.message.text.trim();
      
      if (!ctx.wizard.state.challenge) {
        logger.error('Challenge data missing when processing wallet address', {
          userId: ctx.from.id,
          submissionId: ctx.wizard.state.submissionId
        });
        await ctx.reply('An error occurred. Please try again later.');
        return ctx.scene.leave();
      }
      
      const challenge = ctx.wizard.state.challenge;
      
      // Store the message ID of the wallet address message so we can delete it
      const walletMessageId = ctx.message.message_id;
      
      // Validate wallet address
      if (!validateWalletAddress(walletAddress, challenge.currency)) {
        await processing.handleInvalidAddress(ctx, walletMessageId, challenge.currency);
        return;
      }
      
      if (!ctx.wizard.state.submission) {
        logger.error('Submission data missing when processing wallet address', {
          userId: ctx.from.id,
          submissionId: ctx.wizard.state.submissionId
        });
        await ctx.reply('An error occurred. Please try again later.');
        return ctx.scene.leave();
      }
      
      // Process valid wallet address
      return await processing.processValidAddress(ctx, walletAddress, walletMessageId);
    }
    
    // If we get a message but aren't waiting for an address, remind the user
    if (ctx.message && !ctx.wizard.state.waitingForAddress) {
      // Store message ID so we can delete it
      const messageId = ctx.message.message_id;
      
      const replyMsg = await ctx.reply(
        'Please click the "Enter Wallet Address" button to provide your wallet address.'
      );
      
      // Try to delete the user's message
      try {
        await ctx.deleteMessage(messageId);
      } catch (error) {
        logger.warn('Could not delete user message', { error });
      }
      
      // Delete our message after 5 seconds
      setTimeout(async () => {
        try {
          await ctx.deleteMessage(replyMsg.message_id);
        } catch (error) {
          logger.warn('Could not delete reminder message', { error });
        }
      }, 5000);
      
      return;
    }
  } catch (error) {
    logger.error('Error saving wallet address:', {
      error,
      userId: ctx.from.id,
      submissionId: ctx.wizard.state.submission?._id.toString()
    });
    await ctx.reply('An error occurred while saving your wallet address. Please try again later.');
    return ctx.scene.leave();
  }
}

module.exports = {
  handleWalletCollection
};