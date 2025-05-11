// utils/callbacks/voting.js
const Challenge = require('../../models/challenge');
const Submission = require('../../models/submission');
const User = require('../../models/user');
const redisClient = require('../../services/redis');
const { getVotingKeyboard } = require('../keyboards');
const { finalizeChallenge } = require('../challenges');
const { countUniqueVoters, countEligibleVoters } = require('./helpers');
const logger = require('../logger');

module.exports = function(bot) {
  // Handle navigation between submissions during voting
  bot.action(/prev_(\d+)/, async (ctx) => {
    const currentIndex = parseInt(ctx.match[1]);
    const userId = ctx.from.id.toString();
    
    try {
      // Try Redis first, fall back to session if Redis fails
      let voteData;
      try {
        const redisData = await redisClient.get(`vote:${userId}`);
        if (redisData) {
          voteData = JSON.parse(redisData);
        }
      } catch (redisError) {
        logger.warn('Redis error when retrieving vote data', { error: redisError });
      }
      
      // If Redis failed, try session storage
      if (!voteData && ctx.session?.voteData) {
        voteData = ctx.session.voteData;
      }
      
      if (!voteData) {
        await ctx.answerCbQuery('Voting session expired. Please start again.');
        return;
      }
      
      const { challengeId, submissions } = voteData;
      
      // Validate the challenge is still in voting phase
      const challenge = await Challenge.findById(challengeId);
      if (!challenge || challenge.completed) {
        await ctx.answerCbQuery('This challenge is completed or no longer exists.');
        return;
      }
      
      const newIndex = currentIndex > 0 ? currentIndex - 1 : submissions.length - 1;
      const submission = submissions[newIndex];
      
      await ctx.answerCbQuery();
      
      // Show previous submission
      await ctx.editMessageMedia(
        {
          type: 'photo',
          media: submission.imageFileId,
          caption: `${submission.caption || 'No caption'}\n\n${newIndex + 1}/${submissions.length}`
        },
        getVotingKeyboard(submissions, newIndex)
      );
    } catch (error) {
      logger.error('Error navigating to previous submission:', {error, userId});
      await ctx.answerCbQuery('An error occurred.');
    }
  });
  
  bot.action(/next_(\d+)/, async (ctx) => {
    const currentIndex = parseInt(ctx.match[1]);
    const userId = ctx.from.id.toString();
    
    try {
      // Try Redis first, fall back to session if Redis fails
      let voteData;
      try {
        const redisData = await redisClient.get(`vote:${userId}`);
        if (redisData) {
          voteData = JSON.parse(redisData);
        }
      } catch (redisError) {
        logger.warn('Redis error when retrieving vote data', { error: redisError });
      }
      
      // If Redis failed, try session storage
      if (!voteData && ctx.session?.voteData) {
        voteData = ctx.session.voteData;
      }
      
      if (!voteData) {
        await ctx.answerCbQuery('Voting session expired. Please start again.');
        return;
      }
      
      const { challengeId, submissions } = voteData;
      
      // Validate the challenge is still in voting phase
      const challenge = await Challenge.findById(challengeId);
      if (!challenge || challenge.completed) {
        await ctx.answerCbQuery('This challenge is completed or no longer exists.');
        return;
      }
      
      const newIndex = (currentIndex + 1) % submissions.length;
      const submission = submissions[newIndex];
      
      await ctx.answerCbQuery();
      
      // Show next submission
      await ctx.editMessageMedia(
        {
          type: 'photo',
          media: submission.imageFileId,
          caption: `${submission.caption || 'No caption'}\n\n${newIndex + 1}/${submissions.length}`
        },
        getVotingKeyboard(submissions, newIndex)
      );
    } catch (error) {
      logger.error('Error navigating to next submission:', {error, userId});
      await ctx.answerCbQuery('An error occurred.');
    }
  });
  
  // Handle vote confirmation
  bot.action('vote_confirmed', async (ctx) => {
    await ctx.answerCbQuery('Your vote has been recorded!');
  });
  
  // Handle voting
  bot.action(/vote_(.+)/, async (ctx) => {
    const submissionId = ctx.match[1];
    const userId = ctx.from.id.toString();
    
    try {
      // Get submission and check if challenge is in voting phase
      const submission = await Submission.findById(submissionId);
      if (!submission) {
        await ctx.answerCbQuery('This submission no longer exists.');
        return;
      }
      
      const challenge = await Challenge.findById(submission.challengeId);
      if (!challenge) {
        await ctx.answerCbQuery('This challenge no longer exists.');
        return;
      }
      
      // Check if challenge is in voting phase
      const now = new Date();
      if (now < challenge.endDate) {
        await ctx.answerCbQuery('Voting has not started yet. Submissions are still open.', {show_alert: true});
        return;
      }
      
      if (challenge.completed) {
        await ctx.answerCbQuery('This challenge is already completed.', {show_alert: true});
        return;
      }
      
      // Check if the user is the submission owner (can't vote for your own)
      if (submission.userId === userId) {
        await ctx.answerCbQuery('You cannot vote for your own submission.', {show_alert: true});
        return;
      }
      
      // Check if user already voted
      if (submission.voters.includes(userId)) {
        await ctx.answerCbQuery('You have already voted for this submission.', {show_alert: true});
        return;
      }
      
      // Check if user voted for another submission in this challenge
      const existingVote = await Submission.findOne({
        challengeId: challenge._id,
        voters: userId
      });
      
      if (existingVote) {
        await ctx.answerCbQuery('You have already voted for another submission in this challenge.', {show_alert: true});
        return;
      }
      
      // Check if user is eligible to vote (must be a member of the group)
      try {
        const chatMember = await ctx.telegram.getChatMember(challenge.groupId, userId);
        if (!['creator', 'administrator', 'member'].includes(chatMember.status)) {
          await ctx.answerCbQuery('You must be a member of the group to vote.', {show_alert: true});
          return;
        }
      } catch (error) {
        logger.error('Error checking group membership for voting:', {
          error,
          userId,
          groupId: challenge.groupId
        });
        // Fail open for now, but log the error
      }
      
      // Add confirmation dialog
      await ctx.answerCbQuery('Confirm your vote for this submission?', {show_alert: true});
      
      // Record vote
      submission.votes += 1;
      submission.voters.push(userId);
      await submission.save();

      // Track vote in user profile
      try {
        await User.findOneAndUpdate(
          { userId: ctx.from.id.toString() },
          { 
            $inc: { totalVotesCast: 1 },
            $addToSet: { 
              tags: 'voter',
              groups: challenge.groupId
            }
          },
          { upsert: true }
        );
      } catch (userError) {
        logger.warn('Error updating user vote stats', { error: userError, userId });
        // Continue even if user tracking fails
      }
      
      // Replace voting button with confirmation
      try {
        await ctx.editMessageReplyMarkup({
          inline_keyboard: [
            [{ text: '✅ Vote Recorded', callback_data: 'vote_confirmed' }],
            [{ text: 'Back to Group', url: `https://t.me/c/${challenge.groupId.replace('-100', '')}` }]
          ]
        });
      } catch (editError) {
        logger.warn('Could not update vote button', { error: editError });
      }
      
      // Show vote confirmation
      await ctx.reply(`✅ Vote recorded for this submission! Total votes: ${submission.votes}`);
      
      // Check if this was the last voter
      const totalVoters = await countUniqueVoters(challenge._id);
      const totalPossibleVoters = await countEligibleVoters(challenge.groupId);
      
      // Dynamic threshold based on group size
      const groupSize = totalPossibleVoters;
      const thresholdPercentage = groupSize > 100 ? 0.3 : groupSize > 50 ? 0.4 : 0.5;
      
      // If threshold of possible voters have voted, or 24 hours have passed since challenge ended
      const hoursAfterEnd = (now - challenge.endDate) / (1000 * 60 * 60);
      
      if (totalVoters > totalPossibleVoters * thresholdPercentage || hoursAfterEnd > 24) {
        try {
          await finalizeChallenge(challenge._id);
        } catch (finalizeError) {
          logger.error('Error finalizing challenge after vote', { 
            error: finalizeError, 
            challengeId: challenge._id.toString() 
          });
        }
      }
    } catch (error) {
      logger.error('Error processing vote:', {error, userId, submissionId});
      await ctx.answerCbQuery('An error occurred while processing your vote.');
    }
  });
  
  // Start voting
  bot.action(/start_voting_(.+)/, async (ctx) => {
    const challengeId = ctx.match[1];
    const userId = ctx.from.id.toString();
    
    try {
      // Check if challenge exists and is in voting phase
      const challenge = await Challenge.findById(challengeId);
      
      if (!challenge) {
        await ctx.answerCbQuery('This challenge no longer exists.', {show_alert: true});
        return;
      }
      
      if (challenge.completed) {
        await ctx.answerCbQuery('This challenge is already completed.', {show_alert: true});
        return;
      }
      
      const now = new Date();
      if (now < challenge.endDate) {
        await ctx.answerCbQuery('Voting has not started yet. Submissions are still open.', {show_alert: true});
        return;
      }
      
      // Check if this is an admin selection challenge
      if (challenge.votingMethod === 'admin') {
        await ctx.answerCbQuery('This challenge uses admin selection, not community voting.', {show_alert: true});
        return;
      }
      
      // Check if there are any submissions
      const submissionsCount = await Submission.countDocuments({ challengeId: challenge._id });
      
      if (submissionsCount === 0) {
        await ctx.answerCbQuery('There are no submissions to vote on.', {show_alert: true});
        return;
      }
      
      // Check if user has already voted
      const existingVote = await Submission.findOne({
        challengeId: challenge._id,
        voters: userId
      });
      
      if (existingVote) {
        await ctx.answerCbQuery('You have already voted in this challenge.', {show_alert: true});
        return;
      }
      
      // Start voting session
      await ctx.answerCbQuery();
      
      // Get submissions and shuffle them for randomized order
      const submissions = await Submission.find({ challengeId: challenge._id });
      const shuffledSubmissions = [...submissions].sort(() => 0.5 - Math.random());
      
      // Store submission data in Redis for this voting session with longer expiry
      try {
        await redisClient.set(
          `vote:${userId}`,
          JSON.stringify({
            challengeId: challenge._id.toString(),
            submissions: shuffledSubmissions
          }),
          'EX',
          7200 // Expire after 2 hours instead of 1
        );
      } catch (redisError) {
        logger.warn('Redis error during voting session creation', { error: redisError });
        // Fallback to storing in session if Redis fails
        if (ctx.session) {
          ctx.session.voteData = { 
            challengeId: challenge._id.toString(), 
            submissions: shuffledSubmissions 
          };
        }
      }
      
      // Show intro message with submission count
      const introMsg = await ctx.reply(
        `🗳️ *Voting for "${challenge.title}"*\n\n` +
        `Please review all ${submissions.length} submissions and vote for your favorite meme.\n\n` +
        `• Navigate using the Previous/Next buttons\n` +
        `• You can vote for only one submission\n` +
        `• Your vote helps determine the winner\n\n` +
        `Current prize pool: ${challenge.prizePool} ${challenge.currency}`,
        { parse_mode: 'Markdown' }
      );
      
      // Show first submission
      const firstSubmission = shuffledSubmissions[0];
      
      await ctx.replyWithPhoto(
        firstSubmission.imageFileId,
        {
          caption: `${firstSubmission.caption || 'No caption'}\n\n1/${shuffledSubmissions.length}`,
          reply_markup: getVotingKeyboard(shuffledSubmissions, 0).reply_markup
        }
      );
    } catch (error) {
      logger.error('Error starting voting:', {
        error,
        userId,
        challengeId
      });
      await ctx.answerCbQuery('An error occurred. Please try again.');
    }
  });
};