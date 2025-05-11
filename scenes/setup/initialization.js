// scenes/setup/initialization.js
const Group = require('../../models/group');
const User = require('../../models/user');
const { getAdminKeyboard } = require('../../utils/keyboards');
const logger = require('../../utils/logger');

async function startSetup(ctx) {
  // Verify we're in a group
  if (!ctx.chat || (ctx.chat.type !== 'group' && ctx.chat.type !== 'supergroup')) {
    await ctx.reply('This command can only be used in a group.');
    return ctx.scene.leave();
  }

  const groupId = ctx.chat.id.toString();
  const adminId = ctx.from.id.toString();
  
  // Check if the user is an admin in the group
  try {
    const chatMember = await ctx.telegram.getChatMember(groupId, adminId);
    if (!['creator', 'administrator'].includes(chatMember.status)) {
      await ctx.reply('Only group administrators can set up the bot.');
      return ctx.scene.leave();
    }
    
    // Check if the bot is already set up
    let group = await Group.findOne({ groupId });
    
    if (group && group.setupComplete) {
      await ctx.reply('The bot is already set up in this group.');
      return ctx.scene.leave();
    }
    
    // Show progress message
    const progressMsg = await ctx.reply('🔄 Setting up MemrrBot...');
    
    if (!group) {
      group = new Group({
        groupId,
        title: ctx.chat.title,
        adminIds: [adminId],
        setupComplete: false
      });
      await group.save();
      logger.info('New group created', {groupId, adminId});
    } else if (!group.adminIds.includes(adminId)) {
      group.adminIds.push(adminId);
      await group.save();
      logger.info('Admin added to group', {groupId, adminId});
    }
    
    // Track admin activity
    try {
      await User.findOneAndUpdate(
        { userId: adminId },
        { 
          username: ctx.from.username,
          firstName: ctx.from.first_name,
          lastName: ctx.from.last_name,
          $addToSet: { 
            groups: groupId,
            tags: ['admin', 'group_admin'] 
          },
          userType: 'admin'
        },
        { upsert: true }
      );
    } catch (error) {
      logger.warn('Could not track admin in setup', { error });
    }
    
    // Delete progress message and show welcome
    try {
      await ctx.deleteMessage(progressMsg.message_id);
    } catch (error) {
      logger.warn('Could not delete progress message', { error });
    }
    
    await ctx.reply(
      '🎭 *Welcome to MemrrBot!* 🎭\n\n' +
      'This bot will help you organize meme contests in your group with crypto prizes.\n\n' +
      'Would you like to add more admins who can create challenges?',
      {
        parse_mode: 'Markdown',
        ...getAdminKeyboard()
      }
    );
    
    ctx.wizard.state.groupData = {
      groupId,
      mainAdmin: adminId
    };
    
    return ctx.wizard.next();
  } catch (error) {
    logger.error('Error in setup step 1:', {error, groupId, adminId});
    await ctx.reply('An error occurred during setup. Please try again later.');
    return ctx.scene.leave();
  }
}

module.exports = {
  startSetup
};