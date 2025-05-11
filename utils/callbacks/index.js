// utils/callbacks/index.js
const submissionCallbacks = require('./submission');
const votingCallbacks = require('./voting');
const fundingCallbacks = require('./funding');
const adminCallbacks = require('./admin');
const utilityCallbacks = require('./utility');
const { countUniqueVoters, countEligibleVoters } = require('./helpers');

function handleCallbacks(bot) {
  submissionCallbacks(bot);
  votingCallbacks(bot);
  fundingCallbacks(bot);
  adminCallbacks(bot);
  utilityCallbacks(bot);
}

module.exports = {
  handleCallbacks,
  countUniqueVoters,
  countEligibleVoters
};