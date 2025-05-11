// scenes/setup/completion.js
const Group = require('../../models/group');
const User = require('../../models/user');
const logger = require('../../utils/logger');

async function completeSetup(ctx, withAdditionalAdmins) {
  const { groupId } = ctx.wizard.state.groupData;
  
  try {
    // Show progress message
    const progressMsg = await ctx.reply('🔄 Completing setup...');
    
    const group = await Group.findOne({ groupId });
    if (!group) {
      logger.error('Group not found during setup completion', {groupId});
      await ctx.reply('An error occurred. Please try again.');
      return ctx.scene.leave();
    }
    
    group.setupComplete = true;
    await group.save();
    
    // Update all admins in user database
    try {
      for (const adminId of group.adminIds) {
        await User.findOneAndUpdate(
          { userId: adminId },
          { 
            $addToSet: { 
              groups: groupId,
              tags: ['admin', 'group_admin'] 
            },
            userType: 'admin'
          },
          { upsert: true }
        );
      }
    } catch (error) {
      logger.warn('Error updating admin users', { error });
    }
    
    logger.info(`Setup completed ${withAdditionalAdmins ? 'with' : 'without'} additional admins`, {
      groupId, 
      adminCount: group.adminIds.length
    });
    
    // Delete progress message
    try {
      await ctx.deleteMessage(progressMsg.message_id);
    } catch (error) {
      logger.warn('Could not delete progress message', { error });
    }
    
    let adminMessage = withAdditionalAdmins 
      ? `${group.adminIds.length} ${group.adminIds.length === 1 ? 'admin has' : 'admins have'} been configured.\n\n`
      : '';
    
    // Final confirmation with admin count
    await ctx.reply(
      `✅ *Setup Complete!*\n\n` +
      adminMessage +
      'You can now create challenges in this group using:\n' +
      '• /challenge - Create a new meme challenge\n' +
      '• /active - View active challenges\n' +
      '• /vote - See challenges in voting phase\n\n' +
      'Create your first challenge by using the /challenge command!',
      { parse_mode: 'Markdown' }
    );
    
    return ctx.scene.leave();
  } catch (error) {
    logger.error(`Error completing setup ${withAdditionalAdmins ? 'with' : 'without'} admins`, {
      error, 
      groupId
    });
    await ctx.reply('An error occurred. Please try again later.');
    return ctx.scene.leave();
  }
}

module.exports = {
  completeSetup
};