// scenes/challenge/validation.js

// Error emoji rotation for visual distinction
const ERROR_EMOJIS = ['⚠️', '❌', '🚫', '⛔️'];
let currentEmojiIndex = 0;

// Get next error emoji in rotation
function getNextErrorEmoji() {
  const emoji = ERROR_EMOJIS[currentEmojiIndex];
  currentEmojiIndex = (currentEmojiIndex + 1) % ERROR_EMOJIS.length;
  return emoji;
}

module.exports = {
  getNextErrorEmoji
};