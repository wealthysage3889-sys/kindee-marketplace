import { supabase, supabaseAdmin } from '../config/supabase.js';
import { generateToken, generateRefreshToken, verifyRefreshToken } from '../middleware/auth.js';
import { AppError, NotFoundError, ConflictError } from '../middleware/errorHandler.js';
import { randomBytes } from 'node:crypto';
import { toE164ThaiPhone } from '../utils/phone.js';

// ---------------------------------------------------------------------------
// Supabase session helpers
//
// Supabase Auth is the single source of truth for sessions. Every login path
// returns a Supabase access_token + refresh_token. The legacy custom JWT
// helpers (generateToken/generateRefreshToken/verifyRefreshToken) are kept ONLY
// as a transition fallback for accounts that have not been migrated yet, and
// are never used to mint tokens for a successful Supabase sign-in.
// ---------------------------------------------------------------------------

// Reduce a full Supabase session to the API contract the frontend expects.
const toSessionResult = (profile, session) => ({
  user: profile,
  accessToken: session?.access_token,
  refreshToken: session?.refresh_token
});

// Sign in with email/password through the anon client and return the Supabase
// session. Throws AppError(401) on invalid credentials. Accepts either an email
// or a phone identifier (Supabase signInWithPassword supports both).
const signInWithPassword = async ({ email, phone }, password) => {
  const identifier = email ? { email } : { phone };
  const { data, error } = await supabase.auth.signInWithPassword({ ...identifier, password });
  if (error || !data?.session) {
    throw new AppError('Invalid credentials', 401);
  }
  return data.session;
};

// Fetch the profile row for an auth user id (throws NotFoundError if missing).
const fetchProfile = async (userId) => {
  const { data: profile, error } = await supabaseAdmin
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();

  if (error || !profile) {
    throw new NotFoundError('User');
  }
  return profile;
};

// Register new user
export const registerUser = async (userData) => {
  const { email, phone, password, name, role = 'customer' } = userData;

  // Validate role
  if (!['customer', 'seller'].includes(role)) {
    throw new AppError('Invalid role. Must be customer or seller', 400);
  }

  // Convert phone to E.164 format for Supabase Auth (if provided)
  const phoneE164 = phone ? toE164ThaiPhone(phone) : null;
  if (phone && !phoneE164) {
    throw new AppError('Invalid phone number format. Use Thai format (0812345678) or E.164 (+66812345678)', 400);
  }

  // Check if user exists (use E.164 for phone comparison if available)
  const phoneForCheck = phoneE164 || phone;
  
  // Check email separately
  if (email) {
    const { data: existingEmail, error: emailError } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('email', email)
      .maybeSingle();
    
    // PGRST116 = no rows found (expected for maybeSingle), treat as no user
    if (emailError && emailError.code !== 'PGRST116') {
      throw new AppError(`Email lookup failed: ${emailError.message}`, 500);
    }
    if (existingEmail) {
      throw new ConflictError('Email already registered');
    }
  }
  
  // Check phone separately
  if (phoneForCheck) {
    const { data: existingPhone, error: phoneError } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('phone', phoneForCheck)
      .maybeSingle();
    
    // PGRST116 = no rows found (expected for maybeSingle), treat as no user
    if (phoneError && phoneError.code !== 'PGRST116') {
      throw new AppError(`Phone lookup failed: ${phoneError.message}`, 500);
    }
    if (existingPhone) {
      throw new ConflictError('Phone number already registered');
    }
  }

  // Create auth user with E.164 phone format
  const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
    email,
    phone: phoneE164,
    password,
    email_confirm: true,
    user_metadata: { name, role }
  });

  if (authError) {
    throw new AppError(`Auth creation failed: ${authError.message}`, 500);
  }

  // Create profile with E.164 phone format
  const { data: profile, error: profileError } = await supabaseAdmin
    .from('profiles')
    .insert({
      id: authData.user.id,
      email,
      phone: phoneE164,
      name,
      role,
      is_active: true
    })
    .select()
    .single();

  if (profileError) {
    // Cleanup auth user on profile creation failure
    await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
    throw new AppError(`Profile creation failed: ${profileError.message}`, 500);
  }

  // Register with phone-only account: Supabase signInWithPassword accepts a
  // phone identifier too, so both email and phone registration obtain a real
  // Supabase session the same way.
  const session = await signInWithPassword({ email, phone: phoneE164 }, password);

  return toSessionResult(profile, session);
};

// Login user
export const loginUser = async (emailOrPhone, password) => {
  if (!supabase) {
    throw new AppError('SUPABASE_ANON_KEY is not configured', 500);
  }

  // Convert input to E.164 if it's a Thai phone number for consistent lookup
  const lookupPhone = toE164ThaiPhone(emailOrPhone);
  const emailOrPhoneForLookup = lookupPhone || emailOrPhone;

  // Find user by email or phone (try both original and E.164 format for phone)
  const { data: profile, error } = await supabaseAdmin
    .from('profiles')
    .select('*')
    .or(`email.eq.${emailOrPhoneForLookup},phone.eq.${emailOrPhoneForLookup}`)
    .single();

  if (error || !profile) {
    throw new AppError('Invalid credentials', 401);
  }

  if (!profile.is_active) {
    throw new AppError('Account is deactivated', 403);
  }

  // Verify the password and obtain a Supabase session. Supabase
  // signInWithPassword accepts either an email or a phone identifier.
  // Use E.164 format for phone (already stored in profile)
  const session = await signInWithPassword({ email: profile.email, phone: profile.phone }, password);

  return toSessionResult(profile, session);
};

// Social login (Google, Facebook, LINE)
//
// Every successful social login returns a Supabase session (access + refresh).
//   - Google:   verified by Supabase signInWithIdToken (OIDC ID token).
//   - Facebook: verified server-side via Graph API debug_token + /me, because
//               the FB JS SDK yields a Graph API access token, not an OIDC ID
//               token, which Supabase signInWithIdToken cannot consume.
//   - LINE:     handled separately in lineLogin() (custom server-side flow).
export const socialLogin = async (provider, credential) => {
  if (!supabase) {
    throw new AppError('SUPABASE_ANON_KEY is not configured', 500);
  }

  let authData;

  switch (provider) {
    case 'google': {
      const { data, error } = await supabase.auth.signInWithIdToken({
        provider: 'google',
        token: credential
      });
      if (error) throw new AppError(`Google login failed: ${error.message}`, 401);
      if (!data?.session || !data?.user) throw new AppError('Google login failed', 401);
      authData = data;
      break;
    }

    case 'facebook': {
      // Facebook JS SDK returns a Graph API access token. Verify it server-side
      // and resolve the profile, then create/find the Supabase user manually.
      const fbProfile = await verifyFacebookAccessToken(credential);
      authData = await resolveSocialUser({
        provider: 'facebook',
        providerId: fbProfile.id,
        email: fbProfile.email || null,
        name: fbProfile.name || 'Facebook User',
        avatarUrl: fbProfile.picture || null
      });
      break;
    }

    case 'line':
      // LINE requires the custom authorization-code flow (see lineLogin()).
      throw new AppError('LINE login must use the /auth/line endpoint', 400);

    default:
      throw new AppError('Invalid provider', 400);
  }

  if (!authData?.user) {
    throw new AppError('Social login failed', 401);
  }

  const profile = await fetchProfile(authData.user.id);

  if (!profile.is_active) {
    throw new AppError('Account is deactivated', 403);
  }

  // signInWithIdToken returns the session directly; the server-resolved
  // Facebook path carries the session on authData.session.
  return toSessionResult(profile, authData.session);
};

// Verify a Facebook Graph API access token via debug_token, then load /me.
// Returns { id, name, email, picture }.
const verifyFacebookAccessToken = async (accessToken) => {
  const appId = process.env.FACEBOOK_APP_ID;
  const appSecret = process.env.FACEBOOK_APP_SECRET;

  if (!appId || !appSecret) {
    throw new AppError('Facebook login is not configured', 403);
  }

  const debugRes = await fetch(
    `https://graph.facebook.com/debug_token?input_token=${encodeURIComponent(accessToken)}&access_token=${encodeURIComponent(appId + '|' + appSecret)}`
  );
  const debugData = await debugRes.json();
  if (!debugData?.data?.is_valid || String(debugData.data.app_id) !== String(appId)) {
    throw new AppError('Facebook token ไม่ถูกต้อง', 401);
  }

  const meRes = await fetch(
    `https://graph.facebook.com/me?fields=id,name,email,picture.type(large)&access_token=${encodeURIComponent(accessToken)}`
  );
  const me = await meRes.json();
  if (!me?.id) {
    throw new AppError('ไม่สามารถดึงข้อมูล Facebook ได้', 400);
  }

  return {
    id: String(me.id),
    name: me.name,
    email: me.email ? String(me.email).toLowerCase() : null,
    picture: me.picture?.data?.url || null
  };
};

// Resolve (find-or-create) a Supabase auth user + profile for a social identity
// that is NOT a built-in Supabase provider (Facebook via Graph API, LINE).
// Returns { user, session } where session is a real Supabase session.
// Duplicate email on a DIFFERENT account is rejected (no auto-link).
export const resolveSocialUser = async ({ provider, providerId, email, name, avatarUrl }) => {
  // 1) Existing account with this provider identity?
  const { data: existingProfile } = await supabaseAdmin
    .from('profiles')
    .select('id, email, is_active')
    .eq(`${provider}_id`, providerId)
    .maybeSingle();

  if (existingProfile) {
    if (!existingProfile.is_active) {
      throw new AppError('Account is deactivated', 403);
    }
    const session = await signInSocialUser(existingProfile.id, existingProfile.email);
    const profile = await fetchProfile(existingProfile.id);
    return { user: { id: profile.id, email: profile.email, user_metadata: {} }, session };
  }

  // 2) No provider identity yet — is the email already used by another account?
  if (email) {
    const { data: emailOwner } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('email', email)
      .maybeSingle();
    if (emailOwner) {
      throw new ConflictError('Email already registered. Please login with email first, then link in settings.');
    }
  }

  // 3) Create a new Supabase auth user with a server-side random password.
  const randomPassword = generateSecurePassword();
  const placeholderEmail = email || `${provider}-${providerId}@kindee.local`;

  const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
    email: placeholderEmail,
    password: randomPassword,
    email_confirm: true,
    user_metadata: {
      name,
      avatar_url: avatarUrl,
      provider,
      [`${provider}_id`]: providerId,
      // Marks this account as social-only: it has no user-chosen password, so
      // it is safe to rotate a server-side random password on each login.
      kindee_social_only: true
    }
  });

  if (createError || !created?.user) {
    throw new AppError(`Auth creation failed: ${createError?.message || 'unknown error'}`, 500);
  }

  const { data: profile, error: profileError } = await supabaseAdmin
    .from('profiles')
    .insert({
      id: created.user.id,
      email: placeholderEmail,
      name,
      avatar_url: avatarUrl,
      role: 'customer',
      is_active: true,
      [`${provider}_id`]: providerId
    })
    .select()
    .single();

  if (profileError) {
    await supabaseAdmin.auth.admin.deleteUser(created.user.id);
    throw new AppError(`Profile creation failed: ${profileError.message}`, 500);
  }

  const session = await signInWithPassword({ email: placeholderEmail }, randomPassword);

  return { user: { id: profile.id, email: profile.email, user_metadata: {} }, session };
};

// Sign in a social-only account on repeat logins. These accounts never use a
// user-chosen password, so we rotate a fresh random server-side password and
// immediately exchange it for a Supabase session. The password is never
// returned to the client and never persisted.
//
// SAFETY: we only rotate when the account is flagged `kindee_social_only`. If
// the account ever gains a real password (future account-linking flow), we
// refuse to rotate so we never break a user-chosen password.
const signInSocialUser = async (userId, email) => {
  const { data: userData } = await supabaseAdmin.auth.admin.getUserById(userId);
  const meta = userData?.user?.user_metadata || {};
  if (!meta.kindee_social_only) {
    throw new AppError('This account uses a password; please login with email and password.', 409);
  }

  const rotated = generateSecurePassword();
  const { error } = await supabaseAdmin.auth.admin.updateUserById(userId, { password: rotated });
  if (error) {
    throw new AppError(`Social session creation failed: ${error.message}`, 500);
  }
  return signInWithPassword({ email }, rotated);
};

// Cryptographically strong random password for server-only social accounts.
const generateSecurePassword = () => randomBytes(32).toString('base64url');

// Get user profile
export const getProfile = async (userId) => {
  const { data: profile, error } = await supabaseAdmin
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();
  
  if (error || !profile) {
    throw new NotFoundError('User');
  }
  
  return profile;
};

// Update user profile
export const updateProfile = async (userId, updates) => {
  const allowedFields = ['name', 'phone', 'avatar_url'];
  const filteredUpdates = {};
  
  for (const field of allowedFields) {
    if (updates[field] !== undefined) {
      filteredUpdates[field] = updates[field];
    }
  }
  
  if (Object.keys(filteredUpdates).length === 0) {
    throw new AppError('No valid fields to update', 400);
  }
  
  // Convert phone to E.164 format if provided
  if (filteredUpdates.phone) {
    const phoneE164 = toE164ThaiPhone(filteredUpdates.phone);
    if (!phoneE164) {
      throw new AppError('Invalid phone number format. Use Thai format (0812345678) or E.164 (+66812345678)', 400);
    }
    filteredUpdates.phone = phoneE164;
    
    // Check for unique constraints
    const { data: existing } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('phone', filteredUpdates.phone)
      .neq('id', userId)
      .single();
    
    if (existing) {
      throw new ConflictError('Phone number already in use');
    }
  }
  
  const { data: profile, error } = await supabaseAdmin
    .from('profiles')
    .update(filteredUpdates)
    .eq('id', userId)
    .select()
    .single();
  
  if (error) {
    throw new AppError(`Profile update failed: ${error.message}`, 500);
  }
  
  return profile;
};

// Admin: Activate or deactivate a user account (soft toggle of profiles.is_active).
//
// Safety rules enforced server-side (never rely on the UI alone):
//  - Cannot deactivate the requesting admin's own account.
//  - Cannot deactivate the last remaining active owner.
//  - Cannot deactivate an owner unless the caller is also an owner.
//  - Reactivation is allowed from any state (active or inactive) so an operator
//    can always re-enable an account.
//  - When deactivating, also revoke existing sessions via ban so the user is
//    signed out immediately. When reactivating, clear the ban so the user can
//    log back in.
//
// The profiles UPDATE is verified against the returned row: the API never
// reports success unless Supabase actually persisted the requested is_active
// value (see the post-update assertion below).
export const setUserActive = async (userId, isActive, callerId, callerRole) => {
  const { data: targetUser, error: targetError } = await supabaseAdmin
    .from('profiles')
    .select('id, role, is_active, name, email')
    .eq('id', userId)
    .single();

  if (targetError || !targetUser) {
    throw new AppError('ไม่พบผู้ใช้งาน', 404);
  }

  // Cannot touch your own account.
  if (callerId && targetUser.id === callerId) {
    throw new AppError('ไม่สามารถเปลี่ยนสถานะบัญชีของตัวเองได้', 400);
  }

  // Only owners may manage owner accounts.
  if (targetUser.role === 'owner' && callerRole !== 'owner') {
    throw new AppError('ไม่มีสิทธิ์จัดการบัญชีเจ้าของระบบ', 403);
  }

  // Deactivating an account that is already inactive is a no-op from the
  // caller's point of view. Report it as an error so the UI does not show a
  // misleading success toast.
  if (!isActive && targetUser.is_active === false) {
    throw new AppError('บัญชีนี้ถูกปิดใช้งานอยู่แล้ว', 400);
  }

  if (isActive) {
    // Reactivation is idempotent with respect to the ban: always clear any
    // existing ban so the user can log in again, regardless of prior state.
    const { error: unbanError } = await supabaseAdmin.auth.admin.updateUserById(userId, {
      ban_duration: 'none'
    });
    if (unbanError) {
      // Non-fatal: is_active=true already re-enables API access via middleware.
      console.error(`Failed to unban reactivated user ${userId}: ${unbanError.message}`);
    }
  } else {
    // Deactivating: guard against removing the last active owner.
    if (targetUser.role === 'owner') {
      const { count: ownerCount, error: ownerCountError } = await supabaseAdmin
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .eq('role', 'owner')
        .eq('is_active', true);

      if (ownerCountError) {
        throw new AppError(`ตรวจสอบจำนวนเจ้าของระบบไม่สำเร็จ: ${ownerCountError.message}`, 500);
      }
      if ((ownerCount || 0) <= 1) {
        throw new AppError('ไม่สามารถปิดใช้งานเจ้าของระบบรายสุดท้ายได้ ระบบต้องมีเจ้าของระบบอย่างน้อย 1 บัญชี', 400);
      }
    }

    // Revoke all sessions by banning the user.
    const { error: banError } = await supabaseAdmin.auth.admin.updateUserById(userId, {
      ban_duration: '876000h'
    });
    if (banError) {
      // Non-fatal: is_active=false already blocks API access via middleware.
      console.error(`Failed to revoke sessions for ${userId}: ${banError.message}`);
    }
  }

  const { data: profile, error } = await supabaseAdmin
    .from('profiles')
    .update({ is_active: isActive })
    .eq('id', userId)
    .select()
    .single();

  if (error) {
    throw new AppError(`อัปเดตสถานะผู้ใช้ไม่สำเร็จ: ${error.message}`, 500);
  }

  // Verify the UPDATE actually persisted the requested value. Supabase returns
  // the updated row when .select() is chained; a missing row (or a stale value)
  // means the write did not take effect, so we must not report success.
  if (!profile || profile.is_active !== isActive) {
    throw new AppError('อัปเดตสถานะผู้ใช้ไม่สำเร็จ: ไม่พบการเปลี่ยนแปลงในฐานข้อมูล', 500);
  }

  return profile;
};

// Change password
export const changePassword = async (userId, currentPassword, newPassword) => {
  if (!supabase) {
    throw new AppError('SUPABASE_ANON_KEY is not configured', 500);
  }

  const profile = await getProfile(userId);

  // Verify the current password by signing in (email or phone identifier).
  const { error: verifyError } = await supabase.auth.signInWithPassword({
    ...(profile.email ? { email: profile.email } : { phone: profile.phone }),
    password: currentPassword
  });

  if (verifyError) {
    throw new AppError('Current password is incorrect', 401);
  }

  // Update password
  const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(userId, {
    password: newPassword
  });

  if (updateError) {
    throw new AppError(`Password update failed: ${updateError.message}`, 500);
  }

  return { success: true };
};

// Refresh access token using Supabase refresh-token rotation.
//
// Primary path: hand the Supabase refresh token to GoTrue, which rotates it and
// returns a new access + refresh token.
// Legacy fallback: accounts not yet migrated still hold a custom-JWT refresh
// token; those are upgraded to a Supabase session on refresh (see report).
export const refreshAccessToken = async (refreshToken) => {
  if (!refreshToken) {
    throw new AppError('Invalid refresh token', 401);
  }

  // Primary: Supabase refresh token rotation.
  const { data, error } = await supabase.auth.refreshSession({ refresh_token: refreshToken });
  if (!error && data?.session) {
    const profile = await fetchProfile(data.session.user.id);
    if (!profile.is_active) {
      throw new AppError('Account is deactivated', 403);
    }
    return {
      user: profile,
      accessToken: data.session.access_token,
      refreshToken: data.session.refresh_token
    };
  }

  // Legacy fallback: custom JWT refresh token -> upgrade to Supabase session.
  let decoded;
  try {
    decoded = verifyRefreshToken(refreshToken);
  } catch {
    throw new AppError('Invalid refresh token', 401);
  }

  if (!decoded || decoded.type !== 'refresh' || !decoded.id) {
    throw new AppError('Invalid refresh token', 401);
  }

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('id, email, phone, name, role, avatar_url, is_active')
    .eq('id', decoded.id)
    .single();

  if (!profile || !profile.is_active) {
    throw new AppError('Invalid refresh token', 401);
  }

  // Legacy custom-JWT refresh token. We DO NOT rotate the account password here
  // (that would break a real user-chosen password). Instead we issue a fresh
  // legacy token pair so the session keeps working; the account is upgraded to
  // Supabase tokens automatically the next time the user logs in with a
  // password (loginUser now returns Supabase session tokens).
  const accessToken = generateToken(profile);
  const newRefreshToken = generateRefreshToken(profile);

  return {
    user: profile,
    accessToken,
    refreshToken: newRefreshToken
  };
};

// Logout (revoke refresh token)
//
// IMPORTANT: supabase.auth.admin.signOut(jwt, scope) requires the USER'S ACCESS
// TOKEN (a JWT), NOT a userId. Passing a userId is invalid and the request fails
// at the GoTrue /logout endpoint. We therefore pass req.accessToken (the user's
// Supabase JWT, set by verifyToken).
//
// Scope:
//   'local'  (default) — revoke only the current session (this device).
//   'global'          — revoke every session for this user.
//
// Revocation only invalidates refresh tokens. Access tokens already issued are
// stateless JWTs and remain valid until they expire (~1h); the middleware's
// is_active check bounds any abuse of a deactivated account.
export const logoutUser = async (accessToken, refreshToken, scope = 'local') => {
  const safeScope = ['global', 'local', 'others'].includes(scope) ? scope : 'local';

  // Preferred: revoke via the user's access token (JWT).
  if (supabaseAdmin && accessToken) {
    const { error } = await supabaseAdmin.auth.admin.signOut(accessToken, safeScope);
    if (error) {
      // A missing/expired session (403 session_not_found / 401) means the
      // session is already gone — treat as success (idempotent logout).
      const msg = String(error.message || '').toLowerCase();
      const alreadyGone = error.status === 403 || error.status === 401 ||
        msg.includes('session_not_found') || msg.includes('user_not_found');
      if (!alreadyGone) {
        throw new AppError(`Logout failed: ${error.message}`, 500);
      }
    }
    return { success: true };
  }

  // Fallback: no access token available. Best-effort client signOut so at least
  // the local refresh token is dropped where possible. Never throws.
  if (supabase && refreshToken) {
    try {
      await supabase.auth.signOut({ scope: safeScope });
    } catch {
      // ignore — logout must not fail the request
    }
  }

  return { success: true };
};

// ---------------------------------------------------------------------------
// LINE Login (custom server-side Authorization Code flow)
//
// LINE is NOT a Supabase built-in provider, and LINE web-login ID tokens are
// HS256-signed (channel secret) while Supabase Custom OIDC verifies via JWKS
// (ES256), so we do NOT use Supabase Custom OIDC for LINE. Instead:
//   code -> exchange at LINE token endpoint (server only)
//        -> verify ID token at LINE /verify (iss/aud/exp)
//        -> fall back to /v2/profile if no id_token
//        -> find/create Supabase user keyed by line_id
//        -> return a real Supabase session
// ---------------------------------------------------------------------------

const LINE_TOKEN_URL = 'https://api.line.me/oauth2/v2.1/token';
const LINE_VERIFY_URL = 'https://api.line.me/oauth2/v2.1/verify';
const LINE_PROFILE_URL = 'https://api.line.me/v2/profile';
const LINE_ISSUER = 'https://access.line.me';

const toBool = (v) => v === true || v === 'true' || v === '1' || v === 1;

// Read LINE config from settings table first, then environment variables.
const getLineConfig = async () => {
  const { data } = await supabaseAdmin
    .from('settings')
    .select('key, value')
    .in('key', ['line_channel_id', 'line_channel_secret', 'line_enabled']);

  const values = {};
  (data || []).forEach((row) => { values[row.key] = row.value; });

  const pickText = (key, envKey) => {
    const v = values[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
    return process.env[envKey] || '';
  };

  const channelId = pickText('line_channel_id', 'LINE_CHANNEL_ID');
  const channelSecret = pickText('line_channel_secret', 'LINE_CHANNEL_SECRET');
  const enabled = toBool(values.line_enabled ?? process.env.LINE_ENABLED) || Boolean(channelId && channelSecret);

  return { channelId, channelSecret, enabled };
};

// Exchange a LINE authorization code for tokens (server-side only).
const exchangeLineCode = async (code, redirectUri, channelId, channelSecret) => {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: channelId,
    client_secret: channelSecret
  });

  const res = await fetch(LINE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) {
    throw new AppError(data.error_description || 'LINE login ไม่สำเร็จ', 401);
  }
  return data;
};

// Verify the LINE ID token and validate iss/aud/exp. Returns the payload.
const verifyLineIdToken = async (idToken, channelId) => {
  const body = new URLSearchParams({ id_token: idToken, client_id: channelId });
  const res = await fetch(LINE_VERIFY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  const payload = await res.json();
  if (!res.ok || !payload) {
    throw new AppError('LINE ID token ไม่ถูกต้อง', 401);
  }

  // Validate issuer, audience and expiry (signature is validated by LINE's
  // /verify endpoint itself).
  if (payload.iss !== LINE_ISSUER) {
    throw new AppError('LINE ID token issuer ไม่ถูกต้อง', 401);
  }
  if (String(payload.aud) !== String(channelId)) {
    throw new AppError('LINE ID token audience ไม่ถูกต้อง', 401);
  }
  if (payload.exp && payload.exp <= Math.floor(Date.now() / 1000)) {
    throw new AppError('LINE ID token หมดอายุ', 401);
  }

  return payload;
};

// Resolve LINE profile from the access token when no id_token is available.
const getLineProfileFromAccessToken = async (accessToken) => {
  const res = await fetch(LINE_PROFILE_URL, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  const data = await res.json();
  if (!res.ok || !data.userId) {
    throw new AppError('ไม่สามารถดึงข้อมูล LINE ได้', 400);
  }
  return { lineId: data.userId, name: data.displayName, avatarUrl: data.pictureUrl, email: null };
};

// LINE login: exchange code -> verify identity -> find/create Supabase user.
export const lineLogin = async (code, redirectUri) => {
  if (!supabase) {
    throw new AppError('SUPABASE_ANON_KEY is not configured', 500);
  }

  if (!code) {
    throw new AppError('LINE authorization code required', 400);
  }

  const { channelId, channelSecret, enabled } = await getLineConfig();
  if (!enabled || !channelId || !channelSecret) {
    throw new AppError('การเข้าสู่ระบบด้วย LINE ถูกปิดใช้งานหรือยังไม่ถูกตั้งค่า', 403);
  }

  const tokenData = await exchangeLineCode(code, redirectUri, channelId, channelSecret);

  let lineId;
  let name;
  let avatarUrl;
  let email;

  if (tokenData.id_token) {
    const payload = await verifyLineIdToken(tokenData.id_token, channelId);
    lineId = payload.sub;
    name = payload.name || '';
    avatarUrl = payload.picture || null;
    email = payload.email ? String(payload.email).toLowerCase() : null;
  } else {
    const profile = await getLineProfileFromAccessToken(tokenData.access_token);
    lineId = profile.lineId;
    name = profile.name || '';
    avatarUrl = profile.avatarUrl || null;
    email = profile.email;
  }

  if (!lineId) {
    throw new AppError('ไม่สามารถดึงข้อมูล LINE ได้', 400);
  }

  // Reuse the shared social resolver keyed by line_id (idempotent, no auto-link).
  const authData = await resolveSocialUser({
    provider: 'line',
    providerId: lineId,
    email,
    name: name || 'LINE User',
    avatarUrl
  });

  const profile = await fetchProfile(authData.user.id);
  if (!profile.is_active) {
    throw new AppError('Account is deactivated', 403);
  }

  return toSessionResult(profile, authData.session);
};

// Deactivate account
//
// Sets profiles.is_active = false AND revokes every session belonging to the
// user. The admin API cannot sign out by userId alone (admin.signOut needs the
// user's JWT), so we revoke all refresh tokens by banning the user
// (ban_duration). A banned user cannot obtain new tokens either.
//
// This is a "soft" deactivation used both by the admin status toggle and by the
// "remove from list" action: it NEVER deletes the profiles row, Supabase Auth
// user, orders, or any relationship data. The row simply stops appearing in the
// default (active-only) admin list.
//
// REACTIVATION: when re-enabling an account, you MUST also clear the ban by
// calling admin.updateUserById(userId, { ban_duration: 'none' }) in addition to
// setting is_active = true; otherwise the user stays signed out / unable to log in.
export const deactivateAccount = async (userId) => {
  const { data: profile, error } = await supabaseAdmin
    .from('profiles')
    .update({ is_active: false })
    .eq('id', userId)
    .select()
    .single();

  if (error) {
    throw new AppError(`Deactivation failed: ${error.message}`, 500);
  }

  // Verify the UPDATE actually persisted. A missing row (or a stale is_active)
  // means the write did not take effect; never report success in that case.
  if (!profile || profile.is_active !== false) {
    throw new AppError('Deactivation failed: ไม่พบการเปลี่ยนแปลงในฐานข้อมูล', 500);
  }

  // Revoke all sessions (refresh tokens) for this user. ban_duration is the
  // supported admin way to force sign-out by user id.
  const { error: banError } = await supabaseAdmin.auth.admin.updateUserById(userId, {
    ban_duration: '876000h'
  });
  if (banError) {
    // Non-fatal: is_active=false already blocks API access via middleware; log
    // and continue so the profile update is not rolled back.
    console.error(`Failed to revoke sessions for ${userId}: ${banError.message}`);
  }

  return profile;
};

// Admin: Get all users (fetches all matching rows; batches to avoid PostgREST row caps)
export const getAllUsers = async (filters = {}, pagination = {}) => {
  const { role, is_active, search } = filters;
  const BATCH_SIZE = 1000;
  let from = 0;
  let total = 0;
  const users = [];

  while (true) {
    let query = supabaseAdmin
      .from('profiles')
      .select('*', { count: 'exact' });

    if (role) query = query.eq('role', role);
    if (is_active !== undefined) query = query.eq('is_active', is_active);
    if (search) {
      query = query.or(`name.ilike.%${search}%,email.ilike.%${search}%,phone.ilike.%${search}%`);
    }

    query = query
      .order('created_at', { ascending: false })
      .range(from, from + BATCH_SIZE - 1);

    const { data, error, count } = await query;

    if (error) {
      throw new AppError(`Failed to fetch users: ${error.message}`, 500);
    }

    if (typeof count === 'number') total = count;
    const batch = data || [];
    users.push(...batch);

    if (batch.length < BATCH_SIZE) break;
    if (total && users.length >= total) break;
    from += BATCH_SIZE;
  }

  return {
    users,
    pagination: {
      page: 1,
      limit: users.length,
      total: typeof total === 'number' ? total : users.length,
      totalPages: 1
    }
  };
};

// Admin: permanently delete a user account (for test accounts) with safeguards.
//
// - Never deletes orders/messages/transaction history.
// - If the user has protected business/history references (e.g. orders, store
//   orders, messages, conversations, reviews, payments, refunds, deliveries,
//   call history, courier records) deletion is blocked; caller should handle as
//   deactivate + PII handling instead of destroying history.
// - If safe to remove: delete dependent non-business records we own (stores and
//   their cascaded catalog data, carts/wishlists/notifications, etc.), then
//   delete the Supabase Auth user (admin API) which cascades to profiles where
//   allowed.
// - Returns { action: 'deleted'|'deactivated', reason?, references?, profile }.
export const adminDeleteUserAccount = async (userId, callerId, callerRole) => {
  const { data: targetUser, error: targetError } = await supabaseAdmin
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();

  if (targetError || !targetUser) {
    throw new AppError('ไม่พบผู้ใช้งาน', 404);
  }

  if (callerId && targetUser.id === callerId) {
    throw new AppError('ไม่สามารถลบบัญชีของตนเองได้', 400);
  }

  if (targetUser.role === 'owner') {
    if (callerRole !== 'owner') {
      throw new AppError('ไม่มีสิทธิ์จัดการบัญชีเจ้าของระบบ', 403);
    }
    const { count: ownerCount, error: ownerCountError } = await supabaseAdmin
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('role', 'owner');
    if (ownerCountError) {
      throw new AppError(`ตรวจสอบจำนวนเจ้าของระบบไม่สำเร็จ: ${ownerCountError.message}`, 500);
    }
    if ((ownerCount || 0) <= 1) {
      throw new AppError('ไม่สามารถลบเจ้าของระบบรายสุดท้ายได้', 400);
    }
  }

  // Use explicit queries for clarity and to detect blocking refs.
  // Reference verification must be reliable: if a required check cannot be
  // completed (missing schema object, permission, network, column mismatch, etc.)
  // we must NOT assume "no references" and must NOT hard-delete.
  const blocking = [];
  const verificationIssues = [];
  const isMissingSchemaObject = (error) => {
    if (!error) return false;
    const code = String(error.code || '');
    const msg = String(error.message || '').toLowerCase();
    return (
      code === '42P01' || // undefined_table
      code === '42703' || // undefined_column
      code === 'PGRST205' || // relation not found in schema cache
      msg.includes('does not exist') ||
      msg.includes('could not find the') ||
      msg.includes('schema cache') ||
      msg.includes('relation') && msg.includes('not found')
    );
  };
  const recordCheckFailure = (label, table, column, error, scope = 'profile') => {
    const issue = {
      label,
      table,
      column,
      scope,
      code: error?.code || null,
      message: error?.message || String(error || 'unknown error'),
      kind: isMissingSchemaObject(error) ? 'schema_missing_or_mismatch' : 'query_failed',
    };
    verificationIssues.push(issue);
    console.warn(`adminDeleteUserAccount ref check failed (${issue.kind}) ${table}.${column}: ${issue.message}`);
  };
  const countRef = async (label, table, column) => {
    try {
      const { count, error } = await supabaseAdmin
        .from(table)
        .select('id', { count: 'exact', head: true })
        .eq(column, userId);
      if (error) {
        recordCheckFailure(label, table, column, error, 'profile');
        return;
      }
      if ((count || 0) > 0) blocking.push({ label, table, column, count });
    } catch (err) {
      recordCheckFailure(label, table, column, err, 'profile');
    }
  };
  const countRefsIn = async (label, table, column, values, extra = {}) => {
    if (!Array.isArray(values) || values.length === 0) return;
    try {
      const { count, error } = await supabaseAdmin
        .from(table)
        .select('id', { count: 'exact', head: true })
        .in(column, values);
      if (error) {
        recordCheckFailure(label, table, column, error, 'store');
        return;
      }
      if ((count || 0) > 0) blocking.push({ label, table, column, count, ...extra });
    } catch (err) {
      recordCheckFailure(label, table, column, err, 'store');
    }
  };

  try {
    await countRef('orders (ลูกค้า)', 'orders', 'customer_id');
    await countRef('store_orders (คนส่ง)', 'store_orders', 'courier_id');
    await countRef('messages (ผู้ส่ง)', 'messages', 'sender_id');
    await countRef('conversation_members', 'conversation_members', 'profile_id');
    await countRef('reviews (ลูกค้า)', 'reviews', 'customer_id');
    await countRef('call_history (ผู้โทร)', 'call_history', 'caller_id');
    await countRef('call_history (ผู้รับสาย)', 'call_history', 'callee_id');
    await countRef('refunds (ผู้อนุมัติ)', 'refunds', 'approved_by');
    await countRef('order_status_history (ผู้เปลี่ยนสถานะ)', 'order_status_history', 'changed_by');
    await countRef('delivery_status_history (ผู้เปลี่ยนสถานะ)', 'delivery_status_history', 'changed_by');
    await countRef('couriers (โปรไฟล์คนส่ง)', 'couriers', 'profile_id');
  } catch (err) {
    recordCheckFailure('profile reference checks', 'profiles', 'id', err, 'profile');
  }

  // Stores owned by user: if any store has order/interaction history, preserve it.
  let ownedStores = [];
  try {
    const { data, error: storesErr } = await supabaseAdmin
      .from('stores')
      .select('id, name')
      .eq('owner_id', userId);
    if (storesErr) {
      recordCheckFailure('stores (ร้านของผู้ใช้)', 'stores', 'owner_id', storesErr, 'store');
    } else {
      ownedStores = data || [];
    }
  } catch (err) {
    recordCheckFailure('stores (ร้านของผู้ใช้)', 'stores', 'owner_id', err, 'store');
  }
  const storeIds = ownedStores.map((s) => s.id);

  if (storeIds.length > 0) {
    // store_orders.store_id and conversations.store_id exist in schema.
    await countRefsIn('store_orders (ร้านของผู้ใช้มีประวัติคำสั่งซื้อ)', 'store_orders', 'store_id', storeIds, {
      stores: ownedStores.map((s) => ({ id: s.id, name: s.name })),
    });
    await countRefsIn('conversations (ร้านของผู้ใช้)', 'conversations', 'store_id', storeIds, {
      stores: ownedStores.map((s) => ({ id: s.id, name: s.name })),
    });

    // Deliveries are related to stores via store_orders in this schema (no deliveries.store_id).
    // If store_orders rows cannot be fetched reliably, record verification issue (fail-safe).
    let storeOrders = [];
    let storeOrdersRowsFailed = false;
    try {
      const { data, error: soRowsErr } = await supabaseAdmin
        .from('store_orders')
        .select('id')
        .in('store_id', storeIds);
      if (soRowsErr) {
        recordCheckFailure('store_orders (rows, ร้านของผู้ใช้)', 'store_orders', 'store_id', soRowsErr, 'store');
        storeOrdersRowsFailed = true;
      } else {
        storeOrders = data || [];
      }
    } catch (err) {
      recordCheckFailure('store_orders (rows, ร้านของผู้ใช้)', 'store_orders', 'store_id', err, 'store');
      storeOrdersRowsFailed = true;
    }

    if (!storeOrdersRowsFailed) {
      const storeOrderIds = storeOrders.map((r) => r.id);
      if (storeOrderIds.length > 0) {
        await countRefsIn('deliveries (ร้านของผู้ใช้/คำสั่งซื้อร้าน)', 'deliveries', 'store_order_id', storeOrderIds, {
          stores: ownedStores.map((s) => ({ id: s.id, name: s.name })),
        });
      }
    }
  }

  if (verificationIssues.length > 0) {
    // Do not guess. If we cannot verify references reliably, never hard-delete.
    const issueSummary = verificationIssues
      .map((i) => `${i.table}.${i.column} (${i.kind})`)
      .join(', ');
    await setUserActive(userId, false, callerId, callerRole).catch(() => deactivateAccount(userId));
    const { data: anonymized } = await supabaseAdmin
      .from('profiles')
      .update({
        name: 'บัญชีที่ถูกปิดใช้งาน',
        phone: null,
        avatar_url: null,
      })
      .eq('id', userId)
      .select()
      .single();
    return {
      action: 'deactivated',
      reason: `ไม่สามารถตรวจสอบข้อมูลอ้างอิงที่จำเป็นได้อย่างครบถ้วน (${issueSummary}) ระบบจึงปิดใช้งานแทนการลบถาวรเพื่อความปลอดภัย (ไม่ลบประวัติธุรกรรม)`,
      references: blocking,
      verificationIssues,
      profile: anonymized || targetUser,
    };
  }

  if (blocking.length > 0) {
    // Preserve business/transaction history: do not hard-delete; deactivate and keep data.
    // Anonymize minimal PII on profile if deactivating (keep id for FK integrity).
    await setUserActive(userId, false, callerId, callerRole).catch(() => deactivateAccount(userId));
  const { data: anonymized } = await supabaseAdmin
      .from('profiles')
      .update({
        name: 'บัญชีที่ถูกปิดใช้งาน',
        phone: null,
        avatar_url: null,
      })
      .eq('id', userId)
      .select()
      .single();

    return {
      action: 'deactivated',
      reason: 'มีข้อมูลธุรกิจ/ประวัติที่ต้องรักษา ระบบจึงปิดใช้งานและจัดการข้อมูลส่วนบุคคลแทนการลบถาวร (ไม่ลบคำสั่งซื้อ/ข้อความ/ประวัติธุรกรรม)',
      references: blocking,
      profile: anonymized || targetUser,
    };
  }

  // Safe to hard-delete: remove owned stores (cascade will remove products,
  // store_products etc. — but we already verified no blocking store history above).
  if (storeIds.length > 0) {
    try {
      const { error: delStoresErr } = await supabaseAdmin
        .from('stores')
        .delete()
        .eq('owner_id', userId);
      if (delStoresErr) {
        throw new AppError(`ลบร้านค้าของผู้ใช้ไม่สำเร็จ: ${delStoresErr.message}`, 500);
      }
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new AppError(`ลบร้านค้าของผู้ใช้ไม่สำเร็จ: ${err?.message || String(err)}`, 500);
    }
  }

  // Best-effort cleanup of user-owned non-critical rows that may block profile/auth deletion.
  // These are not business/transaction history and may not exist in every environment.
  const safeDeletes = [
    ['notifications', 'recipient_id'],
    ['carts', 'user_id'],
    ['wishlists', 'user_id'],
    ['addresses', 'user_id'],
    ['profile_addresses', 'profile_id'],
    ['user_sessions', 'user_id'],
  ];
  for (const [table, column] of safeDeletes) {
    try {
      const { error } = await supabaseAdmin.from(table).delete().eq(column, userId);
      if (error) {
        console.warn(`adminDeleteUserAccount cleanup skipped ${table}.${column}: ${error.message}`);
      }
    } catch (err) {
      console.warn(`adminDeleteUserAccount cleanup skipped ${table}.${column}: ${err?.message || String(err)}`);
    }
  }

  // Revoke/cleanup auth-related state best-effort, then delete auth user.
  // If auth delete fails or cannot be confirmed, do NOT report success as deleted.
  try {
    const { error: authDeleteError } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (authDeleteError) {
      throw authDeleteError;
    }
  } catch (err) {
    // Fallback: attempt profile removal only if auth deletion failed (e.g. auth row missing),
    // but never report "deleted" if auth state is uncertain/inconsistent.
    let profileDelErr = null;
    try {
      const res = await supabaseAdmin.from('profiles').delete().eq('id', userId);
      profileDelErr = res?.error || null;
    } catch (e) {
      profileDelErr = e;
    }
    if (profileDelErr) {
      throw new AppError(`ลบบัญชีจากระบบยืนยันตัวตนไม่สำเร็จ: ${err?.message || 'unknown error'} (${profileDelErr.message || profileDelErr})`, 500);
    }
    throw new AppError(`ลบบัญชีจากระบบยืนยันตัวตนไม่สำเร็จ: ${err?.message || 'unknown error'} (สถานะ Auth/โปรไฟล์อาจไม่สอดคล้องกัน กรุณาตรวจสอบ)`, 500);
  }

  // Ensure profile is gone (if cascade didn't apply in some env). If this fails after auth delete,
  // report error clearly so caller does not assume full success.
  try {
    const { error: profileCleanupErr } = await supabaseAdmin
      .from('profiles')
      .delete()
      .eq('id', userId);
    if (profileCleanupErr) {
      throw new AppError(`ลบโปรไฟล์หลังลบจากระบบยืนยันตัวตนไม่สมบูรณ์ กรุณาตรวจสอบสถานะบัญชี (Auth อาจถูกลบแล้ว): ${profileCleanupErr.message}`, 500);
    }
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(`ลบโปรไฟล์หลังลบจากระบบยืนยันตัวตนไม่สมบูรณ์ กรุณาตรวจสอบสถานะบัญชี (Auth อาจถูกลบแล้ว): ${err?.message || String(err)}`, 500);
  }

  return { action: 'deleted', profile: { id: targetUser.id, email: targetUser.email, name: targetUser.name } };
};
// Admin: Update user role
export const updateUserRole = async (userId, newRole, adminId) => {
  if (!['customer', 'seller', 'admin', 'owner', 'courier'].includes(newRole)) {
    throw new AppError('Invalid role', 400);
  }
  
  // Prevent admin from changing owner role
  const { data: targetUser } = await supabaseAdmin
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .single();
  
  if (targetUser?.role === 'owner' && newRole !== 'owner') {
    throw new AppError('Cannot change owner role', 403);
  }
  
  const { data: profile, error } = await supabaseAdmin
    .from('profiles')
    .update({ role: newRole })
    .eq('id', userId)
    .select()
    .single();
  
  if (error) {
    throw new AppError(`Role update failed: ${error.message}`, 500);
  }
  
  return profile;
};
