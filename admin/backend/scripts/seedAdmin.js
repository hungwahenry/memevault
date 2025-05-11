// admin/backend/scripts/seedAdmin.js
require('dotenv').config();
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const config = require('../config/config');

// Define AdminUser schema
const adminSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  password: {
    type: String,
    required: true
  },
  role: {
    type: String,
    enum: ['admin', 'superadmin'],
    default: 'admin'
  },
  lastLogin: {
    type: Date
  },
  telegramId: {
    type: String
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
}, { 
  timestamps: true,
  collection: 'admin_users' // Use the same collection as in the auth controller
});

// Register the model
const AdminUser = mongoose.model('AdminUser', adminSchema);

async function seedAdmin() {
  try {
    // Connect to MongoDB
    console.log('Connecting to MongoDB...');
    console.log(`Database: ${config.dbName}`);
    
    await mongoose.connect(config.mongoUri, {
      dbName: config.dbName,
    });
    console.log(`Connected to MongoDB database: ${config.dbName}`);
    
    // Check if admin user exists
    const adminCount = await AdminUser.countDocuments();
    if (adminCount > 0) {
      console.log('Admin user already exists. Skipping seed process.');
      return;
    }
    
    // Check credentials
    if (!config.adminUsername || !config.adminPassword) {
      console.error('Admin username and/or password not provided in environment variables.');
      return;
    }
    
    // Create default superadmin
    console.log('Creating default admin account...');
    
    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(config.adminPassword, salt);
    
    // Create admin
    const admin = new AdminUser({
      username: config.adminUsername,
      password: hashedPassword,
      role: 'superadmin',
      telegramId: config.botOwnerId || null
    });
    
    await admin.save();
    
    console.log(`Admin user '${config.adminUsername}' created successfully.`);
  } catch (error) {
    console.error('Error seeding admin user:', error);
  } finally {
    // Close database connection
    await mongoose.connection.close();
    console.log('Database connection closed.');
  }
}

// Run the seed function
seedAdmin();