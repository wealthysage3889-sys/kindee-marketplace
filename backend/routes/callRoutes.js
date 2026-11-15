import express from 'express';
import { body, query, param } from 'express-validator';
import { validate, validateId } from '../middleware/validate.js';
import { verifyToken } from '../middleware/auth.js';
import * as callService from '../services/callService.js';
import { asyncHandler, AppError, NotFoundError } from '../middleware/errorHandler.js';

const router = express.Router();

// Get WebRTC configuration
router.get('/config', verifyToken, asyncHandler(async (req, res) => {
  const config = await callService.getWebRTCConfig();
  
  res.json({
    success: true,
    data: config
  });
}));

// Initiate call
router.post('/', verifyToken, [
  body('calleeId').isUUID().withMessage('Callee ID required'),
  body('conversationId').optional().isUUID(),
  body('storeOrderId').optional().isUUID(),
  body('callType').optional().isIn(['voice', 'video']).withMessage('Invalid call type')
], validate, asyncHandler(async (req, res) => {
  const { calleeId, conversationId, storeOrderId, callType = 'voice' } = req.body;
  
  const call = await callService.initiateCall(req.user.id, calleeId, conversationId, storeOrderId, callType);
  
  res.status(201).json({
    success: true,
    message: 'Call initiated',
    data: call
  });
}));

// Accept call
router.post('/:id/accept', validateId(), verifyToken, asyncHandler(async (req, res) => {
  const call = await callService.acceptCall(req.params.id, req.user.id);
  
  res.json({
    success: true,
    message: 'Call accepted',
    data: call
  });
}));

// Reject call
router.post('/:id/reject', validateId(), verifyToken, asyncHandler(async (req, res) => {
  const call = await callService.rejectCall(req.params.id, req.user.id);
  
  res.json({
    success: true,
    message: 'Call rejected',
    data: call
  });
}));

// End call
router.post('/:id/end', validateId(), verifyToken, asyncHandler(async (req, res) => {
  const call = await callService.endCall(req.params.id, req.user.id);
  
  res.json({
    success: true,
    message: 'Call ended',
    data: call
  });
}));

// Get call history
router.get('/history', verifyToken, [
  query('status').optional().isIn(['ringing', 'accepted', 'rejected', 'missed', 'ended']),
  query('type').optional().isIn(['voice', 'video']),
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 50 })
], validate, asyncHandler(async (req, res) => {
  const filters = {
    status: req.query.status,
    type: req.query.type
  };
  
  const pagination = {
    page: parseInt(req.query.page) || 1,
    limit: parseInt(req.query.limit) || 20
  };
  
  const result = await callService.getCallHistory(req.user.id, filters, pagination);
  
  res.json({
    success: true,
    data: result
  });
}));

// Get active call
router.get('/active', verifyToken, asyncHandler(async (req, res) => {
  const call = await callService.getActiveCall(req.user.id);
  
  res.json({
    success: true,
    data: call
  });
}));

// Get call by ID
router.get('/:id', validateId(), verifyToken, asyncHandler(async (req, res) => {
  const { data: call } = await supabaseAdmin
    .from('call_history')
    .select(`
      *,
      caller:profiles!caller_id(id, name, avatar_url),
      callee:profiles!callee_id(id, name, avatar_url),
      conversation:conversations!conversation_id(id, type, store_id),
      store_order:store_orders!store_order_id(id, store_order_number)
    `)
    .eq('id', req.params.id)
    .or(`caller_id.eq.${req.user.id},callee_id.eq.${req.user.id}`)
    .single();
  
  if (!call) {
    throw new NotFoundError('Call');
  }
  
  res.json({
    success: true,
    data: call
  });
}));

// WebRTC signaling
router.post('/:id/signal', validateId(), verifyToken, [
  body('type').isIn(['offer', 'answer', 'ice-candidate']).withMessage('Invalid signal type'),
  body('sdp').optional().isString(),
  body('candidate').optional().isObject()
], validate, asyncHandler(async (req, res) => {
  await callService.handleSignaling(req.params.id, req.user.id, req.body);
  
  res.json({
    success: true,
    message: 'Signal sent'
  });
}));

// Get signaling history
router.get('/:id/signaling', validateId(), verifyToken, asyncHandler(async (req, res) => {
  const signals = await callService.getSignalingHistory(req.params.id, req.user.id);
  
  res.json({
    success: true,
    data: signals
  });
}));

// Toggle mute
router.post('/:id/mute', validateId(), verifyToken, [
  body('muted').isBoolean().withMessage('Muted must be boolean')
], validate, asyncHandler(async (req, res) => {
  await callService.toggleMute(req.params.id, req.user.id, req.body.muted);
  
  res.json({
    success: true,
    message: req.body.muted ? 'Muted' : 'Unmuted'
  });
}));

export default router;