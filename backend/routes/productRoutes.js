import express from 'express';
import { body, query, param } from 'express-validator';
import { validate, validateId } from '../middleware/validate.js';
import { verifyToken, authorize, authorizeOwner, optionalAuth } from '../middleware/auth.js';
import * as productService from '../services/productService.js';
import * as storeService from '../services/storeService.js';
import { asyncHandler, AppError, NotFoundError } from '../middleware/errorHandler.js';
import { uploadMultiple, uploadToSupabase, generateFileName, generateStoragePath } from '../middleware/upload.js';
import { supabaseAdmin } from '../config/supabase.js';
import { slugify } from '../utils/helpers.js';
import { parsePriceInput, parseStockInput } from '../utils/productPricing.js';

const router = express.Router();

// The admin/seller forms submit a free-text category name (e.g. "เสื้อผ้า"),
// while the products table stores a category_id UUID. Resolve the name to an
// existing category, creating one when it does not exist yet.
const resolveCategoryId = async (category, categoryId) => {
  if (categoryId) return categoryId;
  if (typeof category !== 'string' || !category.trim()) return null;

  const name = category.trim();

  const { data: existing } = await supabaseAdmin
    .from('categories')
    .select('id')
    .eq('name', name)
    .maybeSingle();

  if (existing) return existing.id;

  const baseSlug = slugify(name, { lower: true, strict: true, locale: 'th' }) || `category-${Date.now()}`;
  let slug = baseSlug;
  let counter = 1;

  while (true) {
    const { data: clash } = await supabaseAdmin
      .from('categories')
      .select('id')
      .eq('slug', slug)
      .maybeSingle();

    if (!clash) break;
    slug = `${baseSlug}-${counter++}`;
  }

  const { data: created, error } = await supabaseAdmin
    .from('categories')
    .insert({ name, slug, is_active: true })
    .select('id')
    .single();

  if (error) {
    // A concurrent request may have inserted the same category first.
    const { data: retry } = await supabaseAdmin
      .from('categories')
      .select('id')
      .eq('name', name)
      .maybeSingle();

    if (retry) return retry.id;
    throw new AppError(`Category creation failed: ${error.message}`, 500);
  }

  return created.id;
};

// Runs after Multer and before express-validator so both multipart and JSON
// bodies are normalized before the validation chains execute. Numeric fields
// arrive as strings from FormData; they are parsed here so validators and the
// service never compare prices as strings, and an empty discount field becomes
// null ("no discount") instead of 0.
const normalizeProductBody = async (req, res, next) => {
  try {
    const body = req.body;
    if (body && typeof body === 'object' && !Array.isArray(body) && !Buffer.isBuffer(body)) {
      if (body.price !== undefined) {
        const price = parsePriceInput(body.price);
        if (price.ok) body.price = price.value;
      }

      if (body.discountPrice !== undefined) {
        const discountPrice = parsePriceInput(body.discountPrice);
        if (discountPrice.ok) body.discountPrice = discountPrice.value;
      }

      if (body.stock !== undefined && body.stock !== null) {
        const stock = parseStockInput(body.stock);
        if (stock.ok && stock.value !== null) body.stock = stock.value;
      }

      // Only touch the category when the client actually sent one, so partial
      // updates (e.g. name-only) do not clear the existing category.
      if (body.category !== undefined || body.categoryId !== undefined) {
        body.categoryId = await resolveCategoryId(body.category, body.categoryId);
      }
    }
    next();
  } catch (error) {
    next(error);
  }
};

// Tags arrive as a JSON string, a comma-separated string or an array depending
// on the client. Normalize all of them to a string array.
const parseTags = (tags) => {
  if (!tags) return [];
  if (Array.isArray(tags)) return tags;

  if (typeof tags === 'string') {
    const trimmed = tags.trim();
    if (!trimmed) return [];

    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // Not JSON, fall back to comma-separated parsing.
    }

    return trimmed.split(',').map((tag) => tag.trim()).filter(Boolean);
  }

  return [];
};

// Upload product images to Supabase Storage and return their public URLs.
const uploadProductImages = async (files, storeId) => {
  const list = files || [];

  // Upload concurrently, but wait for EVERY file to settle so that, if any file
  // fails, we can delete the ones that succeeded in this same round and avoid
  // leaving orphaned objects in Storage.
  const results = await Promise.allSettled(
    list.map(async (file) => {
      const fileName = generateFileName(file.originalname, 'product-');
      const filePath = generateStoragePath('product-images', storeId, fileName);
      const result = await uploadToSupabase(supabaseAdmin, 'product-images', filePath, file.buffer, file.mimetype);
      return { path: result.path, publicUrl: result.publicUrl };
    })
  );

  const uploaded = [];
  const failures = [];
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      uploaded.push(result.value);
    } else {
      failures.push({ index, reason: result.reason });
    }
  });

  if (failures.length === 0) {
    return uploaded.map((item) => item.publicUrl);
  }

  // Some uploads failed: remove ONLY the objects uploaded successfully in this
  // round. Pre-existing product images are never part of this list.
  const uploadedPaths = uploaded.map((item) => item.path).filter(Boolean);
  let leftoverPaths = [];

  if (uploadedPaths.length > 0) {
    try {
      const { error: removeError } = await supabaseAdmin.storage
        .from('product-images')
        .remove(uploadedPaths);

      if (removeError) {
        leftoverPaths = uploadedPaths;
        console.error(
          `Product image cleanup failed; ${uploadedPaths.length} object(s) may remain in Storage:`,
          removeError.message,
          uploadedPaths
        );
      }
    } catch (cleanupError) {
      leftoverPaths = uploadedPaths;
      console.error(
        'Product image cleanup threw; these objects may remain in Storage:',
        uploadedPaths,
        cleanupError
      );
    }
  }

  // Surface the original upload failure without masking it with cleanup errors.
  const firstFailure = failures[0].reason;
  const error = firstFailure instanceof Error ? firstFailure : new Error(String(firstFailure));
  if (leftoverPaths.length > 0) {
    error.orphanedImagePaths = leftoverPaths;
  }
  throw error;
};

// Resolve which store a product belongs to. The frontend does not always send
// storeId, so fall back to the store owned by the logged-in user instead of
// failing with "Store ID is required".
const resolveStoreId = async (req, requestedStoreId) => {
  if (requestedStoreId) {
    const { data: store } = await supabaseAdmin
      .from('stores')
      .select('id, owner_id')
      .eq('id', requestedStoreId)
      .single();

    if (!store || store.owner_id !== req.user.id) {
      throw new AppError('Store not found or not authorized', 403);
    }

    return store.id;
  }

  // Some tokens embed the store id; verify it is actually owned by the user.
  const embeddedStoreId = req.user.storeId || req.user.store_id;
  if (embeddedStoreId) {
    const { data: store } = await supabaseAdmin
      .from('stores')
      .select('id, owner_id')
      .eq('id', embeddedStoreId)
      .single();

    if (store && store.owner_id === req.user.id) {
      return store.id;
    }
  }

  // Look up the user's own store(s).
  const stores = await storeService.getStoresByOwner(req.user.id);
  const storeId = Array.isArray(stores) ? stores[0]?.id : stores?.id;

  if (!storeId) {
    throw new AppError('Store not found for the current user. Create a store before adding products.', 400);
  }

  return storeId;
};

// Create product
router.post(
  '/',
  verifyToken,
  authorize('seller', 'owner', 'admin'),
  uploadMultiple('images', 10, 'product-images'),
  normalizeProductBody,
  [
    body('name').trim().notEmpty().withMessage('กรุณากรอกชื่อสินค้า'),
    body('description').trim().notEmpty().withMessage('กรุณากรอกรายละเอียดสินค้า'),
    body('price').isFloat({ min: 0 }).withMessage('ราคาปกติต้องเป็นตัวเลข 0 ขึ้นไป'),
    body('discountPrice').optional({ values: 'falsy' }).isFloat({ min: 0 }).withMessage('ราคาส่วนลดต้องเป็นตัวเลขมากกว่า 0 และน้อยกว่าราคาปกติ หรือเว้นว่างไว้หากไม่มีส่วนลด'),
    body('stock').isInt({ min: 0 }).withMessage('จำนวนคงคลังต้องเป็นเลขจำนวนเต็ม 0 ขึ้นไป'),
    body('categoryId').optional({ nullable: true }).isUUID().withMessage('หมวดหมู่ไม่ถูกต้อง'),
    body('storeId').optional({ values: 'falsy' }).isUUID().withMessage('ร้านค้าไม่ถูกต้อง')
  ],
  validate,
  asyncHandler(async (req, res) => {
    const body = req.body || {};

    // Uses body.storeId when provided, otherwise the logged-in user's store.
    const requestedStoreId = Array.isArray(body.storeId) ? body.storeId[0] : body.storeId;
    const storeId = await resolveStoreId(req, requestedStoreId);

    const images = await uploadProductImages(req.files, storeId);

    const product = await productService.createProduct(storeId, req.user.id, {
      name: body.name,
      description: body.description,
      price: body.price,
      discountPrice: body.discountPrice,
      stock: body.stock,
      categoryId: body.categoryId || null,
      images,
      tags: parseTags(body.tags)
    });

    res.status(201).json({
      success: true,
      message: 'Product created',
      data: product
    });
  })
);

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
router.put(
  '/:id',
  validateId(),
  verifyToken,
  authorize('seller', 'owner', 'admin'),
  uploadMultiple('images', 10, 'product-images'),
  normalizeProductBody,
  [
    body('name').optional().trim().notEmpty().withMessage('ชื่อสินค้าต้องไม่ว่าง'),
    body('description').optional().trim(),
    body('price').optional().isFloat({ min: 0 }).withMessage('ราคาปกติต้องเป็นตัวเลข 0 ขึ้นไป'),
    body('discountPrice').optional({ values: 'falsy' }).isFloat({ min: 0 }).withMessage('ราคาส่วนลดต้องเป็นตัวเลขมากกว่า 0 และน้อยกว่าราคาปกติ หรือเว้นว่างไว้หากไม่มีส่วนลด'),
    body('stock').optional().isInt({ min: 0 }).withMessage('จำนวนคงคลังต้องเป็นเลขจำนวนเต็ม 0 ขึ้นไป'),
    body('categoryId').optional({ nullable: true }).isUUID().withMessage('หมวดหมู่ไม่ถูกต้อง'),
    body('tags').optional(),
    body('isActive').optional().isBoolean().withMessage('สถานะสินค้าไม่ถูกต้อง')
  ],
  validate,
  asyncHandler(async (req, res) => {
    const body = req.body || {};

    // Get product to find store
    const product = await productService.getProductById(req.params.id, true);

    const updates = {};
    if (body.name !== undefined) updates.name = body.name;
    if (body.description !== undefined) updates.description = body.description;
    if (body.price !== undefined) updates.price = body.price;
    // An empty/null discountPrice means "remove the discount".
    if (body.discountPrice !== undefined) updates.discount_price = body.discountPrice;
    if (body.stock !== undefined) updates.stock = body.stock;
    if (body.categoryId !== undefined) updates.category_id = body.categoryId || null;
    if (body.tags !== undefined) updates.tags = parseTags(body.tags);
    if (body.isActive !== undefined) {
      updates.is_active = body.isActive === true || body.isActive === 'true';
    }

    // Keep existing image URLs and append newly uploaded files.
    const existingImages = body.existingImages !== undefined
      ? (Array.isArray(body.existingImages) ? body.existingImages : [body.existingImages])
      : (product.images || []);
    const newImages = await uploadProductImages(req.files, product.store_id);
    updates.images = [...existingImages, ...newImages];

    if (updates.images.length === 0) {
      throw new AppError('Product must have at least one image', 400);
    }

    const updatedProduct = await productService.updateProduct(req.params.id, product.store_id, req.user.id, updates);

    res.json({
      success: true,
      message: 'Product updated',
      data: updatedProduct
    });
  })
);

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