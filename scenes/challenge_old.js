// scenes/challenge.js
const { Scenes, Markup } = require('telegraf');
const { format, addDays } = require('date-fns');
const Challenge = require('../models/challenge');
const User = require('../models/user');
const walletService = require('../services/wallet');
const { 
  getCurrencyKeyboard, 
  getVotingMethodKeyboard,
  getConfirmChallengeKeyboard
} = require('../utils/keyboards');
const {
  validateChallengeTitle,
  validateChallengeDescription,
  validateChallengeDuration,
  validatePrizePool,
  validateEntriesPerUser,
  validateMaxEntries,
  formatDate
} = require('../utils/validation');
const { checkChallengePayment } = require('../utils/challenges');
const logger = require('../utils/logger');

// Error emoji rotation for visual distinction
const ERROR_EMOJIS = ['⚠️', '❌', '🚫', '⛔️'];
let currentEmojiIndex = 0;

// Get next error emoji in rotation
function getNextErrorEmoji() {
  const emoji = ERROR_EMOJIS[currentEmojiIndex];
  currentEmojiIndex = (currentEmojiIndex + 1) % ERROR_EMOJIS.length;
  return emoji;
}

// Create field selection keyboard with better layout
function getFieldSelectionKeyboard(filledFields) {
  const fields = [
    { id: 'title', name: 'Title', done: !!filledFields.title },
    { id: 'description', name: 'Description', done: !!filledFields.description },
    { id: 'duration', name: 'Duration', done: !!filledFields.duration },
    { id: 'currency', name: 'Currency', done: !!filledFields.currency },
    { id: 'prizePool', name: 'Prize Amount', done: !!filledFields.prizePool },
    { id: 'votingMethod', name: 'Voting Method', done: !!filledFields.votingMethod },
    { id: 'entriesPerUser', name: 'Entries Per User', done: !!filledFields.entriesPerUser },
    { id: 'maxEntries', name: 'Max Total Entries', done: !!filledFields.maxEntries },
  ];
  
  const allFieldsFilled = fields.every(field => field.done);
  
  // Create keyboard with grouped buttons (2 per row where possible)
  const keyboard = [];
  
  // Group buttons in pairs
  for (let i = 0; i < fields.length; i += 2) {
    const row = [];
    
    // Add first button in the pair
    row.push({ 
      text: `${fields[i].done ? '✅' : '✏️'} ${fields[i].name}`, 
      callback_data: `set_field_${fields[i].id}` 
    });
    
    // Add second button if it exists
    if (i + 1 < fields.length) {
      row.push({ 
        text: `${fields[i+1].done ? '✅' : '✏️'} ${fields[i+1].name}`, 
        callback_data: `set_field_${fields[i+1].id}` 
      });
    }
    
    keyboard.push(row);
  }
  
  // Add confirm button if all fields are filled
  if (allFieldsFilled) {
    keyboard.push([{ 
      text: '🚀 Confirm Challenge Details', 
      callback_data: 'confirm_challenge' 
    }]);
  }
  
  // Add cancel button
  keyboard.push([{ 
    text: '❌ Cancel Challenge Creation', 
    callback_data: 'cancel_challenge' 
  }]);
  
  return Markup.inlineKeyboard(keyboard);
}

function getChallengeFormMessage(data, errorMessage = null) {
  // Create a message showing all current data
  const filled = [];
  const missing = [];
  
  if (data.title) filled.push(`📝 Title: ${data.title}`);
  else missing.push('📝 Title');
  
  if (data.description) filled.push(`📋 Description: ${data.description.substring(0, 50)}${data.description.length > 50 ? '...' : ''}`);
  else missing.push('📋 Description');
  
  if (data.duration) {
    const endDate = addDays(new Date(), data.duration);
    filled.push(`⏱ Duration: ${data.duration} days (ends ${formatDate(endDate)})`);
  } else missing.push('⏱ Duration');
  
  if (data.currency) filled.push(`💰 Currency: ${data.currency}`);
  else missing.push('💰 Currency');
  
  if (data.prizePool) filled.push(`🏆 Prize Pool: ${data.prizePool} ${data.currency || ''}`);
  else missing.push('🏆 Prize Pool');
  
  if (data.votingMethod) filled.push(`🗳 Voting Method: ${data.votingMethod === 'admin' ? 'Admin Selection' : 'Community Voting'}`);
  else missing.push('🗳 Voting Method');
  
  if (data.entriesPerUser) filled.push(`👤 Entries Per User: ${data.entriesPerUser}`);
  else missing.push('👤 Entries Per User');
  
  if (data.maxEntries !== undefined) filled.push(`🔢 Max Total Entries: ${data.maxEntries === 0 ? 'Unlimited' : data.maxEntries}`);
  else missing.push('🔢 Max Total Entries');
  
  let message = '🎭 Create a New Meme Challenge 🎭\n\n';
  
  if (filled.length > 0) {
    message += '✅ Completed fields:\n' + filled.join('\n') + '\n\n';
  }
  
  if (missing.length > 0) {
    message += '✏️ Missing fields:\n' + missing.join('\n') + '\n\n';
  }
  
  message += 'Click on a field to set or update its value.';
  
  // Append error message if present
  if (errorMessage) {
    message += `\n\n${errorMessage}`;
  }
  
  return message;
}

const challengeScene = new Scenes.WizardScene(
  'challenge_scene',
  // Step 1: Show interactive form for challenge creation
  async (ctx) => {
    // If this is from a deep link, get the group ID
    if (ctx.scene.state.groupId) {
      ctx.wizard.state.groupId = ctx.scene.state.groupId;
      logger.info('Challenge creation started from deep link', {
        userId: ctx.from.id,
        groupId: ctx.wizard.state.groupId
      });
    }
    
    // Initialize the challenge data object
    ctx.wizard.state.challengeData = {};
    
    // Send initial form
    const formMessage = await ctx.reply(
      getChallengeFormMessage(ctx.wizard.state.challengeData),
      getFieldSelectionKeyboard(ctx.wizard.state.challengeData)
    );
    
    // Save message ID for future edits
    ctx.wizard.state.formMessageId = formMessage.message_id;
    
    // Set initial state to field selection
    ctx.wizard.state.currentStep = 'field_selection';
    
    return ctx.wizard.next();
  },
  // Step 2: Handle field selection and input
  async (ctx) => {
    try {
      // If it's a callback query, handle field selection
      if (ctx.callbackQuery) {
        const action = ctx.callbackQuery.data;
        await ctx.answerCbQuery();
        
        // If cancel button was pressed
        if (action === 'cancel_challenge') {
          await ctx.editMessageText(
            '❌ Challenge creation cancelled.',
            { reply_markup: { inline_keyboard: [] } }
          );
          logger.info('Challenge creation cancelled', {
            userId: ctx.from.id,
            username: ctx.from.username
          });
          return ctx.scene.leave();
        }
        
        // If confirm button was pressed
        if (action === 'confirm_challenge') {
          // Format the challenge data for confirmation
          const data = ctx.wizard.state.challengeData;
          const startDate = new Date();
          const endDate = addDays(startDate, data.duration);
          
          ctx.wizard.state.challengeData.startDate = startDate;
          ctx.wizard.state.challengeData.endDate = endDate;
          
          const message = `
📋 Challenge Summary:

Title: ${data.title}
Description: ${data.description.substring(0, 100)}${data.description.length > 100 ? '...' : ''}
Duration: ${data.duration} days (ends ${formatDate(endDate)})
Currency: ${data.currency}
Prize Pool: ${data.prizePool} ${data.currency}
Voting Method: ${data.votingMethod === 'admin' ? 'Admin Selection' : 'Community Voting'}
Entries Per User: ${data.entriesPerUser}
Max Total Entries: ${data.maxEntries === 0 ? 'Unlimited' : data.maxEntries}

Is this information correct?
          `;
          
          await ctx.editMessageText(
            message,
            getConfirmChallengeKeyboard()
          );
          
          ctx.wizard.state.currentStep = 'confirm_challenge';
          return ctx.wizard.next();
        }
        
        // If going back to field selection
        if (action === 'back_to_fields') {
          // Return to field selection view
          await ctx.editMessageText(
            getChallengeFormMessage(ctx.wizard.state.challengeData),
            getFieldSelectionKeyboard(ctx.wizard.state.challengeData)
          );
          ctx.wizard.state.currentStep = 'field_selection';
          return;
        }
        
        // If a specific field was selected
        if (action.startsWith('set_field_')) {
          const field = action.replace('set_field_', '');
          ctx.wizard.state.currentStep = field;
          
          // Show prompt for the selected field
          let promptMessage;
          let keyboard;
          
          switch (field) {
            case 'title':
              promptMessage = '📝 Enter the title for your challenge:';
              break;
            case 'description':
              promptMessage = '📋 Enter a description for your challenge, including any rules or instructions:';
              break;
            case 'duration':
              promptMessage = `⏱ How long should this challenge run for? (in days, between ${process.env.MIN_CHALLENGE_DURATION || '1'}-${process.env.MAX_CHALLENGE_DURATION || '30'}):`;
              break;
            case 'currency':
              promptMessage = '💰 Select the cryptocurrency for this challenge:';
              keyboard = getCurrencyKeyboard();
              break;
            case 'prizePool':
              promptMessage = `🏆 What should be the prize pool amount? (in ${ctx.wizard.state.challengeData.currency || 'cryptocurrency'}):`;
              break;
            case 'votingMethod':
              promptMessage = '🗳 How do you want to select the winner?';
              keyboard = getVotingMethodKeyboard();
              break;
            case 'entriesPerUser':
              promptMessage = `👤 How many entries can each user submit? (maximum per user, between ${process.env.MIN_ENTRIES_PER_USER || '1'}-${process.env.MAX_ENTRIES_PER_USER || '10'}):`;
              break;
            case 'maxEntries':
              promptMessage = `🔢 What is the maximum total number of entries for this challenge? (0 for unlimited, max ${process.env.ABSOLUTE_MAX_ENTRIES || '1000'}):`;
              break;
          }
          
          // Add back button
          const backButton = Markup.inlineKeyboard([
            [{ text: '« Back to Form', callback_data: 'back_to_fields' }]
          ]);
          
          // Use the keyboard if provided, otherwise use back button
          await ctx.editMessageText(
            promptMessage,
            keyboard || backButton
          );
          
          return;
        }
        
        // Handle currency selection
        if (['Solana', 'Ethereum'].includes(ctx.callbackQuery.data)) {
          ctx.wizard.state.challengeData.currency = ctx.callbackQuery.data;
          
          // Go back to field selection
          await ctx.editMessageText(
            getChallengeFormMessage(ctx.wizard.state.challengeData),
            getFieldSelectionKeyboard(ctx.wizard.state.challengeData)
          );
          ctx.wizard.state.currentStep = 'field_selection';
          return;
        }
        
        // Handle voting method selection
        if (['admin', 'community'].includes(ctx.callbackQuery.data)) {
          ctx.wizard.state.challengeData.votingMethod = ctx.callbackQuery.data;
          
          // Go back to field selection
          await ctx.editMessageText(
            getChallengeFormMessage(ctx.wizard.state.challengeData),
            getFieldSelectionKeyboard(ctx.wizard.state.challengeData)
          );
          ctx.wizard.state.currentStep = 'field_selection';
          return;
        }
        
        // Handle prize pool amount confirmation
        if (ctx.callbackQuery.data.startsWith('confirm_amount_')) {
          const confirmedAmount = ctx.callbackQuery.data.replace('confirm_amount_', '');
          ctx.wizard.state.challengeData.prizePool = confirmedAmount;
          
          // Go back to field selection
          await ctx.editMessageText(
            getChallengeFormMessage(ctx.wizard.state.challengeData),
            getFieldSelectionKeyboard(ctx.wizard.state.challengeData)
          );
          ctx.wizard.state.currentStep = 'field_selection';
          return;
        }
        
        // Handle amount change request
        if (ctx.callbackQuery.data === 'change_amount') {
          // Update prompt to ask for new amount
          await ctx.editMessageText(
            `🏆 Please enter a new amount for the prize pool (in ${ctx.wizard.state.challengeData.currency}):`,
            Markup.inlineKeyboard([
              [{ text: '« Back to Form', callback_data: 'back_to_fields' }]
            ])
          );
          ctx.wizard.state.currentStep = 'prizePool';
          return;
        }
      }
      
      // If it's a text message, process field input
      if (ctx.message && ctx.message.text) {
        const field = ctx.wizard.state.currentStep;
        const input = ctx.message.text.trim();
        let errorMessage = null;
        
        // Process input based on the current field
        switch (field) {
          case 'title':
            const titleValidation = validateChallengeTitle(input);
            if (titleValidation.isValid) {
              ctx.wizard.state.challengeData.title = input;
            } else {
              errorMessage = `${getNextErrorEmoji()} ${titleValidation.errorMessage}`;
            }
            break;
            
          case 'description':
            const descValidation = validateChallengeDescription(input);
            if (descValidation.isValid) {
              ctx.wizard.state.challengeData.description = input;
            } else {
              errorMessage = `${getNextErrorEmoji()} ${descValidation.errorMessage}`;
            }
            break;
            
          case 'duration':
            const durationValidation = validateChallengeDuration(input);
            if (durationValidation.isValid) {
              ctx.wizard.state.challengeData.duration = durationValidation.value;
            } else {
              errorMessage = `${getNextErrorEmoji()} ${durationValidation.errorMessage}`;
            }
            break;
            
          case 'prizePool':
            const prizeValidation = validatePrizePool(input, ctx.wizard.state.challengeData.currency);
            if (prizeValidation.isValid) {
              if (prizeValidation.isReasonable) {
                ctx.wizard.state.challengeData.prizePool = prizeValidation.value.toString();
              } else {
                // Ask for confirmation in the same message
                await ctx.telegram.editMessageText(
                  ctx.chat.id,
                  ctx.wizard.state.formMessageId,
                  undefined,
                  `⚠️ The amount you entered (${prizeValidation.value} ${ctx.wizard.state.challengeData.currency}) seems unusually high. Are you sure you want to use this amount?`,
                  {
                    reply_markup: {
                      inline_keyboard: [
                        [{ text: '✅ Yes, use this amount', callback_data: `confirm_amount_${prizeValidation.value}` }],
                        [{ text: '🔄 No, I want to change it', callback_data: 'change_amount' }],
                        [{ text: '« Back to Form', callback_data: 'back_to_fields' }]
                      ]
                    }
                  }
                );
                
                // Try to delete the user's message to reduce clutter
                try {
                  await ctx.deleteMessage(ctx.message.message_id);
                } catch (error) {
                  logger.warn('Could not delete user message', { error });
                }
                
                return;
              }
            } else {
              errorMessage = `${getNextErrorEmoji()} ${prizeValidation.errorMessage}`;
            }
            break;
            
          case 'entriesPerUser':
            const entriesValidation = validateEntriesPerUser(input);
            if (entriesValidation.isValid) {
              ctx.wizard.state.challengeData.entriesPerUser = entriesValidation.value;
            } else {
              errorMessage = `${getNextErrorEmoji()} ${entriesValidation.errorMessage}`;
            }
            break;
            
          // scenes/challenge.js (completion of your updated implementation)
          case 'maxEntries':
            const maxEntriesValidation = validateMaxEntries(input);
            if (maxEntriesValidation.isValid) {
              ctx.wizard.state.challengeData.maxEntries = maxEntriesValidation.value;
            } else {
              errorMessage = `${getNextErrorEmoji()} ${maxEntriesValidation.errorMessage}`;
            }
            break;
            
          default:
            // Ignore other messages
            return;
        }
        
        // Try to delete the user's message to reduce clutter
        try {
          await ctx.deleteMessage(ctx.message.message_id);
        } catch (error) {
          logger.warn('Could not delete user message', { error });
        }
        
        // If validation error occurred, show the error but don't update form
        if (errorMessage) {
          // Show error message as a temporary notification that auto-disappears
          try {
            const tempMsg = await ctx.reply(errorMessage);
            // Delete the error message after 3 seconds
            setTimeout(async () => {
              try {
                await ctx.deleteMessage(tempMsg.message_id);
              } catch (e) {
                logger.warn('Could not delete temporary error message', { error: e });
              }
            }, 3000);
          } catch (error) {
            logger.error('Error sending temporary error message', { error });
          }
          
          return;
        }
        
        // Update form message with new data
        try {
          await ctx.telegram.editMessageText(
            ctx.chat.id,
            ctx.wizard.state.formMessageId,
            undefined,
            getChallengeFormMessage(ctx.wizard.state.challengeData),
            {
              reply_markup: getFieldSelectionKeyboard(ctx.wizard.state.challengeData).reply_markup
            }
          );
          
          ctx.wizard.state.currentStep = 'field_selection';
        } catch (error) {
          logger.error('Error updating form message', { error });
          // If we can't edit the message, send a new one
          const newFormMsg = await ctx.reply(
            getChallengeFormMessage(ctx.wizard.state.challengeData),
            getFieldSelectionKeyboard(ctx.wizard.state.challengeData)
          );
          
          // Update the form message ID
          ctx.wizard.state.formMessageId = newFormMsg.message_id;
          ctx.wizard.state.currentStep = 'field_selection';
        }
      }
    } catch (error) {
      logger.error('Error in challenge data collection', { error });
      await ctx.reply('An error occurred. Please try again later.');
    }
  },
  // Step 3: Handle confirmation and create wallet
  async (ctx) => {
    if (!ctx.callbackQuery) {
      await ctx.reply('Please use the buttons to confirm or cancel.');
      return;
    }
    
    const action = ctx.callbackQuery.data;
    await ctx.answerCbQuery();
    
    if (action === 'cancel_challenge') {
      await ctx.editMessageText('Challenge creation cancelled.');
      logger.info('Challenge creation cancelled', {
        userId: ctx.from.id,
        username: ctx.from.username
      });
      return ctx.scene.leave();
    } else if (action === 'confirm_challenge') {
      // Save the challenge with minimal info first, without wallet details
      try {
        const data = ctx.wizard.state.challengeData;
        
        if (!ctx.wizard.state.groupId) {
          await ctx.reply('Error: Group ID not provided. Please try creating the challenge from the group chat.');
          logger.error('Missing group ID during challenge creation', {
            userId: ctx.from.id
          });
          return ctx.scene.leave();
        }
        
        // Start with creating a waiting message to improve UX
        await ctx.editMessageText('Creating your challenge and preparing wallet...');
        
        // Create the challenge without wallet info first
        const challenge = new Challenge({
          groupId: ctx.wizard.state.groupId,
          creatorId: ctx.from.id.toString(),
          title: data.title,
          description: data.description,
          startDate: data.startDate,
          endDate: data.endDate,
          currency: data.currency,
          prizePool: data.prizePool,
          votingMethod: data.votingMethod,
          entriesPerUser: data.entriesPerUser,
          maxEntries: data.maxEntries,
          funded: false,
          active: false,
          completed: false
        });
        
        await challenge.save();

        await User.findOneAndUpdate(
          { userId: ctx.from.id.toString() },
          { 
            $inc: { challengesCreated: 1 }, 
            $addToSet: { tags: 'creator' }
          }
        );
        
        logger.info('Challenge created (pre-wallet)', {
          challengeId: challenge._id.toString(),
          creator: ctx.from.id,
          title: data.title
        });
        
        // Now create the wallet
        try {
          const walletCurrency = data.currency;
          const wallet = await walletService.createWallet(walletCurrency);
          
          logger.info('Created wallet for challenge', {
            challengeId: challenge._id.toString(),
            currency: walletCurrency,
            address: wallet.address,
            trackId: wallet.trackId
          });
          
          // Update the challenge with wallet info
          challenge.walletAddress = wallet.address;
          challenge.trackId = wallet.trackId;
          
          await challenge.save();
          
          logger.info('Challenge updated with wallet details', {
            challengeId: challenge._id.toString(),
            walletAddress: wallet.address,
            trackId: wallet.trackId
          });
          
          // Display funding information to the user
          const now = new Date();
          
          await ctx.editMessageText(`
📋 Funding Information:

To activate your challenge, please send exactly ${challenge.prizePool} ${challenge.currency} to:
\`${wallet.address}\`

Last checked: ${format(now, process.env.TIME_FORMAT || 'HH:mm:ss')}
Status: Waiting for funds...
          `, {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [{ text: '🔄 Check Funding Status', callback_data: `check_funding_${challenge._id}` }],
                [{ text: '❌ Delete Challenge', callback_data: `delete_challenge_${challenge._id}` }]
              ]
            }
          });
          
          // Register funding check callback
          ctx.wizard.state.challenge = challenge;
          ctx.wizard.state.lastCheckTime = now;
          
          // Move to next step (waiting for funding)
          return ctx.wizard.next();
          
        } catch (error) {
          logger.error('Error creating wallet for challenge', {
            error,
            challengeId: challenge._id.toString()
          });
          
          // Delete the challenge if wallet creation failed
          await Challenge.findByIdAndDelete(challenge._id);
          
          await ctx.editMessageText(`${getNextErrorEmoji()} An error occurred while creating the wallet. Please try again later.`);
          return ctx.scene.leave();
        }
      } catch (error) {
        logger.error('Error saving challenge', {error, userId: ctx.from.id});
        await ctx.editMessageText(`${getNextErrorEmoji()} An error occurred while saving the challenge. Please try again later.`);
        return ctx.scene.leave();
      }
    }
  },
  // Step 4: Wait for funding and activation
  async (ctx) => {
    if (!ctx.callbackQuery) {
      await ctx.reply('Use the Check Funding Status button to verify if your payment has been received.');
      return;
    }
    
    const action = ctx.callbackQuery.data;
    
    // Handle funding check
    if (action.startsWith('check_funding_')) {
      await ctx.answerCbQuery('Checking funding status...');
      
      const challengeId = action.replace('check_funding_', '');
      const challenge = await Challenge.findById(challengeId);
      
      if (!challenge) {
        await ctx.editMessageText(`${getNextErrorEmoji()} Error: Challenge not found.`);
        return ctx.scene.leave();
      }
      
      try {
        // Use trackId for checking balance with OxaPay
        const balance = await walletService.checkBalance(challenge.currency, challenge.trackId || challenge.walletAddress);
        
        logger.info('Challenge funding check', {
          challengeId: challenge._id.toString(),
          walletAddress: challenge.walletAddress,
          trackId: challenge.trackId,
          requiredAmount: challenge.prizePool,
          currentBalance: balance
        });
        
        const now = new Date();
        ctx.wizard.state.lastCheckTime = now;
        
        if (parseFloat(balance) >= parseFloat(challenge.prizePool)) {
          // Mark challenge as funded
          challenge.funded = true;
          await challenge.save();
          
          // Show activation button
          await ctx.editMessageText(`
✅ Funding received! Your challenge "${challenge.title}" is now ready to be activated.

Current balance: ${balance} ${challenge.currency}
Required amount: ${challenge.prizePool} ${challenge.currency}
Last checked: ${format(now, process.env.TIME_FORMAT || 'HH:mm:ss')}

Click the button below to activate and announce the challenge in your group.
          `, {
            reply_markup: {
              inline_keyboard: [
                [{ text: '🚀 Activate Challenge', callback_data: `activate_${challenge._id}` }]
              ]
            }
          });
        } else {
          // Get a rotation of messages to make it more interesting
          const messages = [
            "Still waiting for funds... Blockchain transactions may take some time to confirm.",
            "No funds received yet. Make sure you've sent to the correct address.",
            "Waiting for your payment to arrive. Crypto transactions may take a few minutes.",
            "Funds not yet received. Transaction delays can occur during network congestion."
          ];
          
          // Select a message based on check count
          const checkCount = ctx.wizard.state.checkCount || 0;
          const message = messages[checkCount % messages.length];
          ctx.wizard.state.checkCount = checkCount + 1;
          
          // Show funding not complete yet
          await ctx.editMessageText(`
📋 Funding Status for "${challenge.title}":

To activate your challenge, please send exactly ${challenge.prizePool} ${challenge.currency} to:
\`${challenge.walletAddress}\`

Current balance: ${balance} ${challenge.currency}
Required amount: ${challenge.prizePool} ${challenge.currency}
Last checked: ${format(now, process.env.TIME_FORMAT || 'HH:mm:ss')}

Status: ${message}
          `, {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [{ text: '🔄 Check Again', callback_data: `check_funding_${challenge._id}` }],
                [{ text: '❌ Delete Challenge', callback_data: `delete_challenge_${challenge._id}` }]
              ]
            }
          });
        }
      } catch (error) {
        logger.error('Error checking challenge balance', {
            error,
            challengeId: challenge._id.toString()
          });
          
          const now = new Date();
          
          await ctx.editMessageText(`
⚠️ Error checking balance

To activate your challenge, please send exactly ${challenge.prizePool} ${challenge.currency} to:
\`${challenge.walletAddress}\`

Last checked: ${format(now, process.env.TIME_FORMAT || 'HH:mm:ss')}
Error: Could not retrieve balance information

Please try again in a few moments.
          `, {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [{ text: '🔄 Try Again', callback_data: `check_funding_${challenge._id}` }],
                [{ text: '❌ Delete Challenge', callback_data: `delete_challenge_${challenge._id}` }]
              ]
            }
          });
        }
      } 
      // Handle challenge deletion
      else if (action.startsWith('delete_challenge_')) {
        const challengeId = action.replace('delete_challenge_', '');
        
        await ctx.answerCbQuery('Processing deletion request...');
        
        try {
          // First show a confirmation
          await ctx.editMessageText(`
⚠️ Are you sure you want to delete this challenge?

This action cannot be undone. Any funds sent to the challenge wallet will not be refunded automatically.
          `, {
            reply_markup: {
              inline_keyboard: [
                [
                  { text: '✅ Yes, Delete', callback_data: `confirm_delete_${challengeId}` },
                  { text: '❌ No, Cancel', callback_data: `check_funding_${challengeId}` }
                ]
              ]
            }
          });
        } catch (error) {
          logger.error('Error showing delete confirmation', {
            error,
            challengeId
          });
          await ctx.reply('An error occurred. Please try again.');
        }
      }
      // Handle confirmed deletion
      else if (action.startsWith('confirm_delete_')) {
        const challengeId = action.replace('confirm_delete_', '');
        
        await ctx.answerCbQuery('Deleting challenge...');
        
        try {
          await Challenge.findByIdAndDelete(challengeId);
          
          await ctx.editMessageText('✅ Challenge deleted successfully.');
          
          logger.info('Challenge deleted by creator', {
            challengeId,
            userId: ctx.from.id
          });
          
          return ctx.scene.leave();
        } catch (error) {
          logger.error('Error deleting challenge', {
            error,
            challengeId
          });
          await ctx.reply(`${getNextErrorEmoji()} An error occurred while deleting the challenge.`);
        }
      }
      // Handle activation
      else if (action.startsWith('activate_')) {
        await ctx.answerCbQuery('Activating challenge...');
        
        const challengeId = action.replace('activate_', '');
        const challenge = await Challenge.findById(challengeId);
        
        if (!challenge) {
          await ctx.editMessageText(`${getNextErrorEmoji()} Error: Challenge not found.`);
          return ctx.scene.leave();
        }
        
        try {
          // Show an intermediate message to improve UX during verification
          await ctx.editMessageText('Verifying funding and preparing to activate challenge...');
          
          // Verify the challenge is actually funded
          if (!challenge.funded) {
            const balance = await walletService.checkBalance(
              challenge.currency, 
              challenge.trackId || challenge.walletAddress
            );
            
            if (parseFloat(balance) < parseFloat(challenge.prizePool)) {
              const now = new Date();
              
              await ctx.editMessageText(`
⚠️ Challenge cannot be activated because it's not fully funded.

Current balance: ${balance} ${challenge.currency}
Required amount: ${challenge.prizePool} ${challenge.currency}
Last checked: ${format(now, process.env.TIME_FORMAT || 'HH:mm:ss')}

Please fund the wallet first.
              `, {
                reply_markup: {
                  inline_keyboard: [
                    [{ text: '🔄 Check Again', callback_data: `check_funding_${challengeId}` }],
                    [{ text: '❌ Delete Challenge', callback_data: `delete_challenge_${challenge._id}` }]
                  ]
                }
              });
              return;
            } else {
              // Mark as funded if it wasn't already
              challenge.funded = true;
            }
          }
          
          // Mark challenge as active
          challenge.active = true;
          await challenge.save();
          
          // Show a message that we're activating
          await ctx.editMessageText(`
🚀 Activating challenge "${challenge.title}"...

Announcing in the group chat...
          `);
          
          // Announce challenge in the group
          await ctx.telegram.sendMessage(
            challenge.groupId,
            `
🎉 New Meme Challenge: "${challenge.title}" 🎉

${challenge.description}

Prize: ${challenge.prizePool} ${challenge.currency}
Deadline: ${formatDate(challenge.endDate)}
Voting Method: ${challenge.votingMethod === 'admin' ? 'Admin Selection' : 'Community Voting'}
Maximum entries per user: ${challenge.entriesPerUser}
${challenge.maxEntries > 0 ? `Maximum total entries: ${challenge.maxEntries}` : 'No limit on total entries'}
         `,
           {
             reply_markup: {
               inline_keyboard: [
                 [{ text: '📷 Submit Your Meme', callback_data: `submit_${challenge._id}` }]
               ]
             }
           }
         );
         
         // Update message to show completion
         await ctx.editMessageText(`
🚀 Your challenge "${challenge.title}" has been activated and announced in the group!

The challenge will run until ${formatDate(challenge.endDate)}.

Thanks for creating a fun challenge for the community! 🙌
         `);
         
         logger.info('Challenge activated and announced', {
           challengeId: challenge._id.toString(),
           groupId: challenge.groupId,
           title: challenge.title
         });
         
         return ctx.scene.leave();
       } catch (error) {
         logger.error('Error activating challenge', {
           error,
           challengeId: challenge._id.toString()
         });
         
         await ctx.editMessageText(`${getNextErrorEmoji()} An error occurred while activating the challenge. Please try again.`, {
           reply_markup: {
             inline_keyboard: [
               [{ text: '🚀 Try Again', callback_data: `activate_${challenge._id}` }]
             ]
           }
         });
       }
     }
   }
  );
  
  module.exports = challengeScene;