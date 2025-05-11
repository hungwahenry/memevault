// utils/callbacks/helpers.js
const { Telegraf } = require('telegraf');
const Submission = require('../../models/submission');
const logger = require('../logger');

// Count unique voters in a challenge
async function countUniqueVoters(challengeId) {
  const submissions = await Submission.find({ challengeId });
  const uniqueVoters = new Set();
  
  submissions.forEach(submission => {
    submission.voters.forEach(voter => uniqueVoters.add(voter));
  });
  
  return uniqueVoters.size;
}

// Count members who can vote in the group
async function countEligibleVoters(groupId) {
  try {
    const bot = new Telegraf(process.env.BOT_TOKEN);
    const chatMembersCount = await bot.telegram.getChatMembersCount(groupId);
    // Subtract bots, anonymous admins, etc. (rough estimate)
    return Math.max(chatMembersCount - 5, 10);
  } catch (error) {
    logger.error('Error counting eligible voters:', {error, groupId});
    return 100; // Default fallback number
  }
}

module.exports = {
  countUniqueVoters,
  countEligibleVoters
};