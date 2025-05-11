// admin/backend/controllers/challengeController.js
const models = require('../models/direct-access');
const { mongoose } = require('../utils/database');

// Utility function for safe database operations
const safeDbOp = async (operation, fallbackValue = null) => {
  try {
    return await operation();
  } catch (error) {
    console.error('Database operation error:', error);
    return fallbackValue;
  }
};

// Helper to check if string is valid MongoDB ObjectId
const isValidObjectId = (id) => {
  return mongoose.Types.ObjectId.isValid(id);
};

// Helper to convert string to ObjectId
const toObjectId = (id) => {
  return isValidObjectId(id) ? new mongoose.Types.ObjectId(id) : id;
};

// Get all challenges with pagination
exports.getChallenges = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    const status = req.query.status || 'all';
    
    // Build query based on status
    let query = {};
    
    if (status === 'active') {
      query.active = true;
      query.completed = false;
    } else if (status === 'completed') {
      query.completed = true;
    } else if (status === 'pending') {
      query.active = false;
      query.completed = false;
    }
    
    // Execute query with pagination
    const challenges = await models.Challenge.find(query, {}, { 
      sort: { createdAt: -1 },
      skip, 
      limit 
    });
    
    // Get group information for each challenge
    const challengesWithGroupInfo = [];
    const groupIds = [...new Set(challenges.map(c => c.groupId))];
    const groups = await models.Group.find({ groupId: { $in: groupIds } });
    
    // Count submissions for each challenge
    const challengeIds = challenges.map(c => c._id);
    const submissionCounts = {};
    
    // Use aggregation to get counts
    const submissionStats = await models.Submission.aggregate([
      { $match: { challengeId: { $in: challengeIds } } },
      { $group: { _id: '$challengeId', count: { $sum: 1 } } }
    ]);
    
    submissionStats.forEach(stat => {
      submissionCounts[stat._id.toString()] = stat.count;
    });
    
    // Combine challenge data with group info and submission counts
    for (const challenge of challenges) {
      const group = groups.find(g => g.groupId === challenge.groupId);
      
      challengesWithGroupInfo.push({
        ...challenge,
        groupTitle: group ? group.title : 'Unknown Group',
        submissionCount: submissionCounts[challenge._id.toString()] || 0
      });
    }
    
    // Get total count for pagination
    const total = await models.Challenge.countDocuments(query);
    
    res.status(200).json({
      success: true,
      message: 'Challenges retrieved successfully',
      data: {
        challenges: challengesWithGroupInfo,
        pagination: {
          total,
          page,
          limit,
          pages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error) {
    console.error('Error fetching challenges:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve challenges'
    });
  }
};

// Get a single challenge by ID
exports.getChallenge = async (req, res) => {
  try {
    const id = req.params.id;
    
    // Validate MongoDB ObjectId
    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid challenge ID'
      });
    }
    
    // Find challenge
    const challenge = await models.Challenge.findById(id);
    
    if (!challenge) {
      return res.status(404).json({
        success: false,
        message: 'Challenge not found'
      });
    }
    
    // Get group information
    const group = await models.Group.findOne({ groupId: challenge.groupId });
    
    // Get submissions for this challenge
    const submissions = await models.Submission.find(
      { challengeId: toObjectId(challenge._id) },
      {},
      { sort: { votes: -1, createdAt: -1 } }
    );
    
    // Get creator info
    const creator = await models.User.findOne({ userId: challenge.creatorId });
    
    res.status(200).json({
      success: true,
      message: 'Challenge retrieved successfully',
      data: { 
        challenge,
        group: group ? {
          id: group._id,
          groupId: group.groupId,
          title: group.title,
          adminIds: group.adminIds
        } : null,
        creator: creator ? {
          _id: creator._id,
          userId: creator.userId,
          username: creator.username,
          firstName: creator.firstName,
          lastName: creator.lastName
        } : null,
        submissions
      }
    });
  } catch (error) {
    console.error('Error fetching challenge:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve challenge'
    });
  }
};

// Update a challenge
exports.updateChallenge = async (req, res) => {
  try {
    const id = req.params.id;
    const updateData = req.body;
    
    // Validate MongoDB ObjectId
    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid challenge ID'
      });
    }
    
    // Find challenge
    const challenge = await models.Challenge.findById(id);
    
    if (!challenge) {
      return res.status(404).json({
        success: false,
        message: 'Challenge not found'
      });
    }
    
    // Prepare update data
    const allowedUpdates = [
      'title', 'description', 'startDate', 'endDate', 
      'active', 'completed', 'funded'
    ];
    
    const updateFields = {};
    
    allowedUpdates.forEach(field => {
      if (updateData[field] !== undefined) {
        updateFields[field] = updateData[field];
      }
    });
    
    updateFields.updatedAt = new Date();
    
    // Update challenge
    await models.Challenge.updateOne(
      { _id: toObjectId(id) },
      { $set: updateFields }
    );
    
    // Get updated challenge
    const updatedChallenge = await models.Challenge.findById(id);
    
    res.status(200).json({
      success: true,
      message: 'Challenge updated successfully',
      data: { challenge: updatedChallenge }
    });
  } catch (error) {
    console.error('Error updating challenge:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update challenge'
    });
  }
};

// Delete a challenge
exports.deleteChallenge = async (req, res) => {
  try {
    const id = req.params.id;
    
    // Validate MongoDB ObjectId
    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid challenge ID'
      });
    }
    
    // Check if challenge exists
    const challenge = await models.Challenge.findById(id);
    
    if (!challenge) {
      return res.status(404).json({
        success: false,
        message: 'Challenge not found'
      });
    }
    
    // Check if challenge has submissions
    const submissionCount = await models.Submission.countDocuments({ 
      challengeId: toObjectId(id) 
    });
    
    if (submissionCount > 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete challenge with submissions'
      });
    }
    
    // Delete challenge
    await models.Challenge.deleteOne({ _id: toObjectId(id) });
    
    res.status(200).json({
      success: true,
      message: 'Challenge deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting challenge:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete challenge'
    });
  }
};

// Get challenge statistics
exports.getChallengeStats = async (req, res) => {
  try {
    const stats = {
      total: await safeDbOp(() => models.Challenge.countDocuments(), 0),
      active: await safeDbOp(() => models.Challenge.countDocuments({ 
        active: true, 
        completed: false 
      }), 0),
      completed: await safeDbOp(() => models.Challenge.countDocuments({ 
        completed: true 
      }), 0),
      pending: await safeDbOp(() => models.Challenge.countDocuments({ 
        active: false, 
        completed: false 
      }), 0)
    };
    
    // Get total submissions across all challenges
    stats.totalSubmissions = await safeDbOp(() => 
      models.Submission.countDocuments(), 0);
    
    // Get total prize pool (sum of all challenges)
    const challenges = await models.Challenge.find({}, {
      projection: { prizePool: 1 }
    });
    
    let totalPrizePool = 0;
    
    challenges.forEach(challenge => {
      const prize = parseFloat(challenge.prizePool);
      if (!isNaN(prize)) {
        totalPrizePool += prize;
      }
    });
    
    stats.totalPrizePool = totalPrizePool.toFixed(2);
    
    res.status(200).json({
      success: true,
      message: 'Challenge statistics retrieved successfully',
      data: { stats }
    });
  } catch (error) {
    console.error('Error fetching challenge stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve challenge statistics'
    });
  }
};