// admin/backend/scripts/diagnose-db.js
require('dotenv').config();
const mongoose = require('mongoose');
const path = require('path');
const config = require('../config/config');

// Log config values
console.log('MongoDB URI exists:', !!config.mongoUri);
console.log('Database Name:', config.dbName);

async function diagnoseConnection() {
  try {
    console.log('Attempting MongoDB connection...');
    
    // Connect to MongoDB with explicit options
    await mongoose.connect(config.mongoUri, {
      dbName: config.dbName,
      connectTimeoutMS: 5000, // 5 seconds
      socketTimeoutMS: 45000, // 45 seconds
    });
    
    console.log('Connected to MongoDB successfully!');
    console.log('Connection state:', mongoose.connection.readyState);
    
    // List all collections in the database
    console.log('Listing collections:');
    const collections = await mongoose.connection.db.listCollections().toArray();
    collections.forEach(collection => {
      console.log(`- ${collection.name}`);
    });
    
    // Try to import the User model from main app
    try {
      const mainAppUserPath = path.join(__dirname, '../../../models/user');
      console.log('Main app user model path:', mainAppUserPath);
      
      // Check if file exists
      const fs = require('fs');
      const exists = fs.existsSync(mainAppUserPath + '.js');
      console.log('User model file exists:', exists);
      
      // Try to import
      console.log('Importing User model...');
      const UserSchema = require(mainAppUserPath);
      console.log('User schema imported successfully');
      
      // Define a model
      if (!mongoose.models.User) {
        console.log('Registering User model...');
        mongoose.model('User', UserSchema);
        console.log('User model registered');
      } else {
        console.log('User model already registered');
      }
      
      // Try a count query
      console.log('Attempting countDocuments query...');
      const User = mongoose.model('User');
      console.log('Model loaded:', !!User);
      
      // Execute the count with a timeout
      const countPromise = User.countDocuments();
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Count operation timed out')), 5000)
      );
      
      const count = await Promise.race([countPromise, timeoutPromise]);
      console.log('Count result:', count);
    } catch (err) {
      console.error('Error with User model:', err);
    }
    
  } catch (err) {
    console.error('MongoDB connection error:', err);
  } finally {
    // Close the connection
    await mongoose.connection.close();
    console.log('Connection closed');
  }
}

diagnoseConnection();