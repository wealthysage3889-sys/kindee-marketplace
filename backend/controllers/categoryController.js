import asyncHandler from "express-async-handler";
import { supabaseAdmin } from "../config/supabase.js";
import { AppError, NotFoundError } from "../middleware/errorHandler.js";
import { slugify } from "../utils/helpers.js";

const getCategories = asyncHandler(async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('categories')
    .select('*')
    .eq('is_active', true)
    .order('name');

  if (error) {
    throw new AppError(`Failed to fetch categories: ${error.message}`, 500);
  }

  res.json({ success: true, data });
});

const createCategory = asyncHandler(async (req, res) => {
  const { name, description, image } = req.body;
  
  if (!name || !name.trim()) {
    res.status(400).json({ success: false, message: "กรุณาระบุชื่อหมวดหมู่" });
    return;
  }

  const baseSlug = slugify(name);
  let slug = baseSlug;
  let counter = 1;

  while (true) {
    const { data: existing } = await supabaseAdmin
      .from('categories')
      .select('id')
      .eq('slug', slug)
      .single();
    
    if (!existing) break;
    slug = `${baseSlug}-${counter++}`;
  }

  const { data: category, error } = await supabaseAdmin
    .from('categories')
    .insert({
      name: name.trim(),
      slug,
      description: description?.trim(),
      image: image || "",
      is_active: true
    })
    .select()
    .single();

  if (error) {
    throw new AppError(`Category creation failed: ${error.message}`, 500);
  }

  res.status(201).json({ success: true, data: category });
});

const updateCategory = asyncHandler(async (req, res) => {
  const { name, description, image, is_active } = req.body;

  const updates = {};
  if (name) updates.name = name.trim();
  if (description !== undefined) updates.description = description?.trim();
  if (image !== undefined) updates.image = image;
  if (is_active !== undefined) updates.is_active = is_active;

  if (name) {
    const baseSlug = slugify(name);
    let slug = baseSlug;
    let counter = 1;

    while (true) {
      const { data: existing } = await supabaseAdmin
        .from('categories')
        .select('id')
        .eq('slug', slug)
        .neq('id', req.params.id)
        .single();
      
      if (!existing) break;
      slug = `${baseSlug}-${counter++}`;
    }
    updates.slug = slug;
  }

  const { data: category, error } = await supabaseAdmin
    .from('categories')
    .update(updates)
    .eq('id', req.params.id)
    .select()
    .single();

  if (error || !category) {
    res.status(404).json({ success: false, message: "ไม่พบหมวดหมู่" });
    return;
  }

  res.json({ success: true, data: category });
});

const deleteCategory = asyncHandler(async (req, res) => {
  const { error } = await supabaseAdmin
    .from('categories')
    .delete()
    .eq('id', req.params.id);

  if (error) {
    res.status(404).json({ success: false, message: "ไม่พบหมวดหมู่" });
    return;
  }

  res.json({ success: true, message: "ลบหมวดหมู่เรียบร้อย" });
});

export { getCategories, createCategory, updateCategory, deleteCategory };