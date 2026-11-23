import express from 'express';
import { body, query, param } from 'express-validator';
import { validate, validateId } from '../middleware/validate.js';
import { verifyToken, authorize } from '../middleware/auth.js';
import * as chatService from '../services/chatService.js';
import { getConversationRoute } from '../services/routeService.js';
import { getConversationIpLocation, getClientIp, recordCustomerIp } from '../services/ipLocationService.js';
import { asyncHandler, AppError, NotFoundError } from '../middleware/errorHandler.js';
import { uploadMultiple, uploadToSupabase, generateFileName, generateStoragePath, getSignedUrl } from '../middleware/upload.js';
import { supabaseAdmin } from '../config/supabase.js';

const router = express.Router();

// Retain the customer's most recent IP in memory (short TTL only) so the store
// owner can see an approximate, clearly-labelled IP location. Disabled unless
// the server opts in via IP_GEOLOCATION_ENABLED + IP_GEOLOCATION_CONSENT.
// The IP itself is never persisted, logged, or returned to the client.
const captureCustomerIp = (req, res, next) => {
  recordCustomerIp({
    profileId: req.user?.id,
    role: req.user?.role,
    ip: getClientIp(req),
  });
  next();
};

// Get or create conversation with store
router.post('/conversations', verifyToken, [
  body('storeId').isUUID().withMessage('Store ID required'),
  body('storeOrderId').optional().isUUID()
], validate, asyncHandler(async (req, res) => {
  const { storeId, storeOrderId } = req.body;

  const conversation = await chatService.getOrCreateConversation(req.user.id, storeId, storeOrderId, {
    role: req.user.role
  });

  res.json({
    success: true,
    data: conversation
  });
}));

// Get user conversations
router.get('/conversations', verifyToken, captureCustomerIp, [
  query('type').optional().isIn(['direct', 'group', 'store_customer', 'order_support']),
  query('storeId').optional().isUUID(),
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 50 })
], validate, asyncHandler(async (req, res) => {
  const filters = {
    type: req.query.type,
    store_id: req.query.storeId
  };
  
  const pagination = {
    page: parseInt(req.query.page) || 1,
    limit: parseInt(req.query.limit) || 20
  };
  
  const result = await chatService.getUserConversations(req.user.id, filters, pagination);
  
  res.json({
    success: true,
    data: result
  });
}));

// Get conversation by ID
router.get('/conversations/:id', validateId(), verifyToken, asyncHandler(async (req, res) => {
  const conversation = await chatService.getConversationById(req.params.id, req.user.id);
  
  res.json({
    success: true,
    data: conversation
  });
}));

// Get messages for conversation
router.get('/conversations/:id/messages', validateId(), verifyToken, captureCustomerIp, [
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('beforeId').optional().isUUID()
], validate, asyncHandler(async (req, res) => {
  const pagination = {
    page: parseInt(req.query.page) || 1,
    limit: parseInt(req.query.limit) || 50,
    before_id: req.query.beforeId
  };
  
  const messages = await chatService.getMessages(req.params.id, req.user.id, pagination);
  
  res.json({
    success: true,
    data: messages
  });
}));

// Send message
router.post('/conversations/:id/messages', validateId(), verifyToken, captureCustomerIp, [
  body('content').optional().trim(),
  body('type').optional().isIn(['text', 'image', 'file', 'location', 'system', 'order_update', 'voice_call']),
  body('metadata').optional().isObject(),
  body('replyToId').optional().isUUID(),
  body('attachments').optional().isArray()
], validate, asyncHandler(async (req, res) => {
  const { content, type = 'text', metadata = {}, replyToId, attachments = [] } = req.body;
  
  const message = await chatService.sendMessage(req.params.id, req.user.id, {
    content,
    type,
    metadata,
    reply_to_id: replyToId,
    attachments
  });
  
  res.status(201).json({
    success: true,
    message: 'Message sent',
    data: message
  });
}));

// Mark messages as read
router.post('/conversations/:id/read', validateId(), verifyToken, [
  body('lastReadMessageId').optional().isUUID()
], validate, asyncHandler(async (req, res) => {
  await chatService.markMessagesRead(req.params.id, req.user.id, req.body.lastReadMessageId);
  
  res.json({
    success: true,
    message: 'Messages marked as read'
  });
}));

// Get unread count
router.get('/unread-count', verifyToken, asyncHandler(async (req, res) => {
  const count = await chatService.getUnreadCount(req.user.id);
  
  res.json({
    success: true,
    data: { count }
  });
}));

// Edit message
router.put('/messages/:id', validateId(), verifyToken, [
  body('content').trim().notEmpty().withMessage('Content required')
], validate, asyncHandler(async (req, res) => {
  const message = await chatService.editMessage(req.params.id, req.user.id, req.body.content);
  
  res.json({
    success: true,
    message: 'Message updated',
    data: message
  });
}));

// Delete message
router.delete('/messages/:id', validateId(), verifyToken, asyncHandler(async (req, res) => {
  await chatService.deleteMessage(req.params.id, req.user.id);
  
  res.json({
    success: true,
    message: 'Message deleted'
  });
}));

// Create group conversation
router.post('/conversations/group', verifyToken, [
  body('name').trim().notEmpty().withMessage('Group name required'),
  body('memberIds').isArray({ min: 1 }).withMessage('At least one member required'),
  body('memberIds.*').isUUID().withMessage('Invalid member ID'),
  body('storeId').optional().isUUID(),
  body('storeOrderId').optional().isUUID()
], validate, asyncHandler(async (req, res) => {
  const { name, memberIds, storeId, storeOrderId } = req.body;
  
  const conversation = await chatService.createGroupConversation(req.user.id, {
    name,
    memberIds,
    storeId,
    storeOrderId
  });
  
  res.status(201).json({
    success: true,
    message: 'Group created',
    data: conversation
  });
}));

// Add member to conversation
router.post('/conversations/:id/members', validateId(), verifyToken, [
  body('memberId').isUUID().withMessage('Member ID required'),
  body('role').optional().isIn(['member', 'admin']).withMessage('Invalid role')
], validate, asyncHandler(async (req, res) => {
  await chatService.addConversationMember(req.params.id, req.user.id, req.body.memberId, req.body.role);
  
  res.json({
    success: true,
    message: 'Member added'
  });
}));

// Remove member from conversation
router.delete('/conversations/:id/members/:memberId', validateId(), verifyToken, asyncHandler(async (req, res) => {
  await chatService.removeConversationMember(req.params.id, req.user.id, req.params.memberId);
  
  res.json({
    success: true,
    message: 'Member removed'
  });
}));

// Mute/unmute conversation
router.patch('/conversations/:id/mute', validateId(), verifyToken, [
  body('muted').isBoolean().withMessage('Muted must be boolean')
], validate, asyncHandler(async (req, res) => {
  await chatService.muteConversation(req.params.id, req.user.id, req.body.muted);
  
  res.json({
    success: true,
    message: req.body.muted ? 'Conversation muted' : 'Conversation unmuted'
  });
}));

// Upload message attachment
router.post('/messages/:id/attachments', validateId(), verifyToken, uploadMultiple('attachments', 5, 'chat-attachments'), asyncHandler(async (req, res) => {
  if (!req.files || req.files.length === 0) {
    throw new AppError('No files uploaded', 400);
  }
  
  const uploadedAttachments = [];
  
  for (const file of req.files) {
    const fileName = generateFileName(file.originalname, 'chat-');
    const filePath = generateStoragePath('chat-attachments', req.params.id, fileName);
    
    const result = await uploadToSupabase(supabaseAdmin, 'chat-attachments', filePath, file.buffer, file.mimetype);
    
    // chat-attachments bucket is private, use signed URL
    const signedUrl = await getSignedUrl(supabaseAdmin, 'chat-attachments', result.path, 3600);
    
    const attachment = await chatService.uploadMessageAttachment(req.params.id, {
      file_url: signedUrl,
      file_name: file.originalname,
      file_size: file.size,
      mime_type: file.mimetype
    }, req.user.id);
    
    uploadedAttachments.push(attachment);
  }
  
  res.json({
    success: true,
    message: 'Attachments uploaded',
    data: uploadedAttachments
  });
}));

// Get store conversations (seller)
router.get('/store/:storeId/conversations', validateId('storeId'), verifyToken, authorize('seller', 'owner', 'admin'), [
  query('status').optional().isIn(['all', 'unread']),
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 50 })
], validate, asyncHandler(async (req, res) => {
  const { data: store } = await supabaseAdmin
    .from('stores')
    .select('id')
    .eq('id', req.params.storeId)
    .eq('owner_id', req.user.id)
    .single();

  if (!store) {
    throw new AppError('Store not found or not authorized', 403);
  }
  
  const filters = {
    status: req.query.status
  };
  
  const pagination = {
    page: parseInt(req.query.page) || 1,
    limit: parseInt(req.query.limit) || 20
  };
  
  const result = await chatService.getStoreConversations(req.params.storeId, req.user.id, filters, pagination);
  
  res.json({
    success: true,
    data: result
  });
}));

// Get conversation route (map/navigation)
router.get('/conversations/:id/route', validateId(), verifyToken, asyncHandler(async (req, res) => {
  const route = await getConversationRoute(req.params.id, req.user.id);
  
  res.json({
    success: true,
    data: route
  });
}));

// Get the customer's approximate IP-based location for this conversation.
// This is explicitly separate from GPS/shared locations and is never used as a
// delivery destination. Responds with available:false plus a reason when the
// feature is disabled, no recent IP exists, or the provider fails.
router.get('/conversations/:id/ip-location', validateId(), verifyToken, asyncHandler(async (req, res) => {
  const location = await getConversationIpLocation(req.params.id, req.user.id);

  res.json({
    success: true,
    data: location
  });
}));

// Update conversation alias (rename chat)
router.patch('/conversations/:id/alias', validateId(), verifyToken, [
  body('alias').optional().isString().trim().isLength({ max: 100 }).withMessage('Alias too long')
], validate, asyncHandler(async (req, res) => {
  const result = await chatService.updateConversationAlias(req.params.id, req.user.id, req.body.alias);
  
  res.json({
    success: true,
    message: req.body.alias ? 'Chat renamed' : 'Chat name reset',
    data: result
  });
}));

// Update conversation hidden state (hide/show chat)
router.patch('/conversations/:id/hidden', validateId(), verifyToken, [
  body('isHidden').isBoolean().withMessage('isHidden must be boolean')
], validate, asyncHandler(async (req, res) => {
  const result = await chatService.updateConversationHidden(req.params.id, req.user.id, req.body.isHidden);
  
  res.json({
    success: true,
    message: req.body.isHidden ? 'Chat hidden' : 'Chat shown',
    data: result
  });
}));

// Mark conversation as spam (store owner)
router.post('/conversations/:id/spam', validateId(), verifyToken, asyncHandler(async (req, res) => {
  const result = await chatService.markConversationSpam(req.params.id, req.user.id);
  
  res.json({
    success: true,
    message: 'Conversation marked as spam',
    data: result
  });
}));

// Restore conversation from spam (store owner)
router.post('/conversations/:id/restore', validateId(), verifyToken, asyncHandler(async (req, res) => {
  const result = await chatService.restoreConversationFromSpam(req.params.id, req.user.id);
  
  res.json({
    success: true,
    message: 'Conversation restored from spam',
    data: result
  });
}));

// Get spam conversations (store owner)
router.get('/store/:storeId/spam', validateId('storeId'), verifyToken, authorize('seller', 'owner', 'admin'), [
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 50 })
], validate, asyncHandler(async (req, res) => {
  const { data: store } = await supabaseAdmin
    .from('stores')
    .select('id')
    .eq('id', req.params.storeId)
    .eq('owner_id', req.user.id)
    .single();

  if (!store) {
    throw new AppError('Store not found or not authorized', 403);
  }
  
  const pagination = {
    page: parseInt(req.query.page) || 1,
    limit: parseInt(req.query.limit) || 20
  };
  
  const result = await chatService.getSpamConversations(req.params.storeId, req.user.id, pagination);
  
  res.json({
    success: true,
    data: result
  });
}));

export default router;