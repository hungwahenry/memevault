// admin/backend/routes/challengeRoutes.js
const express = require('express');
const router = express.Router();
const challengeController = require('../controllers/challengeController');
const authMiddleware = require('../middleware/authMiddleware');
const adminMiddleware = require('../middleware/adminMiddleware');

// Apply middleware to all routes
router.use(authMiddleware);
router.use(adminMiddleware);

// Challenge routes
router.get('/', challengeController.getChallenges);
router.get('/stats', challengeController.getChallengeStats);
router.get('/:id', challengeController.getChallenge);
router.put('/:id', challengeController.updateChallenge);
router.delete('/:id', challengeController.deleteChallenge);

module.exports = router;