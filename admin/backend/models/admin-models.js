// admin/backend/controllers/broadcastController.js
const models = require('../models/direct-access');
const { mongoose } = require('../utils/database');
const telegramService = require('../services/telegramService');

// Get broadcast segments (user groups for targeting)
exports.getBroadcastSegments = async (req, res) => {
  try {
    // Define available segments
    const segments = [
      {
        id: 'all_users',
        name: 'All Users',
        description: 'Send to all users',
        count: await models.User.countDocuments()
      },
      {
        id: 'active_users',
        name: 'Active Users',
        description: 'Users active in the last 30 days',
        count: await models.User.countDocuments({
          lastInteraction: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
        })
      },
      {
        id: 'contest_creators',
        name: 'Contest Creators',
        description: 'Users who have created at least one contest',
        count: await models.User.countDocuments({ challengesCreated: { $gt: 0 } })
      },
      {
        id: 'contest_winners',
        name: 'Contest Winners',
        description: 'Users who have won at least one contest',
        count: await models.User.countDocuments({ winCount: { $gt: 0 } })
      },
      {
        id: 'inactive_users',
        name: 'Inactive Users',
        description: 'Users inactive for more than 30 days',
        count: await models.User.countDocuments({
          lastInteraction: { $lt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
        })
      }
    ];
    
    res.status(200).json({
      success: true,
      message: 'Broadcast segments retrieved successfully',
      data: { segments }
    });
  } catch (error) {
    console.error('Error fetching broadcast segments:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve broadcast segments'
    });
  }
};

// Send broadcast message
exports.sendBroadcast = async (req, res) => {
  try {
    const { message, photo, caption, segment, options = {}, type = 'text' } = req.body;
    
    // Validate inputs manually
    if (type === 'text' && !message) {
      return res.status(400).json({
        success: false,
        message: 'Message is required for text broadcasts'
      });
    }
    
    if (type === 'photo' && !photo) {
      return res.status(400).json({
        success: false,
        message: 'Photo path is required for photo broadcasts'
      });
    }
    
    if (!segment) {
      return res.status(400).json({
        success: false,
        message: 'Segment is required'
      });
    }
    
    // Get user IDs based on segment
    let userQuery = {};
    
    switch (segment) {
      case 'all_users':
        // No filter needed
        break;
      case 'active_users':
        userQuery.lastInteraction = { 
          $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) 
        };
        break;
      case 'contest_creators':
        userQuery.challengesCreated = { $gt: 0 };
        break;
      case 'contest_winners':
        userQuery.winCount = { $gt: 0 };
        break;
      case 'inactive_users':
        userQuery.lastInteraction = { 
          $lt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) 
        };
        break;
      default:
        return res.status(400).json({
          success: false,
          message: 'Invalid segment'
        });
    }
    
    // Don't send to banned users
    userQuery.banned = { $ne: true };
    
    // Get all users matching the query
    const collection = mongoose.connection.db.collection('users');
    const users = await collection.find(userQuery).toArray();
    
    if (users.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No users found in this segment'
      });
    }
    
    // Store broadcast directly in MongoDB collection without Mongoose validation
    const broadcastCollection = mongoose.connection.db.collection('broadcasts');
    
    // Create broadcast record
    const broadcastData = {
      type,
      segment,
      options,
      targetCount: users.length,
      sentBy: req.user?.userId || 'unknown',
      sentAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date()
    };
    
    // Add type-specific fields
    if (type === 'text') {
      broadcastData.message = message;
    } else {
      broadcastData.photo = photo;
      broadcastData.caption = caption || '';
    }
    
    // Insert directly into collection
    const result = await broadcastCollection.insertOne(broadcastData);
    const broadcastId = result.insertedId;
    
    // Extract user IDs directly from the userId field
    const userIds = users
      .filter(user => user && typeof user.userId === 'string')
      .map(user => user.userId);
    
    if (userIds.length === 0) {
      await broadcastCollection.updateOne(
        { _id: broadcastId },
        { 
          $set: {
            successCount: 0,
            failureCount: users.length,
            failures: [{ error: 'No valid Telegram user IDs found' }],
            completedAt: new Date(),
            updatedAt: new Date()
          }
        }
      );
      
      return res.status(400).json({
        success: false,
        message: 'No valid Telegram user IDs found in this segment'
      });
    }
    
    // Prepare content based on type
    let content;
    if (type === 'photo') {
      content = {
        type: 'photo',
        photo: photo,
        caption: caption || ''
      };
    } else {
      content = {
        type: 'text',
        message: message
      };
    }
    
    // Send broadcast via Telegram service
    try {
      const results = await telegramService.sendBroadcast(userIds, content, options);
      
      // Update the broadcast record with results
      await broadcastCollection.updateOne(
        { _id: broadcastId },
        { 
          $set: {
            successCount: results.successful,
            failureCount: results.failed,
            failures: results.failures || [],
            completedAt: new Date(),
            updatedAt: new Date()
          }
        }
      );
      
      res.status(200).json({
        success: true,
        message: 'Broadcast sent successfully',
        data: {
          broadcastId: broadcastId,
          targetCount: users.length,
          successCount: results.successful,
          failureCount: results.failed
        }
      });
    } catch (error) {
      console.error('Telegram broadcast error:', error);
      
      // Update record with failure
      await broadcastCollection.updateOne(
        { _id: broadcastId },
        { 
          $set: {
            successCount: 0,
            failureCount: userIds.length,
            failures: [{ error: error.message || 'Telegram service error' }],
            completedAt: new Date(),
            updatedAt: new Date()
          }
        }
      );
      
      throw error;  // Re-throw to be caught by outer try-catch
    }
  } catch (error) {
    console.error('Error sending broadcast:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send broadcast: ' + (error.message || 'Unknown error')
    });
  }
};

// Get broadcast history
exports.getBroadcastHistory = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    
    // Use direct collection access for consistency
    const broadcastCollection = mongoose.connection.db.collection('broadcasts');
    
    // Get broadcasts with pagination
    const broadcasts = await broadcastCollection.find({})
      .sort({ sentAt: -1 })
      .skip(skip)
      .limit(limit)
      .project({ failures: 0 }) // Exclude potentially large failure list
      .toArray();
    
    // Count total documents
    const total = await broadcastCollection.countDocuments({});
    
    res.status(200).json({
      success: true,
      message: 'Broadcast history retrieved successfully',
      data: {
        broadcasts,
        pagination: {
          total,
          page,
          limit,
          pages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error) {
    console.error('Error fetching broadcast history:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve broadcast history'
    });
  }
};