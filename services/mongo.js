// services/mongo.js
const mongoose = require('mongoose');
const logger = require('../utils/logger');

async function connectMongo() {
  const mongoURI = process.env.MONGODB_URI;
  const dbName = process.env.MONGODB_NAME;

  if (!mongoURI) {
    logger.error('MONGODB_URI environment variable is not set.');
    process.exit(1);
  }

  if (!dbName) {
    logger.error('MONGODB_NAME environment variable is not set.');
    process.exit(1);
  }

  try {
    // Connect using Mongoose, specifying the database name
    await mongoose.connect(mongoURI, {
      dbName: dbName,
    });
    logger.info(`Successfully connected to MongoDB database: ${dbName}`);
  } catch (error) {
    logger.error('MongoDB connection error:', { dbName: dbName, error: error.message || error });
    process.exit(1);
  }

  //Listen for connection events
  mongoose.connection.on('error', err => {
    logger.error('Mongoose connection error after initial connection:', { error: err });
  });

  mongoose.connection.on('disconnected', () => {
    logger.warn('Mongoose connection disconnected.');
  });
}

module.exports = {
  connectMongo
};
