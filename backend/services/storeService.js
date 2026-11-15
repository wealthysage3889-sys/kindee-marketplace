import { supabaseAdmin } from '../config/supabase.js';
import { AppError, NotFoundError, ValidationError } from '../middleware/errorHandler.js';
import { slugify } from '../utils/helpers.js';

// Accepts both camelCase (legacy API payloads) and snake_case (store columns)
// and writes only columns that exist on the `stores` table.
const STORE_FIELD_MAP = {
  name: 'name',
  description: 'description',
  address: 'address',
  phone: 'phone',
  email: 'email',
  openingHours: 'opening_hours',
  opening_hours: 'opening_hours',
  categories: 'categories',
  deliveryFee: 'delivery_fee',
  delivery_fee: 'delivery_fee',
  minimumOrder: 'minimum_order',
  minimum_order: 'minimum_order',
  estimatedDeliveryTime: 'estimated_delivery_time',
  estimated_delivery_time: 'estimated_delivery_time',
  deliveryType: 'delivery_type',
  delivery_type: 'delivery_type',
  isActive: 'is_active',
  is_active: 'is_active',
  logoUrl: 'logo_url',
  logo_url: 'logo_url',
  coverImageUrl: 'cover_image_url',
  cover_image_url: 'cover_image_url'
};

const NUMERIC_FIELDS = new Set(['delivery_fee', 'minimum_order']);
const INTEGER_FIELDS = new Set(['estimated_delivery_time']);

const toStoreColumns = (updates = {}) => {
  const columns = {};

  for (const [field, value] of Object.entries(updates || {})) {
    const column = STORE_FIELD_MAP[field];
    if (!column || value === undefined) continue;

    if (NUMERIC_FIELDS.has(column) || INTEGER_FIELDS.has(column)) {
      if (value === '' || value === null) continue;
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) {
        throw new ValidationError(`${field} must be a number`);
      }
      columns[column] = INTEGER_FIELDS.has(column) ? Math.trunc(parsed) : parsed;
      continue;
    }

    columns[column] = value;
  }

  return columns;
};

// Create store
export const createStore = async (ownerId, storeData) => {
  const { name, address } = storeData;
  const columns = toStoreColumns(storeData);

  // Generate slug
  const baseSlug = slugify(name);
  let slug = baseSlug;
  let counter = 1;

  // Ensure unique slug
  while (true) {
    const { data: existing } = await supabaseAdmin
      .from('stores')
      .select('id')
      .eq('slug', slug)
      .single();

    if (!existing) break;
    slug = `${baseSlug}-${counter++}`;
  }

  // Validate address has coordinates
  if (!address?.coordinates?.lat || !address?.coordinates?.lng) {
    throw new ValidationError('Store address must include coordinates (lat, lng)');
  }

  const { data: store, error } = await supabaseAdmin
    .from('stores')
    .insert({
      ...columns,
      owner_id: ownerId,
      slug,
      is_active: true,
      is_verified: false
    })
    .select()
    .single();

  if (error) {
    throw new AppError(`Store creation failed: ${error.message}`, 500);
  }

  return store;
};

// Get store by ID
export const getStoreById = async (storeId) => {
  const { data: store, error } = await supabaseAdmin
    .from('stores')
    .select('*')
    .eq('id', storeId)
    .single();
  
  if (error || !store) {
    throw new NotFoundError('Store');
  }
  
  return store;
};

// Get store by slug
export const getStoreBySlug = async (slug) => {
  const { data: store, error } = await supabaseAdmin
    .from('stores')
    .select('*')
    .eq('slug', slug)
    .single();
  
  if (error || !store) {
    throw new NotFoundError('Store');
  }
  
  return store;
};

// Get stores for owner
export const getStoresByOwner = async (ownerId) => {
  const { data: stores, error } = await supabaseAdmin
    .from('stores')
    .select('*')
    .eq('owner_id', ownerId)
    .order('created_at', { ascending: false });
  
  if (error) {
    throw new AppError(`Failed to fetch stores: ${error.message}`, 500);
  }
  
  return stores;
};

// Update store
export const updateStore = async (storeId, ownerId, updates) => {
  // Verify ownership
  const store = await getStoreById(storeId);
  if (store.owner_id !== ownerId) {
    throw new AppError('Not authorized to update this store', 403);
  }
  
  const filteredUpdates = toStoreColumns(updates);

  // Handle slug update
  if (updates.name && updates.name !== store.name) {
    const baseSlug = slugify(updates.name);
    let slug = baseSlug;
    let counter = 1;
    
    while (true) {
      const { data: existing } = await supabaseAdmin
        .from('stores')
        .select('id')
        .eq('slug', slug)
        .neq('id', storeId)
        .single();
      
      if (!existing) break;
      slug = `${baseSlug}-${counter++}`;
    }
    filteredUpdates.slug = slug;
  }
  
  // Validate address coordinates if provided
  if (filteredUpdates.address?.coordinates) {
    const { lat, lng } = filteredUpdates.address.coordinates;
    const parsedLat = Number(lat);
    const parsedLng = Number(lng);
    if (!Number.isFinite(parsedLat) || !Number.isFinite(parsedLng) ||
        parsedLat < -90 || parsedLat > 90 || parsedLng < -180 || parsedLng > 180) {
      throw new ValidationError('Invalid coordinates');
    }
    filteredUpdates.address = {
      ...filteredUpdates.address,
      coordinates: { lat: parsedLat, lng: parsedLng }
    };
  }

  // Nothing to write: keep the stored row untouched.
  if (Object.keys(filteredUpdates).length === 0) {
    return store;
  }

  const { data: updatedStore, error } = await supabaseAdmin
    .from('stores')
    .update(filteredUpdates)
    .eq('id', storeId)
    .select()
    .single();
  
  if (error) {
    throw new AppError(`Store update failed: ${error.message}`, 500);
  }
  
  return updatedStore;
};

// Delete store
export const deleteStore = async (storeId, ownerId) => {
  const store = await getStoreById(storeId);
  if (store.owner_id !== ownerId) {
    throw new AppError('Not authorized to delete this store', 403);
  }
  
  const { error } = await supabaseAdmin
    .from('stores')
    .delete()
    .eq('id', storeId);
  
  if (error) {
    throw new AppError(`Store deletion failed: ${error.message}`, 500);
  }
  
  return { success: true };
};

// Get public stores (for customers)
export const getPublicStores = async (filters = {}, pagination = {}) => {
  const { category, search, lat, lng, radius = 10, sortBy = 'distance' } = filters;
  const { page = 1, limit = 20 } = pagination;
  
  let query = supabaseAdmin
    .from('stores')
    .select(`
      *,
      products:products(count)
    `, { count: 'exact' })
    .eq('is_active', true)
    .eq('is_verified', true);
  
  if (category) {
    query = query.contains('categories', [category]);
  }
  
  if (search) {
    query = query.or(`name.ilike.%${search}%,description.ilike.%${search}%`);
  }
  
  // Location-based search using PostGIS
  if (lat && lng) {
    const { data, error } = await supabaseAdmin.rpc('find_nearby_stores', {
      p_lat: lat,
      p_lng: lng,
      p_radius_km: radius,
      p_limit: limit
    });
    
    if (error) {
      throw new AppError(`Location search failed: ${error.message}`, 500);
    }
    
    return {
      stores: data,
      pagination: { page: 1, limit, total: data.length, totalPages: 1 }
    };
  }
  
  // Apply sorting
  switch (sortBy) {
    case 'rating':
      query = query.order('rating_average', { ascending: false });
      break;
    case 'delivery_fee':
      query = query.order('delivery_fee', { ascending: true });
      break;
    case 'newest':
      query = query.order('created_at', { ascending: false });
      break;
    default:
      query = query.order('rating_average', { ascending: false });
  }
  
  query = query.range((page - 1) * limit, page * limit - 1);
  
  const { data, error, count } = await query;
  
  if (error) {
    throw new AppError(`Failed to fetch stores: ${error.message}`, 500);
  }
  
  return {
    stores: data,
    pagination: {
      page,
      limit,
      total: count,
      totalPages: Math.ceil(count / limit)
    }
  };
};

// Get store categories
export const getStoreCategories = async (storeId) => {
  const { data: store } = await supabaseAdmin
    .from('stores')
    .select('categories')
    .eq('id', storeId)
    .single();
  
  return store?.categories || [];
};

// Admin: Verify store
export const verifyStore = async (storeId, verified = true) => {
  const { data: store, error } = await supabaseAdmin
    .from('stores')
    .update({ is_verified: verified })
    .eq('id', storeId)
    .select()
    .single();
  
  if (error) {
    throw new AppError(`Store verification failed: ${error.message}`, 500);
  }
  
  return store;
};

// Admin: Get all stores
export const getAllStores = async (filters = {}, pagination = {}) => {
  const { is_active, is_verified, owner_id, search } = filters;
  const { page = 1, limit = 20 } = pagination;
  
  let query = supabaseAdmin
    .from('stores')
    .select(`
      *,
      owner:profiles!owner_id(id, name, email, phone)
    `, { count: 'exact' });
  
  if (is_active !== undefined) query = query.eq('is_active', is_active);
  if (is_verified !== undefined) query = query.eq('is_verified', is_verified);
  if (owner_id) query = query.eq('owner_id', owner_id);
  if (search) {
    query = query.or(`name.ilike.%${search}%,slug.ilike.%${search}%`);
  }
  
  query = query
    .order('created_at', { ascending: false })
    .range((page - 1) * limit, page * limit - 1);
  
  const { data, error, count } = await query;
  
  if (error) {
    throw new AppError(`Failed to fetch stores: ${error.message}`, 500);
  }
  
  return {
    stores: data,
    pagination: {
      page,
      limit,
      total: count,
      totalPages: Math.ceil(count / limit)
    }
  };
};