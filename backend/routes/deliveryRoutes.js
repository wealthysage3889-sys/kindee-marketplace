import express from 'express';
import { body, query, param } from 'express-validator';
import { validate, validateId } from '../middleware/validate.js';
import { verifyToken, authorize } from '../middleware/auth.js';
import * as deliveryService from '../services/deliveryService.js';
import { supabaseAdmin } from '../config/supabase.js';
import { asyncHandler, AppError, NotFoundError } from '../middleware/errorHandler.js';

const router = express.Router();

// Create delivery for store order (seller)
router.post('/store-orders/:storeOrderId', validateId('storeOrderId'), verifyToken, authorize('seller'), asyncHandler(async (req, res) => {
  // Verify store ownership
  const { data: storeOrder } = await supabaseAdmin
    .from('store_orders')
    .select(`
      *,
      store:stores!store_id(owner_id)
    `)
    .eq('id', req.params.storeOrderId)
    .single();
  
  if (!storeOrder || storeOrder.store.owner_id !== req.user.id) {
    throw new AppError('Store order not found or not authorized', 403);
  }
  
  const delivery = await deliveryService.createDelivery(req.params.storeOrderId);
  
  res.status(201).json({
    success: true,
    message: 'Delivery created',
    data: delivery
  });
}));

// Get delivery by ID
router.get('/:id', validateId(), verifyToken, asyncHandler(async (req, res) => {
  const delivery = await deliveryService.getDelivery(req.params.id, req.user.id, req.user.role);
  
  res.json({
    success: true,
    data: delivery
  });
}));

// Get courier's deliveries
router.get('/courier/me', verifyToken, authorize('courier'), [
  query('status').optional().isIn(['pending', 'assigned', 'picked_up', 'in_transit', 'delivered', 'failed', 'cancelled'])
], validate, asyncHandler(async (req, res) => {
  const deliveries = await deliveryService.getCourierDeliveries(req.user.id, req.query.status);
  
  res.json({
    success: true,
    data: deliveries
  });
}));

// Get store deliveries (seller)
router.get('/store/:storeId', validateId('storeId'), verifyToken, authorize('seller'), [
  query('status').optional().isIn(['pending', 'assigned', 'picked_up', 'in_transit', 'delivered', 'failed', 'cancelled']),
  query('limit').optional().isInt({ min: 1, max: 100 })
], validate, asyncHandler(async (req, res) => {
  const filters = {
    status: req.query.status,
    limit: req.query.limit ? parseInt(req.query.limit) : undefined
  };
  
  const deliveries = await deliveryService.getStoreDeliveries(req.params.storeId, req.user.id, filters);
  
  res.json({
    success: true,
    data: deliveries
  });
}));

// Courier accepts assignment
router.post('/assignments/:id/accept', validateId('id'), verifyToken, authorize('courier'), asyncHandler(async (req, res) => {
  await deliveryService.acceptAssignment(req.user.id, req.params.id);
  
  res.json({
    success: true,
    message: 'Assignment accepted'
  });
}));

// Courier rejects assignment
router.post('/assignments/:id/reject', validateId('id'), verifyToken, authorize('courier'), asyncHandler(async (req, res) => {
  await deliveryService.rejectAssignment(req.user.id, req.params.id);
  
  res.json({
    success: true,
    message: 'Assignment rejected'
  });
}));

// Courier picks up order
router.post('/:id/pickup', validateId(), verifyToken, authorize('courier'), asyncHandler(async (req, res) => {
  await deliveryService.pickupOrder(req.user.id, req.params.id);
  
  res.json({
    success: true,
    message: 'Order picked up'
  });
}));

// Courier delivers order
router.post('/:id/deliver', validateId(), verifyToken, authorize('courier'), [
  body('proofImage').optional().isURL().withMessage('Invalid proof image URL')
], validate, asyncHandler(async (req, res) => {
  await deliveryService.deliverOrder(req.user.id, req.params.id, req.body.proofImage);
  
  res.json({
    success: true,
    message: 'Order delivered'
  });
}));

// Update courier location (real-time tracking)
router.post('/:id/location', validateId(), verifyToken, authorize('courier'), [
  body('coordinates').isObject().withMessage('Coordinates required'),
  body('coordinates.lat').isFloat({ min: -90, max: 90 }).withMessage('Invalid latitude'),
  body('coordinates.lng').isFloat({ min: -180, max: 180 }).withMessage('Invalid longitude'),
  body('accuracy').optional().isFloat({ min: 0 }),
  body('speed').optional().isFloat({ min: 0 }),
  body('heading').optional().isFloat({ min: 0, max: 360 })
], validate, asyncHandler(async (req, res) => {
  const { coordinates, accuracy, speed, heading } = req.body;
  
  await deliveryService.updateCourierLocation(req.user.id, req.params.id, coordinates, {
    accuracy,
    speed,
    heading
  });
  
  res.json({
    success: true,
    message: 'Location updated'
  });
}));

// Get delivery route
router.get('/:id/route', validateId(), verifyToken, asyncHandler(async (req, res) => {
  const route = await deliveryService.getDeliveryRoute(req.params.id);
  
  res.json({
    success: true,
    data: route
  });
}));

// End courier shift
router.post('/courier/end-shift', verifyToken, authorize('courier'), asyncHandler(async (req, res) => {
  await deliveryService.endCourierShift(req.user.id);
  
  res.json({
    success: true,
    message: 'Shift ended'
  });
}));

export default router;