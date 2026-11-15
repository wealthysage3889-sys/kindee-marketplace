import express from 'express';
import { body, query, param } from 'express-validator';
import { validate, validateId } from '../middleware/validate.js';
import { verifyToken } from '../middleware/auth.js';
import * as notificationService from '../services/notificationService.js';
import { asyncHandler, AppError, NotFoundError } from '../middleware/errorHandler.js';

const router = express.Router();

// Get notifications
router.get('/', verifyToken, [
  query('isRead').optional().isBoolean(),
  query('type').optional().isIn(['new_message', 'order_status', 'delivery_update', 'incoming_call', 'missed_call', 'payment', 'refund', 'system', 'promotion']),
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 50 })
], validate, asyncHandler(async (req, res) => {
  const filters = {
    is_read: req.query.isRead !== undefined ? req.query.isRead === 'true' : undefined,
    type: req.query.type
  };
  
  const pagination = {
    page: parseInt(req.query.page) || 1,
    limit: parseInt(req.query.limit) || 20
  };
  
  const result = await notificationService.getNotifications(req.user.id, filters, pagination);
  
  res.json({
    success: true,
    data: result
  });
}));

// Get unread count
router.get('/unread-count', verifyToken, asyncHandler(async (req, res) => {
  const count = await notificationService.getUnreadCount(req.user.id);
  
  res.json({
    success: true,
    data: { count }
  });
}));

// Mark notification as read
router.patch('/:id/read', validateId(), verifyToken, asyncHandler(async (req, res) => {
  const notification = await notificationService.markAsRead(req.params.id, req.user.id);
  
  res.json({
    success: true,
    message: 'Notification marked as read',
    data: notification
  });
}));

// Mark all as read
router.post('/read-all', verifyToken, asyncHandler(async (req, res) => {
  await notificationService.markAllAsRead(req.user.id);
  
  res.json({
    success: true,
    message: 'All notifications marked as read'
  });
}));

// Delete notification
router.delete('/:id', validateId(), verifyToken, asyncHandler(async (req, res) => {
  await notificationService.deleteNotification(req.params.id, req.user.id);
  
  res.json({
    success: true,
    message: 'Notification deleted'
  });
}));

export default router;