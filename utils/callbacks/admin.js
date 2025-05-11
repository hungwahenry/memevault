// utils/callbacks/admin.js
const Challenge = require('../../models/challenge');
const Submission = require('../../models/submission');
const User = require('../../models/user');
const { announceWinner } = require('../challenges');
const logger = require('../logger');

module.exports = function(bot) {
  // Handle select_winner callback
  bot.action(/select_winner_(.+)/, async (ctx) => {
    const challengeId = ctx.match[1];
    await ctx.answerCbQuery();

    try {
      const { showChallengeSubmissions } = require('../winner-handler');
      await showChallengeSubmissions(ctx, challengeId);
    } catch (error) {
      logger.error('Error handling select_winner callback:', {
        error,
        userId: ctx.from.id,
        challengeId
      });
      await ctx.reply('An error occurred. Please try again.');
    }
  });

  // Handle show_submission callback
  bot.action(/show_submission_(.+)_(\d+)/, async (ctx) => {
    try {
      const challengeId = ctx.match[1];
      const index = parseInt(ctx.match[2]);
      await ctx.answerCbQuery();

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

      // Get all submissions for this challenge
      const submissions = await Submission.find({ challengeId: challenge._id });

      if (submissions.length === 0) {
        return ctx.reply('This challenge has no submissions.');
      }

      // Ensure index is within bounds
      const currentIndex = (index + submissions.length) % submissions.length;
      const submission = submissions[currentIndex];

      // Send the submission
      await ctx.editMessageMedia(
        {
          type: 'photo',
          media: submission.imageFileId,
          caption: `
Submission ${currentIndex + 1} of ${submissions.length} for "${challenge.title}"
${submission.caption ? `Caption: ${submission.caption}` : 'No caption'}
Submitted by: @${submission.username || `User_${submission.userId}`}
          `
        },
        {
          reply_markup: {
            inline_keyboard: [
              [
                { text: '⬅️ Previous', callback_data: `show_submission_${challengeId}_${currentIndex - 1}` },
                { text: `${currentIndex + 1}/${submissions.length}`, callback_data: 'count' },
                { text: '➡️ Next', callback_data: `show_submission_${challengeId}_${currentIndex + 1}` }
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
    } catch (error) {
      logger.error('Error showing submission:', {
        error,
        userId: ctx.from.id,
        match: ctx.match
      });
      await ctx.reply('An error occurred while showing the submission.');
    }
  });

  // Admin selects winner callback
  bot.action(/admin_select_(.+)/, async (ctx) => {
      const selectedSubmissionId = ctx.match[1];
      await ctx.answerCbQuery('Processing your winner selection...');
      
      try {
        // Fetch the selected submission
        const selectedSubmission = await Submission.findById(selectedSubmissionId);
        
        if (!selectedSubmission) {
          await ctx.answerCbQuery('This submission no longer exists.', {show_alert: true});
          return;
        }
        
        // Check if the challenge is still active
        const challenge = await Challenge.findById(selectedSubmission.challengeId);
        
        if (!challenge) {
          await ctx.answerCbQuery('This challenge no longer exists.', {show_alert: true});
          return;
        }
        
        // Validate the user is the challenge creator/admin
        if (challenge.creatorId !== ctx.from.id.toString()) {
          logger.warn('Unauthorized admin selection attempt', {
            userId: ctx.from.id,
            challengeId: challenge._id.toString(),
            creatorId: challenge.creatorId
          });
          await ctx.answerCbQuery('Only the challenge creator can select the winner.', {show_alert: true});
          return;
        }
        
        if (challenge.completed) {
          await ctx.answerCbQuery('This challenge is already completed.', {show_alert: true});
          return;
        }
        
        // Verify submissions period has ended
        const now = new Date();
        if (now < challenge.endDate) {
          await ctx.answerCbQuery('The submission period for this challenge has not ended yet.', {show_alert: true});
          return;
        }
        
        // Disable all winner selection buttons in the message
        try {
          await ctx.editMessageReplyMarkup({
            inline_keyboard: [
              [{ text: `✅ Selected as Winner`, callback_data: `winner_selected` }]
            ]
          });
        } catch (editError) {
          logger.warn('Could not update winner selection button', { editError });
        }
        
        // Show processing message
        const processingMsg = await ctx.reply('⏳ Processing winner selection...');
        
        // Mark the challenge as completed and set the winner
        challenge.completed = true;
        challenge.winner = selectedSubmission._id;
        await challenge.save();
        
        await User.findOneAndUpdate(
          { userId: selectedSubmission.userId },
          { $inc: { winCount: 1 }, $addToSet: { tags: 'winner' } }
        );
        
        // Update the processing message to show confirmation
        try {
          await ctx.telegram.editMessageText(
            ctx.chat.id,
            processingMsg.message_id,
            undefined,
            `✅ Winner selection processed.\n\nAnnouncing the winner for "${challenge.title}" in the group chat...`
          );
        } catch (editError) {
          logger.warn('Could not update processing message', { editError });
        }
        
        // Announce winner
        await announceWinner(selectedSubmission._id);
        
        logger.info('Admin selected winner', {
          challengeId: challenge._id.toString(),
          submissionId: selectedSubmission._id.toString(),
          adminId: ctx.from.id
        });
        
        // Update all the other message keyboards to show the winner was selected
        try {
          const messageIds = ctx.session?.winnerSelectionMessages?.[challenge._id.toString()] || [];
          for (const messageId of messageIds) {
            if (messageId !== ctx.callbackQuery.message.message_id) {
              try {
                await ctx.telegram.editMessageReplyMarkup(
                  ctx.chat.id,
                  messageId,
                  undefined,
                  {
                    inline_keyboard: [
                      [{ text: '👑 Winner Already Selected', callback_data: 'winner_already_selected' }]
                    ]
                  }
                );
              } catch (error) {
                // Ignore errors, as some messages might not exist anymore
                logger.warn('Could not update keyboard for message', {
                  messageId,
                  error
                });
              }
            }
          }
        } catch (error) {
          logger.warn('Error updating other submission keyboards', { error });
        }
        
        // Final confirmation message
        await ctx.reply(
          `🏆 Success! You have selected a winner for "${challenge.title}".\n\n` +
          `The winner has been notified and the result has been announced in the group.`
        );
        
        // Clear the session data for this challenge
        if (ctx.session?.winnerSelectionMessages) {
          delete ctx.session.winnerSelectionMessages[challenge._id.toString()];
        }
        
      } catch (error) {
        logger.error('Error processing admin selection', {
          error,
          submissionId: selectedSubmissionId,
          userId: ctx.from.id
        });
        await ctx.reply('An error occurred while processing your selection. Please try again later.');
      }
    });
    
    // Handler for already selected winner button
    bot.action('winner_already_selected', async (ctx) => {
      await ctx.answerCbQuery('A winner has already been selected for this challenge.', {show_alert: true});
    });
    
    // Handler for winner selected button
    bot.action('winner_selected', async (ctx) => {
      await ctx.answerCbQuery('You have already selected this submission as the winner.', {show_alert: true});
    });

  // Cancel challenge
  bot.action(/cancel_challenge_(.+)/, async (ctx) => {
    const challengeId = ctx.match[1];

    try {
      // Verify challenge exists and user is the creator
      const challenge = await Challenge.findById(challengeId);

      if (!challenge) {
        await ctx.answerCbQuery('This challenge no longer exists.', {show_alert: true});
        return;
      }

      if (challenge.creatorId !== ctx.from.id.toString()) {
        logger.warn('Unauthorized challenge cancellation attempt', {
          userId: ctx.from.id,
          challengeId,
          creatorId: challenge.creatorId
        });
        await ctx.answerCbQuery('Only the challenge creator can cancel the challenge.', {show_alert: true});
        return;
      }

      // Can only cancel if not active and not funded
      if (challenge.active) {
        await ctx.answerCbQuery('Cannot cancel: Challenge is already active.', {show_alert: true});
        return;
      }

      if (challenge.funded) {
        await ctx.answerCbQuery('Cannot cancel: Challenge is already funded.', {show_alert: true});
        return;
      }

      // Delete the challenge
      await Challenge.findByIdAndDelete(challengeId);

      await ctx.answerCbQuery('Challenge cancelled successfully.');

      await ctx.reply('The challenge has been cancelled.');

      logger.info('Challenge cancelled', {
        challengeId,
        userId: ctx.from.id
      });
    } catch (error) {
      logger.error('Error cancelling challenge:', {
        error,
        userId: ctx.from.id,
        challengeId
      });
      await ctx.answerCbQuery('An error occurred. Please try again.');
    }
  });
};