const asyncHandler = require("express-async-handler");
const Setting = require("../models/Setting");
const { body } = require("express-validator");
const validate = require("../middleware/validate");

const getSettings = asyncHandler(async (req, res) => {
  const { category, public: publicOnly } = req.query;
  const settings = await Setting.getSettings(category, publicOnly === "true");
  res.json({ success: true, data: settings });
});

const getSetting = asyncHandler(async (req, res) => {
  const value = await Setting.getSetting(req.params.key);
  if (value === null) {
    res.status(404).json({ success: false, message: "ไม่พบการตั้งค่า" });
    return;
  }
  res.json({ success: true, data: { key: req.params.key, value } });
});

const updateSetting = asyncHandler(async (req, res) => {
  const { value, description, category, isPublic } = req.body;
  const setting = await Setting.setSetting(
    req.params.key,
    value,
    description,
    category,
    isPublic
  );
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
      Setting.setSetting(s.key, s.value, s.description, s.category, s.isPublic)
    )
  );

  res.json({ success: true, data: results });
});

const initDefaultSettings = asyncHandler(async (req, res) => {
  await Setting.initDefaults();
  res.json({ success: true, message: "สร้างการตั้งค่าเริ่มต้นเรียบร้อย" });
});

module.exports = {
  getSettings,
  getSetting,
  updateSetting,
  bulkUpdateSettings,
  initDefaultSettings,
};