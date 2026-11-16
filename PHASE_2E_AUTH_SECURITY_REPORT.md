# Phase 2E — Authentication Security Audit Report

**Date:** 2026-11-16
**Scope:** Security audit of the Phase 2 Supabase Auth migration (logout, admin
password handling, LINE login, legacy migration, session/refresh, DB migration
006) + fixes for **proven Critical** bugs only + tests.

**Constraints honored:** no `.env` edits; no secrets printed in this report or
terminal; no Production data writes; no real/test accounts on Production; no
commit/push/deploy; no automatic change of the Production admin password; no
migration executed; no unrelated refactor.

---

## 1. Executive Summary

| Severity | Count | Fixed in this pass |
|----------|-------|--------------------|
| Critical | 2     | 2                  |
| High     | 1     | 1 (code) + rotation action required |
| Medium   | 3     | 0 (documented, need approval/scope) |
| Low      | 2     | 0 (documented)     |

**Verdict:** Two Critical logout/deactivation bugs were **proven and fixed** and
covered by new tests. One High-severity credential-exposure issue was **fixed in
code** (env-based) but **requires a manual password rotation** because the old
password is already in git history. Remaining Medium/Low items are documented and
do **not** block the fix, but the Medium items (phone-only legacy migration,
reactivation-clears-ban, redirect-URI whitelist) should be scheduled.

**All backend tests pass (82/82) and the frontend `vite build` succeeds** after
the fixes.

---

## 2. Findings

### CRITICAL

#### C1 — `admin.signOut(userId)` passed a userId where a JWT is required (logout broken)
- **Location:** `backend/services/authService.js:506` (old `:501`), called from
  `backend/routes/authRoutes.js:157`.
- **Root cause:** Installed `@supabase/auth-js@2.119.0` defines
  `GoTrueAdminApi.signOut(jwt, scope)` (`node_modules/@supabase/auth-js/.../GoTrueAdminApi.js:67`).
  The first argument is the **user's access token (JWT)**, which is sent to the
  GoTrue `POST /logout?scope=...` endpoint. The previous code passed a **userId
  (UUID)**, so the request failed authentication and **no session was ever
  revoked** — logout silently did nothing.
- **Impact:** Logout did not invalidate any refresh token; a stolen/leaked
  refresh token stayed valid. Users believed they had logged out.
- **Fixed:** Yes. `logoutUser(accessToken, refreshToken, scope='local')` now
  passes `req.accessToken` (the user's Supabase JWT, set by `verifyToken`) to
  `admin.signOut(accessToken, scope)`. Default scope is `'local'` (current
  device); `'global'` revokes all devices; `'others'` revokes other devices.
  Idempotent: a 401/403 `session_not_found`/`user_not_found` is treated as
  success. Verified by 3 new tests.

#### C2 — `deactivateAccount` also called `admin.signOut(userId)` (suspend did not revoke sessions)
- **Location:** `backend/services/authService.js:710` (old `:690`).
- **Root cause:** Same SDK signature issue. Admin suspend must revoke **all**
  sessions, but the admin API has **no "sign out by userId"** method — it only
  accepts a user JWT, which an admin does not hold for a *target* user.
- **Impact:** Suspending/deleting a user left all their refresh tokens valid.
- **Fixed:** Yes. `deactivateAccount` now sets `profiles.is_active=false` **and**
  revokes every session by banning the user via
  `admin.updateUserById(userId, { ban_duration: '876000h' })` — the supported
  admin way to force sign-out by userId. Non-fatal on ban error (is_active=false
  already blocks API access via middleware). Verified by a new test.
- **Caveat (documented in code):** Re-enabling an account later MUST also clear
  the ban (`admin.updateUserById(userId, { ban_duration: 'none' })`) in addition
  to setting `is_active=true`. See Medium M2.

---

### HIGH

#### H1 — Hardcoded admin password committed to git history
- **Location:** `backend/scripts/createAdminSupabase.js:10` (old), printed at
  old `:117`.
- **Root cause:** The admin email and a **plaintext password were hardcoded** in
  source and **printed to the terminal** on success. The file was committed in
  `6686f7c`, so the password is in **git history** and must be treated as
  **exposed**.
- **Impact:** Anyone with repo/history access has the admin credentials.
- **Fixed (code):** Yes. Credentials now come from `process.env.ADMIN_EMAIL` /
  `process.env.ADMIN_PASSWORD` / `process.env.ADMIN_ROLE`; the script refuses to
  run if they are missing (`:20-22`); the password is **no longer printed**
  (`:124`).
- **Action REQUIRED (cannot be done in code):**
  1. **Rotate the admin password on the Supabase project** (the old value is in
     git history and must be considered compromised).
  2. Set `ADMIN_EMAIL` and `ADMIN_PASSWORD` (new value) in the deployment secret
     store / local `.env` before running the script.
  3. Purge the secret from git history if the repo is/was ever shared
     (`git filter-repo` / BFG), then force-push per policy.
- **Note:** `.env*` is gitignored (root `.gitignore`); the leak was via the
  source file, not `.env`.

---

### MEDIUM (documented, not fixed in this pass)

#### M1 — Phone-only legacy accounts cannot be migrated (`profiles.email` is NOT NULL)
- **Location:** `backend/scripts/migrateLegacyUsers.js:136-162`.
- **Detail:** For a legacy user with a phone but **no email**, `createUser`
  omits `email`, but the `profiles` insert passes `email: null`, which violates
  the `email NOT NULL` constraint (migration 006 keeps email NOT NULL). The auth
  user is created then rolled back → phone-only accounts are skipped with an
  error.
- **Suggested fix (needs approval):** synthesize a placeholder email
  (`phone-<id>@kindee.local`), mirroring `resolveSocialUser`.
- **Impact:** Phone-only legacy users are not migrated (no data loss, but manual
  follow-up needed).

#### M2 — No reactivation path clears the ban (deactivate is effectively one-way)
- **Location:** `backend/services/authService.js:710-733` (deactivate) and the
  absence of any `is_active=true` user endpoint.
- **Detail:** After C2's fix, `deactivateAccount` bans the user. There is
  currently **no admin endpoint to reactivate** a user, so today this is
  consistent; but any future "reactivate" must clear `ban_duration` too (noted
  in code). If product wants reversible suspend, add a reactivation endpoint that
  sets `is_active=true` **and** `ban_duration:'none'`.

#### M3 — `redirectUri` for LINE is client-supplied and not server-whitelisted
- **Location:** `backend/routes/authRoutes.js:97-107` →
  `backend/services/authService.js:582-601` (`exchangeLineCode`).
- **Detail:** The backend trusts the client-provided `redirectUri` in the token
  exchange. LINE itself validates `redirect_uri` against the registered callback,
  so a mismatch fails — low practical risk — but a server-side allow-list of
  accepted redirect URIs is recommended defense-in-depth.
- **Impact:** Low; LINE's own validation mitigates. Documented, not fixed.

---

### LOW (documented)

#### L1 — LINE login has no **server-side** `state` verification
- **Location:** `backend/services/authService.js:644` (`lineLogin(code, redirectUri)`),
  `backend/routes/authRoutes.js:97-107`.
- **Detail:** `state` (CSRF/replay defense) is validated **only in the browser**
  via per-browser `sessionStorage` (`frontend/src/utils/lineState.js`,
  `Login.jsx:56`). Because the state lives in the victim's own sessionStorage and
  an attacker cannot read/set it cross-origin, this is an **effective** CSRF
  defense for the login flow. A future account-*linking* flow should move state
  server-side.
- **Impact:** Low (acceptable for login; revisit for linking).

#### L2 — `createAdminSupabase.js:91` out-of-scope `users` reference (fallback path only)
- **Location:** `backend/scripts/createAdminSupabase.js:83,91`.
- **Detail:** `const { data: users } = await ...listUsers()` is declared inside
  the `if (!authUserId)` block, but line 91 references `users` **outside** that
  block. This throws `ReferenceError` only when the initial `createUser` returns
  no user (fallback path). It is a one-off bootstrap script, not runtime.
- **Impact:** Low. Documented; fix opportunistically when M-items are addressed.

---

## 3. Items Verified PASS (with evidence)

| Area | Result | Evidence |
|------|--------|----------|
| LINE id_token `iss` | PASS | `authService.js:618-620` checks `iss === https://access.line.me`. |
| LINE id_token `aud` | PASS | `authService.js:621-623` checks `aud === channelId`. |
| LINE id_token `exp` | PASS | `authService.js:624-626` rejects expired tokens. |
| LINE signature | PASS (delegated) | Signature verified by LINE `/oauth2/v2.1/verify`. |
| `line_id` uniqueness | PASS (after 006) | `migrate 006` partial unique index; resolver keyed by `line_id` (`authService.js:242-246`). |
| Duplicate/retry callback | PASS | `resolveSocialUser` is idempotent; existing provider → new session, no duplicate. |
| No email-only auto-link | PASS | `authService.js:258-267` returns 409 Conflict if email already owned. |
| LINE no-email case | PASS | Placeholder `${provider}-${providerId}@kindee.local` (`authService.js:271`). |
| Refresh rotation | PASS | `refreshAccessToken` uses `supabase.auth.refreshSession` (rotates). |
| Concurrent refresh | PASS | Frontend `refreshInFlight` collapses per-namespace (`AuthContext.jsx:90,215-216,238-242`). |
| Multi-tab session sync | PASS | `storage` event listener (`AuthContext.jsx:288`). |
| Stale token on load | PASS | `validateSession` on mount (`AuthContext.jsx:253-283`). |
| Inactive account on refresh | PASS | `refreshAccessToken` + `verifyToken` check `is_active`. |
| Role authz source | PASS | Role read from `profiles.role` (never from JWT payload). |
| Legacy migrator dry-run writes nothing | PASS | `migrateLegacyUsers.js:131-133` returns `would-create` before any write. |
| Legacy migrator idempotency | PASS | `profileExistsByEmailOrPhone` skip (`:126-129`). |
| Legacy migrator bcrypt handling | PASS | `isBcryptHash` + `password_hash` reuse, refuses to reset (`:118-124`). |
| Legacy role preservation | PASS | Role whitelist + copy (`:108-110,154-161`). |
| Migration 006 idempotency | PASS | `ADD COLUMN IF NOT EXISTS` + `CREATE UNIQUE INDEX IF NOT EXISTS` in a transaction (`:50-66`). |
| Migration 006 NULL handling | PASS | Partial unique indexes (`WHERE col IS NOT NULL`) allow many NULLs. |
| Migration 006 rollback | PASS | Documented `DROP INDEX/COLUMN IF EXISTS` (`:36-42`). |

---

## 4. What Was Changed (files)

- `backend/services/authService.js`
  - `logoutUser` rewritten to `logoutUser(accessToken, refreshToken, scope='local')`
    using `admin.signOut(accessToken, scope)` with idempotent error handling (`:506`).
  - `deactivateAccount` now revokes sessions via `ban_duration` (`:710-733`).
- `backend/routes/authRoutes.js`
  - `/logout` passes `req.accessToken` and resolves scope from `scope` /
    `revokeAllSessions` (`:155-163`).
- `backend/scripts/createAdminSupabase.js`
  - Admin credentials read from env; script refuses to run without them; password
    no longer printed (`:9-22`, `:124`).
- `backend/__tests__/auth.test.mjs`
  - Fake `admin.signOut` records `{ jwt, scope }` (`:56`).
  - Replaced old logout test; added: access-token-not-userId assertion, global
    scope, no-token fallback, and `deactivateAccount` ban-revocation test.

---

## 5. Test Results

- **Backend:** `npm --prefix backend test` → **82 tests, 0 failed**
  (was 79; +3 net new: access-token logout, global scope, deactivate ban).
- **Frontend:** `npm --prefix frontend run build` → **✓ built in ~3s**
  (653.66 kB JS bundle; pre-existing chunk-size warning only, unrelated).

---

## 6. Blocked Items (no live environment)

- **LINE live E2E** — BLOCKED: no `LINE_CHANNEL_ID` / `LINE_CHANNEL_SECRET` in
  `backend/.env`. Code paths audited statically + unit-tested.
- **Supabase live flows** (real logout/refresh/deactivate) — BLOCKED: no staging
  credentials. Verified against the installed SDK source signature, not a live
  project.
- **Legacy `migrateLegacyUsers.js` against real MongoDB** — BLOCKED: no reachable
  legacy DB; mongoose/models removed. Script is a runnable, dry-run-capable
  procedure only.
- **Admin password rotation** — BLOCKED (manual operator action; see H1).

---

## 7. Migrations Needing Approval

- `supabase/migrations/006_social_provider_ids.sql` — **NOT executed.**
  Additive (nullable `google_id`/`facebook_id`/`line_id` + partial unique
  indexes), transactional, backward compatible. **Requires:** run on STAGING
  first, verify, then Production only after explicit approval. No existing data
  populates these columns yet, so no duplicate-id failure is possible on first
  run; re-runs are safe via `IF NOT EXISTS`.

---

## 8. Pre-Deploy Risks / Checklist

1. **Rotate the admin password** (H1) and move it to the secret store. Do not
   ship with the old value.
2. Add `ADMIN_EMAIL` / `ADMIN_PASSWORD` / `ADMIN_ROLE` to the deploy secret store
   (not the repo) before running `createAdminSupabase.js`.
3. Purge the exposed password from git history if the repo was shared.
4. Apply migration 006 on staging, then production (with approval).
5. Decide whether deactivate should be reversible; if so, add a reactivation
   endpoint that also clears `ban_duration` (M2).
6. Optionally migrate phone-only legacy accounts with placeholder emails (M1).
7. Note behavior: logout/suspend revoke **refresh** tokens immediately; already
   issued **access** tokens remain valid until expiry (~1h) — this is expected and
   documented; middleware `is_active` checks bound deactivated-account abuse.