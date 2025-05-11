// services/wallet.js
const logger = require('../utils/logger');
const oxapayCurl = require('./oxapayCurl');

class WalletService {
  constructor() {
    this.baseUrl = 'https://api.oxapay.com/v1';
  }

  /**
   * Create a wallet based on currency type
   * @param {string} currency - 'Solana' or 'Ethereum'
   * @returns {Promise<Object>} Wallet data
   */
  async createWallet(currency) {
    try {
      logger.info(`Creating ${currency} wallet using OxaPay`);
      
      // Map currency to OxaPay network
      let network;
      
      if (currency === 'Solana') {
        network = 'SOL';
      } else if (currency === 'Ethereum') {
        network = 'ETH';
      } else {
        throw new Error(`Unsupported currency: ${currency}`);
      }

      const requestData = {
        network: network,
        auto_withdrawal: 0 // Keep funds in OxaPay balance
      };

      // Create static address
      const response = await oxapayCurl.post('/payment/static-address', requestData);
      
      if (response.error && Object.keys(response.error).length > 0) {
        throw new Error(`API error: ${response.error.message || JSON.stringify(response.error)}`);
      }
      
      if (!response.data || !response.data.address) {
        throw new Error('Invalid response: missing address');
      }
      
      logger.info(`${currency} wallet created successfully with OxaPay`, {
        hasAddress: !!response.data.address,
        trackId: response.data.track_id
      });
      
      return {
        address: response.data.address,
        trackId: response.data.track_id
      };
    } catch (error) {
      this._handleApiError('Error creating wallet', error, { currency });
      throw new Error(`Failed to create ${currency} wallet: ${this._getErrorMessage(error)}`);
    }
  }
  
  /**
   * Check balance based on currency type and trackId or address
   * @param {string} currency - 'Solana' or 'Ethereum'
   * @param {string} address - Wallet address or trackId
   * @returns {Promise<string>} Balance as a string
   */
  async checkBalance(currency, address) {
    try {
      logger.info(`Checking ${currency} balance for address/trackId ${address}`);
      
      // First try to find a challenge with this address to get the trackId
      const Challenge = require('../models/challenge');
      let trackId = address;
      
      const challenge = await Challenge.findOne({ walletAddress: address });
      if (challenge && challenge.trackId) {
        trackId = challenge.trackId;
      }
      
      const response = await oxapayCurl.get(`/payment/${trackId}`);
      
      if (response.error && Object.keys(response.error).length > 0) {
        throw new Error(`API error: ${response.error.message || JSON.stringify(response.error)}`);
      }
      
      if (!response.data) {
        throw new Error('Invalid response: missing data');
      }
      
      // Calculate total balance from all transactions
      let balance = "0";
      if (response.data.txs && response.data.txs.length > 0) {
        // Sum up all confirmed transaction amounts
        const confirmedTxs = response.data.txs.filter(tx => tx.status === 'confirmed');
        if (confirmedTxs.length > 0) {
          balance = confirmedTxs.reduce((sum, tx) => sum + parseFloat(tx.amount), 0).toString();
        }
      }
      
      logger.info(`Balance check successful: ${balance} ${currency}`);
      return balance;
    } catch (error) {
      this._handleApiError('Error checking balance', error, { currency, address });
      // Return 0 balance on error instead of throwing, to make the app more resilient
      logger.warn(`Returning 0 balance due to API error for ${address}`);
      return "0";
    }
  }

  /**
   * Transfer funds based on currency type
   * @param {string} currency - 'Solana' or 'Ethereum'
   * @param {string} fromAddress - Sender address (not used with OxaPay)
   * @param {string} toAddress - Recipient address
   * @param {string} amount - Amount to send
   * @returns {Promise<string>} Transaction ID
   */
  async transferFunds(currency, fromAddress, toAddress, amount) {
    try {
      logger.info(`Initiating ${currency} transfer with OxaPay`, {
        to: toAddress,
        amount,
        currency
      });
      
      // Map currency to OxaPay format
      let oxapayCurrency;
      let network;
      
      if (currency === 'Solana') {
        oxapayCurrency = 'SOL';
        network = 'SOL';
      } else if (currency === 'Ethereum') {
        oxapayCurrency = 'ETH';
        network = 'ETH';
      } else {
        throw new Error(`Unsupported currency: ${currency}`);
      }
      
      // Create payout request
      const requestData = {
        address: toAddress,
        amount: parseFloat(amount),
        currency: oxapayCurrency,
        network: network,
        description: `Prize payment`
      };
      
      const response = await oxapayCurl.post('/payout', requestData, true); // true for payout API
      
      if (response.error && Object.keys(response.error).length > 0) {
        throw new Error(`API error: ${response.error.message || JSON.stringify(response.error)}`);
      }
      
      if (!response.data || !response.data.track_id) {
        throw new Error('Invalid response: missing track_id');
      }
      
      logger.info(`${currency} transfer initiated successfully, trackId: ${response.data.track_id}`);
      
      return response.data.track_id;
    } catch (error) {
      this._handleApiError('Error transferring funds', error, {
        currency,
        fromAddress,
        toAddress,
        amount
      });
      throw new Error(`Failed to transfer funds: ${this._getErrorMessage(error)}`);
    }
  }
  
  /**
   * Handle API errors consistently
   * @param {string} message - Error message
   * @param {Error} error - Error object
   * @param {Object} context - Additional context
   * @private
   */
  _handleApiError(message, error, context = {}) {
    // Log detailed info about the error
    logger.error(message, {
      ...context,
      error: {
        message: error.message,
        stack: error.stack
      }
    });
    
    // Check for specific error messages
    const errorMsg = this._getErrorMessage(error).toLowerCase();
    if (errorMsg.includes('forbidden') || errorMsg.includes('403')) {
      logger.error('API access forbidden. This may be due to an invalid API key or insufficient permissions.');
    } else if (errorMsg.includes('unauthorized') || errorMsg.includes('401')) {
      logger.error('API authentication failed. Please check your API key.');
    } else if (errorMsg.includes('rate limit') || errorMsg.includes('429')) {
      logger.error('API rate limit exceeded. Please reduce request frequency.');
    }
  }
  
  /**
   * Get a user-friendly error message
   * @param {Error} error - Error object
   * @returns {string} Error message
   * @private
   */
  _getErrorMessage(error) {
    if (error.response && error.response.data) {
      if (error.response.data.message) {
        return error.response.data.message;
      } else if (error.response.data.error) {
        return error.response.data.error;
      }
    }
    
    return error.message || 'Unknown error';
  }
}

module.exports = new WalletService();