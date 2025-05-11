// utils/callbacks/utility.js
const logger = require('../logger');

module.exports = function(bot) {
  // Claim prize
  bot.action(/claim_(.+)/, async (ctx) => {
    const submissionId = ctx.match[1];
    
    try {
      // Verify this is the winner trying to claim
      const Submission = require('../../models/submission');
      const submission = await Submission.findById(submissionId)
        .populate('challengeId');
        
      if (!submission) {
        await ctx.answerCbQuery('This submission does not exist.', {show_alert: true});
        return;
      }
      
      if (submission.userId !== ctx.from.id.toString()) {
        await ctx.answerCbQuery('Only the winner can claim this prize.', {show_alert: true});
        logger.warn('Unauthorized prize claim attempt', {
          userId: ctx.from.id,
          submissionId,
          ownerId: submission.userId
        });
        return;
      }
      
      if (!submission.challengeId || !submission.challengeId.completed) {
        await ctx.answerCbQuery('This challenge is not completed yet.', {show_alert: true});
        return;
      }
      
      if (submission.winnerWalletAddress) {
        await ctx.answerCbQuery('You have already claimed this prize!', {show_alert: true});
        return;
      }
      
      await ctx.answerCbQuery();
      
      // Disable the button by editing the message
      try {
        await ctx.editMessageReplyMarkup({
          inline_keyboard: [
            [{ text: '✅ Claim Process Started', callback_data: 'claimed_already' }]
          ]
        });
      } catch (editError) {
        logger.warn('Could not update claim button', { editError });
      }
      
      if (ctx.chat.type !== 'private') {
        return ctx.reply(
          'To claim your prize, please click the button below:',
          {
            reply_markup: {
              inline_keyboard: [
                [{ text: '💰 Claim Prize', url: `https://t.me/${ctx.botInfo.username}?start=claim_${submissionId}` }]
              ]
            }
          }
        );
      } else {
        return ctx.scene.enter('wallet_scene', { submissionId: submissionId });
      }
    } catch (error) {
      logger.error('Error handling claim action:', {
        error,
        userId: ctx.from.id,
        submissionId
      });
      await ctx.answerCbQuery('An error occurred. Please try again.');
    }
  });
  
  // Handler for already claimed button
  bot.action('claimed_already', async (ctx) => {
    await ctx.answerCbQuery('You have already started the claim process.', {show_alert: true});
  });
  
  // General skip action
  bot.action('skip', async (ctx) => {
    await ctx.answerCbQuery();
    return ctx.wizard.next();
  });
  
  // Placeholder for count button (just to prevent errors)
  bot.action('count', async (ctx) => {
    await ctx.answerCbQuery();
  });
};