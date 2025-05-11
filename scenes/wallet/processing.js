// scenes/wallet/processing.js
const Submission = require('../../models/submission');
const { processPrizePayment } = require('../../utils/challenges');
const logger = require('../../utils/logger');

async function handleInvalidAddress(ctx, walletMessageId, currency) {
  // Send temporary error message that will be deleted
  const errorMsg = await ctx.reply(
    `⚠️ This does not appear to be a valid ${currency} address. Please check and try again.`
  );
  
  // Delete the user's invalid address message for privacy
  try {
    await ctx.deleteMessage(walletMessageId);
  } catch (deleteError) {
    logger.warn('Could not delete invalid wallet address message', { deleteError });
  }
  
  // Delete our error message after 5 seconds
  setTimeout(async () => {
    try {
      await ctx.deleteMessage(errorMsg.message_id);
    } catch (deleteError) {
      logger.warn('Could not delete error message', { deleteError });
    }
  }, 5000);
}

async function processValidAddress(ctx, walletAddress, walletMessageId) {
  // First show a temporary "processing" message
  const processingMsg = await ctx.reply('⏳ Processing your wallet address...');
  
  // Delete the user's wallet address message immediately for privacy
  try {
    await ctx.deleteMessage(walletMessageId);
  } catch (deleteError) {
    logger.warn('Could not delete wallet address message', { deleteError });
  }
  
  // Set wallet address using fresh submission from database to avoid state issues
  try {
    const freshSubmission = await Submission.findById(ctx.wizard.state.submission._id);
    if (!freshSubmission) {
      throw new Error('Could not find submission in database');
    }
    
    freshSubmission.winnerWalletAddress = walletAddress;
    await freshSubmission.save();
    
    // Update our reference
    ctx.wizard.state.submission = freshSubmission;
    
    // Get challenge info for the confirmation message
    const challenge = ctx.wizard.state.challenge;
    
    // Delete the processing message
    try {
      await ctx.deleteMessage(processingMsg.message_id);
    } catch (deleteError) {
      logger.warn('Could not delete processing message', { deleteError });
    }
    
    // Update the original main message with confirmation
    try {
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        ctx.wizard.state.formMessageId,
        undefined,
        `
🎉 Prize Claim Confirmed!

Your prize of ${challenge.prizePool} ${challenge.currency} will be sent to:
\`${walletAddress.substring(0, 6)}...${walletAddress.substring(walletAddress.length - 4)}\`

Please allow a few minutes for the transaction to process. You'll receive a notification when the transaction is complete.
        `,
        { parse_mode: 'Markdown' }
      );
    } catch (error) {
      logger.error('Error updating wallet confirmation message', { error });
      
      // If we can't edit, send a new message
      await ctx.reply(`
🎉 Prize Claim Confirmed!

Your prize of ${challenge.prizePool} ${challenge.currency} will be sent to your wallet.
Please allow a few minutes for the transaction to process.
      `);
    }
    
    // Process payment in the background
    processPrizePayment(ctx.wizard.state.submission._id);
    
    return ctx.scene.leave();
  } catch (saveError) {
    logger.error('Error saving wallet address:', {
      error: saveError,
      userId: ctx.from.id,
      submissionId: ctx.wizard.state.submission._id.toString()
    });
    
    // Delete the processing message
    try {
      await ctx.deleteMessage(processingMsg.message_id);
    } catch (deleteError) {
      logger.warn('Could not delete processing message', { deleteError });
    }
    
    await ctx.reply('An error occurred while saving your wallet address. Please try again later.');
    return ctx.scene.leave();
  }
}

module.exports = {
  handleInvalidAddress,
  processValidAddress
};