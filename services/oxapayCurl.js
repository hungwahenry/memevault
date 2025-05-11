// services/oxapayCurl.js
const { exec } = require('child_process');
const { promisify } = require('util');
const logger = require('../utils/logger');

const execPromise = promisify(exec);

class OxapayCurlService {
  constructor() {
    this.merchantApiKey = process.env.OXAPAY_MERCHANT_API_KEY;
    this.payoutApiKey = process.env.OXAPAY_PAYOUT_API_KEY;
    this.baseUrl = 'https://api.oxapay.com/v1';
  }

  /**
   * Execute a curl command and parse the response
   * @param {string} method - HTTP method (GET, POST, etc.)
   * @param {string} endpoint - API endpoint
   * @param {Object} data - Request body for POST/PUT requests
   * @param {boolean} isPayout - Whether this is a payout operation requiring payout_api_key
   * @returns {Promise<Object>} - Parsed response
   */
  async executeCurl(method, endpoint, data = null, isPayout = false) {
    try {
      const url = `${this.baseUrl}${endpoint}`;
      const apiKey = isPayout ? this.payoutApiKey : this.merchantApiKey;
      const apiKeyHeader = isPayout ? "payout_api_key" : "merchant_api_key";
      
      // Build curl command
      let curlCmd = `curl -s -X ${method} "${url}" -H "${apiKeyHeader}: ${apiKey}" -H "Content-Type: application/json"`;
      
      // Add request body if provided
      if (data && (method === 'POST' || method === 'PUT')) {
        // Escape double quotes in JSON for shell safety
        const jsonData = JSON.stringify(data).replace(/"/g, '\\"');
        curlCmd += ` -d "${jsonData}"`;
      }
      
      logger.debug(`Executing curl command for ${method} ${endpoint}`);
      
      const { stdout, stderr } = await execPromise(curlCmd);
      
      if (stderr) {
        logger.error(`Curl command error: ${stderr}`);
        throw new Error(`Curl error: ${stderr}`);
      }

      logger.debug(`Raw curl response for ${endpoint}:`, { stdout });
      
      // Parse response
      try {
        // Handle empty responses
        if (!stdout.trim()) {
          return {};
        }
        
        return JSON.parse(stdout);
      } catch (parseError) {
        logger.error(`Error parsing curl response: ${parseError.message}`, {
          stdout,
          parseError
        });
        
        if (stdout.trim()) {
            return stdout.trim();
        }
        
        throw new Error(`Failed to parse response: ${parseError.message}`);
      }
    } catch (error) {
      logger.error(`Error executing curl command: ${error.message}`, { error });
      throw error;
    }
  }

  /**
   * Make a GET request
   * @param {string} endpoint - API endpoint
   * @param {boolean} isPayout - Whether this is a payout operation
   * @returns {Promise<Object>} - Response data
   */
  async get(endpoint, isPayout = false) {
    return this.executeCurl('GET', endpoint, null, isPayout);
  }

  /**
   * Make a POST request
   * @param {string} endpoint - API endpoint
   * @param {Object} data - Request body
   * @param {boolean} isPayout - Whether this is a payout operation
   * @returns {Promise<Object>} - Response data
   */
  async post(endpoint, data, isPayout = false) {
    return this.executeCurl('POST', endpoint, data, isPayout);
  }
}

module.exports = new OxapayCurlService();