// scenes/challenge/index.js
const { Scenes } = require('telegraf');
const form = require('./form');
const funding = require('./funding');
const activation = require('./activation');
const logger = require('../../utils/logger');

// Step 1: Show interactive form for challenge creation
async function showInitialForm(ctx) {
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
    form.getChallengeFormMessage(ctx.wizard.state.challengeData),
    form.getFieldSelectionKeyboard(ctx.wizard.state.challengeData)
  );
  
  // Save message ID for future edits
  ctx.wizard.state.formMessageId = formMessage.message_id;
  
  // Set initial state to field selection
  ctx.wizard.state.currentStep = 'field_selection';
  
  return ctx.wizard.next();
}

// Create the challenge scene with the wizard steps
const challengeScene = new Scenes.WizardScene(
  'challenge_scene',
  showInitialForm,
  form.handleFormInteraction,
  funding.handleFundingSetup,
  activation.handleActivation
);

module.exports = challengeScene;