const asyncHandler = require("express-async-handler");
const User = require("../models/User");
const Product = require("../models/Product");
const Order = require("../models/Order");

const VALID_ROLES = ["customer", "seller", "admin", "owner"];

const getAllUsers = asyncHandler(async (req, res) => {
  const users = await User.find().select("-password").sort("-createdAt");
  res.json({ success: true, count: users.length, data: users });
});

const getUserById = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id).select("-password");
  if (!user) {
    res.status(404).json({ success: false, message: "ไม่พบผู้ใช้งาน" });
    return;
  }
  res.json({ success: true, data: user });
});

const createUser = asyncHandler(async (req, res) => {
  const { name, email, password, role = "customer", phone, address } = req.body;

  if (!VALID_ROLES.includes(role)) {
    res.status(400).json({ success: false, message: "role ไม่ถูกต้อง" });
    return;
  }

  if (role === "owner" && req.user.role !== "owner") {
    res.status(403).json({ success: false, message: "เฉพาะเจ้าของระบบเท่านั้นที่สามารถมอบสิทธิ์ owner ได้" });
    return;
  }

  const exists = await User.exists({ email });
  if (exists) {
    res.status(400).json({ success: false, message: "อีเมลนี้มีอยู่แล้วในระบบ" });
    return;
  }
  const user = await User.create({ name, email, password, role, phone, address });
  const safeUser = user.toObject();
  delete safeUser.password;
  res.status(201).json({ success: true, data: safeUser });
});

const updateUserRole = asyncHandler(async (req, res) => {
  const { role } = req.body;
  if (!VALID_ROLES.includes(role)) {
    res.status(400).json({ success: false, message: "role ไม่ถูกต้อง" });
    return;
  }

  if (role === "owner" && req.user.role !== "owner") {
    res.status(403).json({ success: false, message: "เฉพาะเจ้าของระบบเท่านั้นที่สามารถมอบสิทธิ์ owner ได้" });
    return;
  }

  const targetUser = await User.findById(req.params.id);
  if (!targetUser) {
    res.status(404).json({ success: false, message: "ไม่พบผู้ใช้งาน" });
    return;
  }

  if (targetUser.role === "owner" && req.user.role !== "owner") {
    res.status(403).json({ success: false, message: "ไม่มีสิทธิ์จัดการบัญชีเจ้าของระบบ" });
    return;
  }

  const user = await User.findByIdAndUpdate(
    req.params.id,
    { role },
    { new: true, runValidators: true }
  ).select("-password");
  res.json({ success: true, data: user });
});

const deleteUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) {
    res.status(404).json({ success: false, message: "ไม่พบผู้ใช้งาน" });
    return;
  }

  if (user.role === "owner" && req.user.role !== "owner") {
    res.status(403).json({ success: false, message: "ไม่มีสิทธิ์ลบบัญชีเจ้าของระบบ" });
    return;
  }

  if (user._id.toString() === req.user.id) {
    res.status(400).json({ success: false, message: "ไม่สามารถลบบัญชีของตนเองได้" });
    return;
  }

  await user.deleteOne();
  res.json({ success: true, message: "ลบผู้ใช้งานเรียบร้อย" });
});

const getDashboardStats = asyncHandler(async (req, res) => {
  const [users, products, orders] = await Promise.all([
    User.countDocuments(),
    Product.countDocuments(),
    Order.countDocuments().catch(() => 0),
  ]);
  res.json({ success: true, data: { users, products, orders } });
});

const getAllProducts = asyncHandler(async (req, res) => {
  const products = await Product.find()
    .populate("seller", "name email")
    .populate("category", "name slug")
    .sort("-createdAt");
  res.json({ success: true, count: products.length, data: products });
});

const getProductById = asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.id)
    .populate("seller", "name email")
    .populate("category", "name slug");
  if (!product) {
    res.status(404).json({ success: false, message: "ไม่พบสินค้า" });
    return;
  }
  res.json({ success: true, data: product });
});

const createProduct = asyncHandler(async (req, res) => {
  const product = await Product.create({ ...req.body, seller: req.user.id });
  res.status(201).json({ success: true, data: product });
});

const updateProduct = asyncHandler(async (req, res) => {
  const product = await Product.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
    runValidators: true,
  });
  if (!product) {
    res.status(404).json({ success: false, message: "ไม่พบสินค้า" });
    return;
  }
  res.json({ success: true, data: product });
});

const deleteProduct = asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.id);
  if (!product) {
    res.status(404).json({ success: false, message: "ไม่พบสินค้า" });
    return;
  }
  await product.deleteOne();
  res.json({ success: true, message: "ลบสินค้าเรียบร้อย" });
});

const getReports = asyncHandler(async (req, res) => {
  const [users, products, orders] = await Promise.all([
    User.countDocuments(),
    Product.countDocuments(),
    Order.countDocuments().catch(() => 0),
  ]);
  res.json({ success: true, data: { users, products, orders } });
});

const uploadProductImages = asyncHandler(async (req, res) => {
  if (!req.files || req.files.length === 0) {
    res.status(400).json({ success: false, message: "กรุณาอัป加载รูปภาพสินค้าอย่างน้อย 1 รูป" });
    return;
  }

  const images = req.files.map((file) => `/uploads/${file.filename}`);
  res.json({ success: true, data: images });
});

module.exports = {
  getDashboardStats,
  getAllUsers,
  getUserById,
  createUser,
  updateUserRole,
  deleteUser,
  getAllProducts,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct,
  getReports,
  uploadProductImages,
};