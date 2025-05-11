// scenes/wallet/validation.js
const { Markup } = require('telegraf');
const Submission = require('../../models/submission');
const logger = require('../../utils/logger');

async function validateSubmission(ctx) {
  // Get submissionId from scene state
  const submissionId = ctx.scene.state?.submissionId;
  
  logger.info('Wallet scene entered', {
    hasSubmissionId: !!submissionId,
    userId: ctx.from.id
  });
  
  if (!submissionId) {
    await ctx.reply('Error: No submission specified. Please try claiming your prize again.');
    logger.warn('Wallet scene entered without submission ID', {
      userId: ctx.from.id
    });
    return ctx.scene.leave();
  }
  
  try {
    const submission = await Submission.findById(submissionId)
      .populate('challengeId');
    
    if (!submission) {
      await ctx.reply('This submission does not exist.');
      logger.warn('Wallet scene with non-existent submission', {
        userId: ctx.from.id,
        submissionId: submissionId
      });
      return ctx.scene.leave();
    }
    
    if (submission.userId !== ctx.from.id.toString()) {
      await ctx.reply('You are not the owner of this submission.');
      logger.warn('Unauthorized wallet claim attempt', {
        userId: ctx.from.id,
        submissionId: submission._id.toString(),
        ownerId: submission.userId
      });
      return ctx.scene.leave();
    }
    
    const challenge = submission.challengeId;
    
    if (!challenge || !challenge.completed) {
      await ctx.reply('This challenge is not completed yet.');
      logger.warn('Wallet claim attempt for incomplete challenge', {
        userId: ctx.from.id,
        submissionId: submission._id.toString(),
        challengeId: challenge ? challenge._id.toString() : 'null'
      });
      return ctx.scene.leave();
    }
    
    // Check if this is actually the winning submission
    if (!challenge.winner || !challenge.winner.equals(submission._id)) {
      await ctx.reply('This submission is not the winner of the challenge.');
      logger.warn('Wallet claim attempt for non-winning submission', {
        userId: ctx.from.id,
        submissionId: submission._id.toString(),
        challengeId: challenge._id.toString(),
        winnerId: challenge.winner ? challenge.winner.toString() : 'null'
      });
      return ctx.scene.leave();
    }
    
    // Check if they've already provided a wallet address
    if (submission.winnerWalletAddress) {
      const maskedAddress = `${submission.winnerWalletAddress.substring(0, 6)}...${submission.winnerWalletAddress.substring(submission.winnerWalletAddress.length - 4)}`;
      await ctx.reply(`You have already claimed this prize. Your payment to wallet address ${maskedAddress} is being processed.`);
      return ctx.scene.leave();
    }
    
    // Save in wizard state for next step
    ctx.wizard.state.submission = submission;
    ctx.wizard.state.challenge = challenge;
    ctx.wizard.state.submissionId = submissionId;
    
    // Send a message with information and a field to edit
    const formMessage = await ctx.reply(
      `🎉 Congratulations! Your meme has won the "${challenge.title}" challenge!\n\n` +
      `You have won ${challenge.prizePool} ${challenge.currency}.\n\n` +
      `Please provide your ${challenge.currency} wallet address:`,
      Markup.inlineKeyboard([
        [{ text: "Enter Wallet Address", callback_data: "enter_wallet_address" }]
      ])
    );
    
    // Save message ID for future edits
    ctx.wizard.state.formMessageId = formMessage.message_id;
    
    return ctx.wizard.next();
  } catch (error) {
    logger.error('Error in wallet collection step 1:', {
      error, 
      userId: ctx.from.id,
      submissionId: submissionId
    });
    await ctx.reply('An error occurred. Please try again later.');
    return ctx.scene.leave();
  }
}

module.exports = {
  validateSubmission
};