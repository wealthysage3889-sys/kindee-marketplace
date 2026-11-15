import asyncHandler from "express-async-handler";
import * as productService from "../services/productService.js";
import * as storeService from "../services/storeService.js";
import { AppError, NotFoundError, ValidationError } from "../middleware/errorHandler.js";
import { supabaseAdmin } from "../config/supabase.js";

const getProducts = asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 10;
  const filters = {
    store_id: req.query.store_id,
    category_id: req.query.category,
    search: req.query.keyword,
    min_price: req.query.minPrice ? Number(req.query.minPrice) : undefined,
    max_price: req.query.maxPrice ? Number(req.query.maxPrice) : undefined,
    sort_by: req.query.sort_by || 'relevance'
  };
  const pagination = { page, limit };

  const result = await productService.getPublicProducts(filters, pagination);
  res.json({ success: true, ...result });
});

const getProductById = asyncHandler(async (req, res) => {
  const product = await productService.getProductById(req.params.id);
  res.json({ success: true, data: product });
});

const createProduct = asyncHandler(async (req, res) => {
  const store = await storeService.getStoresByOwner(req.user.id);
  const storeId = store[0]?.id;
  
  if (!storeId) {
    res.status(400).json({ success: false, message: "คุณยังไม่มีร้านค้า กรุณาสร้างร้านค้าก่อน" });
    return;
  }

  const { name, description, price, discountPrice, stock, category, tags } = req.body;

  if (!name || !description || !price || !stock || !category) {
    res.status(400).json({ success: false, message: "กรุณากรอกข้อมูลสินค้าให้ครบถ้วน" });
    return;
  }

  const uploadedImages = req.files ? req.files.map((file) => `/uploads/${file.filename}`) : [];
  
  if (uploadedImages.length === 0) {
    res.status(400).json({ success: false, message: "กรุณาอัปโหลดรูปสินค้าอย่างน้อย 1 รูป" });
    return;
  }

  const product = await productService.createProduct(storeId, req.user.id, {
    name,
    description,
    price,
    discountPrice,
    stock,
    categoryId: category,
    images: uploadedImages,
    tags
  });

  res.status(201).json({ success: true, data: product });
});

const updateProduct = asyncHandler(async (req, res) => {
  const { name, description, price, discountPrice, stock, category, tags, isActive, existingImages } = req.body;

  const product = await productService.getProductById(req.params.id, true);
  
  const store = await storeService.getStoresByOwner(req.user.id);
  const storeId = store[0]?.id;
  
  if (!storeId || product.store_id !== storeId) {
    res.status(403).json({ success: false, message: "คุณไม่มีสิทธิ์แก้ไขสินค้านี้" });
    return;
  }

  const updates = {};
  if (name) updates.name = name;
  if (description) updates.description = description;
  if (price !== undefined) updates.price = price;
  if (discountPrice !== undefined) updates.discount_price = discountPrice;
  if (stock !== undefined) updates.stock = stock;
  if (category) updates.category_id = category;
  if (tags) updates.tags = tags;
  if (isActive !== undefined) updates.is_active = isActive;

  const existingImagesArray = existingImages ? (Array.isArray(existingImages) ? existingImages : [existingImages]) : [];
  const newUploadedImages = req.files ? req.files.map((file) => `/uploads/${file.filename}`) : [];
  updates.images = [...existingImagesArray, ...newUploadedImages];

  if (updates.images.length === 0) {
    res.status(400).json({ success: false, message: "กรุณามีรูปสินค้าอย่างน้อย 1 รูป" });
    return;
  }

  const updatedProduct = await productService.updateProduct(req.params.id, storeId, req.user.id, updates);
  res.json({ success: true, data: updatedProduct });
});

const deleteProduct = asyncHandler(async (req, res) => {
  const product = await productService.getProductById(req.params.id, true);
  
  const store = await storeService.getStoresByOwner(req.user.id);
  const storeId = store[0]?.id;
  
  if (!storeId || product.store_id !== storeId) {
    res.status(403).json({ success: false, message: "คุณไม่มีสิทธิ์ลบสินค้านี้" });
    return;
  }

  await productService.deleteProduct(req.params.id, storeId, req.user.id);
  res.json({ success: true, message: "ลบสินค้าเรียบร้อย" });
});

const getSellerProducts = asyncHandler(async (req, res) => {
  const store = await storeService.getStoresByOwner(req.user.id);
  const storeId = store[0]?.id;
  
  if (!storeId) {
    res.json({ success: true, count: 0, data: [] });
    return;
  }

  const result = await productService.getProductsByStore(storeId, req.user.id, {}, { page: 1, limit: 100 });
  res.json({ success: true, count: result.products.length, data: result.products });
});

export {
  getProducts,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct,
  getSellerProducts,
};