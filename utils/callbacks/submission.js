// utils/callbacks/submission.js
const Challenge = require('../../models/challenge');
const Submission = require('../../models/submission');
const Group = require('../../models/group');
const logger = require('../logger');

module.exports = function(bot) {
  // Handle submission
  bot.action(/submit_(.+)/, async (ctx) => {
    const challengeId = ctx.match[1];
    
    try {
      // Verify the challenge exists and is active
      const challenge = await Challenge.findById(challengeId);
      if (!challenge || !challenge.active) {
        await ctx.answerCbQuery('This challenge is not active or does not exist.', {show_alert: true});
        return;
      }
      
      const group = await Group.findOne({ groupId: challenge.groupId });
      if (group && group.adminIds.includes(ctx.from.id.toString())) {
        await ctx.answerCbQuery('As an admin, you cannot submit to your own challenges.', {show_alert: true});
        logger.warn('Admin attempted to submit to own group challenge', {
          userId: ctx.from.id,
          challengeId,
          groupId: challenge.groupId
        });
        return;
      }
      // Check if submissions are still open
      if (new Date() > challenge.endDate) {
        await ctx.answerCbQuery('This challenge is no longer accepting submissions.', {show_alert: true});
        return;
      }
      
      // Check if user has already submitted max entries
      const userSubmissions = await Submission.countDocuments({
        challengeId: challenge._id,
        userId: ctx.from.id.toString()
      });
      
      if (userSubmissions >= challenge.entriesPerUser) {
        await ctx.answerCbQuery(`You've already submitted the maximum number of entries (${challenge.entriesPerUser}).`, {show_alert: true});
        return;
      }
      
      // Check if challenge has reached max total entries
      if (challenge.maxEntries > 0) {
        const totalSubmissions = await Submission.countDocuments({
          challengeId: challenge._id
        });
        
        if (totalSubmissions >= challenge.maxEntries) {
          await ctx.answerCbQuery('This challenge has reached its maximum number of entries.', {show_alert: true});
          return;
        }
      }
      
      if (ctx.chat.type !== 'private') {
        await ctx.answerCbQuery('Opening private chat...');
        return ctx.reply(
          'To submit your meme, please click the button below:',
          {
            reply_markup: {
              inline_keyboard: [
                [{ text: '📷 Submit Meme', url: `https://t.me/${ctx.botInfo.username}?start=submit_${challengeId}` }]
              ]
            }
          }
        );
      } else {
        await ctx.answerCbQuery();
        ctx.scene.state = { challengeId };
        return ctx.scene.enter('submission_scene');
      }
    } catch (error) {
      logger.error('Error handling submit action:', {
        error, 
        userId: ctx.from.id,
        challengeId
      });
      await ctx.answerCbQuery('An error occurred. Please try again.', {show_alert: true});
    }
  });
  
  // Handle confirm_submission / retry_submission callbacks
  bot.action('confirm_submission', async (ctx) => {
    // Implementation for confirm submission
    // This would be filled in based on your existing code
  });
  
  bot.action('retry_submission', async (ctx) => {
    // Implementation for retry submission
    // This would be filled in based on your existing code
  });
  
  // Handle share_all callback
  bot.action(/share_all_(.+)/, async (ctx) => {
    const challengeId = ctx.match[1];
    await ctx.answerCbQuery('Processing your request...');
    
    try {
      const challenge = await Challenge.findById(challengeId);
      if (!challenge) {
        return ctx.reply('This challenge no longer exists.');
      }
      
      // Security check
      if (challenge.creatorId !== ctx.from.id.toString()) {
        logger.warn('Unauthorized attempt to share submissions', {
          userId: ctx.from.id,
          challengeId,
          creatorId: challenge.creatorId
        });
        return ctx.reply('Only the challenge creator can share these submissions.');
      }
      
      // Get all submissions for this challenge
      const submissions = await Submission.find({ challengeId: challenge._id });
      
      if (submissions.length === 0) {
        return ctx.reply('This challenge has no submissions to share.');
      }
      
      // Ask for confirmation due to potential message flood
      await ctx.reply(`
⚠️ You are about to share all ${submissions.length} submissions to the group chat.
This will send multiple messages. Are you sure?
      `, {
        reply_markup: {
          inline_keyboard: [
            [
              { text: '✅ Yes, share all', callback_data: `confirm_share_${challengeId}` },
              { text: '❌ No, cancel', callback_data: 'cancel_share' }
            ]
          ]
        }
      });
    } catch (error) {
      logger.error('Error handling share all request:', {
        error,
        userId: ctx.from.id,
        challengeId
      });
      await ctx.reply('An error occurred while processing your request.');
    }
  });
  
  // Handle confirm_share callback
  bot.action(/confirm_share_(.+)/, async (ctx) => {
    const challengeId = ctx.match[1];
    await ctx.answerCbQuery();
    
    try {
      const challenge = await Challenge.findById(challengeId);
      if (!challenge) {
        return ctx.reply('This challenge no longer exists.');
      }
      
      // Security check
      if (challenge.creatorId !== ctx.from.id.toString()) {
        return ctx.reply('Only the challenge creator can share these submissions.');
      }
      
      // Get all submissions for this challenge
      const submissions = await Submission.find({ challengeId: challenge._id });
      
      if (submissions.length === 0) {
        return ctx.reply('This challenge has no submissions to share.');
      }
      
      // Send a message to the admin
      await ctx.reply(`Sharing ${submissions.length} submissions to the group...`);
      
      // Send an announcement to the group
      await ctx.telegram.sendMessage(
        challenge.groupId,
        `
📢 All Submissions for "${challenge.title}"

The admin is sharing all ${submissions.length} submissions that were received for this challenge.
The winner will be announced soon!
        `
      );
      
      // Send all submissions to the group with a slight delay to avoid rate limiting
      for (let i = 0; i < submissions.length; i++) {
        const submission = submissions[i];
        
        await ctx.telegram.sendPhoto(
          challenge.groupId,
          submission.imageFileId,
          {
            caption: `
Submission ${i + 1}/${submissions.length} for "${challenge.title}"
${submission.caption ? `Caption: ${submission.caption}` : ''}
Submitted by: @${submission.username || `User_${submission.userId}`}
            `
          }
        );
        
        // Add a small delay between messages to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      
      // Confirm completion to the admin
      await ctx.reply('All submissions have been shared to the group.');
    } catch (error) {
      logger.error('Error sharing submissions:', {
        error,
        userId: ctx.from.id,
        challengeId
      });
      await ctx.reply('An error occurred while sharing the submissions.');
    }
  });
  
  // Handle cancel_share callback
  bot.action('cancel_share', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply('Sharing cancelled.');
  });
};