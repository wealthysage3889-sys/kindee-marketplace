const Product = require("../models/Product");
const asyncHandler = require("../utils/asyncHandler");

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
  const products = await query.skip(startIndex).limit(limit).sort("-createdAt");

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
  const product = await Product.findById(req.params.id).populate("category seller");
  if (!product) {
    res.status(404).json({ success: false, message: "ไม่พบสินค้า" });
    return;
  }
  res.json({ success: true, data: product });
});

const createProduct = asyncHandler(async (req, res) => {
  req.body.seller = req.user.id;
  const product = await Product.create(req.body);
  res.status(201).json({ success: true, data: product });
});

const updateProduct = asyncHandler(async (req, res) => {
  let product = await Product.findById(req.params.id);
  if (!product) {
    res.status(404).json({ success: false, message: "ไม่พบสินค้า" });
    return;
  }

  if (product.seller.toString() !== req.user.id && !["admin", "owner"].includes(req.user.role)) {
    res
      .status(403)
      .json({ success: false, message: "คุณไม่มีสิทธิ์แก้ไขสินค้านี้" });
    return;
  }

  product = await Product.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
    runValidators: true,
  });

  res.json({ success: true, data: product });
});

const deleteProduct = asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.id);
  if (!product) {
    res.status(404).json({ success: false, message: "ไม่พบสินค้า" });
    return;
  }

  if (product.seller.toString() !== req.user.id && !["admin", "owner"].includes(req.user.role)) {
    res
      .status(403)
      .json({ success: false, message: "คุณไม่มีสิทธิ์ลบสินค้านี้" });
    return;
  }

  await product.deleteOne();
  res.json({ success: true, message: "ลบสินค้าเรียบร้อย" });
});

module.exports = {
  getProducts,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct,
};
