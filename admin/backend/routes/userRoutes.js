// admin/backend/routes/userRoutes.js
const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const authMiddleware = require('../middleware/authMiddleware');
const adminMiddleware = require('../middleware/adminMiddleware');

// Apply middleware to all routes
router.use(authMiddleware);
router.use(adminMiddleware);

// User routes
router.get('/', userController.getUsers);
router.get('/stats', userController.getUserStats);
router.get('/:userId', userController.getUser);
router.post('/:userId/ban', userController.banUser);
router.post('/:userId/unban', userController.unbanUser);

module.exports = router;