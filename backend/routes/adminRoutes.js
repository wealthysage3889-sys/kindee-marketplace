import express from 'express';
import { body, query, param } from 'express-validator';
import { validate, validateId } from '../middleware/validate.js';
import { verifyToken, authorize, verifyAdmin } from '../middleware/auth.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import { supabaseAdmin } from '../config/supabase.js';
import * as orderService from '../services/orderService.js';
import * as notificationService from '../services/notificationService.js';
import {
  SETTING_COLUMNS,
  normalizeSettingsPayload,
  redactSetting
} from '../utils/settings.js';

const router = express.Router();

// Dashboard stats
router.get('/stats', verifyToken, verifyAdmin, asyncHandler(async (req, res) => {
  const [
    { count: totalUsers },
    { count: totalStores },
    { count: totalProducts },
    { count: totalOrders },
    { count: pendingOrders },
    { count: totalRevenue }
  ] = await Promise.all([
    supabaseAdmin.from('profiles').select('id', { count: 'exact', head: true }),
    supabaseAdmin.from('stores').select('id', { count: 'exact', head: true }),
    supabaseAdmin.from('products').select('id', { count: 'exact', head: true }),
    supabaseAdmin.from('orders').select('id', { count: 'exact', head: true }),
    supabaseAdmin.from('orders').select('id', { count: 'exact', head: true }).in('status', ['pending', 'confirmed', 'preparing']),
    supabaseAdmin.from('orders').select('total_amount', { count: 'exact' }).eq('payment_status', 'paid')
  ]);
  
  const revenue = totalRevenue?.reduce((sum, o) => sum + parseFloat(o.total_amount), 0) || 0;
  
  res.json({
    success: true,
    data: {
      totalUsers,
      totalStores,
      totalProducts,
      totalOrders,
      pendingOrders,
      totalRevenue: revenue
    }
  });
}));

// Get all orders with filters
router.get('/orders', verifyToken, verifyAdmin, [
  query('status').optional(),
  query('paymentStatus').optional(),
  query('customerId').optional().isUUID(),
  query('dateFrom').optional().isISO8601(),
  query('dateTo').optional().isISO8601(),
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 })
], validate, asyncHandler(async (req, res) => {
  const result = await orderService.getAllOrders(req.query, {
    page: parseInt(req.query.page) || 1,
    limit: parseInt(req.query.limit) || 20
  });
  
  res.json({
    success: true,
    data: result
  });
}));

// Update order status (admin)
router.patch('/orders/:id/status', validateId(), verifyToken, verifyAdmin, [
  body('status').isIn(['pending', 'confirmed', 'preparing', 'ready_for_pickup', 'picked_up', 'in_transit', 'delivered', 'cancelled', 'refunded']).withMessage('Invalid status'),
  body('notes').optional().trim()
], validate, asyncHandler(async (req, res) => {
  const { data: order, error } = await supabaseAdmin
    .from('orders')
    .update({ 
      status: req.body.status,
      admin_notes: req.body.notes,
      ...(req.body.status === 'delivered' && { delivered_at: new Date().toISOString(), payment_status: 'paid' }),
      ...(req.body.status === 'cancelled' && { cancelled_at: new Date().toISOString() }),
      ...(req.body.status === 'refunded' && { cancelled_at: new Date().toISOString() })
    })
    .eq('id', req.params.id)
    .select()
    .single();
  
  if (error) {
    throw new AppError(`Order status update failed: ${error.message}`, 500);
  }
  
  res.json({
    success: true,
    message: 'Order status updated',
    data: order
  });
}));

// Get all stores
router.get('/stores', verifyToken, verifyAdmin, [
  query('isActive').optional().isBoolean(),
  query('isVerified').optional().isBoolean(),
  query('ownerId').optional().isUUID(),
  query('search').optional().trim(),
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 })
], validate, asyncHandler(async (req, res) => {
  const filters = {
    is_active: req.query.isActive !== undefined ? req.query.isActive === 'true' : undefined,
    is_verified: req.query.isVerified !== undefined ? req.query.isVerified === 'true' : undefined,
    owner_id: req.query.ownerId,
    search: req.query.search
  };
  
  const pagination = {
    page: parseInt(req.query.page) || 1,
    limit: parseInt(req.query.limit) || 20
  };
  
  // This would use storeService.getAllStores but we'll inline it
  let query = supabaseAdmin
    .from('stores')
    .select(`
      *,
      owner:profiles!owner_id(id, name, email, phone)
    `, { count: 'exact' });
  
  if (filters.is_active !== undefined) query = query.eq('is_active', filters.is_active);
  if (filters.is_verified !== undefined) query = query.eq('is_verified', filters.is_verified);
  if (filters.owner_id) query = query.eq('owner_id', filters.owner_id);
  if (filters.search) {
    query = query.or(`name.ilike.%${filters.search}%,slug.ilike.%${filters.search}%`);
  }
  
  query = query
    .order('created_at', { ascending: false })
    .range((pagination.page - 1) * pagination.limit, pagination.page * pagination.limit - 1);
  
  const { data, error, count } = await query;
  
  if (error) {
    throw new AppError(`Failed to fetch stores: ${error.message}`, 500);
  }
  
  res.json({
    success: true,
    data: {
      stores: data,
      pagination: {
        page: pagination.page,
        limit: pagination.limit,
        total: count,
        totalPages: Math.ceil(count / pagination.limit)
      }
    }
  });
}));

// Verify store
router.patch('/stores/:id/verify', validateId(), verifyToken, verifyAdmin, [
  body('verified').isBoolean().withMessage('Verified must be boolean')
], validate, asyncHandler(async (req, res) => {
  const { data: store, error } = await supabaseAdmin
    .from('stores')
    .update({ is_verified: req.body.verified })
    .eq('id', req.params.id)
    .select()
    .single();
  
  if (error) {
    throw new AppError(`Store verification failed: ${error.message}`, 500);
  }
  
  res.json({
    success: true,
    message: req.body.verified ? 'Store verified' : 'Store unverified',
    data: store
  });
}));

// Get all products
router.get('/products', verifyToken, verifyAdmin, [
  query('storeId').optional().isUUID(),
  query('categoryId').optional().isUUID(),
  query('isActive').optional().isBoolean(),
  query('search').optional().trim(),
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 })
], validate, asyncHandler(async (req, res) => {
  const filters = {
    store_id: req.query.storeId,
    category_id: req.query.categoryId,
    is_active: req.query.isActive !== undefined ? req.query.isActive === 'true' : undefined,
    search: req.query.search
  };
  
  const pagination = {
    page: parseInt(req.query.page) || 1,
    limit: parseInt(req.query.limit) || 20
  };
  
  let query = supabaseAdmin
    .from('products')
    .select(`
      *,
      store:stores!store_id(id, name, slug),
      category:categories!category_id(id, name)
    `, { count: 'exact' });
  
  if (filters.store_id) query = query.eq('store_id', filters.store_id);
  if (filters.category_id) query = query.eq('category_id', filters.category_id);
  if (filters.is_active !== undefined) query = query.eq('is_active', filters.is_active);
  if (filters.search) {
    query = query.or(`name.ilike.%${filters.search}%,description.ilike.%${filters.search}%`);
  }
  
  query = query
    .order('created_at', { ascending: false })
    .range((pagination.page - 1) * pagination.limit, pagination.page * pagination.limit - 1);
  
  const { data, error, count } = await query;
  
  if (error) {
    throw new AppError(`Failed to fetch products: ${error.message}`, 500);
  }
  
  res.json({
    success: true,
    data: {
      products: data,
      pagination: {
        page: pagination.page,
        limit: pagination.limit,
        total: count,
        totalPages: Math.ceil(count / pagination.limit)
      }
    }
  });
}));

// Get all users
router.get('/users', verifyToken, verifyAdmin, [
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
  
  const result = await supabaseAdmin
    .from('profiles')
    .select('*', { count: 'exact' });
  
  // Apply filters
  if (filters.role) result.eq('role', filters.role);
  if (filters.is_active !== undefined) result.eq('is_active', filters.is_active);
  if (filters.search) {
    result.or(`name.ilike.%${filters.search}%,email.ilike.%${filters.search}%,phone.ilike.%${filters.search}%`);
  }
  
  result.order('created_at', { ascending: false })
    .range((pagination.page - 1) * pagination.limit, pagination.page * pagination.limit - 1);
  
  const { data, error, count } = await result;
  
  if (error) {
    throw new AppError(`Failed to fetch users: ${error.message}`, 500);
  }
  
  res.json({
    success: true,
    data: {
      users: data,
      pagination: {
        page: pagination.page,
        limit: pagination.limit,
        total: count,
        totalPages: Math.ceil(count / pagination.limit)
      }
    }
  });
}));

// Send system notification
router.post('/notifications', verifyToken, verifyAdmin, [
  body('recipientIds').isArray({ min: 1 }).withMessage('Recipient IDs required'),
  body('recipientIds.*').isUUID().withMessage('Invalid recipient ID'),
  body('title').trim().notEmpty().withMessage('Title required'),
  body('body').trim().notEmpty().withMessage('Body required'),
  body('type').optional().isIn(['system', 'promotion']).withMessage('Invalid type')
], validate, asyncHandler(async (req, res) => {
  const { recipientIds, title, body, type = 'system' } = req.body;
  
  const notifications = [];
  for (const recipientId of recipientIds) {
    const notification = await notificationService.createSystemNotification(
      recipientId,
      type,
      title,
      body,
      null,
      'system'
    );
    notifications.push(notification);
  }
  
  res.json({
    success: true,
    message: `Sent to ${notifications.length} users`,
    data: notifications
  });
}));

// Get platform settings
router.get('/settings', verifyToken, verifyAdmin, asyncHandler(async (req, res) => {
  const { data: settings, error } = await supabaseAdmin
    .from('settings')
    .select(SETTING_COLUMNS)
    .order('key');
  
  if (error) {
    throw new AppError(`Failed to fetch settings: ${error.message}`, 500);
  }
  
  res.json({
    success: true,
    data: (settings || []).map(redactSetting)
  });
}));

// Bulk update platform settings (admin/owner)
router.post('/settings/bulk', verifyToken, verifyAdmin, [
  body('settings').isArray({ min: 1 }).withMessage('settings must be a non-empty array'),
  body('settings.*.key').isString().notEmpty().withMessage('Setting key is required')
], validate, asyncHandler(async (req, res) => {
  // Shared with /settings/bulk: whitelist, secret redaction, write-only secrets
  // and only the columns that actually exist on the settings table.
  const normalized = normalizeSettingsPayload(req.body.settings);
  if (normalized.length === 0) return res.json({ success: true, message: 'No settings updated', data: [] });
  const { data, error } = await supabaseAdmin
    .from('settings')
    .upsert(normalized, { onConflict: 'key' })
    .select(SETTING_COLUMNS);
  if (error) throw new AppError(`Bulk setting update failed: ${error.message}`, 500);
  res.json({ success: true, message: 'Settings updated', data: (data || []).map(redactSetting) });
}));

// PATCH /settings/:key disabled: no frontend caller found and prior implementation
// allowed arbitrary keys without whitelist/secret-redaction. Use POST /settings/bulk
// or POST /admin/settings/bulk (OAuth whitelist, write-only secrets, redacted response).
router.patch('/settings/:key', verifyToken, verifyAdmin, (req, res) => {
  res.status(410).json({
    success: false,
    message: 'Endpoint disabled. Use /settings/bulk for allowed settings updates.'
  });
});

export default router;