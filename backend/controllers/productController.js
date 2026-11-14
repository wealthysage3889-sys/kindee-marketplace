const asyncHandler = require("express-async-handler");
const Product = require("../models/Product");
const path = require("path");

const getProducts = asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 10;
  const startIndex = (page - 1) * limit;

  let query = Product.find({ isActive: true });

  if (req.query.category) {
    query = query.where("category").equals(req.query.category);
  }

  if (req.query.keyword) {
    query = query.find({
      $or: [
        { name: { $regex: req.query.keyword, $options: "i" } },
        { description: { $regex: req.query.keyword, $options: "i" } },
      ],
    });
  }

  if (req.query.minPrice || req.query.maxPrice) {
    const filter = {};
    if (req.query.minPrice) filter.price = { $gte: Number(req.query.minPrice) };
    if (req.query.maxPrice) {
      if (!filter.price) filter.price = {};
      filter.price.$lte = Number(req.query.maxPrice);
    }
    query = query.find(filter);
  }

  const total = await Product.countDocuments(query);
  const products = await query
    .skip(startIndex)
    .limit(limit)
    .populate("category", "name slug")
    .populate("seller", "name avatar")
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

const getProductById = asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.id)
    .populate("category", "name slug description")
    .populate("seller", "name avatar phone");

  if (!product) {
    res.status(404).json({ success: false, message: "ไม่พบสินค้า" });
    return;
  }

  res.json({ success: true, data: product });
});

const createProduct = asyncHandler(async (req, res) => {
  const { name, description, price, discountPrice, stock, category, tags } = req.body;

  if (!name || !description || !price || !stock || !category) {
    res.status(400).json({ success: false, message: "กรุณากรอกข้อมูลสินค้าให้ครบถ้วน" });
    return;
  }

  // Handle uploaded files
  const uploadedImages = req.files ? req.files.map((file) => `/uploads/${file.filename}`) : [];
  
  if (uploadedImages.length === 0) {
    res.status(400).json({ success: false, message: "กรุณาอัปโหลดรูปสินค้าอย่างน้อย 1 รูป" });
    return;
  }

  const baseSlug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "");

  let slug = baseSlug;
  let counter = 1;
  while (await Product.exists({ slug })) {
    slug = `${baseSlug}-${counter}`;
    counter++;
  }

  const product = await Product.create({
    name,
    slug,
    description,
    price,
    discountPrice,
    stock,
    category,
    images: uploadedImages,
    tags,
    seller: req.user.id,
  });

  res.status(201).json({ success: true, data: product });
});

const updateProduct = asyncHandler(async (req, res) => {
  let product = await Product.findById(req.params.id);
  if (!product) {
    res.status(404).json({ success: false, message: "ไม่พบสินค้า" });
    return;
  }

  if (product.seller.toString() !== req.user.id && !["admin", "owner"].includes(req.user.role)) {
    res.status(403).json({ success: false, message: "คุณไม่มีสิทธิ์แก้ไขสินค้านี้" });
    return;
  }

  const { name, description, price, discountPrice, stock, category, tags, isActive, existingImages } = req.body;

  if (name) {
    product.name = name;
    const baseSlug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)+/g, "");
    let slug = baseSlug;
    let counter = 1;
    while (await Product.exists({ slug, _id: { $ne: product._id } })) {
      slug = `${baseSlug}-${counter}`;
      counter++;
    }
    product.slug = slug;
  }
  if (description) product.description = description;
  if (price !== undefined) product.price = price;
  if (discountPrice !== undefined) product.discountPrice = discountPrice;
  if (stock !== undefined) product.stock = stock;
  if (category) product.category = category;
  if (tags) product.tags = tags;
  if (isActive !== undefined) product.isActive = isActive;

  // Handle images: combine existingImages with newly uploaded files
  const existingImagesArray = existingImages ? (Array.isArray(existingImages) ? existingImages : [existingImages]) : [];
  const newUploadedImages = req.files ? req.files.map((file) => `/uploads/${file.filename}`) : [];
  product.images = [...existingImagesArray, ...newUploadedImages];

  // Ensure at least one image
  if (product.images.length === 0) {
    res.status(400).json({ success: false, message: "กรุณามีรูปสินค้าอย่างน้อย 1 รูป" });
    return;
  }

  await product.save();

  res.json({ success: true, data: product });
});

const deleteProduct = asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.id);
  if (!product) {
    res.status(404).json({ success: false, message: "ไม่พบสินค้า" });
    return;
  }

  if (product.seller.toString() !== req.user.id && !["admin", "owner"].includes(req.user.role)) {
    res.status(403).json({ success: false, message: "คุณไม่มีสิทธิ์ลบสินค้านี้" });
    return;
  }

  await product.deleteOne();
  res.json({ success: true, message: "ลบสินค้าเรียบร้อย" });
});

const getSellerProducts = asyncHandler(async (req, res) => {
  const products = await Product.find({ seller: req.user.id }).sort("-createdAt");
  res.json({ success: true, count: products.length, data: products });
});

module.exports = {
  getProducts,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct,
  getSellerProducts,
};