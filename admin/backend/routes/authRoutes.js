// admin/backend/routes/authRoutes.js
const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const authMiddleware = require('../middleware/authMiddleware');

// Public routes
router.post('/login', authController.login);

// Protected routes
router.get('/validate', authMiddleware, authController.validateToken);
router.post('/password', authMiddleware, authController.updatePassword);

// Admin management routes (superadmin only)
router.get('/admins', authMiddleware, authController.getAdmins);
router.post('/admins', authMiddleware, authController.addAdmin);
router.delete('/admins/:adminId', authMiddleware, authController.deleteAdmin);

module.exports = router;