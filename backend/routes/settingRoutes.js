const express = require("express");
const { body } = require("express-validator");
const Setting = require("../models/Setting");
const validate = require("../middleware/validate");
const { protect, authorize } = require("../middleware/auth");
const {
  getSettings,
  getSetting,
  updateSetting,
  bulkUpdateSettings,
  initDefaultSettings,
} = require("../controllers/settingController");

const router = express.Router();

// Public endpoint for Google OAuth Client ID (used by frontend Google Sign-In button)
router.get("/public/google-client-id", async (req, res) => {
  try {
    const value = await Setting.getSetting("GOOGLE_CLIENT_ID");
    res.json({ success: true, data: { clientId: value || process.env.GOOGLE_CLIENT_ID || "" } });
  } catch (error) {
    res.json({ success: true, data: { clientId: process.env.GOOGLE_CLIENT_ID || "" } });
  }
});

// Public endpoint for social login config (IDs + enabled flags only, no secrets)
router.get("/public/social-config", async (req, res) => {
  try {
    const keys = [
      "GOOGLE_CLIENT_ID",
      "GOOGLE_ENABLED",
      "FACEBOOK_APP_ID",
      "FACEBOOK_ENABLED",
      "LINE_CHANNEL_ID",
      "LINE_ENABLED",
    ];
    const entries = await Promise.all(keys.map((k) => Setting.getSetting(k)));
    const map = Object.fromEntries(keys.map((k, i) => [k, entries[i]]));
    const toBool = (v) => v === true || v === "true" || v === "1";

    res.json({
      success: true,
      data: {
        google: {
          clientId: map.GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || "",
          enabled: toBool(map.GOOGLE_ENABLED),
        },
        facebook: {
          appId: map.FACEBOOK_APP_ID || process.env.FACEBOOK_APP_ID || "",
          enabled: toBool(map.FACEBOOK_ENABLED),
        },
        line: {
          channelId: map.LINE_CHANNEL_ID || process.env.LINE_CHANNEL_ID || "",
          enabled: toBool(map.LINE_ENABLED),
        },
      },
    });
  } catch (error) {
    res.json({
      success: true,
      data: {
        google: { clientId: process.env.GOOGLE_CLIENT_ID || "", enabled: false },
        facebook: { appId: process.env.FACEBOOK_APP_ID || "", enabled: false },
        line: { channelId: process.env.LINE_CHANNEL_ID || "", enabled: false },
      },
    });
  }
});

router.get("/", protect, authorize("admin", "owner"), getSettings);
router.get("/init", protect, authorize("admin", "owner"), initDefaultSettings);
router.get("/:key", protect, authorize("admin", "owner"), getSetting);
router.put(
  "/:key",
  protect,
  authorize("admin", "owner"),
  [body("value").isString().withMessage("value ต้องเป็น string")],
  validate,
  updateSetting
);
router.post(
  "/bulk",
  protect,
  authorize("admin", "owner"),
  [body("settings").isArray().withMessage("settings ต้องเป็น array")],
  validate,
  bulkUpdateSettings
);

module.exports = router;