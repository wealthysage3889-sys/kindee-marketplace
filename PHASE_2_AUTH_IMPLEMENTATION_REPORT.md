# Kindee Marketplace — Phase 2: Supabase Authentication Migration (Implementation Report)

**Status:** CODE COMPLETE (2A/2B/2C code + 2D design + migration SQL). No production data touched. No commit/push/deploy.
**Date:** 2026-11-16
**Scope executed:** Phase 2A (backend), 2B (frontend), 2C (LINE code, live test BLOCKED), 2D (design + runnable script), DB migration (SQL file only).
**Verification basis:** `node --test` (backend, 79 tests), `vite build` (frontend). Live Supabase / LINE / production flows are NOT tested (no staging creds, no LINE creds).

---

## 1. Files changed (all edits by this phase)

### Backend (modified)
| File | Change |
|------|--------|
| `backend/middleware/auth.js` | `verifyToken` primary path = Supabase `getUser` + profile load + `is_active` check; **legacy custom-JWT fallback now ALSO loads the profile from `profiles` and enforces `is_active`** (role read from `profiles.role`, never from the JWT claim). `optionalAuth` refactored to share the same profile loader. Custom JWT helpers (`generateToken`/`generateRefreshToken`/`verifyRefreshToken`/`JWT_SECRET`) **kept** as legacy fallback. |
| `backend/services/authService.js` | `registerUser`/`loginUser` now return **Supabase `access_token` + `refresh_token`** (via `signInWithPassword`, email or phone). `socialLogin` returns Supabase session; **Facebook switched to Graph API server-side verification** (`debug_token` + `/me`) + `resolveSocialUser`; **LINE** implemented via `lineLogin()` (code exchange + ID-token verify + profile fallback). `refreshAccessToken` uses Supabase `refreshSession` rotation, **with a legacy custom-JWT branch that keeps issuing legacy tokens (no password rotation)**. `logoutUser(refreshToken, userId)` revokes via `admin.signOut(userId)`. `changePassword` supports phone identifier. |
| `backend/routes/authRoutes.js` | Added `POST /auth/line`. `POST /auth/logout` now passes `req.user.id` (from `verifyToken`) so sessions are actually revoked. |

### Backend (new)
| File | Change |
|------|--------|
| `backend/scripts/migrateLegacyUsers.js` | Runnable legacy MongoDB→Supabase migration script (`--input=<json>`, `--dry-run`). Reuses original bcrypt hash via `password_hash`, never resets passwords, never duplicates, preserves role/profile/`legacy_id`/provider ids. NOT wired into the app; not executed. |
| `backend/__tests__/auth.test.mjs` | 10 unit tests for session rules (see §8). |

### Backend (test helper, additive)
| File | Change |
|------|--------|
| `backend/__tests__/helpers/fakeSupabase.mjs` | Added `.or()` support to the query builder and a `settings` table (needed by auth/ LINE tests). Additive; chat/pricing tests still pass. |

### Frontend (modified)
| File | Change |
|------|--------|
| `frontend/src/context/AuthContext.jsx` | Added **mount-time session validation** (`validateSession`): on load it calls `/auth/profile`; on 401 it refreshes once, else clears the dead session (prevents stale tokens being reused). Added **single-flight refresh guard** (`refreshInFlight`) so concurrent 401s don't race Supabase refresh-token rotation. Customer/admin namespaces unchanged. |
| `frontend/src/components/ProtectedRoute.jsx` | `mode="admin"` now **requires role admin/owner** (not just any admin-namespaced token). Prevents a non-admin token in the admin namespace from reaching `/selladmin`. Customer `allowedRoles` logic preserved. |
| `frontend/src/pages/Login.jsx` | LINE state is now **cryptographically random + validated** (was constant `"line_login"`). Uses `createLineState`/`validateLineState`; rejects callbacks with missing state. |
| `frontend/src/pages/Register.jsx` | Same LINE random-state fix (was `"line_register"`). |

### Frontend (new)
| File | Change |
|------|--------|
| `frontend/src/utils/lineState.js` | LINE `state` generation/storage/validation helper (sessionStorage, per-flow, consumed once). |

### Database (new — NOT executed)
| File | Change |
|------|--------|
| `supabase/migrations/006_social_provider_ids.sql` | Adds `profiles.google_id / facebook_id / line_id` (nullable) + partial unique indexes. Additive, backward-compatible, includes rollback + verification steps. **Not run.** |

**Not touched:** `.env`, `.env.example`, `.env.test`, `backend/controllers/authController.js` (orphaned/dead — see §9), `backend/config/supabase.js`, any non-auth route/service, `supabase/migrations/001–005`.

---

## 2. Problems found & root causes

1. **Two token systems coexisted.** `middleware/auth.js` verified Supabase JWT then fell back to a custom `jsonwebtoken` JWT; `authService` **issued custom JWTs** in register/login/social/refresh. Sessions were inconsistent and `logout` (bare `signOut()`) could not revoke custom JWTs. → Unified on Supabase session tokens; legacy JWT kept only as fallback.
2. **Legacy fallback trusted JWT claims for identity but not role.** Original fallback set `req.user = decoded` (JWT payload) and skipped `is_active`/profile. → Fallback now resolves the profile from `profiles` (role from `profiles.role`, `is_active` enforced).
3. **Facebook login was broken by design.** `socialLogin('facebook')` called `signInWithIdToken`, but the FB JS SDK returns a Graph API access token (not an OIDC ID token) that Supabase cannot consume. → Replaced with server-side `debug_token` + `/me` verification (same approach as the legacy controller).
4. **LINE login was unimplemented** (threw 501) and the frontend used a **constant `state`** (CSRF/replay hole). → Implemented server-side code exchange + ID-token verification + profile fallback; frontend now uses random, validated state.
5. **Frontend kept dead/stale sessions.** No validation on load; a revoked/expired token stayed in localStorage and was reused. → Added mount validation + single-flight refresh.
6. **Admin route guard trusted namespace, not role.** `ProtectedRoute mode="admin"` only checked `isAuthenticated`. → Now requires admin/owner role.
7. **Login payload shape mismatch (latent).** `api/auth.js` sends `{email}`, but `Login.jsx` authenticates via `AuthContext.login` → `api/index.js` which correctly sends `{emailOrPhone}`. No active bug (Login uses AuthContext), but the duplicate `api/auth.js` login remains a footgun. Left untouched to avoid scope creep (flagged in §9).
8. **Hardcoded admin credentials in repo** (`backend/scripts/createAdminSupabase.js` contains a plaintext password + admin email). Pre-existing; flagged as a security risk (§9). Not modified.

---

## 3. Fixes & rationale (summary)

- **Supabase = single session source.** Every login path returns `access_token` + `refresh_token` from Supabase. Custom JWT is only minted on the legacy refresh path (so unmigrated accounts keep working) and never for a fresh Supabase sign-in.
- **Role from `profiles.role` only.** Both the Supabase path and the legacy fallback load the profile and read `role` from the DB; the JWT `role` claim is never trusted for authorization.
- **`is_active` enforced** on every authenticated request (middleware) and at login/refresh.
- **No auto-link by email.** `resolveSocialUser` returns 409 when the social email already belongs to a different account.
- **No password reset for social/legacy.** Social-only accounts get a server-side random password that is rotated per login and **never returned/persisted**; accounts flagged `kindee_social_only` are the only ones rotated. Legacy refresh does **not** rotate the password.
- **Logout actually revokes** via `admin.signOut(userId)`.

---

## 4. Session architecture (after change)

```
Frontend (localStorage, per-namespace)
  kindee:customer:{token,refreshToken,user}   kindee:admin:{token,refreshToken,user}
        │  Authorization: Bearer <supabase access_token>
        ▼
Backend verifyToken
  1) supabaseAuth.auth.getUser(token)  ── success ──► load profiles row, check is_active, role=profiles.role
  2) (fallback) jwt.verify(token, JWT_SECRET) ─────► load profiles row, check is_active, role=profiles.role
        │  req.user = {id,email,name,role,avatar_url,phone}
        ▼
Role authorization: authorize(...roles) / verifyAdmin read req.user.role (from profiles)
```

- **Login (email/phone):** `signInWithPassword` → Supabase session → `{user, accessToken, refreshToken}`.
- **Google:** `signInWithIdToken` → Supabase session.
- **Facebook:** Graph API `debug_token` + `/me` → `resolveSocialUser` (find by `facebook_id`, else create with server password) → Supabase session.
- **LINE:** `/auth/line` → exchange code at LINE token endpoint → verify ID token (iss/aud/exp) or `/v2/profile` → `resolveSocialUser` by `line_id` → Supabase session.
- **Refresh:** Supabase `refreshSession` (rotates). Legacy custom-JWT refresh tokens keep working via legacy token issuance.
- **Logout:** `admin.signOut(userId)` revokes all sessions. Access tokens expire naturally (~1h); middleware `is_active` check bounds abuse.
- **Frontend recovery:** mount validation refreshes or clears dead sessions; single-flight refresh prevents rotation races.

---

## 5. Legacy compatibility

- **Legacy custom-JWT fallback preserved** in `verifyToken` (loads profile + enforces `is_active` + role from `profiles`). Not removed.
- **Legacy refresh tokens** still accepted by `/auth/refresh` and reissued as legacy tokens (no password mutation). Accounts upgrade to Supabase tokens on their next password login (now returns Supabase tokens).
- **No legacy data source is reachable** from this codebase anymore (mongoose/models removed). Therefore the legacy→Supabase data migration is delivered as a **runnable script + procedure** (Phase 2D) to be executed against a real MongoDB export on staging first.

---

## 6. LINE Login — done vs BLOCKED

### Implemented (code complete, unit-tested)
- Server-side **authorization code exchange** (`https://api.line.me/oauth2/v2.1/token`).
- **ID-token verification** at `https://api.line.me/oauth2/v2.1/verify` with `iss === https://access.line.me`, `aud === channelId`, `exp` check.
- **Fallback** to `https://api.line.me/v2/profile` (Bearer access token) when no `id_token`.
- **Identity key = LINE user id (`sub`/`userId`)** stored in `profiles.line_id` (migration 006) + `user_metadata`.
- **Idempotent repeat login** (find by `line_id`, no duplicate).
- **No email-only auto-link** (409 when email belongs to another account).
- **Missing-email support** via placeholder `line-{lineId}@kindee.local`.
- **Frontend random + validated `state`** (CSRF/replay protection), per-flow (login/register).
- Config read from `settings` table then env (`LINE_CHANNEL_ID` / `LINE_CHANNEL_SECRET` / `LINE_ENABLED`).

### BLOCKED (cannot verify live)
- **No `LINE_CHANNEL_ID` / `LINE_CHANNEL_SECRET`** in `backend/.env` (confirmed). Live end-to-end LINE login is **BLOCKED**. Not tested against the real LINE API.
- The `line_id`/`facebook_id`/`google_id` columns do not exist until **migration 006** is applied; until then Facebook/LINE profile inserts will error (fail-safe 500). This is expected and documented.

**Not claimed:** LINE was NOT tested against the live LINE platform.

---

## 7. Database migration required

**File:** `supabase/migrations/006_social_provider_ids.sql` (NOT executed).

- Adds `profiles.google_id`, `profiles.facebook_id`, `profiles.line_id` (all nullable TEXT).
- Adds partial UNIQUE indexes `idx_profiles_{google,facebook,line}_id` (only where NOT NULL).
- `email` stays `NOT NULL` (placeholder emails used for phone-only/social); no nullability change.
- Additive & backward compatible; RLS unchanged; includes rollback + verification SQL.

**Apply order:** stage first → verify (see file header) → production with approval.

---

## 8. Test results (evidence)

### Backend — `npm --prefix backend test` (node --test)
```
ℹ tests 79
ℹ pass 79
ℹ fail 0
```
Includes the new `backend/__tests__/auth.test.mjs` (10 tests, all PASS):
- PASS registerUser returns Supabase session tokens (no custom JWT)
- PASS loginUser rejects deactivated account (403)
- PASS loginUser returns Supabase session tokens
- PASS refreshAccessToken rotates a Supabase session
- PASS refreshAccessToken keeps a legacy custom JWT on the legacy path (no password rotation)
- PASS logoutUser revokes sessions via admin signOut
- PASS socialLogin rejects duplicate email on another account (409, no auto-link)
- PASS socialLogin rejects an invalid Facebook token (401)
- PASS lineLogin verifies iss/aud and rejects a wrong issuer (401)
- PASS lineLogin rejects when LINE is not configured (403)

Existing suites still green: chat (chat.test.mjs, chatApi.test.mjs), phone (17), pricing (14).

### Frontend — `npm --prefix frontend run build`
```
✓ 161 modules transformed.
✓ built in 3.12s
```
(The `AdminAccount.jsx` ">" esbuild warnings are pre-existing in a file not modified by this phase; build completes successfully.)

### Syntax/import checks
- `node --check` OK: `middleware/auth.js`, `services/authService.js`, `routes/authRoutes.js`, `scripts/migrateLegacyUsers.js`.
- Full route graph import OK: `routes/index.js` default export is a router; `authService` exports all expected functions incl. `lineLogin`, `resolveSocialUser`.

### Status legend
- **PASS** — proven by the automated tests/build above.
- **BLOCKED** — LINE live flow (no LINE credentials); Supabase live flows (no staging creds); migration execution (no approval / no staging project).
- **NOT TESTED** — real Facebook/Google live login, real Supabase signIn/refresh/signOut against a live project, migration 006 against a real DB, `migrateLegacyUsers.js` against real MongoDB data.

---

## 9. Remaining risks

1. **Hardcoded admin credentials in `backend/scripts/createAdminSupabase.js`** (plaintext password + admin email committed). High risk. Recommend rotating the password and moving it to env/secret management. (Not modified here.)
2. **Duplicate frontend auth API** `frontend/src/api/auth.js` (sends `{email}`) vs `api/index.js` (sends `{emailOrPhone}`). Not currently a bug (Login/Register use AuthContext), but a footgun; recommend consolidating/deleting `api/auth.js` in a follow-up.
3. **`profiles.email NOT NULL`** blocks truly phone-only accounts without a placeholder; acceptable for now (placeholder used). Migration 005/ nullable email is a future decision.
4. **Access tokens valid until expiry** after global sign-out (JWT stateless). Bounded by `is_active` middleware check; acceptable.
5. **Social password rotation** only for `kindee_social_only` accounts; if a future account-linking flow sets a real password, the guard prevents breakage (409 instead). Ensure link-account flow clears/sets `kindee_social_only` appropriately.
6. **`createUserClient` / `req.supabase` / `req.accessToken`** are still set by middleware but unused elsewhere; harmless, kept for compatibility.
7. **Facebook/LINE profile inserts require migration 006**; until applied those social logins error (fail-safe).
8. **`authController.js` is dead code** referencing a non-existent `sendTokenResponse` and removed `User` model; it is not imported anywhere. Recommend deletion in a cleanup phase (left untouched).

---

## 10. Steps requiring approval before production use

1. **Apply migration 006** on staging, verify, then production (adds provider-id columns + unique indexes).
2. **Configure LINE Login channel** (`LINE_CHANNEL_ID`, `LINE_CHANNEL_SECRET`, callback URLs `…/login` and `…/register`, scopes `profile openid email`) and run an end-to-end LINE login test.
3. **Configure Facebook app** (`FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET`) and verify Graph API login on staging.
4. **Verify Supabase email provider (SMTP)** if email verification is later enforced (current `email_confirm: true` at register — unchanged).
5. **Rotate the hardcoded admin password** in `createAdminSupabase.js` and move secrets out of source.
6. **Run `migrateLegacyUsers.js`** against a real MongoDB export on staging (with `--dry-run` first), verify N logins, then production; only after that consider removing the legacy custom-JWT fallback.
7. **Deploy** (no deploy performed in this phase).

---

## 11. What was explicitly NOT done
- No `.env` edits; no secrets printed.
- No Supabase production data/schema changes (migration 006 is a reviewable SQL file only, not executed).
- No test/real accounts created in production.
- No commit / push / deploy.
- No unrelated systems changed.
- No claim that LINE or Production flows were tested (they were not).