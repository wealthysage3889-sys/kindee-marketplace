import express from 'express';
import { body, query, param } from 'express-validator';
import { validate, validateId } from '../middleware/validate.js';
import { verifyToken, authorize, authorizeOwner, optionalAuth } from '../middleware/auth.js';
import * as productService from '../services/productService.js';
import { asyncHandler, AppError, NotFoundError } from '../middleware/errorHandler.js';
import { uploadMultiple, uploadToSupabase, generateFileName, generateStoragePath } from '../middleware/upload.js';
import { supabaseAdmin } from '../config/supabase.js';

const router = express.Router();

// Create product
router.post('/', verifyToken, authorize('seller'), [
  body('name').trim().notEmpty().withMessage('Product name is required'),
  body('description').trim().notEmpty().withMessage('Description is required'),
  body('price').isFloat({ min: 0 }).withMessage('Price must be positive'),
  body('discountPrice').optional().isFloat({ min: 0 }).withMessage('Discount price must be positive'),
  body('stock').isInt({ min: 0 }).withMessage('Stock must be non-negative integer'),
  body('categoryId').optional().isUUID().withMessage('Invalid category ID'),
  body('images').optional().isArray().withMessage('Images must be array'),
  body('tags').optional().isArray().withMessage('Tags must be array')
], validate, asyncHandler(async (req, res) => {
  // Verify store ownership
  const { storeId } = req.body;
  if (!storeId) {
    throw new AppError('Store ID is required', 400);
  }
  
  const { data: store } = await supabaseAdmin
    .from('stores')
    .select('id')
    .eq('id', storeId)
    .eq('owner_id', req.user.id)
    .single();
  
  if (!store) {
    throw new AppError('Store not found or not authorized', 403);
  }
  
  const product = await productService.createProduct(storeId, req.user.id, req.body);
  
  res.status(201).json({
    success: true,
    message: 'Product created',
    data: product
  });
}));

// Get public products (for customers)
router.get('/', optionalAuth, [
  query('storeId').optional().isUUID(),
  query('categoryId').optional().isUUID(),
  query('search').optional().trim(),
  query('minPrice').optional().isFloat({ min: 0 }),
  query('maxPrice').optional().isFloat({ min: 0 }),
  query('sortBy').optional().isIn(['relevance', 'price_asc', 'price_desc', 'rating', 'newest']),
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 50 })
], validate, asyncHandler(async (req, res) => {
  const filters = {
    store_id: req.query.storeId,
    category_id: req.query.categoryId,
    search: req.query.search,
    min_price: req.query.minPrice ? parseFloat(req.query.minPrice) : undefined,
    max_price: req.query.maxPrice ? parseFloat(req.query.maxPrice) : undefined,
    sort_by: req.query.sortBy
  };
  
  const pagination = {
    page: parseInt(req.query.page) || 1,
    limit: parseInt(req.query.limit) || 20
  };
  
  const result = await productService.getPublicProducts(filters, pagination);
  
  res.json({
    success: true,
    data: result
  });
}));

// Search products
router.get('/search', optionalAuth, [
  query('q').trim().notEmpty().withMessage('Search query required'),
  query('storeId').optional().isUUID(),
  query('categoryId').optional().isUUID(),
  query('minPrice').optional().isFloat({ min: 0 }),
  query('maxPrice').optional().isFloat({ min: 0 }),
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 50 })
], validate, asyncHandler(async (req, res) => {
  const filters = {
    store_id: req.query.storeId,
    category_id: req.query.categoryId,
    min_price: req.query.minPrice ? parseFloat(req.query.minPrice) : undefined,
    max_price: req.query.maxPrice ? parseFloat(req.query.maxPrice) : undefined
  };
  
  const pagination = {
    page: parseInt(req.query.page) || 1,
    limit: parseInt(req.query.limit) || 20
  };
  
  const result = await productService.searchProducts(req.query.q, filters, pagination);
  
  res.json({
    success: true,
    data: result
  });
}));

// Get products by category
router.get('/category/:categoryId', validateId('categoryId'), optionalAuth, [
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 50 })
], validate, asyncHandler(async (req, res) => {
  const pagination = {
    page: parseInt(req.query.page) || 1,
    limit: parseInt(req.query.limit) || 20
  };
  
  const result = await productService.getProductsByCategory(req.params.categoryId, {}, pagination);
  
  res.json({
    success: true,
    data: result
  });
}));

// Get product by ID
router.get('/:id', validateId(), optionalAuth, asyncHandler(async (req, res) => {
  const includeInactive = req.user && ['seller', 'admin', 'owner'].includes(req.user.role);
  const product = await productService.getProductById(req.params.id, includeInactive);
  
  res.json({
    success: true,
    data: product
  });
}));

// Get products for store (seller)
router.get('/store/:storeId', validateId('storeId'), verifyToken, authorize('seller'), [
  query('isActive').optional().isBoolean(),
  query('categoryId').optional().isUUID(),
  query('search').optional().trim(),
  query('lowStock').optional().isBoolean(),
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 50 })
], validate, asyncHandler(async (req, res) => {
  const filters = {
    is_active: req.query.isActive !== undefined ? req.query.isActive === 'true' : undefined,
    category_id: req.query.categoryId,
    search: req.query.search,
    low_stock: req.query.lowStock === 'true'
  };
  
  const pagination = {
    page: parseInt(req.query.page) || 1,
    limit: parseInt(req.query.limit) || 20
  };
  
  const result = await productService.getProductsByStore(req.params.storeId, req.user.id, filters, pagination);
  
  res.json({
    success: true,
    data: result
  });
}));

// Update product
router.put('/:id', validateId(), verifyToken, authorize('seller'), [
  body('name').optional().trim().notEmpty(),
  body('description').optional().trim(),
  body('price').optional().isFloat({ min: 0 }),
  body('discountPrice').optional().isFloat({ min: 0 }),
  body('stock').optional().isInt({ min: 0 }),
  body('categoryId').optional().isUUID(),
  body('images').optional().isArray(),
  body('tags').optional().isArray(),
  body('isActive').optional().isBoolean()
], validate, asyncHandler(async (req, res) => {
  // Get product to find store
  const product = await productService.getProductById(req.params.id, true);
  
  const updatedProduct = await productService.updateProduct(req.params.id, product.store_id, req.user.id, req.body);
  
  res.json({
    success: true,
    message: 'Product updated',
    data: updatedProduct
  });
}));

// Upload product images
router.post('/:id/images', validateId(), verifyToken, authorize('seller'), uploadMultiple('images', 10, 'product-images'), asyncHandler(async (req, res) => {
  if (!req.files || req.files.length === 0) {
    throw new AppError('No files uploaded', 400);
  }
  
  const product = await productService.getProductById(req.params.id, true);
  
  // Verify ownership
  const { data: store } = await supabaseAdmin
    .from('stores')
    .select('id')
    .eq('id', product.store_id)
    .eq('owner_id', req.user.id)
    .single();
  
  if (!store) {
    throw new AppError('Not authorized', 403);
  }
  
  const uploadedUrls = [];
  
  for (const file of req.files) {
    const fileName = generateFileName(file.originalname, 'product-');
    const filePath = generateStoragePath('product-images', product.id, fileName);
    
    const result = await uploadToSupabase(supabaseAdmin, 'product-images', filePath, file.buffer, file.mimetype);
    uploadedUrls.push(result.publicUrl);
  }
  
  // Update product with new images
  const updatedProduct = await productService.updateProduct(req.params.id, product.store_id, req.user.id, {
    images: [...product.images, ...uploadedUrls]
  });
  
  res.json({
    success: true,
    message: 'Images uploaded',
    data: { images: updatedProduct.images }
  });
}));

// Delete product
router.delete('/:id', validateId(), verifyToken, authorize('seller'), asyncHandler(async (req, res) => {
  const product = await productService.getProductById(req.params.id, true);
  
  await productService.deleteProduct(req.params.id, product.store_id, req.user.id);
  
  res.json({
    success: true,
    message: 'Product deleted'
  });
}));

// Update stock
router.patch('/:id/stock', validateId(), verifyToken, authorize('seller'), [
  body('quantity').isInt({ min: 0 }).withMessage('Quantity must be non-negative'),
  body('operation').optional().isIn(['set', 'increment', 'decrement']).withMessage('Invalid operation')
], validate, asyncHandler(async (req, res) => {
  const product = await productService.getProductById(req.params.id, true);
  
  const { quantity, operation = 'set' } = req.body;
  
  const updatedProduct = await productService.updateStock(req.params.id, product.store_id, req.user.id, quantity, operation);
  
  res.json({
    success: true,
    message: 'Stock updated',
    data: updatedProduct
  });
}));

// Bulk update products
router.post('/bulk-update', verifyToken, authorize('seller'), [
  body('storeId').isUUID().withMessage('Store ID required'),
  body('updates').isArray().withMessage('Updates must be array')
], validate, asyncHandler(async (req, res) => {
  const { storeId, updates } = req.body;
  
  const results = await productService.bulkUpdateProducts(storeId, req.user.id, updates);
  
  res.json({
    success: true,
    data: results
  });
}));

export default router;