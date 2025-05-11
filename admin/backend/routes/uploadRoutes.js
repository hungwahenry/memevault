// admin/backend/routes/uploadRoutes.js
const express = require('express');
const router = express.Router();
const { upload } = require('../utils/fileUpload');
const authMiddleware = require('../middleware/authMiddleware');
const adminMiddleware = require('../middleware/adminMiddleware');
const path = require('path');

// Apply middleware to all routes
router.use(authMiddleware);
router.use(adminMiddleware);

// Upload endpoint
router.post('/image', upload.single('image'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded'
      });
    }

    // Return file info
    res.status(200).json({
      success: true,
      message: 'File uploaded successfully',
      data: {
        filename: req.file.filename,
        path: `/uploads/${req.file.filename}`,
        size: req.file.size,
        mimetype: req.file.mimetype
      }
    });
  } catch (error) {
    console.error('File upload error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to upload file'
    });
  }
});

module.exports = router;