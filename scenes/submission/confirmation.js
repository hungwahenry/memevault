// scenes/submission/confirmation.js
const Submission = require('../../models/submission');
const User = require('../../models/user');
const logger = require('../../utils/logger');

async function confirmSubmission(ctx) {
  if (!ctx.callbackQuery) {
    await ctx.reply('Please use the buttons to confirm or retry.');
    return;
  }
  
  const action = ctx.callbackQuery.data;
  await ctx.answerCbQuery();
  
  if (action === 'retry_submission') {
    await ctx.reply('Let\'s try again. Please upload your meme image:');
    return ctx.wizard.back(2); // Go back to step 2 (image upload)
  } else if (action === 'confirm_submission') {
    try {
      const challenge = ctx.wizard.state.challenge;
      
      if (!challenge) {
        logger.error('Challenge data missing in confirmation step', {
          userId: ctx.from.id,
          challengeId: ctx.wizard.state.challengeId
        });
        await ctx.reply('An error occurred. Please try submitting again.');
        return ctx.scene.leave();
      }
      
      // Save submission to database
      const submission = new Submission({
        challengeId: challenge._id,
        userId: ctx.from.id.toString(),
        username: ctx.from.username || `User_${ctx.from.id}`,
        imageFileId: ctx.wizard.state.imageFileId,
        caption: ctx.wizard.state.caption || ''
      });
      
      await submission.save();

      await User.findOneAndUpdate(
        { userId: ctx.from.id.toString() },
        { 
          $inc: { submissionsCount: 1 },
          $addToSet: { tags: 'participant' }
        }
      );
      
      logger.info('New submission created', {
        submissionId: submission._id.toString(),
        challengeId: challenge._id.toString(),
        userId: ctx.from.id
      });
      
      // Send confirmation
      await ctx.reply('✅ Your meme has been submitted successfully!');
      
      // Send submission to the group chat
      try {
        const bot = ctx.telegram;
        await bot.sendPhoto(
          challenge.groupId,
          ctx.wizard.state.imageFileId,
          {
            caption: `
📥 New Submission for "${challenge.title}"
${ctx.wizard.state.caption ? `Caption: ${ctx.wizard.state.caption}` : ''}
Submitted by: @${ctx.from.username || `User_${ctx.from.id}`}
            `,
            parse_mode: 'Markdown'
          }
        );
      } catch (sendError) {
        logger.error('Error sending submission to group chat:', {
          error: sendError,
          userId: ctx.from.id,
          challengeId: challenge._id.toString()
        });
        // Don't tell the user about this error since their submission was saved
      }
      
      return ctx.scene.leave();
    } catch (error) {
      logger.error('Error saving submission:', {
        error,
        userId: ctx.from.id,
        challengeId: ctx.wizard.state.challengeId
      });
      await ctx.reply('An error occurred while saving your submission. Please try again later.');
      return ctx.scene.leave();
    }
  }
}

module.exports = {
  confirmSubmission
};