// scenes/submission/index.js
const { Scenes } = require('telegraf');
const validation = require('./validation');
const capture = require('./capture');
const confirmation = require('./confirmation');

// Create submission scene with the wizard steps
const submissionScene = new Scenes.WizardScene(
  'submission_scene',
  validation.validateSubmission,
  capture.captureImage,
  capture.captureCaption,
  confirmation.confirmSubmission
);

module.exports = submissionScene;