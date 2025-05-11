// utils/commands/challenge.js
const { Telegraf } = require('telegraf');
const Group = require('../../models/group');
const User = require('../../models/user');
const Challenge = require('../../models/challenge');
const Submission = require('../../models/submission');
const logger = require('../logger');
const { showChallengeSubmissions } = require('../winner-handler');
const walletService = require('../../services/wallet');

function registerChallengeCommands(bot) {
  bot.command('challenge', async (ctx) => {
    if (ctx.chat.type === 'private') {
      return ctx.reply('This command can only be used in a group.');
    } else {
      try {
        // Check if the bot is set up for this group
        const groupId = ctx.chat.id.toString();
        const group = await Group.findOne({ groupId, setupComplete: true });
        
        if (!group) {
          return ctx.reply('Please set up the bot first using the /setup command.');
        }
        
        // Check if user is an admin
        const userId = ctx.from.id.toString();
        if (!group.adminIds.includes(userId)) {
          const chatMember = await ctx.telegram.getChatMember(groupId, userId);
          
          if (!['creator', 'administrator'].includes(chatMember.status)) {
            return ctx.reply('Only group administrators can create challenges.');
          }
          
          // If they're a Telegram admin but not in our DB, add them
          group.adminIds.push(userId);
          await group.save();
          
          // Track new admin
          try {
            await User.findOneAndUpdate(
              { userId },
              { 
                $addToSet: { 
                  groups: groupId,
                  tags: ['admin']
                }
              },
              { upsert: true }
            );
          } catch (error) {
            logger.warn('Could not track new admin', { error });
          }
          
          logger.info('Added Telegram admin to group admins', {
            userId,
            groupId
          });
        }
        
        // Generate a secure hash for the deep link
        const adminIdHash = require('crypto')
          .createHash('sha256')
          .update(`${groupId}_${userId}_${process.env.LINK_SECRET}`)
          .digest('hex')
          .substring(0, 10);
        
        logger.info('Challenge creation initiated from group', {
          userId,
          groupId
        });
        
        // Start the challenge creation process in private chat with secure deep link
        return ctx.reply(
          'Let\'s create a new challenge! Click the button below to start:',
          {
            reply_markup: {
              inline_keyboard: [
                [{ text: '🎭 Create Challenge', url: `https://t.me/${ctx.botInfo.username}?start=create_challenge_${groupId}_${adminIdHash}` }]
              ]
            }
          }
        );
      } catch (error) {
        logger.error('Error handling challenge command', {
          error,
          userId: ctx.from.id,
          groupId: ctx.chat.id
        });
        return ctx.reply('An error occurred. Please try again later.');
      }
    }
  });

  bot.command('checkpool', async (ctx) => {
    try {
      // Only work in private chats
      if (ctx.chat.type !== 'private') {
        return ctx.reply('This command can only be used in a private chat with the bot.');
      }
      
      const userId = ctx.from.id.toString();
      
      // Find challenges created by this user
      const challenges = await Challenge.find({
        creatorId: userId,
        active: false,
        completed: false
      });
      
      if (challenges.length === 0) {
        return ctx.reply('You have no pending challenges that need funding.');
      }
      
      // Show list of challenges with their current funding status
      let message = '💰 Challenge Prize Pools:\n\n';
      let inlineKeyboard = [];
      
      for (const challenge of challenges) {
        // Get current balance
        const balance = await walletService.checkBalance(
          challenge.currency, 
          challenge.trackId || challenge.walletAddress
        );
        
        const status = parseFloat(balance) >= parseFloat(challenge.prizePool) 
          ? '✅ Funded' 
          : '⏳ Waiting for funds';
        
        message += `"${challenge.title}"\n`;
        message += `Current balance: ${balance} ${challenge.currency}\n`;
        message += `Required amount: ${challenge.prizePool} ${challenge.currency}\n`;
        message += `Status: ${status}\n\n`;
        
        inlineKeyboard.push([{ 
          text: `Update prize pool for "${challenge.title}"`, 
          callback_data: `update_pool_${challenge._id}` 
        }]);
      }
      
      return ctx.reply(message, {
        reply_markup: {
          inline_keyboard: inlineKeyboard
        }
      });
    } catch (error) {
      logger.error('Error in checkpool command:', {error, userId: ctx.from.id});
      return ctx.reply('An error occurred while checking your challenge prize pools.');
    }
  });
  
  bot.command('winner', async (ctx) => {
    try {
        if (ctx.chat.type !== 'private') {
            return ctx.reply('This command can only be used in a private chat with the bot.');
        }
        const userId = ctx.from.id.toString();
        // Find all groups where this user is an admin
        const adminGroups = await Group.find({
            adminIds: userId
        });
        if (adminGroups.length === 0) {
            return ctx.reply('You are not an admin of any groups with MemrrBot.');
        }
        // Get all groups IDs where the user is admin
        const groupIds = adminGroups.map(group => group.groupId);
        // Find challenges that have ended but aren't completed where this user is the creator
        const now = new Date();
        const selectableChallenges = await Challenge.find({
            groupId: { $in: groupIds },
            active: true,
            completed: false,
            endDate: { $lt: now },
            votingMethod: 'admin',
            creatorId: userId
        });
        if (selectableChallenges.length === 0) {
            return ctx.reply('You have no challenges that are ready for winner selection.');
        }
        // If there's only one challenge, go directly to submissions
        if (selectableChallenges.length === 1) {
            const challenge = selectableChallenges[0];
            return showChallengeSubmissions(ctx, challenge._id);
        }
        // Otherwise, show a list of challenges to choose from
        let message = '🏆 Select a challenge to pick a winner:\n\n';
        
        let inlineKeyboard = [];
        for (const challenge of selectableChallenges) {
            const submissionCount = await Submission.countDocuments({ challengeId: challenge._id });
            const group = adminGroups.find(g => g.groupId === challenge.groupId);
            
            message += `"${challenge.title}" in ${group?.title || 'Unknown Group'}\n`;
            message += `Submissions: ${submissionCount}\n`;
            message += `Ended: ${challenge.endDate.toLocaleDateString()}\n\n`;
            
            inlineKeyboard.push([{ 
                text: `Select winner for "${challenge.title}"`, 
                callback_data: `select_winner_${challenge._id}` 
            }]);
        }
        
        return ctx.reply(message, {
            reply_markup: {
                inline_keyboard: inlineKeyboard
            }
        });
    } catch (error) {
        logger.error('Error in winner command:', {error, userId: ctx.from.id});
        return ctx.reply('An error occurred while fetching challenges.');
    }
  });
}

module.exports = {
  registerChallengeCommands
};