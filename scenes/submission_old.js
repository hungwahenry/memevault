// scenes/submission.js
const { Scenes } = require('telegraf');
const Challenge = require('../models/challenge');
const Submission = require('../models/submission');
const Group = require('../models/group');
const User = require('../models/user');
const { getSubmissionKeyboard } = require('../utils/keyboards');
const logger = require('../utils/logger');

const submissionScene = new Scenes.WizardScene(
  'submission_scene',
  // Step 1: Start submission process
  async (ctx) => {
    // Check if this was entered via deep link or directly
    let challengeId;
    
    // First try to get from scene state directly
    if (ctx.scene.state && ctx.scene.state.challengeId) {
      challengeId = ctx.scene.state.challengeId;
      logger.info('Got challengeId from scene state', { challengeId, userId: ctx.from.id });
    } 
    // If not available, see if we have it in the message update
    else if (ctx.update && ctx.update.message && ctx.update.message.text) {
      const text = ctx.update.message.text;
      if (text.startsWith('/start submit_')) {
        challengeId = text.substring(14); // Remove '/start submit_'
        logger.info('Extracted challengeId from /start command', { challengeId, userId: ctx.from.id });
      }
    }
    
    if (!challengeId) {
      await ctx.reply('Error: No challenge specified.');
      logger.warn('Submission scene entered without challenge ID', {
        userId: ctx.from.id
      });
      return ctx.scene.leave();
    }
    
    try {
      const challenge = await Challenge.findById(challengeId);
      
      if (!challenge || !challenge.active) {
        await ctx.reply('This challenge is not active or does not exist.');
        logger.warn('Attempt to submit to inactive challenge', {
          userId: ctx.from.id,
          challengeId
        });
        return ctx.scene.leave();
      }

      const group = await Group.findOne({ groupId: challenge.groupId });
      if (group && group.adminIds.includes(ctx.from.id.toString())) {
        await ctx.reply('❌ As an admin of this group, you cannot submit to your own challenges. This helps keep contests fair for all participants.');
        logger.warn('Admin attempted to submit to own group challenge', {
          userId: ctx.from.id,
          challengeId: challenge._id.toString(),
          groupId: challenge.groupId
        });
        return ctx.scene.leave();
      }
      
      // Check if the challenge is still open for submissions
      if (new Date() > challenge.endDate) {
        await ctx.reply('This challenge is no longer accepting submissions.');
        logger.info('Attempt to submit after deadline', {
          userId: ctx.from.id,
          challengeId: challenge._id.toString()
        });
        return ctx.scene.leave();
      }
      
      // Check if user has already submitted max entries
      const userSubmissions = await Submission.countDocuments({
        challengeId: challenge._id,
        userId: ctx.from.id.toString()
      });
      
      if (userSubmissions >= challenge.entriesPerUser) {
        await ctx.reply(
          `You've already submitted the maximum number of entries (${challenge.entriesPerUser}) for this challenge.`
        );
        logger.info('User reached maximum submissions', {
          userId: ctx.from.id,
          challengeId: challenge._id.toString(),
          maxEntries: challenge.entriesPerUser,
          currentEntries: userSubmissions
        });
        return ctx.scene.leave();
      }
      
      // Check if challenge has reached max total entries
      if (challenge.maxEntries > 0) {
        const totalSubmissions = await Submission.countDocuments({
          challengeId: challenge._id
        });
        
        if (totalSubmissions >= challenge.maxEntries) {
          await ctx.reply('This challenge has reached its maximum number of entries.');
          logger.info('Challenge reached maximum entries', {
            challengeId: challenge._id.toString(),
            maxEntries: challenge.maxEntries
          });
          return ctx.scene.leave();
        }
      }
      
      // Store challenge in wizard state for next steps
      ctx.wizard.state.challenge = challenge;
      ctx.wizard.state.challengeId = challengeId;
      
      await ctx.reply(
        `📷 Submit your meme for "${challenge.title}"\n\nPlease upload your meme image:`
      );
      
      return ctx.wizard.next();
    } catch (error) {
      logger.error('Error in submission step 1:', {
        error, 
        userId: ctx.from.id,
        challengeId
      });
      await ctx.reply('An error occurred. Please try again later.');
      return ctx.scene.leave();
    }
  },
  
  // Rest of the scene remains unchanged
  // Step 2: Get meme image
  async (ctx) => {
    if (!ctx.message || !ctx.message.photo) {
      await ctx.reply('Please upload an image for your meme submission.');
      return;
    }
    
    // Get the largest photo size
    const photoSize = ctx.message.photo[ctx.message.photo.length - 1];
    ctx.wizard.state.imageFileId = photoSize.file_id;
    
    await ctx.reply(
      'Your meme image has been received! Would you like to add a caption?',
      {
        reply_markup: {
          inline_keyboard: [
            [
              { text: '➕ Add Caption', callback_data: 'add_caption' },
              { text: '⏩ Skip Caption', callback_data: 'skip' }
            ]
          ]
        }
      }
    );
    
    return ctx.wizard.next();
  },
  // Step 3: Get caption
  async (ctx) => {
    // If user selects skip, move to next step with empty caption
    if (ctx.callbackQuery && ctx.callbackQuery.data === 'skip') {
      await ctx.answerCbQuery();
      ctx.wizard.state.caption = '';
      
      // Show preview
      await ctx.replyWithPhoto(
        ctx.wizard.state.imageFileId,
        {
          caption: 'No caption',
          reply_markup: getSubmissionKeyboard().reply_markup
        }
      );
      
      await ctx.reply('Is this submission correct?');
      
      return ctx.wizard.next();
    }
    
    // If user wants to add caption
    if (ctx.callbackQuery && ctx.callbackQuery.data === 'add_caption') {
      await ctx.answerCbQuery();
      await ctx.reply('Please send your caption:');
      return;
    }
    
    // If user sent caption text
    if (ctx.message && ctx.message.text) {
      const caption = ctx.message.text;
      
      // Validate caption length
      if (caption.length > 200) {
        await ctx.reply('Caption is too long. Please keep it under 200 characters.');
        return;
      }
      
      ctx.wizard.state.caption = caption;
      
      // Show preview
      await ctx.replyWithPhoto(
        ctx.wizard.state.imageFileId,
        {
          caption: caption,
          reply_markup: getSubmissionKeyboard().reply_markup
        }
      );
      
      await ctx.reply('Is this submission correct?');
      
      return ctx.wizard.next();
    }
    
    // Handle other inputs
    if (!ctx.callbackQuery) {
      await ctx.reply('Please send your caption as text or select skip.');
    }
  },
  // Step 4: Confirm submission
  async (ctx) => {
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
);

module.exports = submissionScene;