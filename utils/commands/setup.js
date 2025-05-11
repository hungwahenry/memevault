// utils/commands/setup.js
const { Telegraf } = require('telegraf');
const Group = require('../../models/group');
const User = require('../../models/user');
const Challenge = require('../../models/challenge');
const Submission = require('../../models/submission');
const logger = require('../logger');
const mongoose = require('mongoose');

function registerSetupCommands(bot) {
  // Admin command to check status of challenges
  bot.command('status', async (ctx) => {
    try {
      // Only work in private chats for admins
      if (ctx.chat.type !== 'private') {
        return;
      }
      
      const userId = ctx.from.id.toString();
      
      // Find groups where this user is admin
      const adminGroups = await Group.find({
        adminIds: userId
      });
      
      if (adminGroups.length === 0) {
        return ctx.reply('You are not an admin of any groups with MemeVault.');
      }
      
      // Get all groups IDs where the user is admin
      const groupIds = adminGroups.map(group => group.groupId);
      
      // Find pending and active challenges for these groups
      const pendingChallenges = await Challenge.find({
        groupId: { $in: groupIds },
        funded: false,
        active: false,
        completed: false
      });
      
      const activeChallenges = await Challenge.find({
        groupId: { $in: groupIds },
        active: true,
        completed: false
      });
      
      const completedChallenges = await Challenge.find({
        groupId: { $in: groupIds },
        completed: true
      }).sort({ updatedAt: -1 }).limit(5);
      
      let message = '📊 Challenge Status Report:\n\n';
      
      if (pendingChallenges.length > 0) {
        message += '⏳ Pending Challenges (waiting for funding):\n';
        for (const challenge of pendingChallenges) {
          const group = adminGroups.find(g => g.groupId === challenge.groupId);
          message += `- "${challenge.title}" in ${group?.title || 'Unknown Group'}\n`;
        }
        message += '\n';
      }
      
      if (activeChallenges.length > 0) {
        message += '🔵 Active Challenges:\n';
        for (const challenge of activeChallenges) {
          const group = adminGroups.find(g => g.groupId === challenge.groupId);
          const timeLeft = require('./helpers').getTimeLeft(challenge.endDate);
          const submissionCount = await Submission.countDocuments({ challengeId: challenge._id });
          
          message += `- "${challenge.title}" in ${group?.title || 'Unknown Group'}\n`;
          message += `  ${submissionCount} submissions | ${timeLeft} left\n`;
        }
        message += '\n';
      }
      
      if (completedChallenges.length > 0) {
        message += '✅ Recently Completed Challenges:\n';
        for (const challenge of completedChallenges) {
          const group = adminGroups.find(g => g.groupId === challenge.groupId);
          message += `- "${challenge.title}" in ${group?.title || 'Unknown Group'}\n`;
        }
      }
      
      if (pendingChallenges.length === 0 && activeChallenges.length === 0 && completedChallenges.length === 0) {
        message += 'You have no challenges yet. Use /challenge in a group to create one!';
      }
      
      return ctx.reply(message);
    } catch (error) {
      logger.error('Error in status command:', {error, userId: ctx.from.id});
      return ctx.reply('An error occurred while fetching challenge status.');
    }
  });
  
  // Bot owner stats command
  bot.command('stats', async (ctx) => {
    // Only allow bot owner
    if (ctx.from.id.toString() !== process.env.BOT_OWNER_ID) {
      return;
    }
    
    try {
      const totalGroups = await Group.countDocuments();
      const totalChallenges = await Challenge.countDocuments();
      const activeChallenges = await Challenge.countDocuments({ active: true, completed: false });
      const completedChallenges = await Challenge.countDocuments({ completed: true });
      const totalSubmissions = await Submission.countDocuments();
      
      // User stats if we're tracking them
      let userStats = '';
      if (mongoose.models.User) {
        const totalUsers = await User.countDocuments();
        const activeUsers = await User.countDocuments({ 
          lastInteraction: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
        });
        const adminUsers = await User.countDocuments({ tags: 'admin' });
        const winnerUsers = await User.countDocuments({ tags: 'winner' });
        
        userStats = `\nUsers: ${totalUsers}\n` +
                   `- Active (30d): ${activeUsers}\n` +
                   `- Admins: ${adminUsers}\n` +
                   `- Winners: ${winnerUsers}\n`;
      }
      
      const stats = `📊 Bot Statistics\n\n` +
                   `Groups: ${totalGroups}\n` +
                   `Challenges: ${totalChallenges}\n` +
                   `- Active: ${activeChallenges}\n` +
                   `- Completed: ${completedChallenges}\n` +
                   `Submissions: ${totalSubmissions}` +
                   userStats;
      
      return ctx.reply(stats);
    } catch (error) {
      logger.error('Error in stats command:', {error, userId: ctx.from.id});
      return ctx.reply('An error occurred while fetching statistics.');
    }
  });
  
  bot.command('setup', async (ctx) => {
    if (ctx.chat.type === 'group' || ctx.chat.type === 'supergroup') {
      try {
        // Check if user is an admin
        const chatMember = await ctx.telegram.getChatMember(ctx.chat.id, ctx.from.id);
        if (!['creator', 'administrator'].includes(chatMember.status)) {
          return ctx.reply('Only group administrators can set up the bot.');
        }
        
        // Track group admin
        try {
          await User.findOneAndUpdate(
            { userId: ctx.from.id.toString() },
            { 
              $addToSet: { 
                groups: ctx.chat.id.toString(),
                tags: ['admin']
              }
            },
            { upsert: true }
          );
        } catch (error) {
          logger.warn('Could not track admin in setup', { error });
        }
        
        return ctx.scene.enter('setup_scene');
      } catch (error) {
        logger.error('Error checking admin status for setup', {
          error,
          userId: ctx.from.id,
          groupId: ctx.chat.id
        });
        return ctx.reply('An error occurred. Please try again later.');
      }
    } else {
      return ctx.reply('This command can only be used in a group.');
    }
  });
}

module.exports = {
  registerSetupCommands
};