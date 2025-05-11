// scenes/setup/index.js
const { Scenes } = require('telegraf');
const initialization = require('./initialization');
const admins = require('./admins');
const completion = require('./completion');

// Create setup scene with the wizard steps
const setupScene = new Scenes.WizardScene(
  'setup_scene',
  initialization.startSetup,
  admins.handleAdminOptions,
  admins.processAdminAddition
);

module.exports = setupScene;