// models/challenge.js
const mongoose = require('mongoose');

const challengeSchema = new mongoose.Schema({
  groupId: {
    type: String,
    required: true,
    ref: 'Group'
  },
  creatorId: {
    type: String,
    required: true
  },
  title: {
    type: String,
    required: true
  },
  description: {
    type: String,
    required: true
  },
  startDate: {
    type: Date,
    required: true
  },
  endDate: {
    type: Date,
    required: true
  },
  currency: {
    type: String,
    enum: ['Solana', 'Ethereum'],
    required: true
  },
  prizePool: {
    type: String,
    required: true
  },
  votingMethod: {
    type: String,
    enum: ['admin', 'community'],
    required: true
  },
  entriesPerUser: {
    type: Number,
    required: true
  },
  maxEntries: {
    type: Number,
    required: true
  },
  walletAddress: {
    type: String
  },
  privateKeyEncrypted: {
    type: String
  },
  privateKeyIv: {
    type: String
  },
  trackId: {
    type: String
  },
  funded: {
    type: Boolean,
    default: false
  },
  active: {
    type: Boolean,
    default: false
  },
  completed: {
    type: Boolean,
    default: false
  },
  winner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Submission'
  },
  retryCount: {
    type: Number,
    default: 0
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Pre-save middleware to update the updatedAt field
challengeSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model('Challenge', challengeSchema);