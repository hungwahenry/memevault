// admin/backend/routes/configRoutes.js
const express = require('express');
const router = express.Router();
const configController = require('../controllers/configController');
const authMiddleware = require('../middleware/authMiddleware');
const adminMiddleware = require('../middleware/adminMiddleware');

// Apply middleware to all routes
router.use(authMiddleware);
router.use(adminMiddleware);

// Config routes
router.get('/', configController.getConfig);
router.put('/', configController.updateConfig);
router.get('/bot', configController.getBotInfo);

// Environment variables routes
router.get('/env', configController.getEnvVars);
router.put('/env', configController.updateEnvVars);

module.exports = router;