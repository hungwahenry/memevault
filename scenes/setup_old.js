// scenes/setup.js
const { Scenes, Markup } = require('telegraf');
const Group = require('../models/group');
const User = require('../models/user');
const { getAdminKeyboard } = require('../utils/keyboards');
const logger = require('../utils/logger');

const setupScene = new Scenes.WizardScene(
    'setup_scene',
    // Step 1: Start setup
    async (ctx) => {
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
        const progressMsg = await ctx.reply('🔄 Setting up MemeVault...');
        
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
          '🎭 *Welcome to MemeVault!* 🎭\n\n' +
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
    },
    // Step 2: Add additional admins
    async (ctx) => {
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

          // Update all admins in the user database
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
          
          logger.info('Setup completed without additional admins', {groupId});
          
          // Delete progress message
          try {
            await ctx.deleteMessage(progressMsg.message_id);
          } catch (error) {
            logger.warn('Could not delete progress message', { error });
          }
          
          // Final confirmation message with tips
          await ctx.reply(
            '✅ *Setup Complete!*\n\n' +
            'You can now create challenges in this group using:\n' +
            '• /challenge - Create a new meme challenge\n' +
            '• /active - View active challenges\n' +
            '• /vote - See challenges in voting phase\n\n' +
            'Create your first challenge by using the /challenge command!',
            { parse_mode: 'Markdown' }
          );
          
          return ctx.scene.leave();
        } catch (error) {
          logger.error('Error completing setup without admins', {error, groupId});
          await ctx.reply('An error occurred. Please try again later.');
          return ctx.scene.leave();
        }
      }
    },
    // Step 3: Process forwarded messages from admins
    async (ctx) => {
      const { groupId } = ctx.wizard.state.groupData;
      
      // Check if user is done adding admins
      if (ctx.message && ctx.message.text === '/done') {
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
          
          logger.info('Setup completed with additional admins', {
            groupId, 
            adminCount: group.adminIds.length
          });
          
          // Delete progress message
          try {
            await ctx.deleteMessage(progressMsg.message_id);
          } catch (error) {
            logger.warn('Could not delete progress message', { error });
          }
          
          // Final confirmation with admin count
          await ctx.reply(
            `✅ *Setup Complete!*\n\n` +
            `${group.adminIds.length} ${group.adminIds.length === 1 ? 'admin has' : 'admins have'} been configured.\n\n` +
            'You can now create challenges in this group using:\n' +
            '• /challenge - Create a new meme challenge\n' +
            '• /active - View active challenges\n' +
            '• /vote - See challenges in voting phase\n\n' +
            'Create your first challenge by using the /challenge command!',
            { parse_mode: 'Markdown' }
          );
          
          return ctx.scene.leave();
        } catch (error) {
          logger.error('Error completing setup with admins', {error, groupId});
          await ctx.reply('An error occurred. Please try again later.');
          return ctx.scene.leave();
        }
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
);
  
module.exports = setupScene;