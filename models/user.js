// models/user.js
const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true,
    unique: true
  },
  username: {
    type: String
  },
  firstName: {
    type: String
  },
  lastName: {
    type: String
  },
  languageCode: {
    type: String
  },
  joinedDate: {
    type: Date,
    default: Date.now
  },
  lastInteraction: {
    type: Date,
    default: Date.now
  },
  groups: {
    type: [String],
    default: []
  },
  interactionCount: {
    type: Number,
    default: 1
  },
  challengesCreated: {
    type: Number,
    default: 0
  },
  submissionsCount: {
    type: Number,
    default: 0
  },
  winCount: {
    type: Number,
    default: 0
  },
  totalVotesCast: {
    type: Number,
    default: 0
  },
  userType: {
    type: String,
    enum: ['regular', 'admin', 'active_creator', 'active_participant', 'winner', 'inactive'],
    default: 'regular'
  },
  tags: {
    type: [String],
    default: []
  },
  // Ban fields with default values
  banned: {
    type: Boolean,
    default: false
  },
  banReason: {
    type: String,
    default: null
  },
  bannedAt: {
    type: Date,
    default: null
  },
  bannedBy: {
    type: String,
    default: null
  },
  banExpires: {
    type: Date,
    default: null // null means permanent ban
  }
});

// Helper method to check if user is currently banned
userSchema.methods.isBanned = function() {
  if (!this.banned) return false;
  
  // If banExpires is null, it's a permanent ban
  if (!this.banExpires) return true;
  
  // Check if ban has expired
  return new Date() < this.banExpires;
};

module.exports = mongoose.model('User', userSchema);