const asyncHandler = require("express-async-handler");
const User = require("../models/User");
const Setting = require("../models/Setting");
const { sendTokenResponse } = require("../services/authService");
const { OAuth2Client } = require("google-auth-library");
const jwt = require("jsonwebtoken");

const toBool = (v) => v === true || v === "true" || v === "1";

const getSettingOrEnv = async (key, envKey) => {
  const val = await Setting.getSetting(key);
  if (val !== null && val !== undefined && String(val).trim() !== "") return String(val);
  return process.env[envKey || key] || "";
};

const getGoogleConfig = async () => {
  const [clientId, clientSecret, enabled] = await Promise.all([
    getSettingOrEnv("GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_ID"),
    getSettingOrEnv("GOOGLE_CLIENT_SECRET", "GOOGLE_CLIENT_SECRET"),
    Setting.getSetting("GOOGLE_ENABLED"),
  ]);
  return { clientId, clientSecret, enabled: toBool(enabled) };
};

const getFacebookConfig = async () => {
  const [appId, appSecret, enabled] = await Promise.all([
    getSettingOrEnv("FACEBOOK_APP_ID", "FACEBOOK_APP_ID"),
    getSettingOrEnv("FACEBOOK_APP_SECRET", "FACEBOOK_APP_SECRET"),
    Setting.getSetting("FACEBOOK_ENABLED"),
  ]);
  return { appId, appSecret, enabled: toBool(enabled) };
};

const getLineConfig = async () => {
  const [channelId, channelSecret, enabled] = await Promise.all([
    getSettingOrEnv("LINE_CHANNEL_ID", "LINE_CHANNEL_ID"),
    getSettingOrEnv("LINE_CHANNEL_SECRET", "LINE_CHANNEL_SECRET"),
    Setting.getSetting("LINE_ENABLED"),
  ]);
  return { channelId, channelSecret, enabled: toBool(enabled) };
};

const register = asyncHandler(async (req, res) => {
  const { name, email, password, phone, address, role, emailOrPhone } = req.body;

  const identifier = String(emailOrPhone || email || phone || "").trim();
  if (!identifier) {
    res.status(400).json({ success: false, message: "กรุณาระบุอีเมลหรือเบอร์โทรศัพท์" });
    return;
  }

  const isEmail = identifier.includes("@");
  const lookups = isEmail ? [{ email: identifier.toLowerCase() }] : [{ phone: identifier }];

  const userExists = await User.findOne({ $or: lookups });
  if (userExists) {
    res.status(400).json({ success: false, message: "บัญชีนี้มีผู้ใช้งานแล้ว" });
    return;
  }

  const allowedRoles = ["customer", "seller"];
  const safeRole = allowedRoles.includes(role) ? role : "customer";
  const finalPassword = password || Math.random().toString(36).slice(-12);

  const userData = {
    name: name || "",
    password: finalPassword,
    role: safeRole,
  };

  if (isEmail) {
    userData.email = identifier.toLowerCase();
  } else {
    userData.phone = identifier;
  }

  if (address) userData.address = address;

  const user = await User.create(userData);
  sendTokenResponse(user, 201, res);
});

const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const identifier = String(email || "").trim();
  const looksLikeEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier);

  const user = await User.findOne(
    looksLikeEmail ? { email: identifier.toLowerCase() } : { phone: identifier }
  ).select("+password");

  if (!user || !(await user.matchPassword(password))) {
    res.status(401).json({ success: false, message: "เบอร์โทรศัพท์/อีเมล หรือรหัสผ่านไม่ถูกต้อง" });
    return;
  }

  if (!user.isActive) {
    res.status(403).json({ success: false, message: "บัญชีถูกระงับการใช้งาน" });
    return;
  }

  sendTokenResponse(user, 200, res);
});

const refreshToken = asyncHandler(async (req, res) => {
  const token = req.cookies.token || req.body.refreshToken;
  if (!token) {
    res.status(401).json({ success: false, message: "ไม่พบ refresh token" });
    return;
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).select("-password");
    if (!user || !user.isActive) {
      res.status(401).json({ success: false, message: "ผู้ใช้งานไม่ถูกต้องหรือถูกระงับ" });
      return;
    }
    sendTokenResponse(user, 200, res);
  } catch (error) {
    res.status(401).json({ success: false, message: "refresh token หมดอายุหรือไม่ถูกต้อง" });
  }
});

const getProfile = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user.id);
  res.json({ success: true, data: user });
});

const updateProfile = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user.id);

  if (!user) {
    res.status(404).json({ success: false, message: "ไม่พบผู้ใช้งาน" });
    return;
  }

  user.name = req.body.name || user.name;
  user.email = req.body.email || user.email;
  user.phone = req.body.phone || user.phone;
  user.address = req.body.address || user.address;
  user.avatar = req.body.avatar || user.avatar;

  if (req.body.password) {
    user.password = req.body.password;
  }

  await user.save();

  res.json({ success: true, data: user });
});

const logout = asyncHandler(async (req, res) => {
  res.cookie("token", "", { expires: new Date(Date.now()), httpOnly: true });
  res.json({ success: true, message: "ออกจากระบบเรียบร้อย" });
});

const googleLogin = asyncHandler(async (req, res) => {
  const { credential } = req.body;
  if (!credential) {
    res.status(400).json({ success: false, message: "กรุณาระบุ Google credential" });
    return;
  }

  const { clientId, enabled } = await getGoogleConfig();
  if (!enabled || !clientId) {
    res.status(403).json({ success: false, message: "การเข้าสู่ระบบด้วย Google ถูกปิดใช้งาน" });
    return;
  }

  const client = new OAuth2Client(clientId);
  const ticket = await client.verifyIdToken({ idToken: credential, audience: clientId });
  const payload = ticket.getPayload();
  const { email, name, picture, sub: googleId } = payload || {};

  if (!email) {
    res.status(400).json({ success: false, message: "ไม่พบอีเมลจากบัญชี Google" });
    return;
  }

  let user = await User.findOne({ $or: [{ googleId }, { email: email.toLowerCase() }] });
  if (!user) {
    user = await User.create({
      name: name || "",
      email: email.toLowerCase(),
      role: "customer",
      password: Math.random().toString(36).slice(-12),
      googleId,
      avatar: picture || "",
    });
  } else {
    if (!user.googleId) user.googleId = googleId;
    if (!user.avatar && picture) user.avatar = picture;
    if (!user.name && name) user.name = name;
    if (!user.isActive) {
      res.status(403).json({ success: false, message: "บัญชีถูกระงับการใช้งาน" });
      return;
    }
    await user.save();
  }

  sendTokenResponse(user, 200, res);
});

const facebookLogin = asyncHandler(async (req, res) => {
  const { accessToken } = req.body;
  if (!accessToken) {
    res.status(400).json({ success: false, message: "กรุณาระบุ Facebook access token" });
    return;
  }

  const { appId, appSecret, enabled } = await getFacebookConfig();
  if (!enabled || !appId || !appSecret) {
    res.status(403).json({ success: false, message: "การเข้าสู่ระบบด้วย Facebook ถูกปิดใช้งาน" });
    return;
  }

  const debugRes = await fetch(
    `https://graph.facebook.com/debug_token?input_token=${encodeURIComponent(accessToken)}&access_token=${encodeURIComponent(appId + "|" + appSecret)}`
  );
  const debugData = await debugRes.json();
  if (!debugData?.data?.is_valid || debugData.data.app_id !== appId) {
    res.status(401).json({ success: false, message: "Facebook token ไม่ถูกต้อง" });
    return;
  }

  const meRes = await fetch(
    `https://graph.facebook.com/me?fields=id,name,email,picture.type(large)&access_token=${encodeURIComponent(accessToken)}`
  );
  const profile = await meRes.json();
  if (!profile?.id) {
    res.status(400).json({ success: false, message: "ไม่สามารถดึงข้อมูล Facebook ได้" });
    return;
  }

  const facebookId = profile.id;
  const email = profile.email ? profile.email.toLowerCase() : null;
  const name = profile.name || "";
  const avatar = profile.picture?.data?.url || "";

  let user = await User.findOne(email ? { $or: [{ facebookId }, { email }] } : { facebookId });
  if (!user) {
    user = await User.create({
      name,
      email: email || undefined,
      role: "customer",
      password: Math.random().toString(36).slice(-12),
      facebookId,
      avatar,
    });
  } else {
    if (!user.facebookId) user.facebookId = facebookId;
    if (!user.avatar && avatar) user.avatar = avatar;
    if (!user.name && name) user.name = name;
    if (!user.isActive) {
      res.status(403).json({ success: false, message: "บัญชีถูกระงับการใช้งาน" });
      return;
    }
    await user.save();
  }

  sendTokenResponse(user, 200, res);
});

const lineLogin = asyncHandler(async (req, res) => {
  const { code, redirectUri } = req.body;
  if (!code) {
    res.status(400).json({ success: false, message: "กรุณาระบุ LINE authorization code" });
    return;
  }

  const { channelId, channelSecret, enabled } = await getLineConfig();
  if (!enabled || !channelId || !channelSecret) {
    res.status(403).json({ success: false, message: "การเข้าสู่ระบบด้วย LINE ถูกปิดใช้งาน" });
    return;
  }

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri || `${process.env.CLIENT_URL || "http://localhost:3000"}/login`,
    client_id: channelId,
    client_secret: channelSecret,
  });

  const tokenRes = await fetch("https://api.line.me/oauth2/v2.1/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const tokenData = await tokenRes.json();
  if (!tokenRes.ok || !tokenData.access_token) {
    res.status(401).json({ success: false, message: tokenData.error_description || "LINE login ไม่สำเร็จ" });
    return;
  }

  let lineId, name, avatar, email;
  if (tokenData.id_token) {
    const verifyBody = new URLSearchParams({ id_token: tokenData.id_token, client_id: channelId });
    const verifyRes = await fetch("https://api.line.me/oauth2/v2.1/verify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: verifyBody,
    });
    const verify = await verifyRes.json();
    if (verifyRes.ok) {
      lineId = verify.sub;
      name = verify.name || "";
      avatar = verify.picture || "";
      email = verify.email ? verify.email.toLowerCase() : null;
    }
  }
  if (!lineId) {
    const profRes = await fetch("https://api.line.me/v2/profile", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const profile = await profRes.json();
    lineId = profile.userId;
    name = profile.displayName || "";
    avatar = profile.pictureUrl || "";
  }

  if (!lineId) {
    res.status(400).json({ success: false, message: "ไม่สามารถดึงข้อมูล LINE ได้" });
    return;
  }

  let user = await User.findOne(email ? { $or: [{ lineId }, { email }] } : { lineId });
  if (!user) {
    user = await User.create({
      name,
      email: email || undefined,
      role: "customer",
      password: Math.random().toString(36).slice(-12),
      lineId,
      avatar,
    });
  } else {
    if (!user.lineId) user.lineId = lineId;
    if (!user.avatar && avatar) user.avatar = avatar;
    if (!user.name && name) user.name = name;
    if (!user.isActive) {
      res.status(403).json({ success: false, message: "บัญชีถูกระงับการใช้งาน" });
      return;
    }
    await user.save();
  }

  sendTokenResponse(user, 200, res);
});

module.exports = { register, login, refreshToken, getProfile, updateProfile, logout, googleLogin, facebookLogin, lineLogin };