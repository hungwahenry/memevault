// admin/backend/middleware/adminMiddleware.js
module.exports = (req, res, next) => {
    // Ensure user exists and has a role property
    if (!req.user || !req.user.role) {
      return res.status(403).json({
        success: false,
        message: 'Access denied: Admin privileges required'
      });
    }
    
    // Allow access for both admin and superadmin roles
    if (req.user.role === 'admin' || req.user.role === 'superadmin') {
      return next();
    }
    
    // Deny access for non-admin users
    return res.status(403).json({
      success: false,
      message: 'Access denied: Admin privileges required'
    });
  };