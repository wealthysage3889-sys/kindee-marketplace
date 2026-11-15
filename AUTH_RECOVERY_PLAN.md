# Kindee Marketplace — Complete Authentication Recovery Plan

> **READ-ONLY / PLANNING ONLY** — ห้ามแก้ไขไฟล์ในรอบนี้
>
> **Last Updated:** 2026-11-15
> **Scope:** Cross-Platform Authentication (Desktop Web, Mobile Web, Android App, iOS App)

---

## Executive Summary

ระบบปัจจุบันมี **สองระบบ Authentication ทำงานพร้อมกัน**:
1. **MongoDB/Mongoose (เก่า)**: `authController.js` + `User.js` model — ใช้ bcrypt + JWT ปรับเอง
2. **Supabase (ใหม่)**: `authService.js` + `authRoutes.js` + `profiles` table — ใช้ Supabase Auth + JWT ปรับเอง

แผนนี้จะ **ยกเลิกระบบ MongoDB Auth ทั้งหมด** และ **มาตรฐานให้ Supabase เป็นผู้จัดการ Session/Token เพียงชุดเดียว** พร้อมรองรับ 4 ช่องทาง:
1. Email + Password
2. Facebook Login
3. LINE Login
4. Phone Number + OTP

---

## 1. Platform Scope Separation

### 1.1 Current Platform (React + Vite Web)

**Active scope — deliverables for this platform:**
- Email + Password (register, login, forgot, reset, change)
- Facebook Login (วิธี A: FB JS SDK + Backend verify)
- LINE Login (OAuth Redirect + Backend exchange code)
- Phone Number + OTP (Supabase Phone Auth)
- Account Linking (Settings page UI)
- Logout with global revoke (default scope)

**Technology:**
- Frontend: React + Vite (Web)
- Backend: Node.js + Express
- Supabase JS SDK (browser) + Admin SDK (backend)
- Storage: `localStorage` (default)

### 1.2 Future Native (Android / iOS)

**Not in scope for current phase — planned for future:**
- Native SDK integration (Supabase Flutter/React Native SDK)
- Biometric auth (optional enhancement)
- Push notification token binding
- Deep linking OAuth callback for native apps
- `signOut({ scope: 'local' })` per-device logout
- HttpOnly cookie storage (if needed for enhanced security)

**Technology:**
- Flutter / React Native (TBD)
- Platform-specific Supabase SDK
- Secure storage (SecureStore / Keychain)

---

## 3. Authentication Architecture กลาง (Central Auth Architecture)

### 1.1 Supabase Auth = Single Source of Truth

| หน้าที่ | ผู้รับผิดชอบ |
|----------|-------------|
| **Identity & Credentials** | Supabase Auth (email, phone, password, OAuth providers) |
| **Session Management** | Supabase Auth (access token, refresh token, MFA) |
| **User Profile Data** | `public.profiles` table (1:1 กับ `auth.users.id`) |
| **Authorization (RBAC)** | `profiles.role` + RLS Policies + Middleware `authorize()` |
| **Token Verification** | Middleware `verifyToken()` ใช้ `supabaseAuth.auth.getUser()` |

**ห้ามมี**: Custom JWT สองชุด (Supabase JWT + `generateToken()` เดิม) → **ลบ `generateToken()`/`generateRefreshToken()`/`verifyRefreshToken()` ออกจาก `middleware/auth.js`**

### 1.2 User Identity Mapping

```
auth.users (Supabase managed)
  │
  ├── id (UUID) ──────────────► profiles.id (PK, FK → auth.users.id ON DELETE CASCADE)
  ├── email                   ► profiles.email (UNIQUE, NULLABLE for phone-only)
  ├── phone                   ► profiles.phone (UNIQUE, NULLABLE for email-only)
  ├── user_metadata           ► profiles.name, avatar_url, etc.
  └── identities[]            ► Links: google, facebook, line, phone
```

**Rules:**
- `profiles.id` **ต้องเท่ากับ** `auth.users.id` เสมอ (ON DELETE CASCADE)
- หนึ่ง `auth.user` = หนึ่ง `profile` = หนึ่งบัญชีผู้ใช้
- `identities` array ใน `auth.users` จัดการการเชื่อมโยง OAuth providers หลายตัว

### 1.3 Account Linking Strategy (ป้องกัน Account Takeover)

| สถานการณ์ | การจัดการ |
|------------|-----------|
| **User ใหม่ Login ด้วย OAuth** | สร้าง `auth.user` ใหม่ → สร้าง `profile` ใหม่ → บันทึก `provider_id` ใน `identities` |
| **User เดิม (มี email) Login ด้วย OAuth ใหม่** | **ห้าม auto-link** — ต้องขอ verify ผ่าน email/phone เดิมก่อน (Account Linking Flow) |
| **User ลงทะเบียน Email+Password แล้ว Login OAuth ด้วย email เดียวกัน** | Supabase จะ block ให้เอง (email unique) → Frontend แสดงหน้า "Link Account" |
| **User Login Phone+OTP แล้ว Login OAuth ด้วย email** | ต้องผ่าน Email Verification ก่อนถึง link ได้ |

**Implementation:**
- ใช้ Supabase `linkIdentity()` API หลังจาก user ยืนยัน ownership แล้ว
- Backend expose endpoint `POST /auth/link-account` รับ `provider`, `token`, `currentAccessToken`
- Frontend: Popup "คุณต้องการเชื่อมโยงบัญชีนี้กับบัญชีเดิมหรือไม่?" พร้อม OTP/Email verification

### 1.4 Session & Token Management

```
┌─────────────────────────────────────────────────────────────┐
│                    Supabase Auth Session                      │
├─────────────────────────────────────────────────────────────┤
│  Access Token (JWT)  ──► 1 ชั่วโมง (default)                 │
│  Refresh Token        ──► 30 วัน (default, rotatable)         │
│  Session Revoke       ──► supabase.auth.signOut()            │
│  MFA                  ──► TOTP / Phone (optional)            │
└─────────────────────────────────────────────────────────────┘
```

**Backend Middleware (`verifyToken`):**
```javascript
// ใช้ supabaseAuth.auth.getUser(token) เท่านั้น
// ไม่มี fallback ไป custom JWT
// Return req.user = { id, email, name, role, avatar_url, phone } จาก profiles
```

#### 1.4.1 Logout Strategy (Per-Platform signOut Scope)

Supabase `signOut()` accepts a `scope` parameter:

| Platform | signOut Call | Behavior |
|----------|-------------|----------|
| **React + Vite Web (Current)** | `supabase.auth.signOut()` (default scope = `global`) | Revoke ทุก session บนทุกอุปกรณ์ที่ใช้ refresh token เดียวกัน |
| **React + Vite Web (Current)** | `supabase.auth.signOut({ scope: 'local' }) |  revoke เฉพาะ session ปัจจุบัน (refresh token ที่ใช้อยู่) |
| **Future Native Android/iOS** | `supabase.auth.signOut({ scope: 'local' }) |  revoke เฉพาะ session บนอุปกรณ์นั้น |
| **Future Native Android/iOS** | `supabase.auth.signOut()` (global) |  revoke ทุก session (เมื่อ user เปลี่ยนเครื่อง, lost device, หรือ security incident) |

**Recommendation:**
- **Current Web Platform**: Default `signOut()` (global) — revoke ทุก session
- **Future Native**: expose `POST /auth/logout` with optional `revokeAllSessions: boolean` body
  - `revokeAllSessions: true` → `signOut()` (global)
  - `revokeAllSessions: false` → `signOut({ scope: 'local' })`
- **Security-sensitive actions** (password change, suspicious activity): force global revoke

**Backend `POST /auth/logout`:**
```javascript
// Input: { revokeAllSessions?: boolean } (optional, default true)
// 1. ถ้า revokeAllSessions = true → supabase.auth.signOut() (global)
// 2. ถ้า revokeAllSessions = false → supabase.auth.signOut({ scope: 'local' })
// 3. Clear session cookie/localStorage on frontend
```

**Frontend:**
- เก็บ `accessToken` + `refreshToken` ใน `localStorage` (หรือ HttpOnly cookie ถ้าต้องการปลอดภัยกว่า)
- Auto-refresh ผ่าน `supabase.auth.refreshSession()` หรือ backend `/auth/refresh`

**⚠️ HttpOnly Cookie = Optional (ต้อง/private โดยไม่ใช่ข้อบังคับทันที):**
- **Current Decision**: Use `localStorage` (default Supabase behavior) — simpler, compatible with existing code
- **Security Assessment Required** (before switching to HttpOnly):
  - Evaluate XSS risk: ถ้ามี XSS vector ส่ง `accessToken` ไปได้ → พิจารณา HttpOnly
  - Evaluate CSRF risk: ถ้าใช้ HttpOnly cookie → Supabase JS SDK อ่าน cookie ได้โดยตรง (same-domain)
  - Evaluate migration complexity: localStorage → cookie ต้องปรับ frontend code, backend `/auth/refresh`, OAuth redirect handling
  - Evaluate Supabase SSR compatibility: Next.js SSR ต้องใช้ cookie store อย่าง Supabase `createServerClient`
- **Decision Gate**: ทำ security audit ก่อน Phase 6 แล้วตัดสินใจว่าจะเปลี่ยนเป็น HttpOnly หรือไม่
- **ห้ามบังคับ HttpOnly ทันที** เพราะจะเพิ่ม complexity โดยไม่มี immediate security gain (ไม่มี XSS vector ในปัจจุบัน)

### 1.5 Roles & Authorization

| Role | Description | Can Self-Assign? |
|------|-------------|------------------|
| `customer` | ผู้ซื้อทั่วไป | ❌ (default) |
| `seller` | ผู้ขาย (มีร้าน) | ✅ ผ่าน UI "เป็นผู้ขาย" (ต้อง verify) |
| `courier` | พนักงานส่ง | ❌ (admin assign) |
| `admin` | ผู้ดูแลระบบ | ❌ (owner assign) |
| `owner` | เจ้าของแพลตฟอร์ม | ❌ (database level) |

**RLS Policy Guard:**
```sql
-- profiles table: user อัปเดต role เองไม่ได้
WITH CHECK (id = auth.uid() AND role = (SELECT role FROM profiles WHERE id = auth.uid()))
```

**Middleware `authorize(...roles)`**: ตรวจ `req.user.role` ก่อนผ่าน

### 1.6 Account Status Management

| Status | Field | Effect |
|--------|-------|--------|
| Active | `profiles.is_active = true` | ปกติ |
| Suspended | `profiles.is_active = false` | Block login, revoke sessions |
| Banned | `profiles.is_active = false` + `banned_at` | Permanent, admin only |

**Deactivation Flow:**
1. `PATCH /auth/account` → `supabaseAdmin.auth.admin.signOut(userId)` + `profiles.is_active = false`
2. Middleware `verifyToken` ตรวจ `profile.is_active` ทุก request

### 1.7 Foreign Key Mapping & Data Integrity

 Tables ที่อ้างอิง `profiles` (FK → `profiles.id`)

| Table | FK Column | ON DELETE | Notes |
|-------|-----------|-----------|-------|
| `stores` | `owner_id` → `profiles.id` | CASCADE | ผู้ Besar ของร้านค้า |
| `stores` | `created_by` → `profiles.id` | SET NULL | ผู้สร้างร้าน (admin) |
| `stores` | `updated_by` → `profiles.id` | SET NULL | ผู้อัปเดตล่าสุด |
| `orders` | `customer_id` → `profiles.id` | CASCADE | ผู้ซื้อ |
| `orders` | `seller_id` → `profiles.id` | CASCADE | ผู้ขาย (from store owner) |
| `orders` | `courier_id` → `profiles.id` | SET NULL | พนักงานส่ง |
| `orders` | `created_by` → `profiles.id` | SET NULL | ผู้สร้าง order (admin) |
| `messages` | `sender_id` → `profiles.id` | CASCADE | ผู้ส่งข้อความ |
| `messages` | `receiver_id` → `profiles.id` | CASCADE | ผู้รับข้อความ |
| `reviews` | `user_id` → `profiles.id` | CASCADE | ผู้เขียนรีวิว |
| `reviews` | `store_id` → `stores.id` | CASCADE | ร้านที่ถูกรีวิว (indirect via stores) |
| `notifications` | `user_id` → `profiles.id` | CASCADE | ผู้ได้รับ notification |
| `notifications` | `created_by` → `profiles.id` | SET NULL | ผู้สร้าง notification (system/admin) |
| `cart_items` | `user_id` → `profiles.id` | CASCADE | ผู้ถ Besar ในตระกรี |
| `wishlists` | `user_id` → `profiles.id` | CASCADE | ผู้เพิ่มใน wishlist |
| `payments` | `user_id` → `profiles.id` | CASCADE | ผู้ทำธุริต |
| `disputes` | `opened_by` → `profiles.id` | CASCADE | ผู้เปิด dispute |
| `disputes` | `resolved_by` → `profiles.id` | SET NULL | ผู้แก้ dispute (admin) |

**FK Mapping Verification Checklist (ก่อนและหลัง MongoDB Migration):**

- [ ] นับจำนวน FK แต่ละ column ใน Supabase tables (pre-migration)
- [ ] ตรวจสอบว่า profiles.id เท่ากับ auth.users.id ทุก row
- [ ] ตรวจสอบ orphan records (FK ชี้ไป profiles ที่ไม่มีอยู่)
- [ ] ตรวจสอบ orphan records (profiles ที่ไม่มี FK จาก tables หลัก)
- [ ] Post-migration: re-run ทั้งหมดและเปรียบเทียบ counts
- [ ] Post-migration: spot-check 5-10 records ในแต่ละ table เพื่อความถูกต้อง

---

## 2. Email + Password

### 2.1 Registration Flow

```
POST /auth/register
  Input: { email, password, name?, role? }
  1. Validate email format, password strength (min 8 char)
  2. Check profiles.email UNIQUE
  3. supabaseAdmin.auth.admin.createUser({
       email, password,
       email_confirm: false,  // ❌ ไม่ auto-confirm
       user_metadata: { name, role: 'customer' }
     })
  4. สร้าง profile (id = auth.user.id)
  5. Supabase ส่ง verification email เอง (configure SMTP)
  6. Return: { user: profile, message: "Verify email to activate" }
```

**Key Decision: `email_confirm: false`**
- **ปลอดภัย**: User ต้องคลิกลิงก์ในอีเมลจริงถึง login ได้
- **UX**: Frontend นำทางไปหน้า "Check your email" พร้อม resend option
- **ห้าม**: `email_confirm: true` เพื่อข้ามการยืนยัน

### 2.2 Login Flow

```
POST /auth/login
  Input: { email, password }
  1. supabase.auth.signInWithPassword({ email, password })
  2. ถ้า email_not_confirmed → 400 "Please verify your email"
  3. ดึง profile จาก profiles table
  4. ถ้า !is_active → 403 "Account deactivated"
  5. Return: { user: profile, accessToken, refreshToken }
```

### 2.3 Password Reset

```
POST /auth/forgot-password
  Input: { email }
  1. supabase.auth.resetPasswordForEmail(email, { redirectTo: `${CLIENT_URL}/reset-password` })
  2. Return: { message: "Reset link sent" }

POST /auth/reset-password
  Input: { password, access_token }  // จาก URL fragment
  1. supabase.auth.updateUser({ password }, { accessToken })
  2. Return: { message: "Password updated" }
```

### 2.4 Change Password (Authenticated)

```
PUT /auth/password
  Header: Authorization: Bearer <accessToken>
  Input: { currentPassword, newPassword }
  1. supabase.auth.updateUser({ password: newPassword }) // ต้องมี session ใช้อยู่
  2. Return: { message: "Password changed" }
```

### 2.5 Migration from MongoDB (bcrypt → Supabase)

**ปัญหา**: Supabase ไม่อนุญาต import bcrypt hash โดยตรง

**แนวทาง:**
1. **One-time migration script** (รันครั้งเดียว):
   - อ่าน users จาก MongoDB
   - สร้าง `auth.user` ใน Supabase ด้วย `supabaseAdmin.auth.admin.createUser({ email, password_hash: user.password })` **← Supabase รองรับ `password_hash` parameter**
   - สร้าง `profile` ด้วย `legacy_id = user._id`
   - Mark MongoDB user `migrated = true`

2. **Fallback Login (ช่วง transition)**:
   - ถ้า login ใน Supabase fail → ลองตรวจสอบ MongoDB (bcrypt compare)
   - ถ้า match → สร้าง Supabase user ใหม่พร้อม password ใหม่ (หรือ migrate hash)
   - ลบ MongoDB user หรือ mark migrated

3. **Cleanup**: หลัง migrate ครบ → ลบ MongoDB User collection, หยุดเชื่อม MongoDB สำหรับ Auth

---

## 3. Facebook Login

### 3.1 Token Type Verification (B before Choosing Method A or B)

** Mandatory ตรวจสอบก่อนเลือกวิธี:**

1. **Token ชนิดใดที่ Frontend ส่งมา?**
   - `accessToken` (String ยาว ~100-200 char, ไม่มี periods) → Facebook Graph API Access Token
   - `idToken` (JWT, มี periods `.`, 3 ส่วน header.payload.signature) → Facebook ID Token

2. **SDK ที่ใช้จริงใน Frontend คืออะไร?**
   - `FB.login()` + `FB.api()` → ได้ `accessToken` เท่านั้น (วิธี A)
   - `@react-google-auth` หรือ SDK ที่ส่ง JWT → วิธี B หรือ custom
   - `useFacebookLogin` hook → ตรวจสอบ response type ใน docs

3. **ห้ามฟันธงว่า Access Token ใช้กับ `signInWithIdToken` ไม่ได้**
   - `supabase.auth.signInWithIdToken({ provider: 'facebook', token })` **ต้องการ ID Token (JWT)** เท่านั้น
   - ส่ง Access Token ไป → error: `Invalid token` หรือ `provider not found`
   - ดังนั้น **ต้องตรวจสอบก่อน** ว่า Frontend มีการเรียก ID Token หรือไม่

### 3.2 Correct OAuth Flow (ID Token vs Access Token)

**❌ ผิด (Current authService.js)**: ส่ง `accessToken` ไป `signInWithIdToken(provider: 'facebook', token: accessToken)`
- `signInWithIdToken` ต้องการ **ID Token** (JWT จาก Facebook) ไม่ใช่ Access Token

**✅ ถูกต้อง**: 2 วิธี

#### วิธี A: Facebook OAuth Web (Recommended)
```
Frontend: Facebook Login Button (FB JS SDK)
  1. User กดปุ่ม → FB popup → ได้ `authResponse` (มี `accessToken` + `userID`)
  2. เรียก `FB.api('/me', {fields: 'id,name,email,picture'}, ...)` ได้ profile
  3. ส่ง `accessToken` ไป Backend `/auth/facebook`

Backend: POST /auth/facebook
  1. Verify token: `GET https://graph.facebook.com/debug_token?input_token=${accessToken}&access_token=${appId}|${appSecret}`
  2. ดึง profile: `GET https://graph.facebook.com/me?fields=id,name,email,picture&access_token=${accessToken}`
  3. ใช้ `facebookId` (profile.id) ค้นหา/สร้าง user
  4. **Supabase Linking**: 
     - ถ้า user ใหม่: `supabaseAdmin.auth.admin.createUser({ email, user_metadata: { facebook_id } })`
     - ถ้า user เดิม: `supabaseAdmin.auth.admin.updateUserById(id, { user_metadata: { ...existing, facebook_id } })`
  5. สร้าง/อัปเดต profile
  6. Return tokens
```

#### วิธี B: Supabase Native OAuth (Server-side)
```
Frontend: Redirect to `${SUPABASE_URL}/auth/v1/authorize?provider=facebook&redirect_to=${CLIENT_URL}/auth/callback`
  1. User login บน Facebook → Redirect กลับมาที่ `/auth/callback?code=...`
  2. Frontend ส่ง `code` ไป Backend `/auth/callback`
  3. Backend: `supabase.auth.exchangeCodeForSession(code)`
  4. ได้ session → ดึง user → upsert profile
  5. Return tokens
```

** recommends: ** **วิธี A** เพราะ Frontend มี Facebook SDK อยู่แล้ว (`SocialAuth.jsx`) และควบคุม UX ได้ดีกว่า

### 3.3 Account Linking Guard

- ตรวจสอบ `email` จาก Facebook profile
- ถ้ามี `profiles.email` อยู่แล้ว:
  - **ห้าม auto-create/link** → Return 409 "Email already registered. Please login with email first, then link Facebook in settings."
  - Frontend แสดงหน้า "Link Facebook Account" → เรียก `POST /auth/link-account` หลัง verify

### 3.4 Supabase Provider Config

ใน Supabase Dashboard → Authentication → Providers → Facebook:
- Client ID, Client Secret
- Redirect URL: `${SUPABASE_URL}/auth/v1/callback` (ถ้าใช้ native OAuth)
- Scopes: `public_profile, email`

---

## 4. LINE Login

### 4.1 Current Status

- **Backend**: `authController.js` มี `lineLogin()` ใช้ Authorization Code Flow + ID Token verification
- **New Routes**: `authRoutes.js` **ขาด endpoint `/auth/line`**
- **Frontend**: `SocialAuth.jsx` มีปุ่ม LINE แต่ `onLine` handler ยังไม่ต่อ endpoint

### 4.2 LINE OAuth 2.0 Flow (Authorization Code + ID Token)

**LINE Custom OIDC Compatibility — UNVERIFIED / NOT COMPATIBLE AS-IS (Web Login):**

| Item | Value | Source | Status |
|------|-------|--------|--------|
| LINE issuer | `https://access.line.me` | LINE Login docs (verify-id-token) | ✅ Verified |
| OpenID Discovery URL | `https://access.line.me/.well-known/openid-configuration` | LINE Login docs | ✅ Verified |
| Token endpoint | `https://api.line.me/oauth2/v2.1/token` | LINE Login docs | ✅ Verified |
| JWKS URI | `https://api.line.me/oauth2/v2.1/certs` | LINE Login docs | ✅ Verified |
| Verify ID token endpoint | `POST https://api.line.me/oauth2/v2.1/verify` (`id_token` + `client_id`) | LINE Login docs | ✅ Verified |
| Signing algorithm — web login | **HS256** (HMAC with channel secret) | LINE Login docs | ✅ Verified |
| Signing algorithm — native/LIFF | **ES256** (JWKS, `kid` header) | LINE Login docs | ✅ Verified |
| Discovery doc `id_token_signing_alg_values_supported` | `["ES256"]` only | LINE discovery doc | ✅ Verified |

**Critical incompatibility:** Supabase Custom OAuth/OIDC Providers verify ID tokens against the provider's **JWKS** (official Supabase custom-oauth-providers docs). LINE web-login ID tokens are signed **HS256 with the channel secret**, not ES256/JWKS, while LINE's discovery doc advertises only ES256. A Custom OIDC provider trusting the discovery doc/JWKS will **fail** on LINE web-login tokens.

Supabase auth PR #2578 (open, **not released**) adds a native LINE provider that verifies the ID token with **HS256 using the channel secret** (issuer `https://access.line.me`, audience = channel ID). Confirms the mismatch is a known, unresolved issue.

**Verdict:** LINE Login v2.1 **cannot be reliably configured as a Supabase Custom OIDC Provider for web login** as of this revalidation. Mark **UNVERIFIED / NOT RECOMMENDED** until either the native LINE provider ships or a staging PoC confirms Custom OIDC works.

**Recommended Phase 1A approach:** Use the existing proven custom server-side flow (same pattern as `authController.lineLogin()`):
1. Frontend redirects to `https://access.line.me/oauth2/v2.1/authorize` (already implemented in Login.jsx/Register.jsx)
2. Backend `POST /auth/line` exchanges code at `https://api.line.me/oauth2/v2.1/token`, verifies ID token at `https://api.line.me/oauth2/v2.1/verify`, falls back to `https://api.line.me/v2/profile`
3. Create/lookup Supabase user via `supabaseAdmin.auth.admin.createUser` + `profiles` upsert
4. Return Supabase session tokens

**`email_optional` / users without email:** A Supabase-side toggle is mentioned only in third-party guides (not official Supabase docs). LINE returns `email` only with `email` scope + verified email. Handle missing email at app level (placeholder `line-${lineId}@kindee.local` + post-login verify). Mark **UNVERIFIED** for the Supabase-side setting.

**Frontend:**
```javascript
// Already implemented in Login.jsx:152-165, Register.jsx:161-167
const redirectUri = window.location.origin + "/login"; // or "/register"
const params = new URLSearchParams({
  response_type: "code",
  client_id: socialConfig.line.channelId,
  redirect_uri: redirectUri,
  state: "line_login", // or "line_register"
  scope: "profile openid email",
});
window.location.href = `https://access.line.me/oauth2/v2.1/authorize?${params.toString()}`;
```

**Backend: POST /auth/line** (new implementation required — missing in authRoutes.js)
```
Input: { code, redirectUri, state? }
1. Verify state (if provided)
2. Exchange code: POST https://api.line.me/oauth2/v2.1/token
   Body: grant_type=authorization_code&code=${code}&redirect_uri=${redirectUri}&client_id=${channelId}&client_secret=${channelSecret}
   → { access_token, id_token, ... }
3. Verify ID Token: POST https://api.line.me/oauth2/v2.1/verify
   Body: id_token=${id_token}&client_id=${channelId}
   → payload: { sub: lineId, name, picture, email, email_verified, iss, aud, exp }
   (validate iss=https://access.line.me, aud=channelId, exp)
4. If no id_token → GET https://api.line.me/v2/profile (Bearer access_token) → userId, displayName, pictureUrl
5. Supabase integration (custom — LINE not a built-in provider):
   - Look up existing user by line_id (see Provider Identity Strategy below)
   - If exists → return existing session (idempotent)
   - If not → createUser({ email: payload.email (may be null), password: random, email_confirm: payload.email_verified || false, user_metadata: { line_id, name, avatar_url, provider:'line' } })
   - Upsert profile (id = authUser.id)
6. Return Supabase session tokens
```

### 4.3 Provider Identity & Duplicate-Account Strategy

**Supabase-managed `identities[]` (built-in providers only):**
- For built-in OAuth providers (Google, Facebook via Supabase native OAuth), Supabase auto-populates `auth.users.identities[]` linking `provider` + `provider_id`. Provides uniqueness + account mapping out of the box — **no app-owned mirror needed.**
- For LINE (custom, not built-in): Supabase does **not** auto-populate `identities[]`. The app tracks `line_id` itself.

**Do NOT create a direct unique index on `auth.users.user_metadata->>'line_id'` (migration 006).** Internal `auth.*` tables are Supabase-managed; direct indexes lack documented justification and are out of Phase 1A (code-only) scope.

**Recommended app-owned schema:**
- `profiles.line_id TEXT UNIQUE` (nullable) — app-owned table.
- Uniqueness enforced at `profiles` level.

**Concurrency strategy:**
1. Before create: `SELECT id FROM profiles WHERE line_id = $1` (idempotency check).
2. Create user + profile inside a single transaction.
3. `ON CONFLICT (line_id) DO NOTHING` on profiles insert so concurrent LINE logins return the existing user.
4. If profile exists → return existing user's session (idempotent login).

**Duplicate email guard (LINE & Facebook):** If provider `email` already exists on a different account → **Return 409**, require manual link via `/auth/link-account`. No auto-link.


---

## 5. Phone Number + OTP (Supabase Phone Auth)

### 5.1 Supabase Phone Auth Capabilities

| Feature | Supported | Notes |
|---------|-----------|-------|
| Sign up with phone | ✅ | `supabase.auth.signUp({ phone, password })` |
| Send OTP (SMS) | ✅ | `supabase.auth.signInWithOtp({ phone })` |
| Verify OTP | ✅ | `supabase.auth.verifyOtp({ phone, token, type: 'sms' })` |
| Phone as primary identifier | ✅ | `auth.users.phone` UNIQUE |
| SMS Provider | ⚠️ | ต้อง config Twilio/MessageBird/Vonage ใน Supabase Dashboard |
| Rate limiting | ✅ | Built-in (configurable) |
| MFA via SMS | ✅ | `supabase.auth.mfa.enroll({ factorType: 'phone' })` |

### 5.2 Registration Flow (Phone + OTP)

```
POST /auth/register-phone
  Input: { phone, name? }
  1. Validate phone format (TH: +66xxxxxxxxx)
  2. Check profiles.phone UNIQUE
  3. supabase.auth.signInWithOtp({ phone })  // ส่ง OTP
  4. Return: { message: "OTP sent", phone }

POST /auth/verify-phone
  Input: { phone, otp, name? }
  1. supabase.auth.verifyOtp({ phone, token: otp, type: 'sms' })
  2. ได้ session → user
  3. Upsert profile (id = user.id, phone, name, role: 'customer')
  4. Return: { user: profile, accessToken, refreshToken }
```

### 5.3 Login Flow (Phone + OTP)

```
POST /auth/login-phone
  Input: { phone }
  1. supabase.auth.signInWithOtp({ phone })
  2. Return: { message: "OTP sent" }

POST /auth/verify-phone (same as register)
```

### 5.4 Resend OTP & Rate Limiting

- Supabase จัดการ rate limit เอง (default: 60s cooldown, 3 attempts/hr)
- Backend expose `POST /auth/resend-otp` → `supabase.auth.signInWithOtp({ phone })`
- Frontend: Countdown timer 60s ก่อนปุ่ม "Resend" ใช้งานได้

### 5.5 Phone Verification Required

- `phone_confirmed_at` ใน `auth.users` ต้องไม่เป็น null
- Middleware ตรวจ: `if (!user.phone_confirmed_at) return 403 "Phone not verified"`
- Profile `phone_verified: true` (custom column) หรืออ่านจาก `auth.users`

### 5.6 Schema Conflict: `profiles.email NOT NULL`

**ปัญหา**: Migration `001_initial_schema.sql` line 29: `email TEXT UNIQUE NOT NULL`

**แนวทางแก้ (ไม่แก้ migration ในรอบนี้ — แค่วางแผน):**

1. **Short-term (Application Level)**:
   - สร้าง user ด้วย `email: "phone-${phone}@kindee.local"` (placeholder)
   - `profiles.email` = placeholder, `profiles.phone` = real phone
   - RLS/Logic ใช้ `phone` เป็น primary สำหรับ phone-only accounts
   - Frontend ซ่อน placeholder email

2. **Long-term (Migration Required — Deferred, NOT Phase 1A)**:
   ```sql
   ALTER TABLE profiles ALTER COLUMN email DROP NOT NULL;
   -- เพิ่ม constraint: email OR phone ต้องมีอย่างน้อย 1
   ALTER TABLE profiles ADD CONSTRAINT profiles_email_or_phone_check 
     CHECK (email IS NOT NULL OR phone IS NOT NULL);
   ```
   - รันผ่าน Supabase Migration (version 005+) — **ไม่ใช่ส่วนของ Phase 1A** (Phase 1A = code-only)
   - Migration `005_profiles_email_nullable.sql` ไม่ได้ถูกสร้างในรอบนี้ (มีเฉพาะ 001–004)

**แผนนี้เลือก Short-term ก่อน** เพื่อไม่ block การพัฒนา

### 5.7 SMS Provider Setup (Supabase Dashboard)

1. Supabase Dashboard → Authentication → Phone Provider
2. เลือก Provider: Twilio / MessageBird / Vonage / Custom
3. ใส่ credentials (Account SID, Auth Token, From Number)
4. ทดสอบส่ง OTP ไปเบอร์ไทย (+66)

---

## 6. การรักษาบัญชีสมาชิกเดิมจาก MongoDB (Data Migration)

### 6.1 Migration Scope

| Data | Source (MongoDB) | Target (Supabase) |
|------|------------------|-------------------|
| User Identity | `users._id` (ObjectId) | `auth.users.id` (UUID) + `profiles.legacy_id` |
| Email | `users.email` | `auth.users.email` + `profiles.email` |
| Phone | `users.phone` | `auth.users.phone` + `profiles.phone` |
| Password Hash | `users.password` (bcrypt) | `auth.users.encrypted_password` (via `password_hash` param) |
| Name | `users.name` | `profiles.name` + `auth.users.user_metadata.name` |
| Avatar | `users.avatar` | `profiles.avatar_url` + `auth.users.user_metadata.avatar_url` |
| Role | `users.role` | `profiles.role` |
| Status | `users.isActive` | `profiles.is_active` |
| OAuth IDs | `googleId`, `facebookId`, `lineId` | `auth.users.user_metadata.{google,facebook,line}_id` + `identities[]` |
| Created At | `users.createdAt` | `profiles.created_at` (set manually) |

### 6.2 Password Hash Migration (Critical)

**Supabase `createUser` รองรับ `password_hash` parameter** (bcrypt format):

```javascript
const { data, error } = await supabaseAdmin.auth.admin.createUser({
  email: user.email,
  phone: user.phone,
  password_hash: user.password,  // bcrypt hash จาก MongoDB
  email_confirm: true,  // migrated users = verified
  user_metadata: { ... }
})
```

**เงื่อนไข**: MongoDB ใช้ `bcryptjs` รุ่นเดียวกับ Supabase (default cost 10) → **รองรับได้**

**ทดสอบก่อน migrate**: เขียน script ทดสอบ login ด้วย hash ที่ migrate ไป

### 6.3 Migration Script Design

```javascript
// scripts/migrate-mongodb-to-supabase.js
// รันครั้งเดียว บนเครื่อง admin / CI job

async function migrate() {
  const mongoUsers = await MongoUser.find({ migrated: { $ne: true } });
  
  for (const mongoUser of mongoUsers) {
    try {
      // 1. Prepare metadata
      const metadata = {
        name: mongoUser.name,
        avatar_url: mongoUser.avatar,
        legacy_id: mongoUser._id.toString(),
        // OAuth IDs
        ...(mongoUser.googleId && { google_id: mongoUser.googleId }),
        ...(mongoUser.facebookId && { facebook_id: mongoUser.facebookId }),
        ...(mongoUser.lineId && { line_id: mongoUser.lineId }),
      };

      // 2. Create Supabase Auth User
      const { data: authUser, error: authError } = await supabaseAdmin.auth.admin.createUser({
        email: mongoUser.email,
        phone: mongoUser.phone,
        password_hash: mongoUser.password,  // bcrypt hash
        email_confirm: !!mongoUser.email,   // verified if has email
        phone_confirm: !!mongoUser.phone,
        user_metadata: metadata,
      });

      if (authError) throw authError;

      // 3. Create Profile
      const { error: profileError } = await supabaseAdmin
        .from('profiles')
        .insert({
          id: authUser.user.id,
          email: mongoUser.email,
          phone: mongoUser.phone,
          name: mongoUser.name,
          avatar_url: mongoUser.avatar,
          role: mongoUser.role,
          is_active: mongoUser.isActive,
          legacy_id: mongoUser._id.toString(),
          created_at: mongoUser.createdAt,
          updated_at: mongoUser.updatedAt,
        });

      if (profileError) {
        // Rollback auth user
        await supabaseAdmin.auth.admin.deleteUser(authUser.user.id);
        throw profileError;
      }

      // 4. Mark MongoDB migrated
      await MongoUser.updateOne({ _id: mongoUser._id }, { $set: { migrated: true, supabase_id: authUser.user.id } });

      console.log(`Migrated: ${mongoUser.email || mongoUser.phone}`);
    } catch (err) {
      console.error(`Failed: ${mongoUser._id}`, err);
      // Log to failed_migrations collection for manual review
    }
  }
}
```

### 6.4 OAuth Identity Migration

- **Google**: `googleId` → `user_metadata.google_id` + `identities` array
- **Facebook**: `facebookId` → `user_metadata.facebook_id` + `identities` array  
- **LINE**: `lineId` → `user_metadata.line_id` + `identities` array

**Supabase `identities` array format**:
```json
[
  { "provider": "google", "identity_data": { "sub": "googleId" }, "id": "uuid" },
  { "provider": "facebook", "identity_data": { "sub": "facebookId" }, "id": "uuid" }
]
```
→ ใช้ `supabaseAdmin.auth.admin.updateUserById(id, { identities: [...] })`

### 6.5 Foreign Key Mapping & Data Integrity (Before/After Migration)

**ก่อน Migration (Pre-Migration Checklist):**

1. **Inventory FK ทั้งหมดที่อ้างอิง `profiles.id`:**
   - นับ FK columns ใน tables: `stores`, `orders`, `messages`, `reviews`, `notifications`, `cart_items`, `wishlists`, `payments`, `disputes`
   - 確認ว่า FK columns ทั้งหมดชี้ไปที่ `profiles.id` (ไม่มี orphan)

2. **Check orphan records:**
   ```sql
   -- หา records ที่ FK ชี้ไป profiles ที่ไม่มีอยู่
   SELECT 'stores' AS tbl, owner_id FROM stores WHERE owner_id NOT IN (SELECT id FROM profiles)
   UNION ALL
   SELECT 'orders', customer_id FROM orders WHERE customer_id NOT IN (SELECT id FROM profiles)
   UNION ALL
   SELECT 'messages', sender_id FROM messages WHERE sender_id NOT IN (SELECT id FROM profiles)
   UNION ALL
   SELECT 'reviews', user_id FROM reviews WHERE user_id NOT IN (SELECT id FROM profiles)
   -- ... ทำซ้ำสำหรับ tables ทั้งหมด
   ```

3. **Verify profiles.id = auth.users.id:**
   ```sql
   SELECT COUNT(*) FROM profiles p 
   LEFT JOIN auth.users u ON p.id = u.id 
   WHERE u.id IS NULL;
   -- ต้องเป็น 0
   ```

4. **Count comparison:**
   - จำนวน user ใน MongoDB vs Supabase auth.users
   - จำนวน profile ใน Supabase vs MongoDB users

**หลัง Migration (Post-Migration Checklist):**

1. **Re-run FK inventory** → เปรียบเทียบ counts ก่อน-หลัง
2. **Spot-check FK integrity** บน 5-10 records ในแต่ละ table
3. **Verify no new orphan records** ที่เกิดจาก migration
4. **Verify legacy_id populated** ทุก profile (สำหรับ traceability)
5. **Data integrity report**: สรุป counts, orphans, mismatches

### 6.6 Post-Migration Verification

1. **Spot-check login**: ลอง login ด้วย email/password ของ user ที่ migrate
2. **OAuth link test**: ลอง login Google/Facebook/LINE ด้วยบัญชีเดิม → ต้องเข้าได้
3. **Data integrity**: นับจำนวน user ใน MongoDB vs Supabase
4. **Rollback plan**: เก็บ MongoDB backup ไว้ 30 วัน

### 6.7 Deprecation Timeline

| Phase | Action |
|-------|--------|
| **Week 1** | Run migration script (staging) → Test thoroughly |
| **Week 2** | Run migration (production) → Monitor errors |
| **Week 3** | Remove MongoDB Auth code (`authController.js`, `User.js`, `db.js` connect) |
| **Week 4** | Drop MongoDB `users` collection (after backup verified) |

---

## 7. Implementation Checklist (Priority Order)

### Phase 1: Core Infrastructure (Week 1)
- [ ] **Remove custom JWT** from `middleware/auth.js` (delete `generateToken`, `generateRefreshToken`, `verifyRefreshToken`)
- [ ] **Update `verifyToken`** ใช้ `supabaseAuth.auth.getUser()` เท่านั้น
- [ ] **Fix `authRoutes.js`**: Add `/auth/line` endpoint → `authService.socialLogin('line', ...)`
- [ ] **Implement LINE in `authService.socialLogin`** (Custom flow, not Supabase built-in)
- [ ] **Fix Facebook in `authService`**: ใช้ `debug_token` + `me` API (เหมือน `authController.js`) แทน `signInWithIdToken`

**Phone OTP ไม่ได้รวมอยู่ใน Phase 1 Core Infrastructure** — ดูขั้นตอนใน Phase 2 ด้านล่าง

### Phase 2: Phone + OTP (Week 1-2)
- [ ] **Add endpoints** in `authRoutes.js`:
  - `POST /auth/register-phone`
  - `POST /auth/login-phone`
  - `POST /auth/verify-phone`
  - `POST /auth/resend-otp`
- [ ] **Implement in `authService`** ใช้ `supabase.auth.signInWithOtp` + `verifyOtp`
- [ ] **Handle email NOT NULL** → ใช้ placeholder `phone-${phone}@kindee.local`
- [ ] **Configure SMS Provider** ใน Supabase Dashboard (Twilio/MessageBird)
- [ ] **Validate Phone Format**: TH: +66xxxxxxxxx
- [ ] **Rate Limiting**: Supabase built-in (60s cooldown, 3 attempts/hr)
- [ ] **Phone Verification Required**: `phone_confirmed_at` not null

### Phase 3: Email + Password Hardening (Week 2)
- [ ] **Change `email_confirm: false`** ใน `registerUser`
- [ ] **Add Forgot/Reset Password endpoints**:
  - `POST /auth/forgot-password`
  - `POST /auth/reset-password`
- [ ] **Configure Email Provider** ใน Supabase Cloud Dashboard:
  - Supabase Dashboard → Authentication → Email Providers
  - เลือก: SendGrid / Resend / Mailgun / Custom SMTP
  - ใส่ credentials ตรงกับ provider ที่เลือก (Dashboard แสดง fields ที่ต้องการ)
  - ปิดส่วน SMTP manual config ใน `.env` (ถ้าไม่ได้ใช้ Custom SMTP)
- [ ] **Email templates** (Verify, Reset Password) ใน Supabase Auth settings
- [ ] **Test email delivery**: ลอง register Checkว่าได้รับ verification email ไหม

### Phase 3.1: Current Platform (React + Vite Web) — Dedicated Scope

**Planned for Current Platform only:**
- [ ] Email + Password (register, login, forgot, reset, change)
- [ ] Facebook Login (วิธี A: FB JS SDK + Backend verify)
- [ ] LINE Login (OAuth Redirect + Backend exchange code)
- [ ] Account Linking (Settings page UI)
- [ ] Logout with global revoke (default scope)

** NOT in Current Platform scope (Future Native only):**
- Native Android/iOS SDK integration
- Biometric auth (optional enhancement)
- Push notification token binding
- Deep linking OAuth callback for native apps

### Phase 4: Account Linking (Week 2-3)
- [ ] **Add `POST /auth/link-account`** endpoint
- [ ] **Implement linking logic**: verify ownership → `supabase.auth.linkIdentity()`
- [ ] **Frontend**: Settings page "Connected Accounts" UI

### Phase 5: MongoDB Migration (Week 3)
- [ ] **Write migration script** (test on staging)
- [ ] **Run migration** (production)
- [ ] **Verify**: login, OAuth, profile data
- [ ] **Remove MongoDB Auth code**: `authController.js`, `User.js`, `config/db.js` (keep for other models)

### Phase 6: Cleanup & Polish (Week 3-4)
- [ ] **Remove unused dependencies**: `bcryptjs`, `jsonwebtoken` (ถ้าไม่ใช้ที่อื่น), `google-auth-library` (ถ้าไม่ใช้ที่อื่น)
- [ ] **Update Frontend**: ใช้ Supabase JS SDK ตรงๆ สำหรับ OAuth (optional, ปัจจุบันผ่าน backend ก็ได้)
- [ ] **Load test**: 1000 concurrent login
- [ ] **Security audit**: Rate limiting, token rotation, session revocation

---

## 8. API Contract Summary (Final)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/auth/register` | ❌ | Email + Password register |
| POST | `/auth/login` | ❌ | Email/Phone + Password login |
| POST | `/auth/refresh` | ❌ | Refresh access token |
| POST | `/auth/forgot-password` | ❌ | Request password reset email |
| POST | `/auth/reset-password` | ❌ | Reset password with token |
| POST | `/auth/google` | ❌ | Google login (ID token) |
| POST | `/auth/facebook` | ❌ | Facebook login (access token) |
| POST | `/auth/line` | ❌ | LINE login (auth code) |
| POST | `/auth/register-phone` | ❌ | Request OTP for registration |
| POST | `/auth/login-phone` | ❌ | Request OTP for login |
| POST | `/auth/verify-phone` | ❌ | Verify OTP + create/login |
| POST | `/auth/resend-otp` | ❌ | Resend OTP |
| POST | `/auth/link-account` | ✅ | Link OAuth provider |
| GET | `/auth/profile` | ✅ | Get current user profile |
| PUT | `/auth/profile` | ✅ | Update profile |
| PUT | `/auth/password` | ✅ | Change password |
| POST | `/auth/logout` | ✅ | Logout (revoke session) |
| DELETE | `/auth/account` | ✅ | Deactivate account |

---

## 9. Environment Variables Required

```env
# Supabase (Already configured)
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# OAuth Providers (Configure in Supabase Dashboard + these for backend verification)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
FACEBOOK_APP_ID=
FACEBOOK_APP_SECRET=
LINE_CHANNEL_ID=
LINE_CHANNEL_SECRET=

# SMS Provider (Configure in Supabase Dashboard)
# TWILIO_ACCOUNT_SID=
# TWILIO_AUTH_TOKEN=
# TWILIO_PHONE_NUMBER=

# Email Provider (Configure in Supabase Cloud Dashboard)
# Supabase Cloud Dashboard → Authentication → Email Providers
# Select: SendGrid / Resend / Mailgun / Custom SMTP
# For Custom SMTP only: Supabase Dashboard shows SMTP fields to fill
# Do NOT set SMTP_HOST/PORT/USER/PASS in .env unless using Custom SMTP provider
# Email sending is managed by Supabase Cloud (no backend SMTP code needed)

# Frontend URL (for OAuth redirects)
CLIENT_URL=http://localhost:3000

# JWT Secret (for legacy token verification during transition only)
JWT_SECRET=
```

---

## 10. Risk Assessment & Mitigation

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Password hash migration fails | Medium | High | Test script thoroughly on staging; keep MongoDB backup |
| LINE email missing → duplicate accounts | Medium | Medium | Enforce phone/email verification post-login; account linking flow |
| SMS OTP not delivered (Thailand) | Low | High | Test with multiple providers; fallback to email OTP |
| Supabase rate limits hit | Low | Medium | Configure rate limits; implement exponential backoff |
| Session conflict (two token systems) | High | High | **Phase 1: Remove custom JWT immediately** |
| RLS policy blocks legitimate access | Low | High | Test all roles thoroughly; use service_role for admin ops |

---

## 11. Testing Scenarios (Must Pass Before Deploy)

### Auth Flows
- [ ] Register email+password → verify email → login
- [ ] Login wrong password → 401
- [ ] Login unverified email → 400 "Verify email"
- [ ] Forgot password → reset → login with new password
- [ ] Google login (new user) → create profile → login
- [ ] Google login (existing email) → link account flow
- [ ] Facebook login (new user) → create profile → login
- [ ] Facebook login (existing email) → link account flow
- [ ] LINE login (new user, has email) → create profile → login
- [ ] LINE login (new user, no email) → create with placeholder → require phone verify
- [ ] Register phone → OTP → verify → login
- [ ] Login phone → OTP → verify → login
- [ ] Resend OTP rate limit works
- [ ] Change password (authenticated)
- [ ] Logout → token invalidated
- [ ] Deactivate account → cannot login

### Migration
- [ ] Migrated user login with old password
- [ ] Migrated user Google/Facebook/LINE login
- [ ] Migrated user profile data correct
- [ ] Legacy_id populated for traceability

### Security
- [ ] Role escalation blocked (user cannot change own role)
- [ ] Owner role protected (admin cannot demote)
- [ ] Suspended user cannot login
- [ ] Rate limiting on auth endpoints
- [ ] Token refresh rotates refresh token
- [ ] Logout revokes all sessions

---

## 12. Files to Modify (Reference)

| File | Changes |
|------|---------|
| `backend/middleware/auth.js` | **REMOVE** custom JWT functions; **FIX** `verifyToken` |
| `backend/services/authService.js` | **ADD** LINE, Phone OTP, Forgot/Reset, Link Account |
| `backend/routes/authRoutes.js` | **ADD** endpoints for Phone, Forgot/Reset, LINE, Link |
| `backend/controllers/authController.js` | **DEPRECATE** (remove after migration) |
| `backend/models/User.js` | **DEPRECATE** (remove after migration) |
| `backend/config/db.js` | **REMOVE** MongoDB connect for auth (keep for other models) |
| `supabase/migrations/005_profiles_email_nullable.sql` | **NEW** migration for phone-only accounts — **deferred, NOT Phase 1A** (Phase 1A = code-only; file not yet created, only 001–004 exist) |
| `frontend/src/context/AuthContext.jsx` | **UPDATE** to use new endpoints |
| `frontend/src/api/auth.js` | **ADD** new API methods |
| `frontend/src/components/SocialAuth.jsx` | **CONNECT** LINE handler |
| `frontend/src/pages/Auth/*.jsx` | **UPDATE** UI for new flows |

---

**End of Plan** — รอบนี้เป็น **วางแผนเท่านั้น** ห้ามแก้ไขไฟล์ใดๆ