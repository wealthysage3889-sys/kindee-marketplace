import express from 'express';
import { body, query } from 'express-validator';
import { validate } from '../middleware/validate.js';
import { verifyToken, optionalAuth } from '../middleware/auth.js';
import * as authService from '../services/authService.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import { validatePhone } from '../utils/phone.js';

const router = express.Router();

// Register
router.post('/register', [
  body('email').optional().isEmail().normalizeEmail().withMessage('Invalid email'),
  body('phone').optional().custom(validatePhone).withMessage('Invalid phone number'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  body('name').optional().trim().notEmpty().withMessage('Name cannot be empty'),
  body('role').optional().isIn(['customer', 'seller']).withMessage('Invalid role')
], validate, asyncHandler(async (req, res) => {
  const { email, phone, password, name, role } = req.body;
  
  if (!email && !phone) {
    throw new AppError('Email or phone is required', 400);
  }
  
  const result = await authService.registerUser({ email, phone, password, name, role });
  
  res.status(201).json({
    success: true,
    message: 'Registration successful',
    data: result
  });
}));

// Login
router.post('/login', [
  body('emailOrPhone').notEmpty().withMessage('Email or phone is required'),
  body('password').notEmpty().withMessage('Password is required')
], validate, asyncHandler(async (req, res) => {
  const { emailOrPhone, password } = req.body;
  
  const result = await authService.loginUser(emailOrPhone, password);
  
  res.json({
    success: true,
    message: 'Login successful',
    data: result
  });
}));

// Refresh token
router.post('/refresh', asyncHandler(async (req, res) => {
  const { refreshToken } = req.body;
  
  if (!refreshToken) {
    throw new AppError('Refresh token required', 400);
  }
  
  const result = await authService.refreshAccessToken(refreshToken);
  
  res.json({
    success: true,
    data: result
  });
}));

// Google login
router.post('/google', [
  body('credential').notEmpty().withMessage('Google credential required')
], validate, asyncHandler(async (req, res) => {
  const { credential } = req.body;
  
  const result = await authService.socialLogin('google', credential);
  
  res.json({
    success: true,
    message: 'Google login successful',
    data: result
  });
}));

// Facebook login
router.post('/facebook', [
  body('accessToken').notEmpty().withMessage('Facebook access token required')
], validate, asyncHandler(async (req, res) => {
  const { accessToken } = req.body;
  
  const result = await authService.socialLogin('facebook', accessToken);
  
  res.json({
    success: true,
    message: 'Facebook login successful',
    data: result
  });
}));

// LINE login (server-side authorization code exchange)
router.post('/line', [
  body('code').notEmpty().withMessage('LINE authorization code required'),
  body('redirectUri').optional().isString()
], validate, asyncHandler(async (req, res) => {
  const { code, redirectUri } = req.body;

  const result = await authService.lineLogin(code, redirectUri);

  res.json({
    success: true,
    message: 'LINE login successful',
    data: result
  });
}));

// Get profile
router.get('/profile', verifyToken, asyncHandler(async (req, res) => {
  const profile = await authService.getProfile(req.user.id);
  
  res.json({
    success: true,
    data: profile
  });
}));

// Update profile
router.put('/profile', verifyToken, [
  body('email').optional().isEmail().normalizeEmail().withMessage('Invalid email'),
  body('phone').optional().custom(validatePhone).withMessage('Invalid phone number'),
  body('name').optional().trim().notEmpty().withMessage('Name cannot be empty'),
  body('address').optional().trim(),
  body('avatar_url').optional().isURL().withMessage('Invalid avatar URL')
], validate, asyncHandler(async (req, res) => {
  const profile = await authService.updateProfile(req.user.id, req.body);
  
  res.json({
    success: true,
    message: 'Profile updated',
    data: profile
  });
}));

// Change password
router.put('/password', verifyToken, [
  body('currentPassword').notEmpty().withMessage('Current password required'),
  body('newPassword').isLength({ min: 6 }).withMessage('New password must be at least 6 characters')
], validate, asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  
  await authService.changePassword(req.user.id, currentPassword, newPassword);
  
  res.json({
    success: true,
    message: 'Password changed successfully'
  });
}));

// Logout
router.post('/logout', verifyToken, asyncHandler(async (req, res) => {
  const { refreshToken, revokeAllSessions, scope } = req.body || {};
  // Default: sign out the current device only ('local'). revokeAllSessions=true
  // (or scope='global') signs out every device.
  const resolvedScope = scope || (revokeAllSessions ? 'global' : 'local');
  await authService.logoutUser(req.accessToken, refreshToken, resolvedScope);

  res.json({
    success: true,
    message: 'Logged out successfully'
  });
}));

// Sessions
router.get('/sessions', verifyToken, asyncHandler(async (req, res) => {
  const sessions = await authService.getUserSessions(req.user.id);
  res.json({
    success: true,
    data: sessions
  });
}));

router.post('/sessions/revoke', verifyToken, [
  body('session_id').optional().isUUID().withMessage('session_id ต้องเป็น UUID'),
  body('all').optional().isBoolean().withMessage('all ต้องเป็น boolean')
], validate, asyncHandler(async (req, res) => {
  const { session_id, all } = req.body || {};
  if (all === true) {
    await authService.revokeAllUserSessions(req.user.id, 'user_initiated_global');
  } else if (session_id) {
    await authService.revokeUserSession(req.user.id, session_id, 'user_initiated_revoke');
  } else {
    throw new AppError('ระบุ session_id หรือ all=true', 400);
  }
  res.json({
    success: true,
    message: 'ยกเลิกเซสชันเรียบร้อยแล้ว'
  });
}));

// Login history
router.get('/login-history', verifyToken, asyncHandler(async (req, res) => {
  const history = await authService.getLoginHistory(req.user.id);
  res.json({
    success: true,
    data: history
  });
}));

// Security alerts
router.get('/security-alerts', verifyToken, asyncHandler(async (req, res) => {
  const alerts = await authService.getSecurityAlerts(req.user.id);
  res.json({
    success: true,
    data: alerts
  });
}));

router.patch('/security-alerts/:id/read', verifyToken, asyncHandler(async (req, res) => {
  await authService.markSecurityAlertRead(req.params.id, req.user.id);
  res.json({
    success: true,
    message: 'ทำเครื่องหมายอ่านเรียบร้อยแล้ว'
  });
}));

// Social unlink (with login-channel guard)
router.post('/social/unlink', verifyToken, [
  body('provider').isIn(['google', 'facebook', 'line']).withMessage('Provider ไม่ถูกต้อง')
], validate, asyncHandler(async (req, res) => {
  const result = await authService.unlinkSocialProvider(req.user.id, req.body.provider);
  res.json({
    success: true,
    message: `ยกเลิกการเชื่อมต่อ ${result.provider} เรียบร้อยแล้ว`,
    data: { provider: result.provider, remainingChannels: result.remainingChannels, channelDetails: result.channelDetails }
  });
}));

// Deactivate account
router.delete('/account', verifyToken, asyncHandler(async (req, res) => {
  await authService.deactivateAccount(req.user.id);
  
  res.json({
    success: true,
    message: 'Account deactivated'
  });
}));

export default router;
