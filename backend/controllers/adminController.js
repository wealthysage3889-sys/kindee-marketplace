import asyncHandler from "express-async-handler";
import * as authService from "../services/authService.js";
import * as productService from "../services/productService.js";
import * as orderService from "../services/orderService.js";
import * as storeService from "../services/storeService.js";
import { AppError, NotFoundError, ValidationError } from "../middleware/errorHandler.js";
import { supabaseAdmin } from "../config/supabase.js";

const VALID_ROLES = ["customer", "seller", "admin", "owner", "courier"];

const getAllUsers = asyncHandler(async (req, res) => {
  const { role, is_active, search } = req.query;

  const result = await authService.getAllUsers(
    { role, is_active: is_active === 'true' ? true : is_active === 'false' ? false : undefined, search }
  );

  res.json({ success: true, count: result.users.length, data: result });
});

const getUserById = asyncHandler(async (req, res) => {
  const user = await authService.getProfile(req.params.id);
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

  const result = await authService.registerUser({ email, password, name, role, phone, address });
  const safeUser = { ...result.user };
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

  const targetUser = await authService.getProfile(req.params.id);
  if (!targetUser) {
    res.status(404).json({ success: false, message: "ไม่พบผู้ใช้งาน" });
    return;
  }

  if (targetUser.role === "owner" && req.user.role !== "owner") {
    res.status(403).json({ success: false, message: "ไม่มีสิทธิ์จัดการบัญชีเจ้าของระบบ" });
    return;
  }

  const user = await authService.updateUserRole(req.params.id, role, req.user.id);
  res.json({ success: true, data: user });
});

const deleteUser = asyncHandler(async (req, res) => {
  const result = await authService.adminDeleteUserAccount(req.params.id, req.user.id, req.user.role);

  if (result.action === 'deleted') {
    return res.json({
      success: true,
      message: "ลบบัญชีผู้ใช้งานออกจากระบบเรียบร้อยแล้ว (ลบจาก Supabase Auth และโปรไฟล์ เนื่องจากไม่มีประวัติธุรกรรมที่ต้องรักษา)",
      data: result
    });
  }

  return res.json({
    success: true,
    message: result.reason || "ไม่สามารถลบถาวรได้เนื่องจากมีข้อมูลธุรกิจที่ต้องรักษา ระบบจึงปิดใช้งานและจัดการข้อมูลส่วนบุคคลแทน (ไม่ลบคำสั่งซื้อ/ข้อความ/ประวัติธุรกรรม)",
    data: result
  });
});

const getDashboardStats = asyncHandler(async (req, res) => {
  const [{ count: users }, { count: products }, { count: orders }] = await Promise.all([
    supabaseAdmin.from('profiles').select('*', { count: 'exact', head: true }),
    supabaseAdmin.from('products').select('*', { count: 'exact', head: true }),
    supabaseAdmin.from('orders').select('*', { count: 'exact', head: true }).catch(() => ({ count: 0 })),
  ]);
  
  res.json({ success: true, data: { users: users || 0, products: products || 0, orders: orders || 0 } });
});

const getAllProducts = asyncHandler(async (req, res) => {
  const result = await productService.getAllProducts({}, { page: 1, limit: 100 });
  res.json({ success: true, count: result.products.length, data: result.products });
});

const getProductById = asyncHandler(async (req, res) => {
  const product = await productService.getProductById(req.params.id, true);
  if (!product) {
    res.status(404).json({ success: false, message: "ไม่พบสินค้า" });
    return;
  }
  res.json({ success: true, data: product });
});

const createProduct = asyncHandler(async (req, res) => {
  const store = await storeService.getStoresByOwner(req.user.id);
  const storeId = store[0]?.id;
  
  if (!storeId) {
    res.status(400).json({ success: false, message: "คุณยังไม่มีร้านค้า กรุณาสร้างร้านค้าก่อน" });
    return;
  }

  const product = await productService.createProduct(storeId, req.user.id, req.body);
  res.status(201).json({ success: true, data: product });
});

const updateProduct = asyncHandler(async (req, res) => {
  const store = await storeService.getStoresByOwner(req.user.id);
  const storeId = store[0]?.id;
  
  if (!storeId) {
    res.status(400).json({ success: false, message: "คุณยังไม่มีร้านค้า" });
    return;
  }

  const product = await productService.updateProduct(req.params.id, storeId, req.user.id, req.body);
  if (!product) {
    res.status(404).json({ success: false, message: "ไม่พบสินค้า" });
    return;
  }
  res.json({ success: true, data: product });
});

const deleteProduct = asyncHandler(async (req, res) => {
  const store = await storeService.getStoresByOwner(req.user.id);
  const storeId = store[0]?.id;
  
  if (!storeId) {
    res.status(400).json({ success: false, message: "คุณยังไม่มีร้านค้า" });
    return;
  }

  await productService.deleteProduct(req.params.id, storeId, req.user.id);
  res.json({ success: true, message: "ลบสินค้าเรียบร้อย" });
});

const getReports = asyncHandler(async (req, res) => {
  const [{ count: users }, { count: products }, { count: orders }] = await Promise.all([
    supabaseAdmin.from('profiles').select('*', { count: 'exact', head: true }),
    supabaseAdmin.from('products').select('*', { count: 'exact', head: true }),
    supabaseAdmin.from('orders').select('*', { count: 'exact', head: true }).catch(() => ({ count: 0 })),
  ]);
  
  res.json({ success: true, data: { users: users || 0, products: products || 0, orders: orders || 0 } });
});

const uploadProductImages = asyncHandler(async (req, res) => {
  if (!req.files || req.files.length === 0) {
    res.status(400).json({ success: false, message: "กรุณาอัปโหลดรูปภาพสินค้าอย่างน้อย 1 รูป" });
    return;
  }

  const images = req.files.map((file) => `/uploads/${file.filename}`);
  res.json({ success: true, data: images });
});

export {
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