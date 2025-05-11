// admin/backend/utils/database.js
const mongoose = require('mongoose');
const config = require('../config/config');

// Log critical Mongoose events
mongoose.connection.on('connecting', () => {
  console.log('MongoDB: Connecting...');
});

mongoose.connection.on('connected', () => {
  console.log('MongoDB: Connected');
});

mongoose.connection.on('disconnecting', () => {
  console.log('MongoDB: Disconnecting...');
});

mongoose.connection.on('disconnected', () => {
  console.log('MongoDB: Disconnected');
});

mongoose.connection.on('error', (err) => {
  console.error('MongoDB connection error:', err);
});

// Connect function
const connect = async () => {
  // Set a longer timeout for operations (30 seconds)
  mongoose.set('bufferTimeoutMS', 30000);
  
  // Disable buffering to prevent timeout issues
  mongoose.set('bufferCommands', false);
  
  if (mongoose.connection.readyState === 1) {
    console.log('Already connected to MongoDB');
    return mongoose.connection;
  }

  try {
    console.log(`Connecting to MongoDB: ${config.mongoUri ? '[URI HIDDEN]' : 'Missing URI'}`);
    console.log(`Database: ${config.dbName}`);
    
    // Create connection
    const conn = await mongoose.connect(config.mongoUri, {
      dbName: config.dbName,
      connectTimeoutMS: 10000,
      socketTimeoutMS: 45000,
    });
    
    console.log(`MongoDB connected successfully to database: ${config.dbName}`);
    return conn;
  } catch (error) {
    console.error('MongoDB connection failed:', error);
    throw error;
  }
};

// Check connection state
const getState = () => {
  const states = ['disconnected', 'connected', 'connecting', 'disconnecting'];
  return {
    readyState: mongoose.connection.readyState,
    stateText: states[mongoose.connection.readyState] || 'unknown'
  };
};

// Close connection
const close = async () => {
  if (mongoose.connection.readyState !== 0) {
    console.log('Closing MongoDB connection...');
    await mongoose.connection.close();
    console.log('MongoDB connection closed');
  }
};

module.exports = {
  connect,
  getState,
  close,
  mongoose
};