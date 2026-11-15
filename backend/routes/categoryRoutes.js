import express from 'express';
import { body, query, param } from 'express-validator';
import { validate, validateId } from '../middleware/validate.js';
import { verifyToken, authorize, verifyAdmin, optionalAuth } from '../middleware/auth.js';
import { asyncHandler, AppError, NotFoundError } from '../middleware/errorHandler.js';
import { supabaseAdmin } from '../config/supabase.js';

const router = express.Router();

// Get all categories (public)
router.get('/', optionalAuth, [
  query('parentId').optional().isUUID()
], validate, asyncHandler(async (req, res) => {
  let query = supabaseAdmin
    .from('categories')
    .select('*')
    .eq('is_active', true)
    .order('sort_order', { ascending: true });
  
  if (req.query.parentId) {
    query = query.eq('parent_id', req.query.parentId);
  } else {
    query = query.is('parent_id', null);
  }
  
  const { data, error } = await query;
  
  if (error) {
    throw new AppError(`Failed to fetch categories: ${error.message}`, 500);
  }
  
  res.json({
    success: true,
    data
  });
}));

// Get category by ID
router.get('/:id', validateId(), optionalAuth, asyncHandler(async (req, res) => {
  const { data: category, error } = await supabaseAdmin
    .from('categories')
    .select('*')
    .eq('id', req.params.id)
    .single();
  
  if (error || !category) {
    throw new NotFoundError('Category');
  }
  
  res.json({
    success: true,
    data: category
  });
}));

// Create category (admin)
router.post('/', verifyToken, verifyAdmin, [
  body('name').trim().notEmpty().withMessage('Name is required'),
  body('slug').optional().trim(),
  body('description').optional().trim(),
  body('imageUrl').optional().isURL().withMessage('Invalid image URL'),
  body('parentId').optional().isUUID().withMessage('Invalid parent ID'),
  body('sortOrder').optional().isInt({ min: 0 }).withMessage('Sort order must be non-negative')
], validate, asyncHandler(async (req, res) => {
  const { name, slug, description, imageUrl, parentId, sortOrder } = req.body;
  
  let finalSlug = slug;
  if (!finalSlug) {
    finalSlug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');
  }
  
  // Ensure unique slug
  let counter = 1;
  let testSlug = finalSlug;
  while (true) {
    const { data: existing } = await supabaseAdmin
      .from('categories')
      .select('id')
      .eq('slug', testSlug)
      .single();
    
    if (!existing) break;
    testSlug = `${finalSlug}-${counter++}`;
  }
  finalSlug = testSlug;
  
  const { data: category, error } = await supabaseAdmin
    .from('categories')
    .insert({
      name,
      slug: finalSlug,
      description,
      image_url: imageUrl,
      parent_id: parentId,
      sort_order: sortOrder || 0,
      is_active: true
    })
    .select()
    .single();
  
  if (error) {
    throw new AppError(`Category creation failed: ${error.message}`, 500);
  }
  
  res.status(201).json({
    success: true,
    message: 'Category created',
    data: category
  });
}));

// Update category (admin)
router.put('/:id', validateId(), verifyToken, verifyAdmin, [
  body('name').optional().trim().notEmpty(),
  body('slug').optional().trim(),
  body('description').optional().trim(),
  body('imageUrl').optional().isURL(),
  body('parentId').optional().isUUID(),
  body('sortOrder').optional().isInt({ min: 0 }),
  body('isActive').optional().isBoolean()
], validate, asyncHandler(async (req, res) => {
  const { data: category, error } = await supabaseAdmin
    .from('categories')
    .update(req.body)
    .eq('id', req.params.id)
    .select()
    .single();
  
  if (error) {
    throw new AppError(`Category update failed: ${error.message}`, 500);
  }
  
  res.json({
    success: true,
    message: 'Category updated',
    data: category
  });
}));

// Delete category (admin)
router.delete('/:id', validateId(), verifyToken, verifyAdmin, asyncHandler(async (req, res) => {
  // Check for subcategories
  const { data: children } = await supabaseAdmin
    .from('categories')
    .select('id')
    .eq('parent_id', req.params.id);
  
  if (children && children.length > 0) {
    throw new AppError('Cannot delete category with subcategories', 400);
  }
  
  // Check for products
  const { data: products } = await supabaseAdmin
    .from('products')
    .select('id')
    .eq('category_id', req.params.id)
    .limit(1);
  
  if (products && products.length > 0) {
    throw new AppError('Cannot delete category with products', 400);
  }
  
  const { error } = await supabaseAdmin
    .from('categories')
    .delete()
    .eq('id', req.params.id);
  
  if (error) {
    throw new AppError(`Category deletion failed: ${error.message}`, 500);
  }
  
  res.json({
    success: true,
    message: 'Category deleted'
  });
}));

export default router;