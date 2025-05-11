// models/submission.js
const mongoose = require('mongoose');

const submissionSchema = new mongoose.Schema({
  challengeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Challenge',
    required: true
  },
  userId: {
    type: String,
    required: true
  },
  username: {
    type: String
  },
  imageFileId: {
    type: String,
    required: true
  },
  caption: {
    type: String
  },
  votes: {
    type: Number,
    default: 0
  },
  voters: {
    type: [String],
    default: []
  },
  winnerWalletAddress: {
    type: String
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Submission', submissionSchema);