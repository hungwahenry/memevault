// utils/commands/user.js
const { countUniqueVoters } = require('../callbacks');
const { Telegraf } = require('telegraf');
const Challenge = require('../../models/challenge');
const Submission = require('../../models/submission');
const Group = require('../../models/group');
const User = require('../../models/user');
const logger = require('../logger');
const { getTimeLeft } = require('./helpers');

function registerUserCommands(bot) {
  bot.command('start', async (ctx) => {
    if (ctx.chat.type === 'private') {
      // Track user interaction 
      try {
        const User = require('../../models/user');
        await User.findOneAndUpdate(
          { userId: ctx.from.id.toString() },
          { 
            username: ctx.from.username,
            firstName: ctx.from.first_name,
            lastName: ctx.from.last_name,
            languageCode: ctx.from.language_code,
            lastInteraction: new Date(),
            $inc: { interactionCount: 1 },
            $addToSet: { tags: 'onboarded' }
          },
          { upsert: true, new: true }
        );
      } catch (error) {
        logger.warn('Could not track user in start command', { error, userId: ctx.from.id });
        // Continue execution even if tracking fails
      }
      
      // Handle deep linking
      if (ctx.message.text.includes(' ')) {
        const param = ctx.message.text.split(' ')[1];
        
        if (param.startsWith('create_challenge_')) {
          try {
            // Extract group ID and admin ID from the parameter
            const parts = param.split('_');
            if (parts.length < 4) {
              throw new Error('Invalid parameter format');
            }
            
            const groupId = parts[2];
            const adminIdHash = parts[3];
            const userId = ctx.from.id.toString();
            
            // Verify the hash for security
            const expectedHash = require('crypto')
              .createHash('sha256')
              .update(`${groupId}_${userId}_${process.env.LINK_SECRET}`)
              .digest('hex')
              .substring(0, 10);
            
            if (adminIdHash !== expectedHash) {
              logger.warn('Invalid admin hash in deep link', {
                userId,
                groupId,
                providedHash: adminIdHash,
                expectedHash
              });
              
              return ctx.reply(
                '🧐 It looks like you are not an administrator for this group, or the link you clicked is no longer valid. Try using the /challenge command in the group again.'
              );
            }
            
            // Verify this user is still an admin for the group
            const group = await Group.findOne({ groupId });
            if (!group) {
              logger.warn('Group not found for challenge creation', {
                userId,
                groupId
              });
              return ctx.reply('The group for this challenge could not be found. Please make sure the bot is properly set up in your group.');
            }
            
            if (!group.adminIds.includes(userId)) {
              logger.warn('Non-admin tried to create challenge', {
                userId,
                groupId
              });
              return ctx.reply('Only group administrators can create challenges.');
            }
            
            logger.info('Deep link challenge creation starting', {
              userId,
              groupId
            });
            
            // Track admin activity
            try {
              await User.findOneAndUpdate(
                { userId },
                { 
                  $addToSet: { 
                    groups: groupId,
                    tags: ['admin', 'creator']
                  }
                },
                { upsert: true }
              );
            } catch (error) {
              logger.warn('Could not track admin activity', { error });
            }
            
            // Enter challenge scene with group ID in state
            return ctx.scene.enter('challenge_scene', { groupId });
          } catch (error) {
            logger.error('Error processing challenge deep link', {
              error,
              userId: ctx.from.id,
              param
            });
            return ctx.reply('There was an error processing your request. Please go back to your group and try again.');
          }
        } else if (param.startsWith('submit_')) {
          try {
            const challengeId = param.substring(7);

            logger.info('Submission deep link activated', {
                userId: ctx.from.id,
                challengeId
              });
            
            // Verify the challenge exists and is active
            const challenge = await Challenge.findById(challengeId);
            if (!challenge || !challenge.active) {
              return ctx.reply('This challenge is not active or does not exist.');
            }
            
            // Check if submissions are still open
            if (new Date() > challenge.endDate) {
              return ctx.reply('This challenge is no longer accepting submissions.');
            }
            
            // Track participant activity
            try {
              await User.findOneAndUpdate(
                { userId: ctx.from.id.toString() },
                { 
                  $addToSet: { 
                    groups: challenge.groupId,
                    tags: 'participant'
                  }
                },
                { upsert: true }
              );
            } catch (error) {
              logger.warn('Could not track participant activity', { error });
            }
            
            ctx.scene.state = { challengeId };
            return ctx.scene.enter('submission_scene');
          } catch (error) {
            logger.error('Error processing submission deep link', {
              error,
              userId: ctx.from.id,
              param
            });
            return ctx.reply('There was an error processing your submission request. Please try again.');
          }
        } else if (param.startsWith('claim_')) {
          try {
            const submissionId = param.substring(6);

            logger.info('Claim deep link activated', {
                userId: ctx.from.id,
                submissionId
              });
            
            // Verify this is the winner trying to claim
            const submission = await Submission.findById(submissionId)
              .populate('challengeId');
              
            if (!submission) {
              return ctx.reply('This submission does not exist.');
            }
            
            if (submission.userId !== ctx.from.id.toString()) {
              logger.warn('Unauthorized prize claim attempt', {
                userId: ctx.from.id,
                submissionId,
                ownerId: submission.userId
              });
              return ctx.reply('Only the winner can claim this prize.');
            }
            
            if (!submission.challengeId || !submission.challengeId.completed) {
              return ctx.reply('This challenge is not completed yet.');
            }
            
            // Track winner activity
            try {
              await User.findOneAndUpdate(
                { userId: ctx.from.id.toString() },
                { 
                  $inc: { winCount: 1 },
                  $addToSet: { 
                    tags: 'winner',
                    groups: submission.challengeId.groupId
                  },
                  userType: 'winner'
                },
                { upsert: true }
              );
            } catch (error) {
              logger.warn('Could not track winner activity', { error });
            }
            
            if (!ctx.session) ctx.session = {};
            ctx.session.submissionId = submissionId;
    
            return ctx.scene.enter('wallet_scene', { submissionId });
          } catch (error) {
            logger.error('Error processing claim deep link', {
              error,
              userId: ctx.from.id,
              param
            });
            return ctx.reply('There was an error processing your claim request. Please try again.');
          }
        }
      }
      
      // Regular start command
      await ctx.reply(
        'Welcome to MemeVault! 🎭\n\n' +
        'I help crypto communities run meme contests with real prizes.\n\n' +
        'To use me, add me to a group and run the /setup command.'
      );
    }
  });

  bot.command('help', (ctx) => {
    const isGroup = ctx.chat.type === 'group' || ctx.chat.type === 'supergroup';
    const isAdmin = ctx.state.group?.adminIds?.includes(ctx.from.id.toString());
    
    let helpMessage = '🎭 MemeVault Bot Commands:\n\n';
    
    if (isGroup) {
      if (isAdmin) {
        helpMessage += 'Admin Commands:\n';
        helpMessage += '/setup - Set up the bot in this group\n';
        helpMessage += '/challenge - Create a new meme challenge\n\n';
      }
      
      helpMessage += 'Group Commands:\n';
      helpMessage += '/active - Show active challenges in this group\n';
      helpMessage += '/vote - Show challenges in voting phase\n';
    } else {
      helpMessage += 'Add me to a group and use the /setup command to get started!\n\n';
      helpMessage += 'In a group, admins can use:\n';
      helpMessage += '- /setup to configure the bot\n';
      helpMessage += '- /challenge to create meme contests\n';
      helpMessage += '- /winner to select winners (for admin selection challenges)\n\n';
      helpMessage += 'In private chat, admins can use:\n';
      helpMessage += '- /status - Check challenge status\n';
      helpMessage += '- /checkpool - Check and update prize pool amounts\n\n';
      helpMessage += 'Group members can:\n';
      helpMessage += '- Submit memes to active challenges\n';
      helpMessage += '- Vote for their favorite submissions\n';
      helpMessage += '- Win crypto prizes!\n';
    }
    
    helpMessage += '\n/help - Show this help message';
    
    return ctx.reply(helpMessage);
  });
  
  bot.command('vote', async (ctx) => {
    try {
        const groupId = ctx.chat.id.toString();
        const now = new Date();
        const votingChallenges = await Challenge.find({
            groupId,
            active: true,
            completed: false,
            endDate: { $lt: now },
            votingMethod: 'community'
        });
        
        // Track user interaction with voting
        try {
          User.findOneAndUpdate(
            { userId: ctx.from.id.toString() },
            { 
              lastInteraction: new Date(),
              $inc: { interactionCount: 1 },
              $addToSet: { groups: groupId, tags: 'voter' }
            },
            { upsert: true }
          ).exec(); // Use exec() to fire and forget
        } catch (error) {
          // Silently handle errors in user tracking
        }
        
        if (votingChallenges.length === 0) {
            return ctx.reply('There are no challenges currently in the voting phase in this group.');
        }
        
        let message = '🗳️ Challenges In Voting Phase:\n\n';
        for (const challenge of votingChallenges) {
            const submissionCount = await Submission.countDocuments({ challengeId: challenge._id });
            const voteCount = await countUniqueVoters(challenge._id);
            const hoursLeft = Math.round((now - challenge.endDate) / (1000 * 60 * 60));
            const autoFinalizesIn = 24 - hoursLeft;
            message += `${challenge.title}\n`;
            message += `Prize: ${challenge.prizePool} ${challenge.currency}\n`;
            message += `Submissions: ${submissionCount}\n`;
            message += `Votes so far: ${voteCount}\n`;
            if (autoFinalizesIn > 0) {
                message += `Voting closes in: ${autoFinalizesIn} hours\n`;
            } else {
                message += `Voting closes soon\n`;
            }
            message += '\n';
        }
        
        return ctx.reply(message, {
            reply_markup: {
                inline_keyboard: votingChallenges.map(challenge => [
                    { text: `🗳️ Vote for "${challenge.title}"`, callback_data: `start_voting_${challenge._id}` }
                ])
            }
        });
    } catch (error) {
        logger.error('Error in vote command:', {error, groupId: ctx.chat.id});
        return ctx.reply('An error occurred while fetching challenges for voting.');
    }
  });

  bot.command('active', async (ctx) => {
    try {
      const groupId = ctx.chat.id.toString();
      const activeChallenges = await Challenge.find({
        groupId,
        active: true,
        completed: false
      });
      
      // Track user interaction
      try {
        User.findOneAndUpdate(
          { userId: ctx.from.id.toString() },
          { 
            lastInteraction: new Date(),
            $inc: { interactionCount: 1 },
            $addToSet: { groups: groupId }
          },
          { upsert: true }
        ).exec(); // Use exec() to fire and forget
      } catch (error) {
        // Silently handle errors in user tracking
      }
      
      if (activeChallenges.length === 0) {
        const isAdmin = ctx.state.group?.adminIds?.includes(ctx.from.id.toString());
        
        if (isAdmin) {
          return ctx.reply('There are no active challenges in this group. Use /challenge to create one!');
        } else {
          return ctx.reply('There are no active challenges in this group right now.');
        }
      }
      
      let message = '📋 Active Challenges:\n\n';
      
      for (const challenge of activeChallenges) {
        const submissionCount = await Submission.countDocuments({ challengeId: challenge._id });
        const timeLeft = getTimeLeft(challenge.endDate);
        
        message += `${challenge.title}\n`;
        message += `Prize: ${challenge.prizePool} ${challenge.currency}\n`;
        message += `Time left: ${timeLeft}\n`;
        message += `Submissions: ${submissionCount}`;
        
        if (challenge.maxEntries > 0) {
          message += ` / ${challenge.maxEntries}`;
        }
        
        message += '\n\n';
      }
      
      return ctx.reply(message, {
        reply_markup: {
          inline_keyboard: activeChallenges.map(challenge => [
            { text: `📷 Submit to "${challenge.title}"`, callback_data: `submit_${challenge._id}` }
          ])
        }
      });
    } catch (error) {
      logger.error('Error in active command:', {error, groupId: ctx.chat.id});
      return ctx.reply('An error occurred while fetching active challenges.');
    }
  });
}

module.exports = {
  registerUserCommands
};