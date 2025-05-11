// utils/validation.js
const logger = require('./logger');
const { format } = require('date-fns');

/**
 * Validate wallet address based on currency type
 * @param {string} address - Wallet address to validate
 * @param {string} currency - Currency type (Solana, Ethereum)
 * @returns {boolean} Whether the address is valid
 */
function validateWalletAddress(address, currency) {
  try {
    if (!address || typeof address !== 'string') {
      logger.warn('Invalid wallet address format', {address, currency});
      return false;
    }
    
    if (currency === 'Solana') {
      // Solana address validation (check if it's a base58 string of correct length)
      const isValid = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
      if (!isValid) {
        logger.warn('Invalid Solana address format', {address});
      }
      return isValid;
    } else if (currency === 'Ethereum') {
      // ETH address validation (check if it's a hex string starting with 0x)
      const isValid = /^0x[a-fA-F0-9]{40}$/.test(address);
      if (!isValid) {
        logger.warn('Invalid Ethereum address format', {address});
      }
      return isValid;
    }
    
    logger.warn('Unsupported currency for wallet validation', {currency});
    return false;
  } catch (error) {
    logger.error('Error validating wallet address:', {error, address, currency});
    return false;
  }
}

/**
 * Validate challenge title
 * @param {string} title - Challenge title
 * @returns {Object} Validation result with isValid and error message
 */
function validateChallengeTitle(title) {
  try {
    if (!title || typeof title !== 'string') {
      return { isValid: false, errorMessage: ' Title must be provided' };
    }
    
    if (title.length < parseInt(process.env.MIN_CHALLENGE_TITLE_LENGTH || '3')) {
      return { 
        isValid: false, 
        errorMessage: ` Title is too short, must be at least ${process.env.MIN_CHALLENGE_TITLE_LENGTH || '3'} characters` 
      };
    }
    
    if (title.length > parseInt(process.env.MAX_CHALLENGE_TITLE_LENGTH || '100')) {
      return { 
        isValid: false, 
        errorMessage: ` Title is too long, must be at most ${process.env.MAX_CHALLENGE_TITLE_LENGTH || '100'} characters` 
      };
    }
    
    return { isValid: true };
  } catch (error) {
    logger.error('Error validating challenge title:', {error, title});
    return { isValid: false, errorMessage: ' Error validating title' };
  }
}

/**
 * Validate challenge description
 * @param {string} description - Challenge description
 * @returns {Object} Validation result with isValid and error message
 */
function validateChallengeDescription(description) {
  try {
    if (!description || typeof description !== 'string') {
      return { isValid: false, errorMessage: ' Description must be provided' };
    }
    
    if (description.length < parseInt(process.env.MIN_CHALLENGE_DESCRIPTION_LENGTH || '10')) {
      return { 
        isValid: false, 
        errorMessage: ` Description is too short, must be at least ${process.env.MIN_CHALLENGE_DESCRIPTION_LENGTH || '10'} characters` 
      };
    }
    
    if (description.length > parseInt(process.env.MAX_CHALLENGE_DESCRIPTION_LENGTH || '1000')) {
      return { 
        isValid: false, 
        errorMessage: ` Description is too long, must be at most ${process.env.MAX_CHALLENGE_DESCRIPTION_LENGTH || '1000'} characters` 
      };
    }
    
    return { isValid: true };
  } catch (error) {
    logger.error('Error validating challenge description:', {error, description});
    return { isValid: false, errorMessage: ' Error validating description' };
  }
}

/**
 * Validate challenge duration in days
 * @param {string|number} duration - Duration in days
 * @returns {Object} Validation result with isValid and error message
 */
function validateChallengeDuration(duration) {
  try {
    const parsedDuration = parseInt(duration);
    
    if (isNaN(parsedDuration)) {
      return { isValid: false, errorMessage: ' Duration must be a number' };
    }
    
    const minDuration = parseInt(process.env.MIN_CHALLENGE_DURATION || '1');
    const maxDuration = parseInt(process.env.MAX_CHALLENGE_DURATION || '30');
    
    if (parsedDuration < minDuration) {
      return { 
        isValid: false, 
        errorMessage: ` Duration must be at least ${minDuration} day${minDuration > 1 ? 's' : ''}` 
      };
    }
    
    if (parsedDuration > maxDuration) {
      return { 
        isValid: false, 
        errorMessage: ` Duration must be at most ${maxDuration} days` 
      };
    }
    
    return { isValid: true, value: parsedDuration };
  } catch (error) {
    logger.error('Error validating challenge duration:', {error, duration});
    return { isValid: false, errorMessage: ' Error validating duration' };
  }
}

/**
 * Validate prize pool amount
 * @param {string|number} amount - Prize pool amount
 * @param {string} currency - Currency type (Solana, Ethereum)
 * @returns {Object} Validation result with isValid, error message, and warning
 */
function validatePrizePool(amount, currency) {
  try {
    const parsedAmount = parseFloat(amount);
    
    if (isNaN(parsedAmount)) {
      return { isValid: false, errorMessage: ' Prize amount must be a number' };
    }
    
    if (parsedAmount <= 0) {
      return { isValid: false, errorMessage: ' Prize amount must be greater than 0' };
    }
    
    let warning = null;
    let isReasonable = true;
    
    // Check if amount is reasonably high based on currency
    const maxReasonableAmount = currency === 'Solana' 
      ? parseFloat(process.env.MAX_REASONABLE_SOLANA_AMOUNT || '1000')
      : parseFloat(process.env.MAX_REASONABLE_ETHEREUM_AMOUNT || '10');
    
    if (parsedAmount > maxReasonableAmount) {
      warning = ` The amount you entered (${parsedAmount} ${currency}) seems unusually high. Are you sure?`;
      isReasonable = false;
    }
    
    return { 
      isValid: true, 
      value: parsedAmount, 
      warning,
      isReasonable 
    };
  } catch (error) {
    logger.error('Error validating prize pool:', {error, amount, currency});
    return { isValid: false, errorMessage: ' Error validating prize amount' };
  }
}

/**
 * Validate entries per user
 * @param {string|number} entries - Number of entries per user
 * @returns {Object} Validation result with isValid and error message
 */
function validateEntriesPerUser(entries) {
  try {
    const parsedEntries = parseInt(entries);
    
    if (isNaN(parsedEntries)) {
      return { isValid: false, errorMessage: ' Entries per user must be a number' };
    }
    
    const minEntries = parseInt(process.env.MIN_ENTRIES_PER_USER || '1');
    const maxEntries = parseInt(process.env.MAX_ENTRIES_PER_USER || '10');
    
    if (parsedEntries < minEntries) {
      return { 
        isValid: false, 
        errorMessage: ` Entries per user must be at least ${minEntries}` 
      };
    }
    
    if (parsedEntries > maxEntries) {
      return { 
        isValid: false, 
        errorMessage: ` Entries per user must be at most ${maxEntries}` 
      };
    }
    
    return { isValid: true, value: parsedEntries };
  } catch (error) {
    logger.error('Error validating entries per user:', {error, entries});
    return { isValid: false, errorMessage: ' Error validating entries per user' };
  }
}

/**
 * Validate max entries
 * @param {string|number} maxEntries - Maximum number of entries
 * @returns {Object} Validation result with isValid and error message
 */
function validateMaxEntries(maxEntries) {
  try {
    const parsedMaxEntries = parseInt(maxEntries);
    
    if (isNaN(parsedMaxEntries)) {
      return { isValid: false, errorMessage: ' Max entries must be a number' };
    }
    
    if (parsedMaxEntries < 0) {
      return { isValid: false, errorMessage: ' Max entries cannot be negative' };
    }
    
    const absoluteMaxEntries = parseInt(process.env.ABSOLUTE_MAX_ENTRIES || '1000');
    
    if (parsedMaxEntries > absoluteMaxEntries && parsedMaxEntries !== 0) {
      return { 
        isValid: false, 
        errorMessage: ` Max entries must be at most ${absoluteMaxEntries} (or 0 for unlimited)` 
      };
    }
    
    return { isValid: true, value: parsedMaxEntries };
  } catch (error) {
    logger.error('Error validating max entries:', {error, maxEntries});
    return { isValid: false, errorMessage: ' Error validating max entries' };
  }
}

/**
 * Format a date consistently
 * @param {Date} date - Date to format
 * @returns {string} Formatted date string
 */
function formatDate(date) {
  try {
    return format(date, process.env.DATE_FORMAT || 'PPP'); // 'PPP' is a preset for full date format
  } catch (error) {
    logger.error('Error formatting date:', {error, date});
    return date.toLocaleDateString();
  }
}

module.exports = {
  validateWalletAddress,
  validateChallengeTitle,
  validateChallengeDescription,
  validateChallengeDuration,
  validatePrizePool,
  validateEntriesPerUser,
  validateMaxEntries,
  formatDate
};