// models/group.js
const mongoose = require('mongoose');

const groupSchema = new mongoose.Schema({
  groupId: {
    type: String,
    required: true,
    unique: true
  },
  title: {
    type: String,
    required: true
  },
  adminIds: {
    type: [String],
    default: []
  },
  setupComplete: {
    type: Boolean,
    default: false
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

module.exports = mongoose.model('Group', groupSchema);