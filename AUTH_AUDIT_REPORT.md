# Kindee Marketplace — Phase 1: Authentication Pre-Implementation Audit Report

**Date:** 2026-11-15  
**Scope:** READ-ONLY audit of current authentication architecture before Phase 1 implementation  
**Source Files Analyzed:** All backend auth routes, services, middleware, controllers, models, and frontend auth context, API modules, and social auth components

---

## 1. Current Architecture

### 1.1 Dual Authentication Systems (CONFIRMED)

| System | Location | Technology | Status |
|--------|----------|------------|--------|
| **MongoDB Auth (Legacy)** | `backend/controllers/authController.js`, `backend/models/User.js`, `backend/routes/auth.js`, `backend/middleware/auth.js` (old) | bcrypt + custom JWT (`jsonwebtoken`), Mongoose | **Active** — used by some routes |
| **Supabase Auth (New)** | `backend/services/authService.js`, `backend/routes/authRoutes.js`, `backend/middleware/auth.js` (new), `backend/config/supabase.js` | Supabase Auth (GoTrue) + Supabase JWT | **Active** — used by new routes |

**Evidence:**
- `backend/server.js` imports only Supabase config, fails fast if Supabase not configured (lines 14-22)
- `backend/routes/index.js` mounts `authRoutes` (new) at `/api/auth` (line 18)
- `backend/routes/auth.js` (old) exists but **NOT mounted** in `routes/index.js`
- `backend/config/db.js` still connects MongoDB for Store model (line 12)

### 1.2 Token Systems Conflict (CONFIRMED)

**Two JWT systems coexist in `backend/middleware/auth.js`:**

```javascript
// Lines 182-205: Custom JWT functions (LEGACY)
export const generateToken = (user) => { ... }
export const generateRefreshToken = (user) => { ... }
export const verifyRefreshToken = (token) => { ... }

// Lines 11-83: Supabase JWT verification with FALLBACK to custom JWT
const { data: { user }, error } = await supabaseAuth.auth.getUser(token);
if (error || !user) {
  // Fallback to custom JWT verification (lines 28-40)
  const decoded = jwt.verify(token, JWT_SECRET);
  ...
}
```

**Conflict:** `authService.js` **uses custom JWT** (lines 60-61, 108-109, 190-191) while middleware **verifies Supabase JWT first**.

---

## 2. Authentication Flow per Channel

### 2.1 Email + Password

| Flow | Backend Endpoint | Service Method | Token Type | Status |
|------|------------------|----------------|------------|--------|
| Register | `POST /auth/register` | `authService.registerUser()` | **Custom JWT** | Works but `email_confirm: true` (auto-confirms) ❌ |
| Login | `POST /auth/login` | `authService.loginUser()` | **Custom JWT** | Works |
| Refresh | `POST /auth/refresh` | `authService.refreshAccessToken()` | **Custom JWT** | Works |
| Forgot Password | `POST /auth/forgot-password` | **NOT IMPLEMENTED** in new routes | — | Missing |
| Reset Password | `POST /auth/reset-password` | **NOT IMPLEMENTED** in new routes | — | Missing |
| Change Password | `PUT /auth/password` | `authService.changePassword()` | Uses Supabase | Works |
| Logout | `POST /auth/logout` | `authService.logoutUser()` | Calls `supabase.auth.signOut()` | Works |
| Deactivate | `DELETE /auth/account` | `authService.deactivateAccount()` | Revokes Supabase sessions | Works |

**Critical Issue:** `registerUser()` uses `email_confirm: true` (line 31) — **bypasses email verification** (violates plan requirement `email_confirm: false`).

### 2.2 Google Login

| Component | Implementation | Token Type Sent | Verification Method |
|-----------|----------------|-----------------|---------------------|
| Frontend | Google GIS (`google.accounts.id`) | **ID Token (JWT)** | `supabase.auth.signInWithIdToken({ provider: 'google', token: credential })` |
| Backend Route | `POST /auth/google` (authRoutes.js:66-78) | `credential` (ID Token) | Supabase built-in |
| Service | `authService.socialLogin('google', credential)` | ID Token | Supabase `signInWithIdToken` |

**Status:** ✅ **Correct** — Uses ID Token with Supabase native OAuth.

### 2.3 Facebook Login

| Component | Implementation | Token Type Sent | Verification Method |
|-----------|----------------|-----------------|---------------------|
| Frontend | Facebook JS SDK (`FB.login()`) | **Access Token** (OAuth token, NOT JWT) | `FB.api('/me', ...)` |
| Backend Route | `POST /auth/facebook` (authRoutes.js:81-93) | `accessToken` | `authService.socialLogin('facebook', accessToken)` |
| Service (NEW) | `authService.socialLogin()` lines 136-143 | **Access Token** → `supabase.auth.signInWithIdToken({ provider: 'facebook', token: accessToken })` | ❌ **WRONG** — `signInWithIdToken` requires **ID Token (JWT)**, not Access Token |
| Controller (OLD) | `authController.facebookLogin()` lines 211-269 | Access Token → `debug_token` + `me` API | ✅ **CORRECT** — Verifies via Facebook Graph API |

**Critical Issue:** New `authService.socialLogin()` for Facebook **will fail** because it sends Access Token to `signInWithIdToken()` which expects ID Token. The old `authController.js` correctly uses `debug_token` + Graph API.

### 2.4 LINE Login

| Component | Implementation | Status |
|-----------|----------------|--------|
| Frontend | OAuth Redirect to `access.line.me/oauth2/v2.1/authorize` | ✅ Implemented in Login.jsx (lines 152-165) & Register.jsx (lines 161-167) |
| Backend Route | `POST /auth/line` — **NOT EXIST** in `authRoutes.js` | ❌ **MISSING** |
| Service | `authService.socialLogin('line', ...)` throws `501 Not Implemented` (line 145-147) | ❌ **MISSING** |
| Controller (OLD) | `authController.lineLogin()` lines 271-356 | ✅ **FULLY IMPLEMENTED** — Code exchange, ID Token verification, user creation |

**Critical Issue:** New auth system **completely lacks LINE endpoint and service implementation**. Old controller has full working implementation.

### 2.5 Phone Number + OTP

| Component | Status |
|-----------|--------|
| Backend Routes | **NOT IMPLEMENTED** in `authRoutes.js` |
| Service Methods | **NOT IMPLEMENTED** in `authService.js` |
| Frontend UI | Not present |
| Plan | Phase 2 (not Phase 1) |

---

## 3. Issues Found (with File & Line References)

### 3.1 Critical — Token System Conflict

| # | Issue | File | Line | Severity |
|---|-------|------|------|----------|
| 1 | Custom JWT functions (`generateToken`, `generateRefreshToken`, `verifyRefreshToken`) exist alongside Supabase JWT | `backend/middleware/auth.js` | 182-205 | **CRITICAL** |
| 2 | `verifyToken` middleware falls back to custom JWT if Supabase verification fails | `backend/middleware/auth.js` | 27-40 | **CRITICAL** |
| 3 | `authService` generates **custom JWT** instead of using Supabase session tokens | `backend/services/authService.js` | 60-61, 108-109, 190-191 | **CRITICAL** |
| 4 | `refreshAccessToken` uses custom `verifyRefreshToken` | `backend/services/authService.js` | 287-310 | **CRITICAL** |
| 5 | `logoutUser` calls `supabase.auth.signOut()` but tokens are custom JWT | `backend/services/authService.js` | 314-324 | **HIGH** |

### 3.2 Critical — Facebook OAuth Broken

| # | Issue | File | Line | Severity |
|---|-------|------|------|----------|
| 6 | `socialLogin('facebook')` sends Access Token to `signInWithIdToken()` which requires ID Token | `backend/services/authService.js` | 136-143 | **CRITICAL** |
| 7 | No fallback to Graph API verification like old `authController` | `backend/services/authService.js` | 119-198 | **CRITICAL** |

### 3.3 Critical — LINE Login Missing

| # | Issue | File | Line | Severity |
|---|-------|------|------|----------|
| 8 | No `/auth/line` route in `authRoutes.js` | `backend/routes/authRoutes.js` | — | **CRITICAL** |
| 9 | `socialLogin('line')` throws 501 | `backend/services/authService.js` | 145-147 | **CRITICAL** |

### 3.4 High — Email Verification Bypassed

| # | Issue | File | Line | Severity |
|---|-------|------|------|----------|
| 10 | `registerUser()` uses `email_confirm: true` (auto-confirms) | `backend/services/authService.js` | 31 | **HIGH** |
| 11 | No Forgot/Reset Password endpoints in new routes | `backend/routes/authRoutes.js` | — | **HIGH** |
| 12 | No Forgot/Reset Password service methods | `backend/services/authService.js` | — | **HIGH** |

### 3.5 High — Profile Schema Conflict

| # | Issue | File | Line | Severity |
|---|-------|------|------|----------|
| 13 | `profiles.email` is `UNIQUE NOT NULL` (migration 001 line 29) — blocks phone-only accounts | `supabase/migrations/001_initial_schema.sql` | 29 | **HIGH** |
| 14 | `registerUser` allows phone-only but profile insert will fail on NOT NULL email | `backend/services/authService.js` | 17-24, 40-51 | **HIGH** |

### 3.6 Medium — Legacy MongoDB Artifacts

| # | Issue | File | Line | Severity |
|---|-------|------|------|----------|
| 15 | `backend/routes/auth.js` (old) exists but unused | `backend/routes/auth.js` | — | **MEDIUM** |
| 16 | `backend/controllers/authController.js` (old) fully implemented but unused | `backend/controllers/authController.js` | — | **MEDIUM** |
| 17 | `backend/models/User.js` (MongoDB) still exists | `backend/models/User.js` | — | **MEDIUM** |
| 18 | `backend/config/db.js` connects MongoDB for non-auth models | `backend/config/db.js` | 7-12 | **MEDIUM** |
| 19 | Frontend `authAPI` in `src/api/auth.js` duplicates `src/api/index.js` | `frontend/src/api/auth.js` | — | **MEDIUM** |

### 3.7 Medium — Account Linking Missing

| # | Issue | File | Line | Severity |
|---|-------|------|------|----------|
| 20 | No `/auth/link-account` endpoint | `backend/routes/authRoutes.js` | — | **MEDIUM** |
| 21 | No account linking service logic | `backend/services/authService.js` | — | **MEDIUM** |
| 22 | No duplicate email guard in social login (auto-creates/links) | `backend/services/authService.js` | 158-184 | **MEDIUM** |

### 3.8 Low — Frontend Inconsistencies

| # | Issue | File | Line | Severity |
|---|-------|------|------|----------|
| 23 | Two auth API modules: `src/api/auth.js` and `src/api/index.js` (different `request` implementations) | `frontend/src/api/auth.js`, `frontend/src/api/index.js` | — | **LOW** |
| 24 | `AuthContext` uses `authAPI` from `src/api/auth.js` but `src/api/index.js` has more methods | `frontend/src/context/AuthContext.jsx` | 2 | **LOW** |
| 25 | Login/Register pages handle LINE callback but no `/auth/line` backend endpoint | `frontend/src/pages/Login.jsx` | 50-65 | **LOW** |

---

## 4. What Works & Must Be Preserved

| Component | Status | Notes |
|-----------|--------|-------|
| **Supabase Auth Infrastructure** | ✅ Working | `supabase.js` config, admin/client separation |
| **Profiles Table & RLS** | ✅ Working | Migration 001, 002, 003 complete |
| **Google Login (New)** | ✅ Working | ID Token + `signInWithIdToken` |
| **Facebook Login (Old Controller)** | ✅ Working | `debug_token` + Graph API in `authController.js:211-269` |
| **LINE Login (Old Controller)** | ✅ Working | Full OAuth code exchange + ID Token verify in `authController.js:271-356` |
| **Email/Password Login (New)** | ⚠️ Works but uses custom JWT | Must migrate to Supabase session tokens |
| **Profile CRUD** | ✅ Working | `getProfile`, `updateProfile` |
| **Change Password** | ✅ Working | Uses Supabase `updateUserById` |
| **Logout/Deactivate** | ✅ Working | Revokes Supabase sessions |
| **Role-based Auth (`authorize`)** | ✅ Working | Middleware checks `req.user.role` |
| **Social Config API** | ✅ Working | `/settings/public/social-config` reads from DB + env |

---

## 5. Risks to Existing MongoDB Accounts

| Risk | Likelihood | Impact | Evidence |
|------|------------|--------|----------|
| **Password hash migration failure** | Medium | High | Plan uses `password_hash` param (bcrypt cost 10) — need staging test |
| **Duplicate accounts on OAuth login** | High | Medium | New `socialLogin` auto-creates profile if email exists (line 158-184) — **no guard** |
| **LINE email missing → orphan accounts** | Medium | Medium | LINE may not return email; plan requires phone verification post-login |
| **FK integrity (orders, stores, messages)** | Low | High | All FKs point to `profiles.id` (UUID); MongoDB `_id` (ObjectId) different — migration must map `legacy_id` |
| **Session conflict (two token systems)** | **High** | **High** | Custom JWT + Supabase JWT both valid simultaneously |

**Migration Data Mapping (from Plan):**
- MongoDB `users._id` → Supabase `profiles.legacy_id` (TEXT)
- MongoDB `password` (bcrypt) → Supabase `password_hash` param
- OAuth IDs (`googleId`, `facebookId`, `lineId`) → `user_metadata.{provider}_id` + `identities[]`

---

## 6. Files Requiring Changes in Phase 1

### 6.1 Must Fix (Critical Path)

| File | Changes Required |
|------|------------------|
| `backend/middleware/auth.js` | **REMOVE** lines 182-205 (`generateToken`, `generateRefreshToken`, `verifyRefreshToken`); **REMOVE** fallback to custom JWT (lines 27-40); `verifyToken` must use **only** `supabaseAuth.auth.getUser()` |
| `backend/services/authService.js` | **REPLACE** all `generateToken`/`generateRefreshToken` calls with Supabase session tokens; **FIX** `socialLogin('facebook')` to use Graph API like old controller; **IMPLEMENT** `socialLogin('line')` with code exchange; **CHANGE** `registerUser` to `email_confirm: false`; **ADD** `forgotPassword`, `resetPassword`, `linkAccount` methods |
| `backend/routes/authRoutes.js` | **ADD** endpoints: `/auth/line`, `/auth/forgot-password`, `/auth/reset-password`, `/auth/link-account`, `/auth/register-phone`, `/auth/login-phone`, `/auth/verify-phone`, `/auth/resend-otp` |
| `backend/config/supabase.js` | Verify `supabase` (anon client) is available for `signInWithPassword`, `signInWithOtp` |

### 6.2 Must Remove (Deprecation)

| File | Action |
|------|--------|
| `backend/routes/auth.js` | **DELETE** (old MongoDB auth routes, unused) |
| `backend/controllers/authController.js` | **DELETE** after migration verified (keep for reference during transition) |
| `backend/models/User.js` | **DELETE** after migration verified |
| `backend/config/db.js` | **REMOVE** MongoDB connect for auth; keep for Store/other models if needed |
| `frontend/src/api/auth.js` | **DELETE** (duplicate of `src/api/index.js`) |

### 6.3 Schema Migration (Post-Phase 1)

| File | Changes Required |
|------|------------------|
| `supabase/migrations/005_profiles_email_nullable.sql` | **NEW**: `ALTER TABLE profiles ALTER COLUMN email DROP NOT NULL; ADD CONSTRAINT profiles_email_or_phone_check CHECK (email IS NOT NULL OR phone IS NOT NULL);` |
| `supabase/migrations/006_line_id_unique.sql` | **NEW**: Unique partial index on `auth.users.user_metadata->>'line_id'` |

---

## 7. Safe Fix Sequence

| Step | Action | Files | Risk |
|------|--------|-------|------|
| **1** | Remove custom JWT from middleware | `middleware/auth.js` | Low — only affects new routes |
| **2** | Fix `verifyToken` to use only Supabase | `middleware/auth.js` | Low |
| **3** | Update `authService` to return Supabase session tokens | `services/authService.js` | Medium — test login/register |
| **4** | Implement Facebook Graph API verification in `authService` | `services/authService.js` | Medium — copy from `authController` |
| **5** | Implement LINE login in `authService` + add route | `services/authService.js`, `routes/authRoutes.js` | Medium — copy from `authController` |
| **6** | Change `registerUser` to `email_confirm: false` | `services/authService.js` | Low — requires email provider config |
| **7** | Add Forgot/Reset Password endpoints + service | `routes/authRoutes.js`, `services/authService.js` | Low — Supabase handles email |
| **8** | Add Account Linking endpoint + service | `routes/authRoutes.js`, `services/authService.js` | Medium — requires Supabase `linkIdentity()` |
| **9** | Remove old auth files | `routes/auth.js`, `controllers/authController.js`, `models/User.js` | Low — after verification |
| **10** | Clean up frontend duplicate API | `frontend/src/api/auth.js` | Low |
| **11** | Schema migration for phone-only accounts | New migration file | Medium — coordinate with Supabase |

---

## 8. Test Cases Required (Must Pass Before Deploy)

### Auth Flows
- [ ] Register email+password → **verify email required** → login fails until verified
- [ ] Login wrong password → 401
- [ ] Login unverified email → 400 "Verify email"
- [ ] Forgot password → reset email sent → reset → login with new password
- [ ] Google login (new user) → profile created → login success
- [ ] Google login (existing email) → **409 "Email exists, link in settings"**
- [ ] Facebook login (new user) → profile created → login success
- [ ] Facebook login (existing email) → **409 "Email exists, link in settings"**
- [ ] LINE login (new user, has email) → profile created → login success
- [ ] LINE login (new user, no email) → profile with placeholder → requires phone verify
- [ ] Change password (authenticated) → old password invalid
- [ ] Logout → access token rejected on subsequent requests
- [ ] Deactivate account → cannot login

### Migration
- [ ] Migrated user login with old bcrypt password
- [ ] Migrated user Google/Facebook/LINE login works
- [ ] Migrated user profile data correct (name, avatar, role)
- [ ] `legacy_id` populated for all migrated profiles
- [ ] FK integrity: orders, stores, messages, reviews all reference valid `profiles.id`

### Security
- [ ] User cannot change own role (RLS blocks)
- [ ] Admin cannot demote owner (middleware + RLS)
- [ ] Suspended user (`is_active=false`) cannot login
- [ ] Rate limiting on auth endpoints
- [ ] Token refresh rotates refresh token (Supabase default)
- [ ] Logout revokes session (Supabase `signOut()`)

---

## 9. Verification Status Summary

| Area | Status | Confidence |
|------|--------|------------|
| **Supabase as Single Source of Truth** | ❌ Not enforced — custom JWT fallback exists | Confirmed |
| **Email + Password (register/login/verify/reset)** | ⚠️ Partial — register auto-confirms, no forgot/reset | Confirmed |
| **Google Login** | ✅ Correct (ID Token + `signInWithIdToken`) | Confirmed |
| **Facebook Login** | ❌ Broken in new service (Access Token → `signInWithIdToken`) | Confirmed |
| **LINE Login** | ❌ Missing entirely in new routes/service | Confirmed |
| **Phone + OTP** | ❌ Not implemented (Phase 2) | Confirmed |
| **Account Linking** | ❌ Missing | Confirmed |
| **MongoDB Legacy Data** | 🔄 Exists, not migrated | Confirmed |
| **Cross-Platform (Web only)** | ✅ React + Vite Web, no native app yet | Confirmed |
| **OAuth Mobile Browser Support** | ✅ LINE redirect works; Google GIS works; FB SDK works | Confirmed |

---

## 10. Recommendations

1. **Immediate (Phase 1 Week 1):**
   - Remove custom JWT from middleware — this is the highest risk
   - Fix Facebook to use Graph API verification (copy from `authController.js`)
   - Implement LINE login (copy from `authController.js`)
   - Change `email_confirm: false` in registration

2. **Short-term (Phase 1 Week 1-2):**
   - Add Forgot/Reset Password endpoints
   - Add Account Linking endpoint with Supabase `linkIdentity()`
   - Add duplicate email guard in social login (return 409, not auto-link)

3. **Schema (Before Phone OTP):**
   - Create migration `005_profiles_email_nullable.sql` to allow phone-only accounts
   - Add unique partial index for LINE `sub` in `auth.users.user_metadata`

4. **Migration (Phase 3):**
   - Run migration script on staging first
   - Verify password hash migration works (bcrypt cost 10)
   - Spot-check 10+ migrated accounts for login + OAuth

5. **Cleanup (Phase 4):**
   - Remove all old MongoDB auth files
   - Consolidate frontend auth API to single module
   - Remove `bcryptjs`, `jsonwebtoken` from dependencies if unused elsewhere

---

**End of Audit Report** — Awaiting approval to begin Phase 1 Implementation.