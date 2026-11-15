import asyncHandler from "express-async-handler";
import * as storeService from "../services/storeService.js";
import * as productService from "../services/productService.js";
import { AppError, NotFoundError, ValidationError } from "../middleware/errorHandler.js";
import { supabaseAdmin } from "../config/supabase.js";

const parseJsonField = (value) => {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
};

const parseCategories = (value) => {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = parseJsonField(value);
    if (Array.isArray(parsed)) {
      return parsed.map((item) => String(item).trim()).filter(Boolean);
    }
    return value.split(",").map((item) => item.trim()).filter(Boolean);
  }
  return [];
};

const roundCoordinate = (value) => Math.round(value * 1e7) / 1e7;

const sanitizeCoordinates = (coordinates) => {
  if (coordinates === undefined || coordinates === null) {
    return { coordinates: undefined };
  }
  if (typeof coordinates !== "object" || Array.isArray(coordinates)) {
    return { error: "รูปแบบพิกัดไม่ถูกต้อง" };
  }

  const hasValue = (value) => value !== undefined && value !== null && value !== "";
  const hasLat = hasValue(coordinates.lat);
  const hasLng = hasValue(coordinates.lng);

  if (!hasLat && !hasLng) return { coordinates: undefined };
  if (!hasLat || !hasLng) {
    return { error: "กรุณาระบุทั้งละติจูดและลองจิจูด" };
  }

  const lat = Number(coordinates.lat);
  const lng = Number(coordinates.lng);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    return { error: "ละติจูดต้องเป็นตัวเลขระหว่าง -90 ถึง 90" };
  }
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
    return { error: "ลองจิจูดต้องเป็นตัวเลขระหว่าง -180 ถึง 180" };
  }

  return { coordinates: { lat: roundCoordinate(lat), lng: roundCoordinate(lng) } };
};

const normalizeAddressField = (value) => {
  if (value === undefined) return undefined;
  const parsed = parseJsonField(value);
  if (parsed === undefined) return undefined;
  if (typeof parsed !== "object" || Array.isArray(parsed) || parsed === null) return undefined;
  return parsed;
};

const getStores = asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 10;
  const filters = {
    category: req.query.category,
    search: req.query.search,
    lat: req.query.lat ? parseFloat(req.query.lat) : undefined,
    lng: req.query.lng ? parseFloat(req.query.lng) : undefined,
    radius: req.query.radius ? parseFloat(req.query.radius) : 10,
    sortBy: req.query.sortBy
  };
  const pagination = { page, limit };

  const result = await storeService.getPublicStores(filters, pagination);
  res.json({ success: true, ...result });
});

const getFeaturedStores = asyncHandler(async (req, res) => {
  const result = await storeService.getPublicStores(
    { sortBy: 'rating' },
    { page: 1, limit: 6 }
  );
  res.json({ success: true, data: result.stores });
});

const getCategories = asyncHandler(async (req, res) => {
  const { data } = await supabaseAdmin
    .from('stores')
    .select('categories')
    .eq('is_active', true)
    .eq('is_verified', true);
  
  const categories = [...new Set(data.flatMap(s => s.categories || []).filter(Boolean))];
  res.json({ success: true, data: categories });
});

const getStoreById = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const store = await storeService.getStoreById(id);
  
  const images = store.cover_image_url || store.logo_url
    ? [store.cover_image_url, store.logo_url].filter(Boolean)
    : [];
  res.json({ success: true, data: { ...store, images } });
});

const getStoreProducts = asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 10;
  const { id } = req.params;

  const store = await storeService.getStoreById(id);
  
  const result = await productService.getProductsByStore(
    store.id, 
    store.owner_id, 
    { is_active: true, category_id: req.query.category, search: req.query.search },
    { page, limit }
  );

  res.json({ success: true, ...result });
});

const createStore = asyncHandler(async (req, res) => {
  const { name, description, address, phone, email, openingHours, categories, deliveryFee, minimumOrder, estimatedDeliveryTime } = req.body;

  if (!name || !name.trim()) {
    res.status(400).json({ success: false, message: "กรุณาระบุชื่อร้านค้า" });
    return;
  }

  const logoFile = req.files?.logo?.[0];
  const coverFile = req.files?.coverImage?.[0];
  const logoPath = logoFile ? `/uploads/${logoFile.filename}` : undefined;
  const coverPath = coverFile ? `/uploads/${coverFile.filename}` : undefined;

  const storeAddress = normalizeAddressField(address) || {};
  const { coordinates, error: coordinatesError } = sanitizeCoordinates(storeAddress.coordinates);
  if (coordinatesError) {
    res.status(400).json({ success: false, message: coordinatesError });
    return;
  }
  if (coordinates) storeAddress.coordinates = coordinates;
  else delete storeAddress.coordinates;

  const store = await storeService.createStore(req.user.id, {
    name: name.trim(),
    description: description?.trim(),
    logo_url: logoPath,
    cover_image_url: coverPath,
    address: storeAddress,
    phone: phone?.trim(),
    email: email?.toLowerCase().trim(),
    opening_hours: parseJsonField(openingHours),
    categories: parseCategories(categories),
    delivery_fee: deliveryFee || 0,
    minimum_order: minimumOrder || 0,
    estimated_delivery_time: estimatedDeliveryTime || 30,
  });

  res.status(201).json({ success: true, data: store });
});

const updateStore = asyncHandler(async (req, res) => {
  const store = await storeService.getStoreById(req.params.id);
  if (store.owner_id !== req.user.id && req.user.role !== "admin") {
    res.status(403).json({ success: false, message: "คุณไม่มีสิทธิ์แก้ไขร้านค้านี้" });
    return;
  }

  const logoFile = req.files?.logo?.[0];
  const coverFile = req.files?.coverImage?.[0];

  const updateData = { ...req.body };
  if (logoFile) updateData.logo_url = `/uploads/${logoFile.filename}`;
  if (coverFile) updateData.cover_image_url = `/uploads/${coverFile.filename}`;

  if (updateData.address !== undefined) {
    const parsedAddress = normalizeAddressField(updateData.address);
    if (parsedAddress !== undefined) {
      const { coordinates, error: coordinatesError } = sanitizeCoordinates(parsedAddress.coordinates);
      if (coordinatesError) {
        res.status(400).json({ success: false, message: coordinatesError });
        return;
      }
      if (coordinates) parsedAddress.coordinates = coordinates;
      else delete parsedAddress.coordinates;
      updateData.address = parsedAddress;
    } else {
      delete updateData.address;
    }
  }
  if (updateData.openingHours !== undefined) {
    updateData.opening_hours = parseJsonField(updateData.openingHours);
  }
  if (updateData.categories !== undefined) {
    updateData.categories = parseCategories(updateData.categories);
  }

  const updatedStore = await storeService.updateStore(req.params.id, req.user.id, updateData);
  res.json({ success: true, data: updatedStore });
});

const deleteStore = asyncHandler(async (req, res) => {
  const store = await storeService.getStoreById(req.params.id);
  if (store.owner_id !== req.user.id && req.user.role !== "admin") {
    res.status(403).json({ success: false, message: "คุณไม่มีสิทธิ์ลบร้านค้านี้" });
    return;
  }
  await storeService.deleteStore(req.params.id, req.user.id);
  res.json({ success: true, message: "ลบร้านค้าเรียบร้อย" });
});

const updateStoreStatus = asyncHandler(async (req, res) => {
  const { isActive } = req.body;
  const store = await storeService.updateStore(req.params.id, req.user.id, { is_active: isActive });
  if (!store) {
    res.status(404).json({ success: false, message: "ไม่พบร้านค้า" });
    return;
  }
  res.json({ success: true, data: store });
});

const getMyStores = asyncHandler(async (req, res) => {
  const stores = await storeService.getStoresByOwner(req.user.id);
  res.json({ success: true, data: stores });
});

const getStoreByOwner = asyncHandler(async (req, res) => {
  const stores = await storeService.getStoresByOwner(req.params.ownerId);
  const store = stores[0] || null;
  if (!store) {
    res.status(404).json({ success: false, message: "ไม่พบร้านค้า" });
    return;
  }
  const images = store.cover_image_url || store.logo_url
    ? [store.cover_image_url, store.logo_url].filter(Boolean)
    : [];
  res.json({ success: true, data: { ...store, images } });
});

export {
  getStores,
  getFeaturedStores,
  getCategories,
  getStoreById,
  getStoreProducts,
  createStore,
  updateStore,
  deleteStore,
  updateStoreStatus,
  getMyStores,
  getStoreByOwner,
};