import express from 'express';
import { body, query, param } from 'express-validator';
import { validate, validateId } from '../middleware/validate.js';
import { verifyToken, authorize, authorizeOwner, optionalAuth } from '../middleware/auth.js';
import * as storeService from '../services/storeService.js';
import * as productService from '../services/productService.js';
import { asyncHandler, AppError, NotFoundError } from '../middleware/errorHandler.js';
import { uploadSingle, uploadMultiple, uploadToSupabase, generateFileName, generateStoragePath } from '../middleware/upload.js';
import { supabaseAdmin } from '../config/supabase.js';
import { validatePhone } from '../utils/phone.js';

const router = express.Router();

// snake_case column names -> camelCase fields used by the validators and by
// storeService, so both payload styles are accepted.
const STORE_BODY_ALIASES = {
  opening_hours: 'openingHours',
  delivery_fee: 'deliveryFee',
  minimum_order: 'minimumOrder',
  estimated_delivery_time: 'estimatedDeliveryTime',
  delivery_type: 'deliveryType',
  is_active: 'isActive',
  is_verified: 'isVerified',
  logo_url: 'logoUrl',
  cover_image_url: 'coverImageUrl',
  owner_id: 'ownerId'
};

const normalizeStoreBody = (req, res, next) => {
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body) || Buffer.isBuffer(body)) {
    return next();
  }
  for (const [snakeKey, camelKey] of Object.entries(STORE_BODY_ALIASES)) {
    if (body[snakeKey] !== undefined && body[camelKey] === undefined) {
      body[camelKey] = body[snakeKey];
    }
  }
  return next();
};

// Create store (seller only)
router.post('/', normalizeStoreBody, verifyToken, authorize('seller'), [
  body('name').trim().notEmpty().withMessage('Store name is required'),
  body('description').optional().trim(),
  body('address').isObject().withMessage('Address is required'),
  body('address.street').optional().trim(),
  body('address.district').optional().trim(),
  body('address.province').optional().trim(),
  body('address.postalCode').optional().trim(),
  body('address.coordinates').isObject().withMessage('Coordinates required'),
  body('address.coordinates.lat').isFloat({ min: -90, max: 90 }).withMessage('Invalid latitude'),
  body('address.coordinates.lng').isFloat({ min: -180, max: 180 }).withMessage('Invalid longitude'),
  body('phone').optional().custom(validatePhone).withMessage('Invalid phone'),
  body('email').optional().isEmail().withMessage('Invalid email'),
  body('openingHours').optional().isObject(),
  body('categories').optional().isArray(),
  body('deliveryFee').optional().isFloat({ min: 0 }).withMessage('Delivery fee must be positive'),
  body('minimumOrder').optional().isFloat({ min: 0 }).withMessage('Minimum order must be positive'),
  body('estimatedDeliveryTime').optional().isInt({ min: 1 }).withMessage('Invalid delivery time'),
  body('deliveryType').optional().isIn(['store_delivery', 'platform_courier']).withMessage('Invalid delivery type')
], validate, asyncHandler(async (req, res) => {
  const store = await storeService.createStore(req.user.id, req.body);
  
  res.status(201).json({
    success: true,
    message: 'Store created successfully',
    data: store
  });
}));

// Get public stores (for customers)
router.get('/', optionalAuth, [
  query('category').optional().trim(),
  query('search').optional().trim(),
  query('lat').optional().isFloat({ min: -90, max: 90 }),
  query('lng').optional().isFloat({ min: -180, max: 180 }),
  query('radius').optional().isFloat({ min: 1, max: 100 }),
  query('sortBy').optional().isIn(['distance', 'rating', 'delivery_fee', 'newest']),
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 50 })
], validate, asyncHandler(async (req, res) => {
  const filters = {
    category: req.query.category,
    search: req.query.search,
    lat: req.query.lat ? parseFloat(req.query.lat) : undefined,
    lng: req.query.lng ? parseFloat(req.query.lng) : undefined,
    radius: req.query.radius ? parseFloat(req.query.radius) : 10,
    sortBy: req.query.sortBy
  };
  
  const pagination = {
    page: parseInt(req.query.page) || 1,
    limit: parseInt(req.query.limit) || 20
  };
  
  const result = await storeService.getPublicStores(filters, pagination);
  
  res.json({
    success: true,
    data: result
  });
}));

// Get store by slug
router.get('/slug/:slug', optionalAuth, asyncHandler(async (req, res) => {
  const store = await storeService.getStoreBySlug(req.params.slug);
  
  res.json({
    success: true,
    data: store
  });
}));

// Get current owner's stores (seller/admin/owner) - returns all stores for multi-store support
router.get('/owner/me', verifyToken, authorize('seller', 'admin', 'owner'), asyncHandler(async (req, res) => {
  const stores = await storeService.getStoresByOwner(req.user.id);

  res.json({
    success: true,
    data: stores
  });
}));

// Get my stores (seller)
router.get('/my/stores', verifyToken, authorize('seller'), asyncHandler(async (req, res) => {
  const stores = await storeService.getStoresByOwner(req.user.id);
  
  res.json({
    success: true,
    data: stores
  });
}));

// Get store by ID
router.get('/:id', validateId(), optionalAuth, asyncHandler(async (req, res) => {
  const store = await storeService.getStoreById(req.params.id);
  
  res.json({
    success: true,
    data: store
  });
}));

// Update store (owner only; route allows privileged roles but service enforces ownership)
router.put('/:id', normalizeStoreBody, validateId(), verifyToken, authorize('seller', 'admin', 'owner'), [
  body('name').optional().trim().notEmpty(),
  body('description').optional().trim(),
  body('address').optional().isObject(),
  body('address.coordinates').optional().isObject(),
  body('address.coordinates.lat').optional().isFloat({ min: -90, max: 90 }),
  body('address.coordinates.lng').optional().isFloat({ min: -180, max: 180 }),
  body('phone').optional().custom(validatePhone),
  body('email').optional().isEmail(),
  body('openingHours').optional().isObject(),
  body('categories').optional().isArray(),
  body('deliveryFee').optional().isFloat({ min: 0 }),
  body('minimumOrder').optional().isFloat({ min: 0 }),
  body('estimatedDeliveryTime').optional().isInt({ min: 1 }),
  body('deliveryType').optional().isIn(['store_delivery', 'platform_courier']),
  body('isActive').optional().isBoolean(),
  body('logoUrl').optional().isURL(),
  body('coverImageUrl').optional().isURL()
], validate, asyncHandler(async (req, res) => {
  const store = await storeService.updateStore(req.params.id, req.user.id, req.body);
  
  res.json({
    success: true,
    message: 'Store updated',
    data: store
  });
}));

// Upload store logo (owner only; route allows privileged roles but service enforces ownership)
router.post('/:id/logo', validateId(), verifyToken, authorize('seller', 'admin', 'owner'), uploadSingle('logo', 'store-logos'), asyncHandler(async (req, res) => {
  if (!req.file) {
    throw new AppError('No file uploaded', 400);
  }
  
  const fileName = generateFileName(req.file.originalname, 'logo-');
  const filePath = generateStoragePath('store-logos', req.params.id, fileName);
  
  const result = await uploadToSupabase(supabaseAdmin, 'store-logos', filePath, req.file.buffer, req.file.mimetype);
  
  // Update store with logo URL
  await storeService.updateStore(req.params.id, req.user.id, { logo_url: result.publicUrl });
  
  res.json({
    success: true,
    message: 'Logo uploaded',
    data: { url: result.publicUrl, path: result.path }
  });
}));

// Upload store cover (owner only; route allows privileged roles but service enforces ownership)
router.post('/:id/cover', validateId(), verifyToken, authorize('seller', 'admin', 'owner'), uploadSingle('cover', 'store-covers'), asyncHandler(async (req, res) => {
  if (!req.file) {
    throw new AppError('No file uploaded', 400);
  }
  
  const fileName = generateFileName(req.file.originalname, 'cover-');
  const filePath = generateStoragePath('store-covers', req.params.id, fileName);
  
  const result = await uploadToSupabase(supabaseAdmin, 'store-covers', filePath, req.file.buffer, req.file.mimetype);
  
  await storeService.updateStore(req.params.id, req.user.id, { cover_image_url: result.publicUrl });
  
  res.json({
    success: true,
    message: 'Cover image uploaded',
    data: { url: result.publicUrl, path: result.path }
  });
}));

// Delete store
router.delete('/:id', validateId(), verifyToken, authorize('seller'), asyncHandler(async (req, res) => {
  await storeService.deleteStore(req.params.id, req.user.id);
  
  res.json({
    success: true,
    message: 'ลบร้านค้าเรียบร้อย'
  });
}));

// Get KBZPay payment settings for the current owner's store (seller)
router.get('/me/kbzpay-settings', verifyToken, authorize('seller'), asyncHandler(async (req, res) => {
  const stores = await storeService.getStoresByOwner(req.user.id);
  const store = stores[0] || null;
  if (!store) {
    throw new NotFoundError('ไม่พบร้านค้าของคุณ');
  }
  const settings = await storeService.getKbzpaySettings(store.id);
  res.json({
    success: true,
    data: settings
  });
}));

// Get public KBZPay payment settings of a store (for customers paying an order).
// Returns only payment-display fields; no secrets.
router.get('/:id/kbzpay-settings', optionalAuth, validateId(), asyncHandler(async (req, res) => {
  const settings = await storeService.getKbzpaySettings(req.params.id);
  if (!settings) {
    throw new NotFoundError('ไม่พบร้านค้า');
  }
  res.json({
    success: true,
    data: settings
  });
}));

// Update KBZPay payment settings (owner only; service enforces ownership)
router.put('/:id/kbzpay-settings', validateId(), verifyToken, authorize('seller', 'admin', 'owner'), [
  body('accountName').optional().trim().notEmpty().withMessage('ชื่อบัญชี KBZPay ต้องไม่ว่าง'),
  body('phoneNumber').optional().trim().notEmpty().withMessage('เบอร์โทรศัพท์ต้องไม่ว่าง'),
  body('receiverName').optional().trim().notEmpty().withMessage('ชื่อผู้รับเงินต้องไม่ว่าง'),
  body('enabled').optional().isBoolean()
], validate, asyncHandler(async (req, res) => {
  const settings = await storeService.updateKbzpaySettings(req.params.id, req.user.id, {
    accountName: req.body.accountName,
    phoneNumber: req.body.phoneNumber,
    receiverName: req.body.receiverName,
    enabled: req.body.enabled
  });
  res.json({
    success: true,
    message: 'อัปเดตการตั้งค่า KBZPay เรียบร้อยแล้ว',
    data: settings
  });
}));

// Upload KBZPay QR code (owner only; service enforces ownership)
router.post('/:id/kbzpay-qr', validateId(), verifyToken, authorize('seller', 'admin', 'owner'), uploadSingle('qr', 'store-kbzpay-qr'), asyncHandler(async (req, res) => {
  if (!req.file) {
    throw new AppError('ไม่พบไฟล์รูปภาพ QR Code', 400);
  }
  if (req.file.size > 5 * 1024 * 1024) {
    throw new AppError('ขนาดไฟล์ QR Code ต้องไม่เกิน 5MB', 400);
  }

  const fileName = generateFileName(req.file.originalname, 'kbzpay-qr-');
  const filePath = generateStoragePath('store-kbzpay-qr', req.params.id, fileName);

  const result = await uploadToSupabase(supabaseAdmin, 'store-kbzpay-qr', filePath, req.file.buffer, req.file.mimetype);

  const settings = await storeService.updateKbzpayQrUrl(req.params.id, req.user.id, result.publicUrl);

  res.json({
    success: true,
    message: 'อัปโหลด QR Code เรียบร้อยแล้ว',
    data: { url: result.publicUrl, path: result.path, settings }
  });
}));

export default router;
