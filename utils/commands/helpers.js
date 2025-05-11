// utils/commands/helpers.js

// Helper function to format time left
function getTimeLeft(endDate) {
    const now = new Date();
    const timeLeft = endDate - now;
    
    if (timeLeft <= 0) {
      return 'Ended';
    }
    
    const days = Math.floor(timeLeft / (1000 * 60 * 60 * 24));
    const hours = Math.floor((timeLeft % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((timeLeft % (1000 * 60 * 60)) / (1000 * 60));
    
    if (days > 0) {
      return `${days}d ${hours}h`;
    } else if (hours > 0) {
      return `${hours}h ${minutes}m`;
    } else {
      const seconds = Math.floor((timeLeft % (1000 * 60)) / 1000);
      return `${minutes}m ${seconds}s`;
    }
  }
  
  // Setup command function that handles circular dependency by doing dynamic requires
  function setupCommands(bot) {
    // Dynamically import modules to avoid circular dependencies
    const setup = require('./setup');
    const challenge = require('./challenge');
    const user = require('./user');
    
    // Register all commands
    if (typeof setup.registerSetupCommands === 'function') {
      setup.registerSetupCommands(bot);
    } else {
      console.error('setup.registerSetupCommands is not a function');
    }
    
    if (typeof challenge.registerChallengeCommands === 'function') {
      challenge.registerChallengeCommands(bot);
    } else {
      console.error('challenge.registerChallengeCommands is not a function');
    }
    
    if (typeof user.registerUserCommands === 'function') {
      user.registerUserCommands(bot);
    } else {
      console.error('user.registerUserCommands is not a function');
    }
  }
  
  module.exports = {
    getTimeLeft,
    setupCommands
  };