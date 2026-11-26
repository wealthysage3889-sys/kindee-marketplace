import express from 'express';
import { body, query, param } from 'express-validator';
import { validate, validateId } from '../middleware/validate.js';
import { verifyToken, authorize, verifyAdmin } from '../middleware/auth.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import { supabaseAdmin } from '../config/supabase.js';
import * as orderService from '../services/orderService.js';
import * as notificationService from '../services/notificationService.js';
import * as authService from '../services/authService.js';
import * as productService from '../services/productService.js';
import {
  SETTING_COLUMNS,
  normalizeSettingsPayload,
  redactSetting
} from '../utils/settings.js';

const router = express.Router();

// A raw search term is interpolated into a PostgREST .or() filter, where
// characters such as , ( ) " \ : are structural. Strip them so user input can
// only match text and can never alter the filter expression.
const sanitizeSearch = (value) =>
  String(value ?? '').replace(/[,()"\\:]/g, ' ').trim();

// Dashboard stats
router.get('/stats', verifyToken, verifyAdmin, asyncHandler(async (req, res) => {
  const [
    { count: totalUsers },
    { count: totalStores },
    { count: totalProducts },
    { count: totalOrders },
    { count: pendingOrders },
    { data: paidOrders }
  ] = await Promise.all([
    supabaseAdmin.from('profiles').select('id', { count: 'exact', head: true }),
    supabaseAdmin.from('stores').select('id', { count: 'exact', head: true }),
    supabaseAdmin.from('products').select('id', { count: 'exact', head: true }),
    supabaseAdmin.from('orders').select('id', { count: 'exact', head: true }),
    supabaseAdmin.from('orders').select('id', { count: 'exact', head: true }).in('status', ['pending', 'confirmed', 'preparing']),
    supabaseAdmin.from('orders').select('total_amount', { count: 'exact' }).eq('payment_status', 'paid')
  ]);
  
  const revenue = (paidOrders || []).reduce(
    (sum, order) => sum + parseFloat(order.total_amount || 0),
    0
  );
  
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

// List payment slips (admin)
router.get('/payment-slips', verifyToken, verifyAdmin, [
  query('slipStatus').optional().isIn(['uploaded', 'approved', 'rejected']).withMessage('Invalid slip status'),
  query('customerId').optional().isUUID(),
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 })
], validate, asyncHandler(async (req, res) => {
  const result = await orderService.getPaymentSlips(
    {
      slip_status: req.query.slipStatus,
      customer_id: req.query.customerId
    },
    {
      page: parseInt(req.query.page) || 1,
      limit: parseInt(req.query.limit) || 20
    }
  );
  
  res.json({
    success: true,
    data: result
  });
}));

// Approve payment slip (admin)
router.patch('/payment-slips/:slipId/approve', validateId('slipId'), verifyToken, verifyAdmin, asyncHandler(async (req, res) => {
  const result = await orderService.approvePaymentSlip(req.user.id, req.params.slipId);
  
  res.json({
    success: true,
    message: 'Payment slip approved',
    data: result
  });
}));

// Reject payment slip (admin)
router.patch('/payment-slips/:slipId/reject', validateId('slipId'), verifyToken, verifyAdmin, [
  body('reason').optional().trim()
], validate, asyncHandler(async (req, res) => {
  const result = await orderService.rejectPaymentSlip(req.user.id, req.params.slipId, req.body.reason);
  
  res.json({
    success: true,
    message: 'Payment slip rejected',
    data: result
  });
}));

// Update order status (admin) โ€” validated against the fulfilment workflow.
// Authorization stays verifyAdmin (admin/owner only); payment_status is never
// touched here (payment confirmation is a separate slip-review flow).
router.patch('/orders/:id/status', validateId(), verifyToken, verifyAdmin, [
  body('status').isIn(['pending', 'confirmed', 'preparing', 'ready_for_pickup', 'picked_up', 'in_transit', 'delivered', 'cancelled', 'refunded']).withMessage('Invalid status'),
  body('notes').optional().trim()
], validate, asyncHandler(async (req, res) => {
  const order = await orderService.updateOrderStatusAdmin(
    req.params.id,
    req.body.status,
    req.body.notes
  );

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
  const storeSearch = sanitizeSearch(filters.search);
  if (storeSearch) {
    query = query.or(`name.ilike.%${storeSearch}%,slug.ilike.%${storeSearch}%`);
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
  const productSearch = sanitizeSearch(filters.search);
  if (productSearch) {
    query = query.or(`name.ilike.%${productSearch}%,description.ilike.%${productSearch}%`);
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

// Delete product (admin)
// Delegates to productService.adminDeleteProduct, which:
//   - returns 404 when the id does not exist (verified by affected-row count)
//   - preserves order history by deactivating products referenced by
//     order_items / reviews / reservations (soft delete)
//   - hard-deletes only products with no references at all
router.delete('/products/:id', validateId(), verifyToken, verifyAdmin, asyncHandler(async (req, res) => {
  const result = await productService.adminDeleteProduct(req.params.id);

  if (result.action === 'deactivated') {
    return res.json({
      success: true,
      message: 'ลบสินค้าไม่สำเร็จแบบถาวร เนื่องจากมีประวัติคำสั่งซื้ออ้างอิงอยู่ ระบบจึงปิดการขายสินค้านี้แทน เพื่อรักษาประวัติการซื้อ',
      data: { action: result.action, product: result.product }
    });
  }

  res.json({
    success: true,
    message: 'Product deleted',
    data: { action: result.action, product: result.product }
  });
}));

// Get all users (Admin Users page: no user-facing pagination, return all matching rows)
router.get('/users', verifyToken, verifyAdmin, [
  query('role').optional().isIn(['customer', 'seller', 'admin', 'owner', 'courier']),
  query('isActive').optional().isBoolean(),
  query('search').optional().trim()
], validate, asyncHandler(async (req, res) => {
  const filters = {
    role: req.query.role,
    is_active: req.query.isActive !== undefined ? req.query.isActive === 'true' : undefined,
    search: req.query.search
  };

  const BATCH_SIZE = 1000;
  let from = 0;
  let total = 0;
  const users = [];

  while (true) {
    let query = supabaseAdmin
      .from('profiles')
      .select('*', { count: 'exact' });

    // Apply filters
    if (filters.role) query = query.eq('role', filters.role);
    if (filters.is_active !== undefined) query = query.eq('is_active', filters.is_active);
    const userSearch = sanitizeSearch(filters.search);
    if (userSearch) {
      query = query.or(`name.ilike.%${userSearch}%,email.ilike.%${userSearch}%,phone.ilike.%${userSearch}%`);
    }

    query = query
      .order('created_at', { ascending: false })
      .range(from, from + BATCH_SIZE - 1);

    const { data, error, count } = await query;

    if (error) {
      throw new AppError(`Failed to fetch users: ${error.message}`, 500);
    }

    if (typeof count === 'number') total = count;
    const batch = data || [];
    users.push(...batch);

    if (batch.length < BATCH_SIZE) break;
    if (total && users.length >= total) break;
    from += BATCH_SIZE;
  }

  res.json({
    success: true,
    data: {
      users,
      pagination: {
        total: typeof total === 'number' ? total : users.length,
        totalPages: 1,
        page: 1,
        limit: users.length
      }
    }
  });
}));

// Create a new user account (admin only).
// Creates the Supabase Auth user via the service-role Admin API, then writes
// the profiles row with the requested role. Only an owner may grant the
// owner role; admins may create customer/seller/admin/courier accounts.
router.post('/users', verifyToken, verifyAdmin, [
  body('name').trim().notEmpty().withMessage('Name is required'),
  body('email').isEmail().normalizeEmail().withMessage('Invalid email'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  body('role').isIn(['customer', 'seller', 'admin', 'owner', 'courier']).withMessage('Invalid role')
], validate, asyncHandler(async (req, res) => {
  const { name, email, password, role } = req.body;

  if (role === 'owner' && req.user.role !== 'owner') {
    throw new AppError('เน€เธเธเธฒเธฐเน€เธเนเธฒเธเธญเธเธฃเธฐเธเธเน€เธ—เนเธฒเธเธฑเนเธเธ—เธตเนเธชเธฒเธกเธฒเธฃเธ–เธกเธญเธเธชเธดเธ—เธเธดเน owner เนเธ”เน', 403);
  }

  const result = await authService.registerUser({ email, password, name, role });

  const safeUser = { ...result.user };
  delete safeUser.password;

  res.status(201).json({
    success: true,
    message: 'เธชเธฃเนเธฒเธเธเธฑเธเธเธตเธเธนเนเนเธเนเน€เธฃเธตเธขเธเธฃเนเธญเธขเนเธฅเนเธง',
    data: safeUser
  });
}));

// Update user role
router.patch('/users/:id/role', validateId(), verifyToken, verifyAdmin, [
  body('role').isIn(['customer', 'seller', 'admin', 'owner', 'courier']).withMessage('Invalid role')
], validate, asyncHandler(async (req, res) => {
  const targetUser = await authService.getProfile(req.params.id);
  if (!targetUser) {
    throw new AppError('ไม่พบผู้ใช้งาน', 404);
  }

  if (req.body.role === 'owner' && req.user.role !== 'owner') {
    throw new AppError('เฉพาะเจ้าของระบบเท่านั้นที่สามารถมอบสิทธิ์ owner ได้', 403);
  }

  if (targetUser.role === 'owner' && req.user.role !== 'owner') {
    throw new AppError('ไม่มีสิทธิ์จัดการบัญชีเจ้าของระบบ', 403);
  }

  const profile = await authService.updateUserRole(req.params.id, req.body.role, req.user.id);

  res.json({
    success: true,
    message: 'User role updated',
    data: profile
  });
}));

// Activate / deactivate a user account (soft toggle of profiles.is_active).
// Body: { isActive: boolean }
router.patch('/users/:id/status', validateId(), verifyToken, verifyAdmin, [
  body('isActive').isBoolean().withMessage('isActive must be boolean')
], validate, asyncHandler(async (req, res) => {
  const targetUser = await authService.getProfile(req.params.id);
  if (!targetUser) {
    throw new AppError('ไม่พบผู้ใช้งาน', 404);
  }

  // Cannot deactivate your own account.
  if (targetUser.id === req.user.id) {
    throw new AppError('ไม่สามารถเปลี่ยนสถานะบัญชีของตัวเองได้', 400);
  }

  // Only owners may manage owner accounts.
  if (targetUser.role === 'owner' && req.user.role !== 'owner') {
    throw new AppError('ไม่มีสิทธิ์จัดการบัญชีเจ้าของระบบ', 403);
  }

  if (!req.body.isActive && targetUser.role === 'owner') {
    const { count: ownerCount, error: ownerCountError } = await supabaseAdmin
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('role', 'owner')
      .eq('is_active', true);

    if (ownerCountError) {
      throw new AppError(`ตรวจสอบจำนวนเจ้าของระบบไม่สำเร็จ: ${ownerCountError.message}`, 500);
    }
    if ((ownerCount || 0) <= 1) {
      throw new AppError('ไม่สามารถปิดใช้งานเจ้าของระบบรายสุดท้ายได้ ระบบต้องมีเจ้าของระบบอย่างน้อย 1 บัญชี', 400);
    }
  }

  const profile = await authService.setUserActive(req.params.id, req.body.isActive, req.user.id, req.user.role);

  res.json({
    success: true,
    message: req.body.isActive ? 'เปิดใช้งานผู้ใช้เรียบร้อยแล้ว' : 'ปิดใช้งานผู้ใช้เรียบร้อยแล้ว',
    data: profile
  });
}));

// Delete a user account (admin).
//
// Attempts a real/permanent account deletion for test accounts with NO protected
// business/transaction history (orders, store orders, messages, conversations,
// reviews, call history, refunds/approvals, courier records, or stores with
// order history). In that safe case it removes owned stores (and cascaded catalog
// data), deletes the Supabase Auth user via Admin API, and removes the profile.
//
// If protected history/references exist, it NEVER deletes orders/messages/
// transactions. Instead it deactivates the account, revokes sessions, anonymizes
// PII on the profile, and returns action=deactivated with the blocking references
// and reason so the admin sees why permanent deletion was not possible.
//
// Guards: cannot delete self, non-owners cannot manage owner accounts, and the
// last owner cannot be deleted. Pagination/list refresh is handled client-side.
router.delete('/users/:id', validateId(), verifyToken, verifyAdmin, asyncHandler(async (req, res) => {
  const result = await authService.adminDeleteUserAccount(req.params.id, req.user.id, req.user.role);

  if (result.action === 'deleted') {
    return res.json({
      success: true,
      message: 'ลบบัญชีผู้ใช้งานออกจากระบบเรียบร้อยแล้ว (ลบจาก Supabase Auth และโปรไฟล์ เนื่องจากไม่มีประวัติธุรกรรมที่ต้องรักษา)',
      data: result
    });
  }

  res.json({
    success: true,
    message: result.reason || 'ไม่สามารถลบถาวรได้เนื่องจากมีข้อมูลธุรกิจที่ต้องรักษา ระบบจึงปิดใช้งานและจัดการข้อมูลส่วนบุคคลแทน (ไม่ลบคำสั่งซื้อ/ข้อความ/ประวัติธุรกรรม)',
    data: result
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

// List payment slips (admin)
router.get('/payment-slips', verifyToken, verifyAdmin, [
  query('slipStatus').optional().isIn(['uploaded', 'approved', 'rejected']).withMessage('Invalid slip status'),
  query('customerId').optional().isUUID(),
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 })
], validate, asyncHandler(async (req, res) => {
  const result = await orderService.getPaymentSlips(
    { slip_status: req.query.slipStatus, customer_id: req.query.customerId },
    { page: parseInt(req.query.page) || 1, limit: parseInt(req.query.limit) || 20 }
  );
  res.json({ success: true, data: result });
}));

// Approve payment slip (admin)
router.patch('/payment-slips/:slipId/approve', validateId('slipId'), verifyToken, verifyAdmin, asyncHandler(async (req, res) => {
  const result = await orderService.approvePaymentSlip(req.user.id, req.params.slipId);
  res.json({ success: true, message: 'Payment slip approved', data: result });
}));

// Reject payment slip (admin)
router.patch('/payment-slips/:slipId/reject', validateId('slipId'), verifyToken, verifyAdmin, [
  body('reason').optional().trim()
], validate, asyncHandler(async (req, res) => {
  const result = await orderService.rejectPaymentSlip(req.user.id, req.params.slipId, req.body.reason);
  res.json({ success: true, message: 'Payment slip rejected', data: result });
}));
export default router;

