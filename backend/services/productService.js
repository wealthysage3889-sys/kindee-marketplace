import { supabaseAdmin } from '../config/supabase.js';
import { AppError, NotFoundError, ValidationError } from '../middleware/errorHandler.js';
import { slugify } from '../utils/helpers.js';
import {
  STOCK_INVALID_MESSAGE,
  parseStockInput,
  validateProductPricing,
  validateUpdatedProductPricing
} from '../utils/productPricing.js';

// Create product
export const createProduct = async (storeId, ownerId, productData) => {
  // Verify store ownership
  const { data: store } = await supabaseAdmin
    .from('stores')
    .select('id')
    .eq('id', storeId)
    .eq('owner_id', ownerId)
    .single();
  
  if (!store) {
    throw new AppError('Store not found or not authorized', 403);
  }
  
  const { name, description, price, discountPrice, stock, categoryId, images, tags } = productData;

  // FormData/multipart clients send prices as strings, JSON clients may send
  // numbers. Parse them to numbers first so the discount comparison below is
  // numeric ('99' >= '100' is true for strings, 99 >= 100 is not).
  const pricing = validateProductPricing({ price, discount: discountPrice });
  if (pricing.errors.length > 0) {
    throw new ValidationError(pricing.errors[0]);
  }

  const stockResult = parseStockInput(stock);
  const numericStock = stockResult.value === null ? 0 : stockResult.value;
  if (!stockResult.ok || numericStock < 0) {
    throw new ValidationError(STOCK_INVALID_MESSAGE);
  }

  const numericPrice = pricing.price;
  // null means "no discount": the column is stored as NULL, not as 0.
  const numericDiscountPrice = pricing.discount;
  
  // Generate slug
  const baseSlug = slugify(name);
  let slug = baseSlug;
  let counter = 1;
  
  while (true) {
    const { data: existing } = await supabaseAdmin
      .from('products')
      .select('id')
      .eq('store_id', storeId)
      .eq('slug', slug)
      .single();
    
    if (!existing) break;
    slug = `${baseSlug}-${counter++}`;
  }
  
  const { data: product, error } = await supabaseAdmin
    .from('products')
    .insert({
      store_id: storeId,
      category_id: categoryId,
      name,
      slug,
      description,
      price: numericPrice,
      discount_price: numericDiscountPrice,
      stock: numericStock,
      images: images || [],
      tags: tags || [],
      is_active: true
    })
    .select()
    .single();
  
  if (error) {
    throw new AppError(`Product creation failed: ${error.message}`, 500);
  }
  
  return product;
};

// Get product by ID
export const getProductById = async (productId, includeInactive = false) => {
  let query = supabaseAdmin
    .from('products')
    .select(`
      *,
      store:stores!store_id(id, name, slug, logo_url, delivery_fee, minimum_order, estimated_delivery_time, delivery_type),
      category:categories!category_id(id, name, slug)
    `)
    .eq('id', productId);
  
  if (!includeInactive) {
    query = query.eq('is_active', true);
  }
  
  const { data: product, error } = await query.single();
  
  if (error || !product) {
    throw new NotFoundError('Product');
  }
  
  return product;
};

// Get products for store
export const getProductsByStore = async (storeId, ownerId, filters = {}, pagination = {}) => {
  // Verify ownership
  const { data: store } = await supabaseAdmin
    .from('stores')
    .select('id')
    .eq('id', storeId)
    .eq('owner_id', ownerId)
    .single();
  
  if (!store) {
    throw new AppError('Store not found or not authorized', 403);
  }
  
  const { is_active, category_id, search, low_stock } = filters;
  const { page = 1, limit = 20 } = pagination;
  
  let query = supabaseAdmin
    .from('products')
    .select('*', { count: 'exact' })
    .eq('store_id', storeId);
  
  if (is_active !== undefined) query = query.eq('is_active', is_active);
  if (category_id) query = query.eq('category_id', category_id);
  if (search) {
    query = query.or(`name.ilike.%${search}%,description.ilike.%${search}%`);
  }
  if (low_stock) {
    query = query.lte('stock', 10);
  }
  
  query = query
    .order('created_at', { ascending: false })
    .range((page - 1) * limit, page * limit - 1);
  
  const { data, error, count } = await query;
  
  if (error) {
    throw new AppError(`Failed to fetch products: ${error.message}`, 500);
  }
  
  return {
    products: data,
    pagination: {
      page,
      limit,
      total: count,
      totalPages: Math.ceil(count / limit)
    }
  };
};

// Update product
export const updateProduct = async (productId, storeId, ownerId, updates) => {
  // Verify ownership
  const product = await getProductById(productId, true);
  if (product.store_id !== storeId) {
    throw new AppError('Product not found in this store', 404);
  }
  
  const { data: store } = await supabaseAdmin
    .from('stores')
    .select('id')
    .eq('id', storeId)
    .eq('owner_id', ownerId)
    .single();
  
  if (!store) {
    throw new AppError('Not authorized to update this product', 403);
  }
  
  const allowedFields = [
    'name', 'description', 'price', 'discount_price', 'stock',
    'category_id', 'images', 'tags', 'is_active'
  ];
  
  const filteredUpdates = {};
  for (const field of allowedFields) {
    if (updates[field] !== undefined) {
      filteredUpdates[field] = updates[field];
    }
  }

  // Normalize and validate the numeric fields. The discount is checked against
  // the price that will be stored: a new price, or the current one when the
  // request only changes the discount (and the other way around), so a partial
  // update cannot leave discount_price >= price behind.
  const pricing = validateUpdatedProductPricing({
    price: filteredUpdates.price,
    discount: filteredUpdates.discount_price,
    currentPrice: product.price,
    currentDiscount: product.discount_price
  });

  if (pricing.errors.length > 0) {
    throw new ValidationError(pricing.errors[0]);
  }

  const stockResult = filteredUpdates.stock !== undefined
    ? parseStockInput(filteredUpdates.stock)
    : { ok: true, value: undefined };
  if (filteredUpdates.stock !== undefined && (!stockResult.ok || stockResult.value === null || stockResult.value < 0)) {
    throw new ValidationError(STOCK_INVALID_MESSAGE);
  }

  if (pricing.hasPrice) filteredUpdates.price = pricing.price;
  if (pricing.hasDiscount) filteredUpdates.discount_price = pricing.discount;
  if (filteredUpdates.stock !== undefined) filteredUpdates.stock = stockResult.value;
  
  // Handle slug update
  if (filteredUpdates.name && filteredUpdates.name !== product.name) {
    const baseSlug = slugify(filteredUpdates.name);
    let slug = baseSlug;
    let counter = 1;
    
    while (true) {
      const { data: existing } = await supabaseAdmin
        .from('products')
        .select('id')
        .eq('store_id', storeId)
        .eq('slug', slug)
        .neq('id', productId)
        .single();
      
      if (!existing) break;
      slug = `${baseSlug}-${counter++}`;
    }
    filteredUpdates.slug = slug;
  }
  
  const { data: updatedProduct, error } = await supabaseAdmin
    .from('products')
    .update(filteredUpdates)
    .eq('id', productId)
    .select()
    .single();
  
  if (error) {
    throw new AppError(`Product update failed: ${error.message}`, 500);
  }
  
  return updatedProduct;
};

// Delete product
export const deleteProduct = async (productId, storeId, ownerId) => {
  const product = await getProductById(productId, true);
  if (product.store_id !== storeId) {
    throw new AppError('Product not found in this store', 404);
  }
  
  const { data: store } = await supabaseAdmin
    .from('stores')
    .select('id')
    .eq('id', storeId)
    .eq('owner_id', ownerId)
    .single();
  
  if (!store) {
    throw new AppError('Not authorized to delete this product', 403);
  }
  
  const { error } = await supabaseAdmin
    .from('products')
    .delete()
    .eq('id', productId);
  
  if (error) {
    throw new AppError(`Product deletion failed: ${error.message}`, 500);
  }
  
  return { success: true };
};

// Get public products (for customers)
export const getPublicProducts = async (filters = {}, pagination = {}) => {
  const { store_id, category_id, search, min_price, max_price, sort_by = 'relevance' } = filters;
  const { page = 1, limit = 20 } = pagination;
  const offset = (page - 1) * limit;
  
  let query = supabaseAdmin
    .from('products')
    .select(`
      *,
      store:stores!store_id(id, name, slug, logo_url, delivery_fee, minimum_order, estimated_delivery_time, delivery_type),
      category:categories!category_id(id, name, slug)
    `, { count: 'exact' })
    .eq('is_active', true);
  
  if (store_id) query = query.eq('store_id', store_id);
  if (category_id) query = query.eq('category_id', category_id);
  if (min_price) query = query.gte('price', min_price);
  if (max_price) query = query.lte('price', max_price);
  
  if (search) {
    query = query.or(`name.ilike.%${search}%,description.ilike.%${search}%`);
  }
  
  switch (sort_by) {
    case 'price_asc':
      query = query.order('price', { ascending: true });
      break;
    case 'price_desc':
      query = query.order('price', { ascending: false });
      break;
    case 'rating':
      query = query.order('rating_average', { ascending: false });
      break;
    case 'newest':
      query = query.order('created_at', { ascending: false });
      break;
    case 'relevance':
    default:
      query = query.order('rating_average', { ascending: false })
                   .order('created_at', { ascending: false });
      break;
  }
  
  query = query.range(offset, offset + limit - 1);
  
  const { data, error, count } = await query;
  
  if (error) {
    throw new AppError(`Product search failed: ${error.message}`, 500);
  }
  
  return {
    products: data,
    pagination: {
      page,
      limit,
      total: count,
      totalPages: Math.ceil((count || 0) / limit)
    }
  };
};

// Get products by category
export const getProductsByCategory = async (categoryId, filters = {}, pagination = {}) => {
  return getPublicProducts({ ...filters, category_id: categoryId }, pagination);
};

// Search products (full-text search)
export const searchProducts = async (query, filters = {}, pagination = {}) => {
  return getPublicProducts({ ...filters, search: query }, pagination);
};

// Update stock
export const updateStock = async (productId, storeId, ownerId, quantity, operation = 'set') => {
  const product = await getProductById(productId, true);
  if (product.store_id !== storeId) {
    throw new AppError('Product not found in this store', 404);
  }
  
  const { data: store } = await supabaseAdmin
    .from('stores')
    .select('id')
    .eq('id', storeId)
    .eq('owner_id', ownerId)
    .single();
  
  if (!store) {
    throw new AppError('Not authorized to update this product', 403);
  }
  
  let newStock;
  if (operation === 'increment') {
    newStock = product.stock + quantity;
  } else if (operation === 'decrement') {
    newStock = product.stock - quantity;
    if (newStock < 0) {
      throw new ValidationError('Insufficient stock');
    }
  } else {
    newStock = quantity;
  }
  
  if (newStock < 0) {
    throw new ValidationError('Stock cannot be negative');
  }
  
  const { data: updatedProduct, error } = await supabaseAdmin
    .from('products')
    .update({ stock: newStock })
    .eq('id', productId)
    .select()
    .single();
  
  if (error) {
    throw new AppError(`Stock update failed: ${error.message}`, 500);
  }
  
  return updatedProduct;
};

// Bulk update products
export const bulkUpdateProducts = async (storeId, ownerId, productUpdates) => {
  const { data: store } = await supabaseAdmin
    .from('stores')
    .select('id')
    .eq('id', storeId)
    .eq('owner_id', ownerId)
    .single();
  
  if (!store) {
    throw new AppError('Not authorized', 403);
  }
  
  const results = [];
  
  for (const update of productUpdates) {
    try {
      const result = await updateProduct(update.id, storeId, ownerId, update.data);
      results.push({ id: update.id, success: true, data: result });
    } catch (error) {
      results.push({ id: update.id, success: false, error: error.message });
    }
  }
  
  return results;
};

// Admin: Get all products
export const getAllProducts = async (filters = {}, pagination = {}) => {
  const { store_id, category_id, is_active, search } = filters;
  const { page = 1, limit = 20 } = pagination;
  
  let query = supabaseAdmin
    .from('products')
    .select(`
      *,
      store:stores!store_id(id, name, slug),
      category:categories!category_id(id, name)
    `, { count: 'exact' });
  
  if (store_id) query = query.eq('store_id', store_id);
  if (category_id) query = query.eq('category_id', category_id);
  if (is_active !== undefined) query = query.eq('is_active', is_active);
  if (search) {
    query = query.or(`name.ilike.%${search}%,description.ilike.%${search}%`);
  }
  
  query = query
    .order('created_at', { ascending: false })
    .range((page - 1) * limit, page * limit - 1);
  
  const { data, error, count } = await query;
  
  if (error) {
    throw new AppError(`Failed to fetch products: ${error.message}`, 500);
  }
  
  return {
    products: data,
    pagination: {
      page,
      limit,
      total: count,
      totalPages: Math.ceil(count / limit)
    }
  };
};