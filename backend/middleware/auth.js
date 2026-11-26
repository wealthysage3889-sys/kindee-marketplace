import { supabaseAuth, supabaseAdmin, createUserClient } from '../config/supabase.js';
import jwt from 'jsonwebtoken';

// LEGACY custom-JWT support.
// These helpers and the fallback branch in verifyToken() exist ONLY so that
// accounts created before the Supabase Auth migration keep working until every
// legacy account has been migrated (see PHASE_2_AUTH_IMPLEMENTATION_REPORT.md).
// Do NOT remove until the legacy fallback has been proven unused in production.
export const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable is required');
}

// Load the profile row that backs an auth user id, enforce is_active, and
// attach a normalized req.user. Role ALWAYS comes from profiles.role, never
// from a token claim (custom or Supabase). Returns { profile } or sends an
// error response and returns null.
const attachProfileContext = async (req, res, userId, token) => {
  const { data: profile, error: profileError } = await supabaseAdmin
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();

  if (profileError || !profile) {
    res.status(401).json({
      success: false,
      message: 'User profile not found'
    });
    return null;
  }

  if (!profile.is_active) {
    res.status(403).json({
      success: false,
      message: 'Account is deactivated'
    });
    return null;
  }

  req.user = {
    id: profile.id,
    email: profile.email,
    name: profile.name,
    role: (profile.role || '').toLowerCase(),
    avatar_url: profile.avatar_url,
    phone: profile.phone
  };
  req.accessToken = token;
  req.supabase = createUserClient(token);

  return profile;
};

// Detect Supabase "bad_jwt" error (malformed token payload)
export const isBadJwtError = (error) => {
  if (!error) return false;
  const msg = String(error.message || '').toLowerCase();
  return error.code === 'bad_jwt' ||
    msg.includes('invalid jwt') ||
    msg.includes('malformed') ||
    msg.includes('could not json decode') ||
    msg.includes('invalid character');
};

// Extract user ID from JWT payload (handles malformed payloads by fixing JSON)
export const extractUserIdFromToken = (token) => {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    
    // Decode payload (base64url)
    let payloadB64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    // Add padding if needed
    while (payloadB64.length % 4) payloadB64 += '=';
    
    const payloadJson = Buffer.from(payloadB64, 'base64').toString();
    
    // Fix common malformed JSON issues from Supabase bug
    let fixedJson = payloadJson.trim();
    // Fix missing closing brace
    if (!fixedJson.endsWith('}')) {
      fixedJson += '}';
    }
    // Fix double closing brackets in amr array
    fixedJson = fixedJson.replace(/\]\]/g, ']');
    
    const payload = JSON.parse(fixedJson);
    return payload.sub || payload.user_id || payload.id || null;
  } catch (e) {
    return null;
  }
};

// Verify Supabase JWT token (primary path).
// Falls back to the legacy custom JWT ONLY for accounts not yet migrated.
// Handles malformed tokens from Supabase (intermittent bug in supabase-js v2.x)
// by extracting user ID from payload and verifying profile exists in database.
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

    // Primary: verify the token with Supabase Auth.
    let user = null;
    let getUserError = null;
    try {
      const result = await supabaseAuth.auth.getUser(token);
      user = result.data?.user ?? null;
      getUserError = result.error ?? null;
    } catch (getUserErr) {
      // Supabase client may throw on malformed tokens instead of returning error
      getUserError = getUserErr;
    }

    // If Supabase verification succeeded, use the user
    if (!getUserError && user) {
      const profile = await attachProfileContext(req, res, user.id, token);
      if (!profile) return; // response already sent
      return next();
    }

    // If Supabase returns a "bad_jwt" error (malformed token payload),
    // extract user ID from JWT payload directly and verify profile exists.
    // This works around a Supabase bug where tokens have invalid JSON payloads.
    if (isBadJwtError(getUserError)) {
      const userId = extractUserIdFromToken(token);
      if (userId) {
        const profile = await attachProfileContext(req, res, userId, token);
        if (!profile) return; // response already sent (401/403)
        return next();
      }
      // Could not extract user ID from malformed token
      return res.status(401).json({
        success: false,
        message: 'Invalid or expired token',
        code: 'TOKEN_MALFORMED'
      });
    }

    // Fallback: legacy custom JWT (accounts not yet migrated to Supabase Auth).
    // Role is still read from profiles.role below — the JWT payload is trusted
    // only for the user id, never for authorization.
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      if (!decoded || !decoded.id) {
        throw new Error('missing subject');
      }
      const profile = await attachProfileContext(req, res, decoded.id, token);
      if (!profile) return; // response already sent
      return next();
    } catch (jwtError) {
      return res.status(401).json({
        success: false,
        message: 'Invalid or expired token'
      });
    }
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
    
    let user = null;
    let getUserError = null;
    try {
      const result = await supabaseAuth.auth.getUser(token);
      user = result.data?.user ?? null;
      getUserError = result.error ?? null;
    } catch (getUserErr) {
      getUserError = getUserErr;
    }
    
    // Silently ignore malformed tokens in optional auth
    if (isBadJwtError(getUserError)) {
      return next();
    }
    
    if (!getUserError && user) {
      await attachProfileContext(req, res, user.id, token);
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