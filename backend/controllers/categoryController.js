const asyncHandler = require("express-async-handler");
const Category = require("../models/Category");

const getCategories = asyncHandler(async (req, res) => {
  const categories = await Category.find({ isActive: true });
  res.json({ success: true, data: categories });
});

const createCategory = asyncHandler(async (req, res) => {
  const category = await Category.create(req.body);
  res.status(201).json({ success: true, data: category });
});

const updateCategory = asyncHandler(async (req, res) => {
  const category = await Category.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
    runValidators: true,
  });
  if (!category) {
    res.status(404).json({ success: false, message: "ไม่พบหมวดหมู่" });
    return;
  }
  res.json({ success: true, data: category });
});

const deleteCategory = asyncHandler(async (req, res) => {
  const category = await Category.findById(req.params.id);
  if (!category) {
    res.status(404).json({ success: false, message: "ไม่พบหมวดหมู่" });
    return;
  }
  await category.deleteOne();
  res.json({ success: true, message: "ลบหมวดหมู่เรียบร้อย" });
});

module.exports = {
  getCategories,
  createCategory,
  updateCategory,
  deleteCategory,
};
