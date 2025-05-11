// admin/backend/config/config.js
require('dotenv').config();

module.exports = {
  port: process.env.ADMIN_PORT || 3001,
  jwtSecret: process.env.JWT_SECRET || 'your-secret-key',
  jwtExpiry: process.env.JWT_EXPIRY || '24h',
  mongoUri: process.env.MONGODB_URI || 'mongodb://localhost:27017/memevault',
  dbName: process.env.MONGODB_DB_NAME || 'memevault', // Explicit database name
  adminUsername: process.env.ADMIN_USERNAME || 'admin',
  adminPassword: process.env.ADMIN_PASSWORD,
  botToken: process.env.BOT_TOKEN,
  botOwnerId: process.env.BOT_OWNER_ID
};