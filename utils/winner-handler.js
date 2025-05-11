// utils/winner-handler.js
const Challenge = require('../models/challenge');
const Submission = require('../models/submission');
const logger = require('./logger');

// Helper function to show challenge submissions
async function showChallengeSubmissions(ctx, challengeId) {
  try {
    const challenge = await Challenge.findById(challengeId);
    
    if (!challenge) {
      return ctx.reply('This challenge no longer exists.');
    }
    
    // Security check
    if (challenge.creatorId !== ctx.from.id.toString()) {
      logger.warn('Unauthorized attempt to view submissions', {
        userId: ctx.from.id,
        challengeId,
        creatorId: challenge.creatorId
      });
      return ctx.reply('Only the challenge creator can view these submissions.');
    }
    
    if (challenge.completed) {
      return ctx.reply('This challenge is already completed.');
    }
    
    // Check if challenge has ended
    const now = new Date();
    if (now < challenge.endDate) {
      return ctx.reply(
        `This challenge is still accepting submissions. You can select a winner after it ends on ${challenge.endDate.toLocaleDateString()}.`
      );
    }
    
    // Get all submissions for this challenge
    const submissions = await Submission.find({ challengeId: challenge._id });
    
    if (submissions.length === 0) {
      return ctx.reply('This challenge has no submissions to review.');
    }
    
    // Initialize session storage for message IDs if needed
    if (!ctx.session) ctx.session = {};
    if (!ctx.session.winnerSelectionMessages) ctx.session.winnerSelectionMessages = {};
    ctx.session.winnerSelectionMessages[challengeId.toString()] = [];
    
    // Show the first submission
    const currentIndex = 0;
    const submission = submissions[currentIndex];
    
    await ctx.reply(
      `You are now reviewing submissions for "${challenge.title}"\n` +
      `There are ${submissions.length} submissions in total.\n` +
      `Use the navigation buttons to review all submissions and select a winner.`
    );
    
    const photoMsg = await ctx.replyWithPhoto(
      submission.imageFileId,
      {
        caption: `
Submission ${currentIndex + 1} of ${submissions.length} for "${challenge.title}"
${submission.caption ? `Caption: ${submission.caption}` : 'No caption'}
Submitted by: @${submission.username || `User_${submission.userId}`}
        `,
        reply_markup: {
          inline_keyboard: [
            [
              { text: '⬅️ Previous', callback_data: `show_submission_${challengeId}_${submissions.length - 1}` },
              { text: `${currentIndex + 1}/${submissions.length}`, callback_data: 'count' },
              { text: '➡️ Next', callback_data: `show_submission_${challengeId}_1` }
            ],
            [
              { text: '👑 Select as Winner', callback_data: `admin_select_${submission._id}` }
            ],
            [
              { text: '📤 Share All Submissions to Group', callback_data: `share_all_${challengeId}` }
            ]
          ]
        }
      }
    );
    
    // Store the message ID for later reference
    ctx.session.winnerSelectionMessages[challengeId.toString()].push(photoMsg.message_id);
    
  } catch (error) {
    logger.error('Error showing challenge submissions:', {
      error,
      userId: ctx.from.id,
      challengeId
    });
    await ctx.reply('An error occurred while fetching submissions.');
  }
}

module.exports = {
  showChallengeSubmissions
};