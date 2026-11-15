import express from 'express';
import { body, query, param } from 'express-validator';
import { validate, validateId } from '../middleware/validate.js';
import { verifyToken, authorize, verifyAdmin } from '../middleware/auth.js';
import * as authService from '../services/authService.js';
import { asyncHandler, AppError, NotFoundError } from '../middleware/errorHandler.js';

const router = express.Router();

// Get user profile (public)
router.get('/:id/profile', validateId(), asyncHandler(async (req, res) => {
  const profile = await authService.getProfile(req.params.id);
  
  // Remove sensitive fields
  const publicProfile = {
    id: profile.id,
    name: profile.name,
    avatar_url: profile.avatar_url,
    role: profile.role,
    created_at: profile.created_at
  };
  
  res.json({
    success: true,
    data: publicProfile
  });
}));

// Get current user's stores (if seller)
router.get('/me/stores', verifyToken, authorize('seller'), asyncHandler(async (req, res) => {
  const stores = await authService.getStoresByOwner(req.user.id);
  
  res.json({
    success: true,
    data: stores
  });
}));

// Admin: Get all users
router.get('/', verifyToken, verifyAdmin, [
  query('role').optional().isIn(['customer', 'seller', 'admin', 'owner', 'courier']),
  query('isActive').optional().isBoolean(),
  query('search').optional().trim(),
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 })
], validate, asyncHandler(async (req, res) => {
  const filters = {
    role: req.query.role,
    is_active: req.query.isActive !== undefined ? req.query.isActive === 'true' : undefined,
    search: req.query.search
  };
  
  const pagination = {
    page: parseInt(req.query.page) || 1,
    limit: parseInt(req.query.limit) || 20
  };
  
  const result = await authService.getAllUsers(filters, pagination);
  
  res.json({
    success: true,
    data: result
  });
}));

// Admin: Update user role
router.patch('/:id/role', validateId(), verifyToken, verifyAdmin, [
  body('role').isIn(['customer', 'seller', 'admin', 'owner', 'courier']).withMessage('Invalid role')
], validate, asyncHandler(async (req, res) => {
  // Prevent admin from changing owner role
  if (req.user.role === 'admin' && req.body.role === 'owner') {
    throw new AppError('Admins cannot assign owner role', 403);
  }
  
  const profile = await authService.updateUserRole(req.params.id, req.body.role, req.user.id);
  
  res.json({
    success: true,
    message: 'User role updated',
    data: profile
  });
}));

// Admin: Deactivate/activate user
router.patch('/:id/status', validateId(), verifyToken, verifyAdmin, [
  body('isActive').isBoolean().withMessage('isActive must be boolean')
], validate, asyncHandler(async (req, res) => {
  const profile = await authService.updateProfile(req.params.id, { is_active: req.body.isActive });
  
  res.json({
    success: true,
    message: req.body.isActive ? 'User activated' : 'User deactivated',
    data: profile
  });
}));

export default router;