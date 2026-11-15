import asyncHandler from "express-async-handler";
import * as authService from "../services/authService.js";
import { AppError, NotFoundError } from "../middleware/errorHandler.js";
import { supabaseAdmin } from "../config/supabase.js";

const VALID_ROLES = ["customer", "seller", "admin", "owner", "courier"];

const getUsers = asyncHandler(async (req, res) => {
  const { role, is_active, search, page = 1, limit = 20 } = req.query;
  
  const result = await authService.getAllUsers(
    { role, is_active: is_active === 'true' ? true : is_active === 'false' ? false : undefined, search },
    { page: parseInt(page), limit: parseInt(limit) }
  );
  
  res.json({ success: true, data: result });
});

const getUserById = asyncHandler(async (req, res) => {
  const profile = await authService.getProfile(req.params.id);
  if (!profile) {
    res.status(404).json({ success: false, message: "ไม่พบผู้ใช้งาน" });
    return;
  }
  res.json({ success: true, data: profile });
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
  const user = await authService.getProfile(req.params.id);
  if (!user) {
    res.status(404).json({ success: false, message: "ไม่พบผู้ใช้งาน" });
    return;
  }

  if (user.role === "owner" && req.user.role !== "owner") {
    res.status(403).json({ success: false, message: "ไม่มีสิทธิ์ลบบัญชีเจ้าของระบบ" });
    return;
  }

  if (user.id === req.user.id) {
    res.status(400).json({ success: false, message: "ไม่สามารถลบบัญชีของตนเองได้" });
    return;
  }

  await authService.deactivateAccount(req.params.id);
  res.json({ success: true, message: "ลบผู้ใช้งานเรียบร้อย" });
});

export { getUsers, getUserById, updateUserRole, deleteUser };