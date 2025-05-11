// admin/backend/server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./utils/database');
const config = require('./config/config');
const uploadRoutes = require('./routes/uploadRoutes');

// Create Express app
const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Serve uploaded files from the uploads directory
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Define an async function to start the server
async function startServer() {
  try {
    // First connect to MongoDB
    await db.connect();
    
    console.log('MongoDB connection state:', db.getState().stateText);
    
    // Import our admin-specific models
    console.log('Loading admin models...');
    require('./models/admin-models');
    
    // Import our direct access models (not actual Mongoose models)
    console.log('Setting up direct database access...');
    const models = require('./models/direct-access');
    
    // Verify direct access is working
    try {
      const userCount = await models.User.countDocuments();
      console.log(`Database verification: ${userCount} users found`);
    } catch (error) {
      console.error('Database verification failed:', error);
      throw new Error('Could not access database collections');
    }
    
    // Import routes
    console.log('Loading routes...');
    const authRoutes = require('./routes/authRoutes');
    const userRoutes = require('./routes/userRoutes');
    const challengeRoutes = require('./routes/challengeRoutes');
    const broadcastRoutes = require('./routes/broadcastRoutes');
    const configRoutes = require('./routes/configRoutes');
    
    // API routes
    app.use('/api/auth', authRoutes);
    app.use('/api/users', userRoutes);
    app.use('/api/challenges', challengeRoutes);
    app.use('/api/broadcasts', broadcastRoutes);
    app.use('/api/config', configRoutes);
    app.use('/api/upload', uploadRoutes);
    
    // Serve static files in production
    if (process.env.NODE_ENV === 'production') {
      app.use(express.static(path.join(__dirname, '../frontend/build')));
      
      app.get('*', (req, res) => {
        res.sendFile(path.join(__dirname, '../frontend/build', 'index.html'));
      });
    }
    
    // Error handling middleware
    app.use((err, req, res, next) => {
      console.error('API Error:', err.stack);
      res.status(500).json({
        success: false,
        message: 'Server error',
        error: process.env.NODE_ENV === 'development' ? err.message : undefined
      });
    });
    
    // Start the server
    const server = app.listen(config.port, () => {
      console.log(`Admin API server running on port ${config.port}`);
    });
    
    // Handle graceful shutdown
    process.on('SIGTERM', async () => {
      console.log('SIGTERM signal received: closing HTTP server');
      server.close(() => {
        console.log('HTTP server closed');
        db.close().then(() => {
          process.exit(0);
        });
      });
    });
    
  } catch (error) {
    console.error('Failed to start server:', error);
    await db.close();
    process.exit(1);
  }
}

// Start the server
startServer();