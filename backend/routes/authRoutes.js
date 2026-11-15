import express from 'express';
import { body, query } from 'express-validator';
import { validate } from '../middleware/validate.js';
import { verifyToken, optionalAuth } from '../middleware/auth.js';
import * as authService from '../services/authService.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';

const router = express.Router();

// Register
router.post('/register', [
  body('email').optional().isEmail().normalizeEmail().withMessage('Invalid email'),
  body('phone').optional().isMobilePhone('th-TH').withMessage('Invalid phone number'),
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
  body('phone').optional().isMobilePhone('th-TH').withMessage('Invalid phone number'),
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
  await authService.logoutUser(req.body.refreshToken);
  
  res.json({
    success: true,
    message: 'Logged out successfully'
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