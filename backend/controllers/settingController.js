import asyncHandler from "express-async-handler";
import { supabaseAdmin } from "../config/supabase.js";
import { AppError, NotFoundError } from "../middleware/errorHandler.js";
import { body } from "express-validator";
import validate from "../middleware/validate.js";

const getSettings = asyncHandler(async (req, res) => {
  const { category, public: publicOnly } = req.query;
  
  let query = supabaseAdmin
    .from('settings')
    .select('*')
    .order('key');

  if (publicOnly === "true") {
    query = query.eq('is_public', true);
  }
  if (category) {
    query = query.eq('category', category);
  }

  const { data, error } = await query;

  if (error) {
    throw new AppError(`Failed to fetch settings: ${error.message}`, 500);
  }

  res.json({ success: true, data });
});

const getSetting = asyncHandler(async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('settings')
    .select('value')
    .eq('key', req.params.key)
    .single();

  if (error || !data) {
    res.status(404).json({ success: false, message: "ไม่พบการตั้งค่า" });
    return;
  }

  res.json({ success: true, data: { key: req.params.key, value: data.value } });
});

const updateSetting = asyncHandler(async (req, res) => {
  const { value, description, category, isPublic } = req.body;

  const { data: setting, error } = await supabaseAdmin
    .from('settings')
    .upsert({
      key: req.params.key,
      value,
      description,
      category,
      is_public: isPublic
    }, { onConflict: 'key' })
    .select()
    .single();

  if (error) {
    throw new AppError(`Setting update failed: ${error.message}`, 500);
  }

  res.json({ success: true, data: setting });
});

const bulkUpdateSettings = asyncHandler(async (req, res) => {
  const { settings } = req.body;
  if (!Array.isArray(settings)) {
    res.status(400).json({ success: false, message: "settings ต้องเป็น array" });
    return;
  }

  const results = await Promise.all(
    settings.map((s) =>
      supabaseAdmin
        .from('settings')
        .upsert({
          key: s.key,
          value: s.value,
          description: s.description,
          category: s.category,
          is_public: s.isPublic
        }, { onConflict: 'key' })
        .select()
        .single()
    )
  );

  const errors = results.filter(r => r.error);
  if (errors.length > 0) {
    throw new AppError(`Some settings failed to update: ${errors.map(e => e.error.message).join(', ')}`, 500);
  }

  res.json({ success: true, data: results.map(r => r.data) });
});

const initDefaultSettings = asyncHandler(async (req, res) => {
  const DEFAULT_SETTINGS = [
    {
      key: "GOOGLE_CLIENT_ID",
      value: "",
      description: "Google OAuth Client ID from Google Cloud Console",
      category: "oauth",
      is_public: false,
    },
    {
      key: "GOOGLE_CLIENT_SECRET",
      value: "",
      description: "Google OAuth Client Secret from Google Cloud Console",
      category: "oauth",
      is_public: false,
    },
    {
      key: "GOOGLE_ENABLED",
      value: "false",
      description: "Enable Google login",
      category: "oauth",
      is_public: false,
    },
    {
      key: "FACEBOOK_APP_ID",
      value: "",
      description: "Facebook App ID",
      category: "oauth",
      is_public: false,
    },
    {
      key: "FACEBOOK_APP_SECRET",
      value: "",
      description: "Facebook App Secret",
      category: "oauth",
      is_public: false,
    },
    {
      key: "FACEBOOK_ENABLED",
      value: "false",
      description: "Enable Facebook login",
      category: "oauth",
      is_public: false,
    },
    {
      key: "LINE_CHANNEL_ID",
      value: "",
      description: "LINE Channel ID",
      category: "oauth",
      is_public: false,
    },
    {
      key: "LINE_CHANNEL_SECRET",
      value: "",
      description: "LINE Channel Secret",
      category: "oauth",
      is_public: false,
    },
    {
      key: "LINE_ENABLED",
      value: "false",
      description: "Enable LINE login",
      category: "oauth",
      is_public: false,
    },
  ];

  const results = await Promise.all(
    DEFAULT_SETTINGS.map((setting) =>
      supabaseAdmin
        .from('settings')
        .upsert(setting, { onConflict: 'key', ignoreDuplicates: true })
        .select()
        .single()
    )
  );

  const errors = results.filter(r => r.error);
  if (errors.length > 0) {
    throw new AppError(`Some default settings failed to create: ${errors.map(e => e.error.message).join(', ')}`, 500);
  }

  res.json({ success: true, message: "สร้างการตั้งค่าเริ่มต้นเรียบร้อย" });
});

export { getSettings, getSetting, updateSetting, bulkUpdateSettings, initDefaultSettings };