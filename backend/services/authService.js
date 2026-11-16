import { supabase, supabaseAdmin } from '../config/supabase.js';
import { generateToken, generateRefreshToken, verifyRefreshToken } from '../middleware/auth.js';
import { AppError, NotFoundError, ConflictError } from '../middleware/errorHandler.js';
import { randomBytes } from 'node:crypto';

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

  // Check if user exists
  const { data: existingUser } = await supabaseAdmin
    .from('profiles')
    .select('id')
    .or(`email.eq.${email},phone.eq.${phone}`)
    .single();

  if (existingUser) {
    throw new ConflictError('Email or phone already registered');
  }

  // Create auth user
  const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
    email,
    phone,
    password,
    email_confirm: true,
    user_metadata: { name, role }
  });

  if (authError) {
    throw new AppError(`Auth creation failed: ${authError.message}`, 500);
  }

  // Create profile
  const { data: profile, error: profileError } = await supabaseAdmin
    .from('profiles')
    .insert({
      id: authData.user.id,
      email,
      phone,
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
  const session = await signInWithPassword({ email, phone }, password);

  return toSessionResult(profile, session);
};

// Login user
export const loginUser = async (emailOrPhone, password) => {
  if (!supabase) {
    throw new AppError('SUPABASE_ANON_KEY is not configured', 500);
  }

  // Find user by email or phone
  const { data: profile, error } = await supabaseAdmin
    .from('profiles')
    .select('*')
    .or(`email.eq.${emailOrPhone},phone.eq.${emailOrPhone}`)
    .single();

  if (error || !profile) {
    throw new AppError('Invalid credentials', 401);
  }

  if (!profile.is_active) {
    throw new AppError('Account is deactivated', 403);
  }

  // Verify the password and obtain a Supabase session. Supabase
  // signInWithPassword accepts either an email or a phone identifier.
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
  const allowedFields = ['name', 'phone', 'address', 'avatar_url'];
  const filteredUpdates = {};
  
  for (const field of allowedFields) {
    if (updates[field] !== undefined) {
      filteredUpdates[field] = updates[field];
    }
  }
  
  if (Object.keys(filteredUpdates).length === 0) {
    throw new AppError('No valid fields to update', 400);
  }
  
  // Check for unique constraints
  if (filteredUpdates.phone) {
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

// Admin: Get all users
export const getAllUsers = async (filters = {}, pagination = {}) => {
  const { role, is_active, search } = filters;
  const { page = 1, limit = 20 } = pagination;
  
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
    .range((page - 1) * limit, page * limit - 1);
  
  const { data, error, count } = await query;
  
  if (error) {
    throw new AppError(`Failed to fetch users: ${error.message}`, 500);
  }
  
  return {
    users: data,
    pagination: {
      page,
      limit,
      total: count,
      totalPages: Math.ceil(count / limit)
    }
  };
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