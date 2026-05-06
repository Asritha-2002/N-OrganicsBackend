const jwt = require('jsonwebtoken');

const authenticateToken = (req, res, next) => {
  try {
    
    const token = req.header('Authorization').replace('Bearer ', '');
    
    
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    // console.log(decoded);
    
    req.user = decoded;
    next();
  } catch (error) {
    res.status(401).json({ message: 'Authentication required' });
  }
};

const requireAdmin = (req, res, next) => {
  if (req.user && req.user.isAdmin) {
    next();
  } else {
    res.status(403).json({ message: 'Admin access required' });
  }
};

// Legacy aliases for backward compatibility
const auth = authenticateToken;
const adminAuth = requireAdmin;

module.exports = { 
  auth, 
  adminAuth, 
  authenticateToken, 
  requireAdmin 
};
