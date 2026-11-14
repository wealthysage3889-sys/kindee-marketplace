const asyncHandler = require("express-async-handler");
const User = require("../models/User");

const VALID_ROLES = ["customer", "seller", "admin", "owner"];

const getUsers = asyncHandler(async (req, res) => {
  const users = await User.find().select("-password");
  res.json({ success: true, data: users });
});

const getUserById = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id).select("-password");
  if (!user) {
    res.status(404).json({ success: false, message: "ไม่พบผู้ใช้งาน" });
    return;
  }
  res.json({ success: true, data: user });
});

const updateUserRole = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) {
    res.status(404).json({ success: false, message: "ไม่พบผู้ใช้งาน" });
    return;
  }

  if (req.body.role !== undefined && !VALID_ROLES.includes(req.body.role)) {
    res.status(400).json({ success: false, message: "role ไม่ถูกต้อง" });
    return;
  }

  if (req.body.role === "owner" && req.user.role !== "owner") {
    res.status(403).json({ success: false, message: "เฉพาะเจ้าของระบบเท่านั้นที่สามารถมอบสิทธิ์ owner ได้" });
    return;
  }

  if (user.role === "owner" && req.user.role !== "owner") {
    res.status(403).json({ success: false, message: "ไม่มีสิทธิ์จัดการบัญชีเจ้าของระบบ" });
    return;
  }

  user.role = req.body.role || user.role;
  await user.save();

  res.json({ success: true, data: user });
});

const deleteUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) {
    res.status(404).json({ success: false, message: "ไม่พบผู้ใช้งาน" });
    return;
  }

  await user.deleteOne();
  res.json({ success: true, message: "ลบผู้ใช้งานเรียบร้อย" });
});

module.exports = { getUsers, getUserById, updateUserRole, deleteUser };
