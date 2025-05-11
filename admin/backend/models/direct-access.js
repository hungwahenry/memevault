// admin/backend/models/direct-access.js
const { mongoose } = require('../utils/database');

// This takes a different approach - it doesn't try to import
// models from the main app, but rather accesses collections directly

// Get direct collection access (bypassing model registration)
const getCollection = (collectionName) => {
  if (!mongoose.connection || mongoose.connection.readyState !== 1) {
    throw new Error('MongoDB not connected. Connect before accessing collections.');
  }
  
  return mongoose.connection.db.collection(collectionName);
};

// Helper to check if string is valid MongoDB ObjectId
const isValidObjectId = (id) => {
  return mongoose.Types.ObjectId.isValid(id);
};

// Helper to convert string to ObjectId
const toObjectId = (id) => {
  return isValidObjectId(id) ? new mongoose.Types.ObjectId(id) : id;
};

// Create proxy objects that mimic Mongoose models but use direct collection access
const createModelProxy = (collectionName) => {
  return {
    // Count documents in collection
    countDocuments: async (filter = {}) => {
      const collection = getCollection(collectionName);
      return await collection.countDocuments(filter);
    },
    
    // Find documents
    find: async (filter = {}, projection = {}, options = {}) => {
      const collection = getCollection(collectionName);
      const cursor = collection.find(filter, { projection, ...options });
      
      // Apply sort if provided
      if (options.sort) {
        cursor.sort(options.sort);
      }
      
      // Apply pagination if provided
      if (options.skip) {
        cursor.skip(options.skip);
      }
      
      if (options.limit) {
        cursor.limit(options.limit);
      }
      
      return await cursor.toArray();
    },
    
    // Find one document
    findOne: async (filter = {}, projection = {}, options = {}) => {
      const collection = getCollection(collectionName);
      return await collection.findOne(filter, { projection, ...options });
    },
    
    // Find by ID (converts string ID to ObjectId)
    findById: async (id, projection = {}, options = {}) => {
      const collection = getCollection(collectionName);
      const objectId = isValidObjectId(id) ? new mongoose.Types.ObjectId(id) : id;
      return await collection.findOne({ _id: objectId }, { projection, ...options });
    },
    
    // Update one document
    updateOne: async (filter = {}, update = {}, options = {}) => {
      const collection = getCollection(collectionName);
      return await collection.updateOne(filter, update, options);
    },
    
    // Delete one document
    deleteOne: async (filter = {}, options = {}) => {
      const collection = getCollection(collectionName);
      return await collection.deleteOne(filter, options);
    },
    
    // Aggregate pipeline
    aggregate: async (pipeline = []) => {
      const collection = getCollection(collectionName);
      return await collection.aggregate(pipeline).toArray();
    }
  };
};

// Export model proxies for direct database access
module.exports = {
  // Create proxies for all collections we need to access
  User: createModelProxy('users'),
  Challenge: createModelProxy('challenges'),
  Submission: createModelProxy('submissions'),
  Group: createModelProxy('groups'),
  // Use the admin-specific model for broadcasts
  Broadcast: createModelProxy('broadcasts')
};