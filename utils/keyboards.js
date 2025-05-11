// utils/keyboards.js
const { Markup } = require('telegraf');

// Keyboard for admin setup
function getAdminKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('Yes, add more admins', 'add_admins'),
      Markup.button.callback('No, continue', 'no_admins')
    ]
  ]);
}

// Keyboard for currency selection
function getCurrencyKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('Solana', 'Solana'),
      Markup.button.callback('Ethereum', 'Ethereum')
    ]
  ]);
}

// Keyboard for voting method selection
function getVotingMethodKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('Admin Selection', 'admin'),
      Markup.button.callback('Community Voting', 'community')
    ]
  ]);
}

// Keyboard for challenge confirmation
function getConfirmChallengeKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('✅ Confirm', 'confirm_challenge'),
      Markup.button.callback('❌ Cancel', 'cancel_challenge')
    ]
  ]);
}

// Keyboard for submission confirmation
function getSubmissionKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('✅ Confirm', 'confirm_submission'),
      Markup.button.callback('🔄 Try Again', 'retry_submission')
    ]
  ]);
}

// Skip button
function getSkipButton() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('Skip', 'skip')]
  ]);
}

// Keyboard for voting
function getVotingKeyboard(submissions, currentIndex) {
  const total = submissions.length;
  
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('⬅️ Previous', `prev_${currentIndex}`),
      Markup.button.callback(`${currentIndex + 1}/${total}`, 'count'),
      Markup.button.callback('➡️ Next', `next_${currentIndex}`)
    ],
    [
      Markup.button.callback('👍 Vote for this meme', `vote_${submissions[currentIndex]._id}`)
    ]
  ]);
}

module.exports = {
  getAdminKeyboard,
  getCurrencyKeyboard,
  getVotingMethodKeyboard,
  getConfirmChallengeKeyboard,
  getSubmissionKeyboard,
  getSkipButton,
  getVotingKeyboard
};