// admin/backend/scripts/test-direct-access.js
require('dotenv').config();
const db = require('../utils/database');

async function testDirectAccess() {
  try {
    // Connect to MongoDB
    console.log('Connecting to MongoDB...');
    await db.connect();
    console.log('Connected successfully');
    
    // Import direct access models
    console.log('Importing direct access models...');
    const models = require('../models/direct-access');
    
    // Test User collection
    console.log('\nTesting User collection access...');
    const userCount = await models.User.countDocuments();
    console.log(`User count: ${userCount}`);
    
    if (userCount > 0) {
      // Get one user to verify data access
      const firstUser = await models.User.findOne();
      console.log('Sample user:', {
        id: firstUser._id,
        userId: firstUser.userId,
        username: firstUser.username || '[No username]'
      });
    }
    
    // Test other collections
    console.log('\nTesting Challenge collection...');
    const challengeCount = await models.Challenge.countDocuments();
    console.log(`Challenge count: ${challengeCount}`);
    
    console.log('\nTesting Group collection...');
    const groupCount = await models.Group.countDocuments();
    console.log(`Group count: ${groupCount}`);
    
    console.log('\nTesting Submission collection...');
    const submissionCount = await models.Submission.countDocuments();
    console.log(`Submission count: ${submissionCount}`);
    
    console.log('\nAll tests completed successfully');
  } catch (error) {
    console.error('Test failed:', error);
  } finally {
    // Close connection
    await db.close();
  }
}

// Run the test
testDirectAccess();