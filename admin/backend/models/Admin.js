// admin/backend/models/Admin.js
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

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
}, { timestamps: true });

// Hash password before saving
adminSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  
  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Method to check password validity
adminSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Static method to initialize default admin if none exists
adminSchema.statics.initializeDefaultAdmin = async function() {
  const AdminModel = this;
  const adminCount = await AdminModel.countDocuments();
  
  if (adminCount === 0) {
    const config = require('../config/config');
    
    // Create default admin account from config if it doesn't exist
    if (config.adminUsername && config.adminPassword) {
      console.log('Creating default admin account...');
      await AdminModel.create({
        username: config.adminUsername,
        password: config.adminPassword,
        role: 'superadmin',
        telegramId: config.botOwnerId
      });
      console.log('Default admin account created successfully.');
    }
  }
};

const Admin = mongoose.model('Admin', adminSchema);

module.exports = Admin;