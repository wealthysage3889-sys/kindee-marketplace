import asyncHandler from "express-async-handler";
import * as authService from "../services/authService.js";
import { AppError, ConflictError, NotFoundError } from "../middleware/errorHandler.js";
import { OAuth2Client } from "google-auth-library";
import jwt from "jsonwebtoken";
import { supabaseAdmin } from "../config/supabase.js";

const toBool = (v) => v === true || v === "true" || v === "1";

const getSettingOrEnv = async (key, envKey) => {
  const { data } = await supabaseAdmin
    .from('settings')
    .select('value')
    .eq('key', key)
    .single();
  if (data?.value !== null && data?.value !== undefined && String(data.value).trim() !== "") return String(data.value);
  return process.env[envKey || key] || "";
};

const getGoogleConfig = async () => {
  const [clientId, clientSecret, enabled] = await Promise.all([
    getSettingOrEnv("GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_ID"),
    getSettingOrEnv("GOOGLE_CLIENT_SECRET", "GOOGLE_CLIENT_SECRET"),
    getSettingOrEnv("GOOGLE_ENABLED"),
  ]);
  return { clientId, clientSecret, enabled: toBool(enabled) };
};

const getFacebookConfig = async () => {
  const [appId, appSecret, enabled] = await Promise.all([
    getSettingOrEnv("FACEBOOK_APP_ID", "FACEBOOK_APP_ID"),
    getSettingOrEnv("FACEBOOK_APP_SECRET", "FACEBOOK_APP_SECRET"),
    getSettingOrEnv("FACEBOOK_ENABLED"),
  ]);
  return { appId, appSecret, enabled: toBool(enabled) };
};

const getLineConfig = async () => {
  const [channelId, channelSecret, enabled] = await Promise.all([
    getSettingOrEnv("LINE_CHANNEL_ID", "LINE_CHANNEL_ID"),
    getSettingOrEnv("LINE_CHANNEL_SECRET", "LINE_CHANNEL_SECRET"),
    getSettingOrEnv("LINE_ENABLED"),
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
  const result = await authService.registerUser({ 
    email: isEmail ? identifier.toLowerCase() : undefined,
    phone: isEmail ? undefined : identifier,
    password,
    name,
    role 
  });
  
  const { sendTokenResponse } = await import("../services/authService.js");
  sendTokenResponse(result.user, 201, res);
});

const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const identifier = String(email || "").trim();
  const looksLikeEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier);

  const result = await authService.loginUser(identifier, password);
  
  const { sendTokenResponse } = await import("../services/authService.js");
  sendTokenResponse(result.user, 200, res);
});

const refreshToken = asyncHandler(async (req, res) => {
  const token = req.cookies.token || req.body.refreshToken;
  if (!token) {
    res.status(401).json({ success: false, message: "ไม่พบ refresh token" });
    return;
  }

  try {
    const result = await authService.refreshAccessToken(token);
    
    const { sendTokenResponse } = await import("../services/authService.js");
    sendTokenResponse({ ...result.user, id: result.user.id }, 200, res);
  } catch (error) {
    res.status(401).json({ success: false, message: "refresh token หมดอายุหรือไม่ถูกต้อง" });
  }
});

const getProfile = asyncHandler(async (req, res) => {
  const profile = await authService.getProfile(req.user.id);
  res.json({ success: true, data: profile });
});

const updateProfile = asyncHandler(async (req, res) => {
  const profile = await authService.updateProfile(req.user.id, req.body);
  res.json({ success: true, data: profile });
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
  let payload;
  try {
    const ticket = await client.verifyIdToken({ idToken: credential, audience: clientId });
    payload = ticket.getPayload();
  } catch (err) {
    res.status(400).json({ success: false, message: "Google credential ไม่ถูกต้อง" });
    return;
  }
  const { email, name, picture, sub: googleId } = payload || {};

  if (!email) {
    res.status(400).json({ success: false, message: "ไม่พบอีเมลจากบัญชี Google" });
    return;
  }

  const result = await authService.socialLogin('google', credential);
  
  const { sendTokenResponse } = await import("../services/authService.js");
  sendTokenResponse(result.user, 200, res);
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

  const result = await authService.socialLogin('facebook', accessToken);
  
  const { sendTokenResponse } = await import("../services/authService.js");
  sendTokenResponse(result.user, 200, res);
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
    redirect_uri: redirectUri || `${process.env.CLIENT_URL}/oauth/line/callback`,
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

  const result = await authService.socialLogin('line', { code, redirectUri, channelId, channelSecret });
  
  const { sendTokenResponse } = await import("../services/authService.js");
  sendTokenResponse(result.user, 200, res);
});

export { register, login, refreshToken, getProfile, updateProfile, logout, googleLogin, facebookLogin, lineLogin };