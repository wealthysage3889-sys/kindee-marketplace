import express from 'express';
import { body, query, param } from 'express-validator';
import { validate, validateId } from '../middleware/validate.js';
import { verifyToken, authorize, verifyAdmin } from '../middleware/auth.js';
import * as orderService from '../services/orderService.js';
import { asyncHandler, AppError, NotFoundError } from '../middleware/errorHandler.js';
import { validatePhone } from '../utils/phone.js';
import { supabaseAdmin } from '../config/supabase.js';
import { uploadSingle } from '../middleware/upload.js';

const router = express.Router();

// Upload payment slip for existing order (customer)
router.post('/:id/payment-slip', validateId(), verifyToken, uploadSingle('slip', 'payment-slips'), [
  body('amountThb').optional().isFloat({ min: 0.01 }).withMessage('Invalid amount'),
  body('note').optional().trim()
], validate, asyncHandler(async (req, res) => {
  if (!req.file) { throw new AppError('No file uploaded', 400); }
  const result = await orderService.uploadPaymentSlip(req.user.id, req.params.id, {
    fileBuffer: req.file.buffer,
    fileName: req.file.originalname,
    mimeType: req.file.mimetype,
    amountThb: req.body.amountThb || null,
    note: req.body.note
  });
  res.status(201).json({ success: true, message: 'Payment slip uploaded', data: result });
}));

// Create order
router.post('/', verifyToken, [
  body('items').isArray({ min: 1 }).withMessage('At least one item required'),
  body('items.*.productId').isUUID().withMessage('Invalid product ID'),
  body('items.*.quantity').isInt({ min: 1 }).withMessage('Quantity must be at least 1'),
  body('paymentMethod').isIn(['cod', 'transfer', 'promptpay', 'card', 'wallet', 'kbzpay']).withMessage('Invalid payment method'),
  body('customerNotes').optional().trim(),
  body('deliveryAddress').isObject().withMessage('Delivery address required'),
  body('deliveryAddress.name').trim().notEmpty().withMessage('Recipient name required'),
  body('deliveryAddress.phone').custom(validatePhone).withMessage('Invalid phone'),
  body('deliveryAddress.address').trim().notEmpty().withMessage('Address required'),
  body('deliveryAddress.district').optional().trim(),
  body('deliveryAddress.province').optional().trim(),
  body('deliveryAddress.postalCode').optional().trim(),
  body('customerCoordinates').optional().custom((value) => {
    if (value === null || value === undefined) return true;
    return value.lat !== undefined && value.lng !== undefined;
  }).withMessage('Both latitude and longitude are required'),
  body('customerCoordinates.lat').optional().isFloat({ min: -90, max: 90 }),
  body('customerCoordinates.lng').optional().isFloat({ min: -180, max: 180 }),
  // KBZPay exchange rate fields (only required when paymentMethod === 'kbzpay')
  body('exchangeRate').optional().isFloat({ min: 0.001 }).withMessage('Invalid exchange rate'),
  body('exchangeRateSource').optional().isString().trim().withMessage('Invalid exchange rate source'),
  body('exchangeRateUpdatedAt').optional().isISO8601().withMessage('Invalid exchange rate timestamp'),
  body('amountMMK').optional().isFloat({ min: 0.01 }).withMessage('Invalid MMK amount')
], validate, asyncHandler(async (req, res) => {
  const { items, paymentMethod, customerNotes, deliveryAddress, customerCoordinates,
    exchangeRate, exchangeRateSource, exchangeRateUpdatedAt, amountMMK } = req.body;
  
  const order = await orderService.createOrder(req.user.id, {
    items: items.map(item => ({
      product_id: item.productId,
      quantity: item.quantity
    })),
    payment_method: paymentMethod,
    customer_notes: customerNotes,
    delivery_address: deliveryAddress,
    customer_coordinates: customerCoordinates,
    exchange_rate: exchangeRate,
    exchange_rate_source: exchangeRateSource,
    exchange_rate_updated_at: exchangeRateUpdatedAt,
    amount_mmk: amountMMK
  });
  
  res.status(201).json({
    success: true,
    message: 'Order created successfully',
    data: order
  });
}));

// Upload payment slip for existing order (customer)
router.post('/:id/payment-slip', validateId(), verifyToken, uploadSingle('slip', 'payment-slips'), [
  body('amountThb').optional().isFloat({ min: 0.01 }).withMessage('Invalid amount'),
  body('note').optional().trim()
], validate, asyncHandler(async (req, res) => {
  if (!req.file) {
    throw new AppError('No file uploaded', 400);
  }

  const result = await orderService.uploadPaymentSlip(req.user.id, req.params.id, {
    fileBuffer: req.file.buffer,
    fileName: req.file.originalname,
    mimeType: req.file.mimetype,
    amountThb: req.body.amountThb || null,
    note: req.body.note
  });

  res.status(201).json({
    success: true,
    message: 'Payment slip uploaded',
    data: result
  });
}));

// Get customer orders
router.get('/', verifyToken, authorize('customer'), [
  query('status').optional().isIn(['pending', 'confirmed', 'preparing', 'ready_for_pickup', 'picked_up', 'in_transit', 'delivered', 'cancelled', 'refunded']),
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 50 })
], validate, asyncHandler(async (req, res) => {
  const filters = {
    status: req.query.status
  };
  
  const pagination = {
    page: parseInt(req.query.page) || 1,
    limit: parseInt(req.query.limit) || 20
  };
  
  const result = await orderService.getCustomerOrders(req.user.id, filters, pagination);
  
  res.json({
    success: true,
    data: result
  });
}));

// Get order by ID
router.get('/:id', validateId(), verifyToken, asyncHandler(async (req, res) => {
  const order = await orderService.getOrderById(req.params.id, req.user.id, req.user.role);
  
  res.json({
    success: true,
    data: order
  });
}));

// Cancel order (customer)
router.post('/:id/cancel', validateId(), verifyToken, authorize('customer'), [
  body('reason').trim().notEmpty().withMessage('Cancellation reason required')
], validate, asyncHandler(async (req, res) => {
  const order = await orderService.cancelOrder(req.params.id, req.user.id, req.body.reason);
  
  res.json({
    success: true,
    message: 'Order cancelled',
    data: order
  });
}));

// Get order status history (customer or seller/admin/owner for their store orders)
router.get('/:id/history', validateId(), verifyToken, asyncHandler(async (req, res) => {
  // Check if user is seller/admin/owner - if so, verify store ownership via store_order
  if (['seller', 'admin', 'owner'].includes(req.user.role)) {
    // For sellers, we need to check if they own a store_order for this parent order
    const { data: storeOrder } = await supabaseAdmin
      .from('store_orders')
      .select('id, store:stores!store_id(owner_id)')
      .eq('parent_order_id', req.params.id)
      .single();
    
    if (storeOrder) {
      if (storeOrder.store.owner_id !== req.user.id && req.user.role !== 'admin' && req.user.role !== 'owner') {
        return res.status(403).json({
          success: false,
          message: 'Not authorized to view this order history'
        });
      }
      // Seller owns this store order, allow access
      const history = await orderService.getOrderStatusHistory(req.params.id);
      return res.json({
        success: true,
        data: history
      });
    }
  }
  
  // Default: customer access check
  await orderService.getOrderById(req.params.id, req.user.id, req.user.role);
  const history = await orderService.getOrderStatusHistory(req.params.id);
  
  res.json({
    success: true,
    data: history
  });
}));

// Get store order status history (seller/admin/owner)
router.get('/store-orders/:storeOrderId/history', validateId('storeOrderId'), verifyToken, authorize('seller', 'admin', 'owner'), asyncHandler(async (req, res) => {
  const history = await orderService.getStoreOrderStatusHistory(req.params.storeOrderId, req.user.id);
  
  res.json({
    success: true,
    data: history
  });
}));

// Get store orders (seller/admin/owner)
router.get('/store/:storeId', validateId('storeId'), verifyToken, authorize('seller', 'admin', 'owner'), [
  query('status').optional().isIn(['pending', 'confirmed', 'preparing', 'ready_for_pickup', 'picked_up', 'in_transit', 'delivered', 'cancelled']),
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 50 })
], validate, asyncHandler(async (req, res) => {
  const filters = {
    status: req.query.status
  };

  const pagination = {
    page: parseInt(req.query.page) || 1,
    limit: parseInt(req.query.limit) || 20
  };

  const result = await orderService.getStoreOrders(req.params.storeId, req.user.id, filters, pagination);

  res.json({
    success: true,
    data: result
  });
}));

// Update store order status (seller/admin/owner)
router.patch('/store-orders/:storeOrderId/status', validateId('storeOrderId'), verifyToken, authorize('seller', 'admin', 'owner'), [
  body('status').isIn(['confirmed', 'preparing', 'ready_for_pickup', 'picked_up', 'in_transit', 'delivered', 'cancelled', 'failed']).withMessage('Invalid status'),
  body('notes').optional().trim()
], validate, asyncHandler(async (req, res) => {
  const storeOrder = await orderService.updateStoreOrderStatus(
    req.params.storeOrderId,
    req.user.id,
    req.body.status,
    req.body.notes
  );
  
  res.json({
    success: true,
    message: 'Store order status updated',
    data: storeOrder
  });
}));

// Create refund
router.post('/:id/refund', validateId(), verifyToken, verifyAdmin, [
  body('storeOrderId').optional().isUUID(),
  body('amount').isFloat({ min: 0.01 }).withMessage('Amount must be positive'),
  body('reason').trim().notEmpty().withMessage('Refund reason required')
], validate, asyncHandler(async (req, res) => {
  const refund = await orderService.createRefund(
    req.params.id,
    req.body.storeOrderId,
    req.body.amount,
    req.body.reason,
    req.user.id
  );
  
  res.status(201).json({
    success: true,
    message: 'Refund request created',
    data: refund
  });
}));

// Admin: Get all orders
router.get('/admin/all', verifyToken, verifyAdmin, [
  query('status').optional().isIn(['pending', 'confirmed', 'preparing', 'ready_for_pickup', 'picked_up', 'in_transit', 'delivered', 'cancelled', 'refunded']),
  query('paymentStatus').optional().isIn(['pending', 'paid', 'failed', 'refunded', 'partially_refunded']),
  query('customerId').optional().isUUID(),
  query('dateFrom').optional().isISO8601(),
  query('dateTo').optional().isISO8601(),
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 })
], validate, asyncHandler(async (req, res) => {
  const filters = {
    status: req.query.status,
    payment_status: req.query.paymentStatus,
    customer_id: req.query.customerId,
    date_from: req.query.dateFrom,
    date_to: req.query.dateTo
  };
  
  const pagination = {
    page: parseInt(req.query.page) || 1,
    limit: parseInt(req.query.limit) || 20
  };
  
  const result = await orderService.getAllOrders(filters, pagination);
  
  res.json({
    success: true,
    data: result
  });
}));

export default router;

