// scenes/submission/validation.js
const Challenge = require('../../models/challenge');
const Submission = require('../../models/submission');
const Group = require('../../models/group');
const logger = require('../../utils/logger');

async function validateSubmission(ctx) {
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
}

module.exports = {
  validateSubmission
};