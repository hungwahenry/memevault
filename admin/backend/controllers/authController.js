// admin/backend/controllers/authController.js
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const config = require('../config/config');
const { mongoose } = require('../utils/database');

// Create AdminUser model (renamed to avoid conflicts)
let AdminUser;
try {
  AdminUser = mongoose.model('AdminUser');
} catch (error) {
  const adminSchema = new mongoose.Schema({
    username: {
      type: String,
      required: true,
      unique: true,
      trim: true
    },
    password: {
      type: String,
      required: true
    },
    role: {
      type: String,
      enum: ['admin', 'superadmin'],
      default: 'admin'
    },
    lastLogin: {
      type: Date
    },
    telegramId: {
      type: String
    },
    createdAt: {
      type: Date,
      default: Date.now
    }
  }, { 
    timestamps: true,
    collection: 'admin_users' // Use a different collection name
  });

  // Hash password before saving
  adminSchema.pre('save', async function(next) {
    if (!this.isModified('password')) return next();
    
    try {
      const salt = await bcrypt.genSalt(10);
      this.password = await bcrypt.hash(this.password, salt);
      next();
    } catch (error) {
      next(error);
    }
  });

  // Method to check password validity
  adminSchema.methods.comparePassword = async function(candidatePassword) {
    return await bcrypt.compare(candidatePassword, this.password);
  };

  AdminUser = mongoose.model('AdminUser', adminSchema);
}

exports.login = async (req, res) => {
  try {
    const { username, password } = req.body;
    
    // Validate required fields
    if (!username || !password) {
      return res.status(400).json({
        success: false,
        message: 'Username and password are required'
      });
    }
    
    // Find admin by username
    const admin = await AdminUser.findOne({ username });
    
    // If admin not found or password is incorrect
    if (!admin || !(await admin.comparePassword(password))) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }
    
    // Update last login time
    admin.lastLogin = new Date();
    await admin.save();
    
    // Generate JWT token
    const token = jwt.sign(
      { userId: admin._id, username: admin.username, role: admin.role },
      config.jwtSecret,
      { expiresIn: config.jwtExpiry }
    );
    
    res.status(200).json({
      success: true,
      message: 'Login successful',
      data: {
        token,
        user: {
          userId: admin._id,
          username: admin.username,
          role: admin.role
        }
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred during login'
    });
  }
};

// Check if token is valid
exports.validateToken = async (req, res) => {
  // If middleware passed, token is valid
  res.status(200).json({
    success: true,
    message: 'Token is valid',
    data: {
      user: req.user
    }
  });
};

// Add a new admin
exports.addAdmin = async (req, res) => {
  try {
    // Only superadmins can add new admins
    if (req.user.role !== 'superadmin') {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to add new admins'
      });
    }
    
    const { username, password, role, telegramId } = req.body;
    
    // Check if username already exists
    const existingAdmin = await AdminUser.findOne({ username });
    if (existingAdmin) {
      return res.status(400).json({
        success: false,
        message: 'Username already exists'
      });
    }
    
    // Create new admin
    const newAdmin = new AdminUser({
      username,
      password,
      role: role || 'admin',
      telegramId
    });
    
    await newAdmin.save();
    
    res.status(201).json({
      success: true,
      message: 'Admin created successfully',
      data: {
        userId: newAdmin._id,
        username: newAdmin.username,
        role: newAdmin.role
      }
    });
  } catch (error) {
    console.error('Add admin error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while adding admin'
    });
  }
};

// Get all admins (for superadmin)
exports.getAdmins = async (req, res) => {
  try {
    // Only superadmins can view all admins
    if (req.user.role !== 'superadmin') {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to view admins'
      });
    }
    
    const admins = await AdminUser.find({}, '-password');
    
    res.status(200).json({
      success: true,
      data: {
        admins
      }
    });
  } catch (error) {
    console.error('Get admins error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while fetching admins'
    });
  }
};

// Delete an admin (for superadmin)
exports.deleteAdmin = async (req, res) => {
  try {
    // Only superadmins can delete admins
    if (req.user.role !== 'superadmin') {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to delete admins'
      });
    }
    
    const { adminId } = req.params;
    
    // Check if trying to delete self
    if (adminId === req.user.userId) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete your own account'
      });
    }
    
    // Check if admin exists
    const admin = await AdminUser.findById(adminId);
    if (!admin) {
      return res.status(404).json({
        success: false,
        message: 'Admin not found'
      });
    }
    
    await AdminUser.findByIdAndDelete(adminId);
    
    res.status(200).json({
      success: true,
      message: 'Admin deleted successfully'
    });
  } catch (error) {
    console.error('Delete admin error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while deleting admin'
    });
  }
};

// Update password (for self)
exports.updatePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    
    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Current password and new password are required'
      });
    }
    
    // Find admin
    const admin = await AdminUser.findById(req.user.userId);
    if (!admin) {
      return res.status(404).json({
        success: false,
        message: 'Admin not found'
      });
    }
    
    // Verify current password
    const isMatch = await admin.comparePassword(currentPassword);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Current password is incorrect'
      });
    }
    
    // Update password
    admin.password = newPassword;
    await admin.save();
    
    res.status(200).json({
      success: true,
      message: 'Password updated successfully'
    });
  } catch (error) {
    console.error('Update password error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while updating password'
    });
  }
};