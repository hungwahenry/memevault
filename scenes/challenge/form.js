// scenes/challenge/form.js
const { Markup } = require('telegraf');
const { addDays } = require('date-fns');
const logger = require('../../utils/logger');
const {
  validateChallengeTitle,
  validateChallengeDescription,
  validateChallengeDuration,
  validatePrizePool,
  validateEntriesPerUser,
  validateMaxEntries,
  formatDate
} = require('../../utils/validation');
const { 
  getCurrencyKeyboard, 
  getVotingMethodKeyboard,
  getConfirmChallengeKeyboard
} = require('../../utils/keyboards');
const validation = require('./validation');

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

async function handleFormInteraction(ctx) {
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
            errorMessage = `${validation.getNextErrorEmoji()} ${titleValidation.errorMessage}`;
          }
          break;
          
        case 'description':
          const descValidation = validateChallengeDescription(input);
          if (descValidation.isValid) {
            ctx.wizard.state.challengeData.description = input;
          } else {
            errorMessage = `${validation.getNextErrorEmoji()} ${descValidation.errorMessage}`;
          }
          break;
          
        case 'duration':
          const durationValidation = validateChallengeDuration(input);
          if (durationValidation.isValid) {
            ctx.wizard.state.challengeData.duration = durationValidation.value;
          } else {
            errorMessage = `${validation.getNextErrorEmoji()} ${durationValidation.errorMessage}`;
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
            errorMessage = `${validation.getNextErrorEmoji()} ${prizeValidation.errorMessage}`;
          }
          break;
          
        case 'entriesPerUser':
          const entriesValidation = validateEntriesPerUser(input);
          if (entriesValidation.isValid) {
            ctx.wizard.state.challengeData.entriesPerUser = entriesValidation.value;
          } else {
            errorMessage = `${validation.getNextErrorEmoji()} ${entriesValidation.errorMessage}`;
          }
          break;
          
        case 'maxEntries':
          const maxEntriesValidation = validateMaxEntries(input);
          if (maxEntriesValidation.isValid) {
            ctx.wizard.state.challengeData.maxEntries = maxEntriesValidation.value;
          } else {
            errorMessage = `${validation.getNextErrorEmoji()} ${maxEntriesValidation.errorMessage}`;
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
}

module.exports = {
  getFieldSelectionKeyboard,
  getChallengeFormMessage,
  handleFormInteraction
};