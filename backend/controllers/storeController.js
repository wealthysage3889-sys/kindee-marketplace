const asyncHandler = require("express-async-handler");
const mongoose = require("mongoose");
const Store = require("../models/Store");
const Product = require("../models/Product");
const User = require("../models/User");

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
  const startIndex = (page - 1) * limit;

  let query = Store.find({ isActive: true });

  if (req.query.category) {
    query = query.where("categories").in([req.query.category]);
  }
  if (req.query.search) {
    query = query.find({ name: { $regex: req.query.search, $options: "i" } });
  }

  let total = await Store.countDocuments(query);
  let stores = await query.skip(startIndex).limit(limit).sort("-createdAt");

  if (total === 0) {
    const anyStore = await Store.exists({});
    if (!anyStore) {
      let userQuery = User.find({
        role: { $in: ["seller", "admin", "owner"] },
        isActive: { $ne: false },
      }).select("name email phone role");

      if (req.query.search) {
        userQuery = userQuery.find({ name: { $regex: req.query.search, $options: "i" } });
      }

      const sellerUsers = await userQuery.sort("-createdAt");
      const mapped = sellerUsers.map((u) => ({
        _id: u._id,
        owner: u._id,
        name: u.name ? `${u.name} Shop` : "ร้านค้า",
        description: "ร้านค้าชั่วคราวจากบัญชีผู้ขาย",
        email: u.email || "",
        phone: u.phone || "",
        categories: [],
        isActive: true,
        isVerified: false,
        rating: { average: 0, count: 0 },
        _temporary: true,
      }));

      total = mapped.length;
      stores = mapped.slice(startIndex, startIndex + limit);
    }
  }

  res.json({
    success: true,
    count: stores.length,
    total,
    page,
    pages: Math.ceil(total / limit) || 1,
    data: stores,
  });
});

const getFeaturedStores = asyncHandler(async (req, res) => {
  const stores = await Store.find({ isActive: true, isVerified: true })
    .sort({ "rating.average": -1 })
    .limit(6);
  res.json({ success: true, data: stores });
});

const getCategories = asyncHandler(async (req, res) => {
  const categories = await Store.distinct("categories");
  res.json({ success: true, data: categories.filter(Boolean) });
});

const getStoreById = asyncHandler(async (req, res) => {
  const { id } = req.params;

  let store = await Store.findById(id).catch(() => null);
  if (!store) {
    store = await Store.findOne({
      $or: [{ owner: id }, { seller: id }, { user: id }],
    }).catch(() => null);
  }
  if (!store) {
    store = await Store.findOne();
  }

  if (!store) {
    res.status(404).json({ success: false, message: "ไม่พบร้านค้า" });
    return;
  }

  const images = store.coverImage || store.logo
    ? [store.coverImage, store.logo].filter(Boolean)
    : [];
  res.json({ success: true, data: { ...store.toObject(), images } });
});

const getStoreProducts = asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 10;
  const startIndex = (page - 1) * limit;
  const { id } = req.params;

  let store = await Store.findById(id).catch(() => null);
  if (!store) {
    store = await Store.findOne({
      $or: [{ owner: id }, { seller: id }, { user: id }],
    }).catch(() => null);
  }
  if (!store) {
    store = await Store.findOne();
  }

  if (!store) {
    res.status(404).json({ success: false, message: "ไม่พบร้านค้า" });
    return;
  }

  let query = Product.find({ seller: store.owner, isActive: true });

  if (req.query.category) {
    query = query.where("category").equals(req.query.category);
  }
  if (req.query.search) {
    query = query.find({ name: { $regex: req.query.search, $options: "i" } });
  }

  const total = await Product.countDocuments(query.getFilter());
  const products = await query
    .skip(startIndex)
    .limit(limit)
    .sort("-createdAt");

  res.json({
    success: true,
    count: products.length,
    total,
    page,
    pages: Math.ceil(total / limit),
    data: products,
  });
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

  const store = await Store.create({
    owner: req.user.id,
    name: name.trim(),
    description: description?.trim(),
    logo: logoPath,
    coverImage: coverPath,
    address: storeAddress,
    phone: phone?.trim(),
    email: email?.toLowerCase().trim(),
    openingHours: parseJsonField(openingHours),
    categories: parseCategories(categories),
    deliveryFee: deliveryFee || 0,
    minimumOrder: minimumOrder || 0,
    estimatedDeliveryTime: estimatedDeliveryTime || 30,
  });

  res.status(201).json({ success: true, data: store });
});

const updateStore = asyncHandler(async (req, res) => {
  let store = await Store.findById(req.params.id);
  if (!store) {
    res.status(404).json({ success: false, message: "ไม่พบร้านค้า" });
    return;
  }
  if (store.owner.toString() !== req.user.id && req.user.role !== "admin") {
    res.status(403).json({ success: false, message: "คุณไม่มีสิทธิ์แก้ไขร้านค้านี้" });
    return;
  }

  const logoFile = req.files?.logo?.[0];
  const coverFile = req.files?.coverImage?.[0];

  const updateData = { ...req.body };
  if (logoFile) updateData.logo = `/uploads/${logoFile.filename}`;
  if (coverFile) updateData.coverImage = `/uploads/${coverFile.filename}`;

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
    updateData.openingHours = parseJsonField(updateData.openingHours);
  }
  if (updateData.categories !== undefined) {
    updateData.categories = parseCategories(updateData.categories);
  }

  store = await Store.findByIdAndUpdate(req.params.id, updateData, { new: true, runValidators: true });
  res.json({ success: true, data: store });
});

const deleteStore = asyncHandler(async (req, res) => {
  const store = await Store.findById(req.params.id);
  if (!store) {
    res.status(404).json({ success: false, message: "ไม่พบร้านค้า" });
    return;
  }
  if (store.owner.toString() !== req.user.id && req.user.role !== "admin") {
    res.status(403).json({ success: false, message: "คุณไม่มีสิทธิ์ลบร้านค้านี้" });
    return;
  }
  await store.deleteOne();
  res.json({ success: true, message: "ลบร้านค้าเรียบร้อย" });
});

const updateStoreStatus = asyncHandler(async (req, res) => {
  const { isActive } = req.body;
  const store = await Store.findByIdAndUpdate(
    req.params.id,
    { isActive },
    { new: true, runValidators: true }
  );
  if (!store) {
    res.status(404).json({ success: false, message: "ไม่พบร้านค้า" });
    return;
  }
  res.json({ success: true, data: store });
});

const getMyStores = asyncHandler(async (req, res) => {
  const stores = await Store.find({ owner: req.user.id }).sort("-createdAt");
  res.json({ success: true, data: stores });
});

const getStoreByOwner = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.ownerId)) {
    res.status(404).json({ success: false, message: "ไม่พบร้านค้า" });
    return;
  }
  const store = await Store.findOne({ owner: req.params.ownerId });
  if (!store) {
    res.status(404).json({ success: false, message: "ไม่พบร้านค้า" });
    return;
  }
  const images = store.coverImage || store.logo
    ? [store.coverImage, store.logo].filter(Boolean)
    : [];
  res.json({ success: true, data: { ...store.toObject(), images } });
});

module.exports = {
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
