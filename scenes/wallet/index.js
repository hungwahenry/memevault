// scenes/wallet/index.js
const { Scenes } = require('telegraf');
const validation = require('./validation');
const collection = require('./collection');

// Create wallet scene with the wizard steps
const walletScene = new Scenes.WizardScene(
  'wallet_scene',
  validation.validateSubmission,
  collection.handleWalletCollection
);

module.exports = walletScene;