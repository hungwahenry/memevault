// scenes/wallet.js
const { Scenes, Telegraf, Markup } = require('telegraf');
const Challenge = require('../models/challenge');
const Submission = require('../models/submission');
const walletService = require('../services/wallet');
const { validateWalletAddress } = require('../utils/validation');
const logger = require('../utils/logger');
const { processPrizePayment } = require('../utils/challenges');

const walletScene = new Scenes.WizardScene(
  'wallet_scene',
  // Step 1: Prompt for wallet address
  async (ctx) => {
    // Get submissionId from scene state
    const submissionId = ctx.scene.state?.submissionId;
    
    logger.info('Wallet scene entered', {
      hasSubmissionId: !!submissionId,
      userId: ctx.from.id
    });
    
    if (!submissionId) {
      await ctx.reply('Error: No submission specified. Please try claiming your prize again.');
      logger.warn('Wallet scene entered without submission ID', {
        userId: ctx.from.id
      });
      return ctx.scene.leave();
    }
    
    try {
      const submission = await Submission.findById(submissionId)
        .populate('challengeId');
      
      if (!submission) {
        await ctx.reply('This submission does not exist.');
        logger.warn('Wallet scene with non-existent submission', {
          userId: ctx.from.id,
          submissionId: submissionId
        });
        return ctx.scene.leave();
      }
      
      if (submission.userId !== ctx.from.id.toString()) {
        await ctx.reply('You are not the owner of this submission.');
        logger.warn('Unauthorized wallet claim attempt', {
          userId: ctx.from.id,
          submissionId: submission._id.toString(),
          ownerId: submission.userId
        });
        return ctx.scene.leave();
      }
      
      const challenge = submission.challengeId;
      
      if (!challenge || !challenge.completed) {
        await ctx.reply('This challenge is not completed yet.');
        logger.warn('Wallet claim attempt for incomplete challenge', {
          userId: ctx.from.id,
          submissionId: submission._id.toString(),
          challengeId: challenge ? challenge._id.toString() : 'null'
        });
        return ctx.scene.leave();
      }
      
      // Check if this is actually the winning submission
      if (!challenge.winner || !challenge.winner.equals(submission._id)) {
        await ctx.reply('This submission is not the winner of the challenge.');
        logger.warn('Wallet claim attempt for non-winning submission', {
          userId: ctx.from.id,
          submissionId: submission._id.toString(),
          challengeId: challenge._id.toString(),
          winnerId: challenge.winner ? challenge.winner.toString() : 'null'
        });
        return ctx.scene.leave();
      }
      
      // Check if they've already provided a wallet address
      if (submission.winnerWalletAddress) {
        const maskedAddress = `${submission.winnerWalletAddress.substring(0, 6)}...${submission.winnerWalletAddress.substring(submission.winnerWalletAddress.length - 4)}`;
        await ctx.reply(`You have already claimed this prize. Your payment to wallet address ${maskedAddress} is being processed.`);
        return ctx.scene.leave();
      }
      
      // Save in wizard state for next step
      ctx.wizard.state.submission = submission;
      ctx.wizard.state.challenge = challenge;
      ctx.wizard.state.submissionId = submissionId;
      
      // Send a message with information and a field to edit
      const formMessage = await ctx.reply(
        `🎉 Congratulations! Your meme has won the "${challenge.title}" challenge!\n\n` +
        `You have won ${challenge.prizePool} ${challenge.currency}.\n\n` +
        `Please provide your ${challenge.currency} wallet address:`,
        Markup.inlineKeyboard([
          [{ text: "Enter Wallet Address", callback_data: "enter_wallet_address" }]
        ])
      );
      
      // Save message ID for future edits
      ctx.wizard.state.formMessageId = formMessage.message_id;
      
      return ctx.wizard.next();
    } catch (error) {
      logger.error('Error in wallet collection step 1:', {
        error, 
        userId: ctx.from.id,
        submissionId: submissionId
      });
      await ctx.reply('An error occurred. Please try again later.');
      return ctx.scene.leave();
    }
  },
  // Step 2: Get and validate wallet address
  async (ctx) => {
    try {
      // Handle wallet address entry callback
      if (ctx.callbackQuery && ctx.callbackQuery.data === "enter_wallet_address") {
        await ctx.answerCbQuery();
        
        // Edit message to prompt for wallet address input and remove keyboard
        await ctx.editMessageText(
          `🎉 Congratulations! Your meme has won the "${ctx.wizard.state.challenge.title}" challenge!\n\n` +
          `You have won ${ctx.wizard.state.challenge.prizePool} ${ctx.wizard.state.challenge.currency}.\n\n` +
          `Please reply with your ${ctx.wizard.state.challenge.currency} wallet address:`,
          { reply_markup: { inline_keyboard: [] } }
        );
        
        // Set state to waiting for address input
        ctx.wizard.state.waitingForAddress = true;
        return;
      }
      
      // Process wallet address input
      if (ctx.message && ctx.message.text && ctx.wizard.state.waitingForAddress) {
        const walletAddress = ctx.message.text.trim();
        
        if (!ctx.wizard.state.challenge) {
          logger.error('Challenge data missing when processing wallet address', {
            userId: ctx.from.id,
            submissionId: ctx.wizard.state.submissionId
          });
          await ctx.reply('An error occurred. Please try again later.');
          return ctx.scene.leave();
        }
        
        const challenge = ctx.wizard.state.challenge;
        
        // Store the message ID of the wallet address message so we can delete it
        const walletMessageId = ctx.message.message_id;
        
        // Validate wallet address
        if (!validateWalletAddress(walletAddress, challenge.currency)) {
          // Send temporary error message that will be deleted
          const errorMsg = await ctx.reply(
            `⚠️ This does not appear to be a valid ${challenge.currency} address. Please check and try again.`
          );
          
          // Delete the user's invalid address message for privacy
          try {
            await ctx.deleteMessage(walletMessageId);
          } catch (deleteError) {
            logger.warn('Could not delete invalid wallet address message', { deleteError });
          }
          
          // Delete our error message after 5 seconds
          setTimeout(async () => {
            try {
              await ctx.deleteMessage(errorMsg.message_id);
            } catch (deleteError) {
              logger.warn('Could not delete error message', { deleteError });
            }
          }, 5000);
          
          return;
        }
        
        if (!ctx.wizard.state.submission) {
          logger.error('Submission data missing when processing wallet address', {
            userId: ctx.from.id,
            submissionId: ctx.wizard.state.submissionId
          });
          await ctx.reply('An error occurred. Please try again later.');
          return ctx.scene.leave();
        }
        
        // First show a temporary "processing" message
        const processingMsg = await ctx.reply('⏳ Processing your wallet address...');
        
        // Delete the user's wallet address message immediately for privacy
        try {
          await ctx.deleteMessage(walletMessageId);
        } catch (deleteError) {
          logger.warn('Could not delete wallet address message', { deleteError });
        }
        
        // Set wallet address using fresh submission from database to avoid state issues
        try {
          const freshSubmission = await Submission.findById(ctx.wizard.state.submission._id);
          if (!freshSubmission) {
            throw new Error('Could not find submission in database');
          }
          
          freshSubmission.winnerWalletAddress = walletAddress;
          await freshSubmission.save();
          
          // Update our reference
          ctx.wizard.state.submission = freshSubmission;
        } catch (saveError) {
          logger.error('Error saving wallet address:', {
            error: saveError,
            userId: ctx.from.id,
            submissionId: ctx.wizard.state.submission._id.toString()
          });
          
          // Delete the processing message
          try {
            await ctx.deleteMessage(processingMsg.message_id);
          } catch (deleteError) {
            logger.warn('Could not delete processing message', { deleteError });
          }
          
          await ctx.reply('An error occurred while saving your wallet address. Please try again later.');
          return ctx.scene.leave();
        }
        
        // Delete the processing message
        try {
          await ctx.deleteMessage(processingMsg.message_id);
        } catch (deleteError) {
          logger.warn('Could not delete processing message', { deleteError });
        }
        
        // Update the original main message with confirmation
        try {
          await ctx.telegram.editMessageText(
            ctx.chat.id,
            ctx.wizard.state.formMessageId,
            undefined,
            `
🎉 Prize Claim Confirmed!

Your prize of ${challenge.prizePool} ${challenge.currency} will be sent to:
\`${walletAddress.substring(0, 6)}...${walletAddress.substring(walletAddress.length - 4)}\`

Please allow a few minutes for the transaction to process. You'll receive a notification when the transaction is complete.
            `,
            { parse_mode: 'Markdown' }
          );
        } catch (error) {
          logger.error('Error updating wallet confirmation message', { error });
          
          // If we can't edit, send a new message
          await ctx.reply(`
🎉 Prize Claim Confirmed!

Your prize of ${challenge.prizePool} ${challenge.currency} will be sent to your wallet.
Please allow a few minutes for the transaction to process.
          `);
        }
        
        // Process payment in the background
        processPrizePayment(ctx.wizard.state.submission._id);
        
        return ctx.scene.leave();
      }
      
      // If we get a message but aren't waiting for an address, remind the user
      if (ctx.message && !ctx.wizard.state.waitingForAddress) {
        // Store message ID so we can delete it
        const messageId = ctx.message.message_id;
        
        const replyMsg = await ctx.reply(
          'Please click the "Enter Wallet Address" button to provide your wallet address.'
        );
        
        // Try to delete the user's message
        try {
          await ctx.deleteMessage(messageId);
        } catch (error) {
          logger.warn('Could not delete user message', { error });
        }
        
        // Delete our message after 5 seconds
        setTimeout(async () => {
          try {
            await ctx.deleteMessage(replyMsg.message_id);
          } catch (error) {
            logger.warn('Could not delete reminder message', { error });
          }
        }, 5000);
        
        return;
      }
    } catch (error) {
      logger.error('Error saving wallet address:', {
        error,
        userId: ctx.from.id,
        submissionId: ctx.wizard.state.submission?._id.toString()
      });
      await ctx.reply('An error occurred while saving your wallet address. Please try again later.');
      return ctx.scene.leave();
    }
  }
);

module.exports = walletScene;