// admin/backend/controllers/userController.js
const models = require('../models/direct-access');

// Utility function for safe database operations
const safeDbOp = async (operation, fallbackValue = null) => {
  try {
    return await operation();
  } catch (error) {
    console.error('Database operation error:', error);
    return fallbackValue;
  }
};

// Get all users with pagination, filtering and search
exports.getUsers = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    const search = req.query.search || '';
    const filter = req.query.filter || '';
    
    // Build query
    let query = {};
    
    // Add search conditions
    if (search) {
      query.$or = [
        { userId: { $regex: search, $options: 'i' } },
        { username: { $regex: search, $options: 'i' } },
        { firstName: { $regex: search, $options: 'i' } },
        { lastName: { $regex: search, $options: 'i' } }
      ];
    }
    
    // Add filter conditions
    if (filter === 'banned') {
      query.banned = true;
    } else if (filter === 'active') {
      query.lastInteraction = { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) };
    } else if (filter === 'inactive') {
      query.lastInteraction = { $lt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) };
    } else if (filter === 'winners') {
      query.winCount = { $gt: 0 };
    } else if (filter === 'admins') {
      query.userType = 'admin';
    }
    
    // Execute query with pagination
    const users = await models.User.find(query, {}, { 
      sort: { lastInteraction: -1 },
      skip, 
      limit 
    });
    
    // Get total count for pagination
    const total = await models.User.countDocuments(query);
    
    res.status(200).json({
      success: true,
      message: 'Users retrieved successfully',
      data: {
        users,
        pagination: {
          total,
          page,
          limit,
          pages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve users'
    });
  }
};

// Get a single user by userId
exports.getUser = async (req, res) => {
  try {
    const userId = req.params.userId;
    
    // Find user
    const user = await models.User.findOne({ userId });
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    // Get additional user stats
    const submissionCount = await models.Submission.countDocuments({ userId });
    const challengeCount = await models.Challenge.countDocuments({ creatorId: userId });
    
    // Get user's groups with names
    const groupDetails = [];
    if (user.groups && user.groups.length > 0) {
      const groups = await models.Group.find({ 
        groupId: { $in: user.groups } 
      }, { projection: { groupId: 1, title: 1 } });
      
      for (const group of groups) {
        groupDetails.push({
          groupId: group.groupId,
          title: group.title
        });
      }
    }
    
    // Get recent submissions
    const recentSubmissions = await models.Submission.find(
      { userId }, 
      {}, 
      { 
        sort: { createdAt: -1 },
        limit: 5
      }
    );
    
    // Get challenges for these submissions
    const challengeIds = recentSubmissions.map(sub => sub.challengeId);
    const challenges = await models.Challenge.find({ 
      _id: { $in: challengeIds } 
    });
    
    // Add challenge information to submissions
    const enhancedSubmissions = recentSubmissions.map(submission => {
      const challenge = challenges.find(c => 
        c._id.toString() === submission.challengeId.toString()
      );
      
      return {
        ...submission,
        challenge: challenge ? {
          _id: challenge._id,
          title: challenge.title
        } : null
      };
    });
    
    res.status(200).json({
      success: true,
      message: 'User retrieved successfully',
      data: { 
        user,
        stats: {
          submissionCount,
          challengeCount
        },
        groups: groupDetails,
        recentSubmissions: enhancedSubmissions
      }
    });
  } catch (error) {
    console.error('Error fetching user:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve user'
    });
  }
};

// Ban a user
exports.banUser = async (req, res) => {
  try {
    const userId = req.params.userId;
    const { reason, duration } = req.body;
    
    if (!reason) {
      return res.status(400).json({
        success: false,
        message: 'Ban reason is required'
      });
    }
    
    // Find user
    const user = await models.User.findOne({ userId });
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    // Update ban information
    const now = new Date();
    let banExpires = null;
    
    // Set expiry if duration provided (in days)
    if (duration && duration > 0) {
      banExpires = new Date();
      banExpires.setDate(banExpires.getDate() + parseInt(duration));
    }
    
    // Update user in database
    const updatedUser = {
      ...user,
      banned: true,
      banReason: reason,
      bannedAt: now,
      bannedBy: req.user.userId,
      banExpires: banExpires
    };
    
    await models.User.updateOne(
      { userId },
      { $set: updatedUser }
    );
    
    res.status(200).json({
      success: true,
      message: 'User banned successfully',
      data: { user: updatedUser }
    });
  } catch (error) {
    console.error('Error banning user:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to ban user'
    });
  }
};

// Unban a user
exports.unbanUser = async (req, res) => {
  try {
    const userId = req.params.userId;
    
    // Find user
    const user = await models.User.findOne({ userId });
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    if (!user.banned) {
      return res.status(400).json({
        success: false,
        message: 'User is not banned'
      });
    }
    
    // Update user in database
    const updatedUser = {
      ...user,
      banned: false,
      banReason: null,
      banExpires: null
    };
    
    await models.User.updateOne(
      { userId },
      { $set: updatedUser }
    );
    
    res.status(200).json({
      success: true,
      message: 'User unbanned successfully',
      data: { user: updatedUser }
    });
  } catch (error) {
    console.error('Error unbanning user:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to unban user'
    });
  }
};

// Get user statistics
exports.getUserStats = async (req, res) => {
  try {
    console.log('Fetching user statistics...');
    
    // Get overall user statistics with safe operations
    const stats = {
      total: await safeDbOp(() => models.User.countDocuments(), 0),
      active: await safeDbOp(() => models.User.countDocuments({
        lastInteraction: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
      }), 0),
      banned: await safeDbOp(() => models.User.countDocuments({ banned: true }), 0),
      admins: await safeDbOp(() => models.User.countDocuments({ userType: 'admin' }), 0),
      winners: await safeDbOp(() => models.User.countDocuments({ winCount: { $gt: 0 } }), 0),
      newUsers: await safeDbOp(() => models.User.countDocuments({
        joinedDate: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
      }), 0)
    };
    
    console.log('User statistics retrieved successfully');
    
    res.status(200).json({
      success: true,
      message: 'User statistics retrieved successfully',
      data: { stats }
    });
  } catch (error) {
    console.error('Error fetching user stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve user statistics'
    });
  }
};