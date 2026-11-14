const mongoose = require("mongoose");

const settingSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    value: {
      type: String,
      default: "",
    },
    description: {
      type: String,
      trim: true,
    },
    category: {
      type: String,
      default: "general",
      enum: ["general", "oauth", "email", "payment", "notification"],
    },
    isPublic: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

settingSchema.index({ category: 1 });

const DEFAULT_SETTINGS = [
  {
    key: "GOOGLE_CLIENT_ID",
    value: "",
    description: "Google OAuth Client ID from Google Cloud Console",
    category: "oauth",
    isPublic: false,
  },
  {
    key: "GOOGLE_CLIENT_SECRET",
    value: "",
    description: "Google OAuth Client Secret from Google Cloud Console",
    category: "oauth",
    isPublic: false,
  },
  {
    key: "GOOGLE_ENABLED",
    value: "false",
    description: "Enable Google login",
    category: "oauth",
    isPublic: false,
  },
  {
    key: "FACEBOOK_APP_ID",
    value: "",
    description: "Facebook App ID",
    category: "oauth",
    isPublic: false,
  },
  {
    key: "FACEBOOK_APP_SECRET",
    value: "",
    description: "Facebook App Secret",
    category: "oauth",
    isPublic: false,
  },
  {
    key: "FACEBOOK_ENABLED",
    value: "false",
    description: "Enable Facebook login",
    category: "oauth",
    isPublic: false,
  },
  {
    key: "LINE_CHANNEL_ID",
    value: "",
    description: "LINE Channel ID",
    category: "oauth",
    isPublic: false,
  },
  {
    key: "LINE_CHANNEL_SECRET",
    value: "",
    description: "LINE Channel Secret",
    category: "oauth",
    isPublic: false,
  },
  {
    key: "LINE_ENABLED",
    value: "false",
    description: "Enable LINE login",
    category: "oauth",
    isPublic: false,
  },
];

settingSchema.statics.getSettings = async function (category = null, publicOnly = false) {
  const query = publicOnly ? { isPublic: true } : {};
  if (category) query.category = category;
  return this.find(query).sort("key");
};

settingSchema.statics.getSetting = async function (key) {
  const setting = await this.findOne({ key });
  return setting ? setting.value : null;
};

settingSchema.statics.setSetting = async function (key, value, description = "", category = "general", isPublic = false) {
  const setting = await this.findOneAndUpdate(
    { key },
    { value, description, category, isPublic },
    { new: true, upsert: true, runValidators: true }
  );
  return setting;
};

settingSchema.statics.initDefaults = async function () {
  for (const setting of DEFAULT_SETTINGS) {
    await this.findOneAndUpdate(
      { key: setting.key },
      { $setOnInsert: setting },
      { upsert: true }
    );
  }
};

module.exports = mongoose.model("Setting", settingSchema);