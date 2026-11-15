import { supabaseAuth, supabaseAdmin, createUserClient } from '../config/supabase.js';
import jwt from 'jsonwebtoken';

export const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable is required');
}

// Verify Supabase JWT token
export const verifyToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ 
        success: false, 
        message: 'No token provided' 
      });
    }
    
    const token = authHeader.split(' ')[1];
    
    // Verify with Supabase
    const { data: { user }, error } = await supabaseAuth.auth.getUser(token);
    
    if (error || !user) {
      // Fallback to custom JWT verification
      try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        req.accessToken = token;
        req.supabase = createUserClient(token);
        return next();
      } catch (jwtError) {
        return res.status(401).json({ 
          success: false, 
          message: 'Invalid or expired token' 
        });
      }
    }
    
    // Get user profile
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single();
    
    if (profileError || !profile) {
      return res.status(401).json({ 
        success: false, 
        message: 'User profile not found' 
      });
    }
    
    if (!profile.is_active) {
      return res.status(403).json({ 
        success: false, 
        message: 'Account is deactivated' 
      });
    }
    
    req.user = {
      id: profile.id,
      email: profile.email,
      name: profile.name,
      role: profile.role,
      avatar_url: profile.avatar_url,
      phone: profile.phone
    };
    req.accessToken = token;
    req.supabase = createUserClient(token);
    
    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Authentication error' 
    });
  }
};

// Optional auth - doesn't fail if no token
export const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return next();
    }
    
    const token = authHeader.split(' ')[1];
    const { data: { user }, error } = await supabaseAuth.auth.getUser(token);
    
    if (!error && user) {
      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();
      
      if (profile && profile.is_active) {
        req.user = {
          id: profile.id,
          email: profile.email,
          name: profile.name,
          role: profile.role,
          avatar_url: profile.avatar_url,
          phone: profile.phone
        };
        req.accessToken = token;
        req.supabase = createUserClient(token);
      }
    }
    
    next();
  } catch (error) {
    // Silently continue without auth
    next();
  }
};

// Role-based authorization
export const authorize = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ 
        success: false, 
        message: 'Authentication required' 
      });
    }
    
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ 
        success: false, 
        message: 'Insufficient permissions' 
      });
    }
    
    next();
  };
};

// Verify admin role - dedicated middleware for admin-only routes
export const verifyAdmin = async (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ 
      success: false, 
      message: 'Authentication required' 
    });
  }
  
  // Check if user has admin or owner role
  if (!['admin', 'owner'].includes(req.user.role)) {
    return res.status(403).json({ 
      success: false, 
      message: 'Access denied: สำหรับผู้ดูแลระบบเท่านั้น' 
    });
  }
  
  next();
};

// Alias for verifyAdmin
export const isAdmin = verifyAdmin;

// Check if user owns resource
export const authorizeOwner = (getResourceOwnerId) => {
  return async (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ 
        success: false, 
        message: 'Authentication required' 
      });
    }
    
    // Admins and owners can access everything
    if (['admin', 'owner'].includes(req.user.role)) {
      return next();
    }
    
    try {
      const ownerId = await getResourceOwnerId(req);
      
      if (ownerId !== req.user.id) {
        return res.status(403).json({ 
          success: false, 
          message: 'Access denied: not resource owner' 
        });
      }
      
      next();
    } catch (error) {
      return res.status(500).json({ 
        success: false, 
        message: 'Authorization error' 
      });
    }
  };
};

// Generate custom JWT token (for backward compatibility)
export const generateToken = (user) => {
  return jwt.sign(
    { 
      id: user.id, 
      email: user.email, 
      role: user.role,
      name: user.name 
    },
    JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
};

export const generateRefreshToken = (user) => {
  return jwt.sign(
    { id: user.id, type: 'refresh' },
    JWT_SECRET,
    { expiresIn: process.env.REFRESH_TOKEN_EXPIRES_IN || '30d' }
  );
};

export const verifyRefreshToken = (token) => {
  return jwt.verify(token, JWT_SECRET);
};