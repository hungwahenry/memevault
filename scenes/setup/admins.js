// scenes/setup/admins.js
const Group = require('../../models/group');
const User = require('../../models/user');
const logger = require('../../utils/logger');
const completion = require('./completion');

async function handleAdminOptions(ctx) {
  // Skip if it's not a callback
  if (!ctx.callbackQuery) {
    await ctx.reply('Please use the buttons to respond.');
    return;
  }
  
  const data = ctx.callbackQuery.data;
  await ctx.answerCbQuery();
  
  const { groupId } = ctx.wizard.state.groupData;
  
  // Update button to show selection
  try {
    const inlineKeyboard = ctx.callbackQuery.message.reply_markup.inline_keyboard;
    const updatedKeyboard = inlineKeyboard.map(row => 
      row.map(button => {
        if (button.callback_data === data) {
          return { ...button, text: `✅ ${button.text.replace('✅ ', '')}` };
        }
        return button;
      })
    );
    
    await ctx.editMessageReplyMarkup({ inline_keyboard: updatedKeyboard });
  } catch (error) {
    logger.warn('Could not update button appearance', { error });
  }
  
  if (data === 'add_admins') {
    await ctx.reply(
      'Please forward a message from each additional admin you want to add, one at a time.\n\n' +
      'Send /done when you\'re finished.',
      { reply_markup: { remove_keyboard: true } }
    );
    return ctx.wizard.next();
  } else if (data === 'no_admins') {
    // Complete setup without adding more admins
    return await completion.completeSetup(ctx, false);
  }
}

async function processAdminAddition(ctx) {
  const { groupId } = ctx.wizard.state.groupData;
  
  // Check if user is done adding admins
  if (ctx.message && ctx.message.text === '/done') {
    return await completion.completeSetup(ctx, true);
  }
  
  // Check if this is a forwarded message
  if (ctx.message && ctx.message.forward_from) {
    try {
      const newAdminId = ctx.message.forward_from.id.toString();
      
      const group = await Group.findOne({ groupId });
      if (!group) {
        logger.error('Group not found during admin addition', {groupId});
        await ctx.reply('An error occurred. Please try again.');
        return ctx.scene.leave();
      }
      
      if (!group.adminIds.includes(newAdminId)) {
        // Show processing message
        const processingMsg = await ctx.reply('🔄 Adding admin...');
        
        group.adminIds.push(newAdminId);
        await group.save();
        
        // Track the new admin in user database
        try {
          await User.findOneAndUpdate(
            { userId: newAdminId },
            { 
              $addToSet: { 
                groups: groupId,
                tags: ['admin', 'group_admin'] 
              },
              userType: 'admin'
            },
            { upsert: true }
          );
        } catch (error) {
          logger.warn('Could not track new admin', { error });
        }
        
        logger.info('Admin added during setup', {
          groupId,
          adminId: newAdminId,
          adminName: ctx.message.forward_from.first_name
        });
        
        // Delete processing message
        try {
          await ctx.deleteMessage(processingMsg.message_id);
        } catch (error) {
          logger.warn('Could not delete processing message', { error });
        }
        
        await ctx.reply(
          `✅ Added *${ctx.message.forward_from.first_name}* as an admin.\n\n` +
          `Forward another admin's message or send /done when finished.`,
          { parse_mode: 'Markdown' }
        );
      } else {
        await ctx.reply(
          '⚠️ This user is already an admin.\n\n' +
          'Forward another admin\'s message or send /done when finished.'
        );
      }
    } catch (error) {
      logger.error('Error adding admin during setup', {
        error, 
        groupId,
        message: ctx.message
      });
      await ctx.reply('An error occurred. Please try again or send /done to finish.');
    }
  } else if (ctx.message) {
    // Try to delete non-forwarded messages to keep chat clean
    try {
      await ctx.deleteMessage(ctx.message.message_id);
    } catch (error) {
      logger.warn('Could not delete user message', { error });
    }
    
    await ctx.reply(
      '⚠️ Please forward a message from the user you want to add as an admin or send /done to finish.',
      { parse_mode: 'Markdown' }
    );
  }
}

module.exports = {
  handleAdminOptions,
  processAdminAddition
};