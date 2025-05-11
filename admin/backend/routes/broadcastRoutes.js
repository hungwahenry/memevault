// admin/backend/routes/broadcastRoutes.js
const express = require('express');
const router = express.Router();
const broadcastController = require('../controllers/broadcastController');
const authMiddleware = require('../middleware/authMiddleware');
const adminMiddleware = require('../middleware/adminMiddleware');

// Apply middleware to all routes
router.use(authMiddleware);
router.use(adminMiddleware);

// Broadcast routes
router.get('/segments', broadcastController.getBroadcastSegments);
router.post('/send', broadcastController.sendBroadcast);
router.get('/history', broadcastController.getBroadcastHistory);

module.exports = router;