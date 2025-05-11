// utils/challenges/index.js
const finalization = require('./finalization');
const payments = require('./payments');
const voting = require('./voting');
const admin = require('./admin');

module.exports = {
  finalizeChallenge: finalization.finalizeChallenge,
  announceWinner: finalization.announceWinner,
  checkForFinalizableChallenges: finalization.checkForFinalizableChallenges,
  checkChallengePayment: payments.checkChallengePayment,
  processPrizePayment: payments.processPrizePayment,
  notifyVotingPhase: voting.notifyVotingPhase
};