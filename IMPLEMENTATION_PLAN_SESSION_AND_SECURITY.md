# Implementation Plan: User Sessions, Login History & Security Alerts

**Status:** PLAN ONLY — awaiting review and approval.
**No migration has been run, no production database modified, no commit/push/deploy.**

---

## 0. Verified facts (basis for schema)

- `profiles.id`: `UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE` (`supabase/migrations/001_initial_schema.sql:28`). All existing FKs (orders, stores, messages, etc.) reference `profiles.id` (UUID).
- Extensions enabled: `pgcrypto`, `uuid-ossp` (001:1-4) → SHA-256 hashing and UUID generation available.
- RLS helpers exist: `get_current_user_id()`, `get_current_user_role()`, `is_admin_or_owner()` (`supabase/migrations/002_rls_policies.sql:31-54`).
- Existing logout API: `POST /auth/logout` with body `{ refreshToken?, revokeAllSessions?, scope? }` → `authService.logoutUser(accessToken, refreshToken, scope)` → `supabaseAdmin.auth.admin.signOut(accessToken, scope)` where scope ∈ {`local`, `global`, `others`} (`backend/services/authService.js:652`, `backend/routes/authRoutes.js:155-166`).
- Existing change-password API: `PUT /auth/password` with `{ currentPassword, newPassword }` → `authService.changePassword(userId, currentPassword, newPassword)` (`backend/services/authService.js:547`, `backend/routes/authRoutes.js:140-152`). Verifies current password via `supabase.auth.signInWithPassword`, then updates via `supabaseAdmin.auth.admin.updateUserById`.
- `user_sessions` is referenced only as a best-effort cleanup in `adminDeleteUserAccount` (`authService.js:1195`); the table does **not** exist yet.
- No `login_history`, `security_alerts`, or `refresh_token_hash` anywhere in the repo → no duplication (requirement 8).

---

## 1. Migration files (to create)

| File | Table | Purpose |
|------|-------|---------|
| `supabase/migrations/025_user_sessions.sql` | `user_sessions` | Per-device session tracking (Approach A: refresh-token hash only) |
| `supabase/migrations/026_login_history.sql` | `login_history` | Append-only auth audit log |
| `supabase/migrations/027_security_alerts.sql` | `security_alerts` | New device / new country / multiple failed-login alerts |

**Foreign key:** every table references `profiles(id)` (UUID) `ON DELETE CASCADE`, matching the confirmed `profiles.id` type (requirement 2). No new column types beyond `UUID`, `TEXT`, `TIMESTAMPTZ`, `BOOLEAN`, `JSONB`.

**RLS model (requirement 1 — owner-only):**
- `user_sessions`: owner (`profile_id = auth.uid()`) or admins can `SELECT`; `service_role` does all `INSERT`/`UPDATE`/`DELETE`; owner may `UPDATE` only to soft-revoke their own session (restrictive `WITH CHECK` — identifying fields and `refresh_token_hash` immutable, revoked cannot be un-revoked).
- `login_history`: owner/admins `SELECT`; `service_role` `INSERT` only; append-only (no `UPDATE`/`DELETE` for users → tamper-proof).
- `security_alerts`: owner/admins `SELECT`; `service_role` `INSERT`; owner marks own alert read (`is_read`/`read_at` only); admins resolve any alert.

---

## 2. Session Tracking — Approach A (requirement 3)

**Rule:** Never store the raw refresh token. Store only `refresh_token_hash = SHA-256(refresh_token)` (hex, via `pgcrypto.digest`) in `user_sessions.refresh_token_hash`. The plaintext refresh token exists only in transit (Supabase client ↔ GoTrue) and in the frontend `localStorage` (existing behavior) — never in the database.

**Login flow (new session row):**
1. Backend completes email/password or social login → receives Supabase `session { access_token, refresh_token, expires_at }`.
2. Backend extracts request context: IP, User-Agent, device_id (client-generated stable id), device_name/browser/os (parsed from User-Agent), country/city (approximate, from IP geolocation — never guessed).
3. Backend inserts one `user_sessions` row: `refresh_token_hash`, device info, IP, `expires_at`, `is_revoked = false`.
4. Backend appends `login_history` row: `event_type='login_success'`, `success=true`, same context.

**Refresh flow (rotation handling — requirement 3):**
1. Client sends current `refresh_token`. Backend computes `hash = SHA-256(refresh_token)` and looks up the active `user_sessions` row for the profile where `refresh_token_hash = hash`, `is_revoked = false`, `expires_at > now()`.
2. **If found:** call `supabase.auth.refreshSession({ refresh_token })`. Supabase rotates → returns **new** `refresh_token`. Backend updates the row: `refresh_token_hash = SHA-256(new_token)`, `expires_at`, `last_activity_at`. Returns new tokens to client.
3. **If NOT found (rotation mismatch):** the token was already rotated on another device (token reuse) or was never recorded → reject refresh (`401`), client clears session. This prevents session data mismatch after Supabase rotation.
4. Append `login_history` row `event_type='token_rotated'` on successful rotation.

**Logout:**
- Current device (`scope='local'`): existing `POST /auth/logout` → `signOut(accessToken, 'local')`; backend also marks the matching `user_sessions` row `is_revoked = true`.
- All devices (`scope='global'` or `revokeAllSessions=true`): existing `POST /auth/logout` → `signOut(accessToken, 'global')`; backend marks all the profile's `user_sessions` rows `is_revoked = true`. (Requirement 8 — reuse existing API, no new system.)

---

## 3. Data captured per session / login event (requirement 4)

Captured **only from verifiable request data**:

| Field | Source | Notes |
|-------|--------|-------|
| `ip_address` | Request remote IP (or `X-Forwarded-For` from trusted proxy) | Verifiable |
| `user_agent` | `User-Agent` header | Verbatim, verifiable |
| `device_id` | Client-generated stable id (stored in frontend localStorage, sent on each auth request) | Verifiable, generated by app — not fingerprinted |
| `device_name` | Parsed from User-Agent | Approximate label |
| `browser` | Parsed from User-Agent | Approximate |
| `os` | Parsed from User-Agent | Approximate |
| `country` | Approximate, from IP geolocation lookup (if configured); otherwise `NULL` | **Approximate only — never guessed** |
| `city` | Approximate, from IP geolocation lookup (if configured); otherwise `NULL` | **Approximate only — never guessed** |
| `created_at` / `last_activity_at` | Server timestamp | Verifiable |

**Location rule:** country/city come solely from an IP geolocation service. If no geolocation source is configured, the fields are `NULL`. The system never infers/guesses location from partial data.

---

## 4. Security Alerts — initial conditions (requirement 5)

Derived from `login_history` (computed by backend/service, inserted into `security_alerts`):

| Alert | Trigger | Severity |
|-------|---------|----------|
| `new_device` | `device_id` (or device fingerprint combo) never seen in a successful login for this profile | medium |
| `new_country` | `country` never seen in a successful login for this profile | medium |
| `multiple_failed_logins` | N failed logins (`success=false`) for the same profile/IP/device within a time window (e.g. 5 failures in 15 min) | high |

Alerts are raised server-side after evaluating `login_history`. Owner reads own alerts (`security_alerts`) and marks them read; admins resolve. Thresholds are configurable (not hardcoded in migration).

---

## 5. Social unlink guard (requirement 6)

Before unlinking Google / Facebook / LINE (`profiles.google_id` / `facebook_id` / `line_id`):

1. Count the profile's remaining login channels:
   - Has a usable password (can `signInWithPassword`)? → email/password channel.
   - Has another non-null social id among google_id/facebook_id/line_id? → that social channel.
   - Has a phone number? → phone/OTP channel (future).
2. **If only one channel remains**, reject unlink (`409`) with message indicating the user would be locked out. Require the user to add an alternative channel (e.g. set a password / add phone) first.
3. Only allow unlink when ≥ 1 other channel remains.
4. Append `login_history` row `event_type='social_unlink'`, `success=true/false`, on every attempt.

This reuses the existing profile columns (`google_id`, `facebook_id`, `line_id` from migration 006) and does not create new identity tables.

---

## 6. Supabase per-device session revocation — real capability & limitation (requirement 7)

**What Supabase actually supports** (`auth.admin.signOut(jwt, scope)`):
- `scope = 'local'` — revoke **only the current session** tied to the supplied access token (i.e., "this device" **only if you hold that device's access token**).
- `scope = 'global'` — revoke **every** session/refresh token for the user.
- `scope = 'others'` — revoke every session **except** the one tied to the supplied access token.

**Limitation (must be reported honestly — do NOT claim per-device revocation by device ID):**
- Supabase has **no public API to revoke a single arbitrary device/session by device ID or session ID** from a different session. Sessions are identified by refresh tokens; you can revoke the session whose access token you hold (`local`), all (`global`), or all others (`others`), but you cannot pick "device X" and revoke only it unless you possess device X's access token.
- Access tokens are stateless JWTs (~1 h expiry); revoking a refresh token does not instantly invalidate an already-issued access token. Abuse window is bounded by access-token TTL and the middleware's `is_active` check.

**Honest system claims:**
- ✅ "ออกจากระบบอุปกรณ์นี้" (sign out this device) — via `scope='local'` using the current device's access token.
- ✅ "ออกจากระบบทุกอุปกรณ์" (sign out all devices) — via `scope='global'`.
- ✅ "ออกจากระบบทุกอุปกรณ์ยกเว้นเครื่องนี้" — via `scope='others'`.
- ❌ Do **NOT** claim "ยกเลิก session ของอุปกรณ์ X โดยระบุอุปกรณ์" (revoke a specific device X by ID from another device) — not supported by Supabase API.

**Safe alternative proposed:**
- Track device-to-session mapping in `user_sessions` (device_id ↔ refresh_token_hash). To revoke a specific device, the backend must hold that device's current access token (obtained only when that device is active/authenticated). Otherwise the supported remediation is `scope='global'` (revoke all) — user re-logins on trusted devices — or ban/deactivate the account (existing `setUserActive` / `deactivateAccount`). This limitation is documented; no false per-device revocation is advertised.

---

## 7. Reuse of existing APIs — no duplication (requirement 8)

| Capability | Existing API (reuse — do NOT build new) | File |
|------------|-----------------------------------------|------|
| Change password | `PUT /auth/password` → `authService.changePassword` | `backend/routes/authRoutes.js:140`, `backend/services/authService.js:547` |
| Logout current device | `POST /auth/logout` scope `local` → `authService.logoutUser` | `backend/routes/authRoutes.js:155`, `backend/services/authService.js:652` |
| Logout all devices | `POST /auth/logout` scope `global` / `revokeAllSessions=true` → same `logoutUser` | same as above |
| Login (email/social) | `POST /auth/login`, `/auth/google`, `/auth/facebook`, `/auth/line` → Supabase session | existing routes |
| Refresh | `POST /auth/refresh` → `authService.refreshAccessToken` | existing route |

The session-tracking layer **wraps** these existing APIs: on each login/refresh/logout it records/revokes `user_sessions` and appends `login_history`. No new authentication or token-issuance system is created.

---

## 8. API surface introduced by this plan (thin orchestration over existing APIs)

All new endpoints are `verifyToken`-guarded where user-context is needed; session writes use `service_role`.

- `GET /auth/sessions` — list current user's active sessions (`user_sessions` where `profile_id = auth.uid()`, `is_revoked = false`). Returns masked info: device_name, browser, os, country (approx), last_activity_at, created_at. **No tokens returned.**
- `POST /auth/sessions/revoke` — body `{ session_id }` or `all=true` → soft-revoke matching own `user_sessions` row(s) (RLS owner UPDATE) + `signOut` for current device if applicable. Append `login_history` `event_type='session_revoked'`.
- `GET /auth/login-history` — list own `login_history` (paginated, recent first).
- `GET /auth/security-alerts` — list own unread/read alerts; `PATCH /auth/security-alerts/:id/read` → mark read (owner only).
- Social unlink endpoint (guard per section 5): e.g. `POST /auth/social/unlink` body `{ provider }` → channel-count check → clear `profiles.{provider}_id` → append `login_history` `social_unlink`.

**No new login/password/token endpoints.** Change password and logout-all remain on the existing `PUT /auth/password` and `POST /auth/logout`.

---

## 9. What is NOT included / out of scope for this plan

- IP geolocation provider integration (fields stay `NULL` until a provider is configured).
- Phone/OTP channel (future).
- Email verification / forgot/reset password (existing gaps tracked separately in AUTH_AUDIT_REPORT.md).
- Hard deletion of sessions; revocation is soft (`is_revoked`) plus Supabase refresh-token revocation.

---

## 10. Next step

Review and approve this plan and the three migration files. Upon approval:
1. Run migrations on STAGING first, verify RLS + session/alert behavior.
2. Implement the thin backend orchestration (record/revoke sessions, append history, raise alerts, social-unlink guard).
3. Then apply to production only after explicit approval.

**Do not run any migration, modify the production database, commit, push, or deploy until approved.**
