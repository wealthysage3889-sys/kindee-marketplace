# Phase 2F — Pre-Deployment Readiness & Credential Incident Remediation Report

**Date:** 2026-11-16
**Baseline:** `PHASE_2E_AUTH_SECURITY_REPORT.md`
**Repository:** `C:\Users\LEGION\OneDrive\Desktop\kindee-marketplace`
**Remote:** `https://github.com/wealthysage3889-sys/kindee-marketplace.git`
**Branch:** `main` (tracking `origin/main`, up to date by SHA at inspection time)

**Constraints honored in this pass**
- No Production login/account test, no Production password change.
- No automatic password rotation on Production.
- No Git history rewrite, no force-push, no commit/push.
- No `.env` / secret values printed in this report or terminal output.
- No migration executed; no unrelated refactor.
- Staging environment not available → live Supabase auth flows are **NOT TESTED**; verification is code review + mock tests only.

---

## 1. Executive Summary

| Area | Status |
|------|--------|
| Admin credential code exposure | **MITIGATED IN CODE** — current file and working tree contain no hardcoded admin password |
| Git history exposure | **CONFIRMED** — admin password (and a service-role key line) exist in commit `6686f7c` (and earlier). Old value must be treated as **compromised**. Rotation **required**; history purge **requires explicit approval**. |
| Account suspension | **PASS (code + mock)** — login blocked, refresh rejected, sessions revoked via `ban_duration`; access-token remains valid until expiry but `is_active` middleware blocks abuse. |
| Logout local/global | **PASS (code + mock)** — `admin.signOut(accessToken, scope)` now receives the user JWT (Phase 2E fix); frontend clears only the requested namespace. |
| Remaining Medium/Low | Documented; no confirmed runtime security bug left unfixed that blocks a conditional GO. One High-priority bug (users ref in createAdmin fallback) fixed; M-items still need approval/scheduling. |
| Regression | **PASS** — backend **82/82**; frontend build **PASS** (with pre-existing `>`/JSX warnings). |
| Overall recommendation | **NO-GO until credential rotation is verified and session safety is confirmed on Staging.** After rotation + staging smoke, re-evaluate. |

> **Rule enforced:** no GO declared while an exposed credential has not been rotated and while session revocation (ban + logout) has not been verified against a live/staging Supabase project.

---

## 2. Credential Exposure — Findings & Required Remediation

### 2.1 Confirmed exposure (no secret values reproduced)

- Commit `6686f7c` (`Remove mongoose and add verifyAdmin middleware`, 2026-11-15) introduced `backend/scripts/createAdminSupabase.js` with:
  - hardcoded `ADMIN_EMAIL` (line 9 of the committed blob)
  - hardcoded `ADMIN_PASSWORD` (line 10 of the committed blob)
  - hardcoded `ADMIN_ROLE` (line 11)
  - **and printed the password on success** (line 117 of the committed blob).
- Git history scan (`git log -p --all -S ...`) confirms the same file also contained a `SUPABASE_SERVICE_ROLE_KEY` assignment line in history (redacted here). This is at least as sensitive as the admin password because the service-role key bypasses RLS.
- Current working tree (`backend/scripts/createAdminSupabase.js`) is **clean**:
  - credentials read from `process.env.ADMIN_EMAIL` / `ADMIN_PASSWORD` / `ADMIN_ROLE` (`:11-13`);
  - refuses to run without them (`:20-23`);
  - password is **not printed** (`:124` only prints a reminder);
  - full-diff inspection shows no remaining literal secret in tracked files.
- `.env*` is gitignored; the leak vector was source code, not `.env`.

### 2.2 Scan for other exposed credentials

A regex scan over tracked source (`backend/**`, `frontend/**`, root `*.json`) was performed **without printing matched values**. No additional hardcoded passwords, API keys, or service-role keys were found in the **current** tree. Historical values are only the ones already identified (admin password, service-role key line in older blobs of `createAdminSupabase.js`). Supabase settings are stored via the `settings` table and injected at runtime (`backend/services/authService.js:getLineConfig`, `backend/utils/settings.js`); the code reads them but does not hardcode them.

### 2.3 Git & remote state

- `git status`: **not clean**. 41 modified/deleted tracked files and many untracked files/reports are present in the working tree (see §6). Nothing staged/committed in this pass.
- Branch `main` equals `origin/main` (no unpushed commits).
- `git log --oneline`: latest is `6686f7c` (the exposure commit). All Phase 2 work after `6686f7c` is **uncommitted** in the working tree.

### 2.4 Required rotation plan (operator action — **NOT performed automatically**)

1. **Rotate the admin account password** in Supabase Auth (Dashboard → Authentication → Users → target admin → reset password, or via `supabaseAdmin.auth.admin.updateUserById(adminId, { password: <new> })` from a trusted operator workstation). Never type the new value into a shell that logs history or into a ticket.
2. **Rotate `SUPABASE_SERVICE_ROLE_KEY`** if it was ever committed (it appears in history). Service-role keys cannot be "changed" in place; generate a new one in the Supabase project settings and update:
   - backend secret store / hosting env (e.g. Render/Vercel `SUPABASE_SERVICE_ROLE_KEY`)
   - local `.env` files for operators
   - any script runner environment
   - then revoke/ignore the old key after verification.
3. **Store new credentials in the deployment secret store only** (`ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_ROLE`, `SUPABASE_SERVICE_ROLE_KEY`) — never in the repo.
4. **Verify rotation**: log in once with the new password (Staging first, then Production via approved operator flow), confirm the old password fails, and confirm the script no longer prints the password.

### 2.5 Git history purge plan (requires explicit approval — **NOT executed**)

The old password is still recoverable by anyone with clone/fetch access. Purging is destructive to history and coordinates:

1. **Get explicit approval** from repo owner before rewriting history.
2. Communicate a **history-rewrite window** to all collaborators. After the rewrite, every collaborator must **re-clone** (a normal `git pull` will fail or create duplicate history; old branches retain the secret locally).
3. Install `git-filter-repo` (`pip install git-filter-repo` or the standalone binary).
4. Dry-run replacement:
   - Use `--replace-text` with a file mapping the literal old password string (and the old service-role key) to `[REDACTED]`. Do **not** paste the secret into a tracked file; keep the replacement file outside the repo.
   - Example shape (values redacted here): `literal_old_password==>REDACTED`.
5. Run `git filter-repo --replace-text <secret-map-file> --force` (or `--invert-paths --path backend/scripts/createAdminSupabase.js` only if you intentionally want to drop the file — **not recommended** since the file is still needed in current form).
6. Re-add the new `origin`, then **force-push all refs** (`git push --force --all` and `git push --force --tags`) — **only with approval and after rotation**.
7. Ask all collaborators to **re-clone**, and rotate any other secret that lived in rewritten commits (service-role key, etc.) regardless of the purge.
8. **Impact on commit history**: every commit SHA from `6686f7c` onward (and any earlier commit containing the secret) changes. Open PRs, tags, forks, and local branches based on old SHAs break; CI caches keyed by SHA invalidate; GitHub may keep unreachable commits accessible by SHA for some time (contact GitHub Support to expedite GC if needed).
9. Alternative: BFG Repo-Cleaner (`bfg --replace-text passwords.txt`) — faster but requires a fresh clone and also changes all SHAs.

> Purge does **not** replace rotation. Rotation must happen first because the old value must be assumed compromised even before the rewrite completes.

---

## 3. Account Suspension Verification

### 3.1 What `deactivateAccount` does (code evidence)

`backend/services/authService.js:710-733`:
1. `UPDATE profiles SET is_active=false WHERE id=userId` (blocks new logins + API access via middleware).
2. `supabaseAdmin.auth.admin.updateUserById(userId, { ban_duration: '876000h' })` — Supabase's supported admin way to revoke all refresh tokens by userId (100 years). Admin API has no `signOut(userId)`; it requires the user's JWT, so banning is the correct revocation mechanism.
3. Ban error is **non-fatal** and logged (`:727-731`); `is_active=false` is the primary control.

### 3.2 Proof matrix (mock + code review)

| Assertion | Result | Evidence |
|-----------|--------|----------|
| Logged-in user with `is_active=false` cannot call protected API | **PASS** | `middleware/auth.js:attachProfileContext` returns 403 `Account is deactivated` for both Supabase and legacy JWT paths (`:34-40`). Every protected route uses `verifyToken` (see §3.3). |
| Suspended user cannot log in again | **PASS** | `loginUser` (`authService.js:127-129`), `socialLogin` (`:193-195`), `lineLogin` (`:693-695`), and `refreshAccessToken` (`:444-447`, `:473`) all reject `is_active=false` with 403. |
| Refresh token from before ban is rejected | **PASS (code) / NOT TESTED live** | After `ban_duration` is set, GoTrue rejects `refreshSession` for that user; code also double-checks `profile.is_active` after refresh (`:444-447`) and on the legacy refresh path (`:473`). Mock test confirms the service rejects and the ban call is issued. |
| Other-device sessions are revoked | **PASS (code, requires live verification)** | `ban_duration` is account-wide: all existing refresh tokens are invalidated on next refresh/use; new logins blocked. **Evidence caveat:** this is based on Supabase's documented `ban_duration` semantics and the SDK signature, **not** on a live E2E (no staging). Treat as "code-correct, pending staging smoke". |
| Existing access token still works for API until expiry | **EXPECTED** — access JWTs are stateless (~1h). Middleware `is_active` check on **every** `verifyToken` request blocks any API use of that token while suspended (`middleware/auth.js:34-40`). Socket connections also re-check `is_active` (`socketService.js:50`). | PASS (mitigated). |
| `is_active` checked on all important paths | **PASS** | All routers import and chain `verifyToken` / `optionalAuth` (see coverage table §3.3). `authorize()` and `verifyAdmin()` depend on `req.user` set only by `attachProfileContext`, which enforces `is_active`. Socket auth (`socketService.js:50`) checks `profile.is_active`. |
| Safe reactivation path exists | **MISSING (by design today)** | There is **no** endpoint/service that sets `is_active=true` and clears the ban. `userController`/`userRoutes` only updates profile fields (no `is_active` flip via allowed fields). The only `is_active=true` writes are at creation/migration. Reactivation today is manual DB + `admin.updateUserById(userId, { ban_duration: 'none' })`. Code comments warn about this (`authService.js:707-709`). See §5 M2. |

### 3.3 Middleware coverage (spot-checked routes)

| Surface | Uses |
|---------|------|
| `authRoutes` (profile, password, logout, account) | `verifyToken` on every protected route (`authRoutes.js:113,123,140,155,169`) |
| `adminRoutes` | `verifyToken, verifyAdmin` on all admin routes (stats, orders, stores, products, users, settings, notifications) |
| `categoryRoutes` | writes: `verifyToken, verifyAdmin`; reads: `optionalAuth` |
| `productRoutes` | writes: `verifyToken, authorize('seller','owner','admin')`; reads: `optionalAuth` |
| `orderRoutes` | all routes `verifyToken` + role/authorization |
| `storeRoutes`, `chatRoutes`, `callRoutes`, `deliveryRoutes`, `notificationRoutes`, `uploadRoutes` | `verifyToken` on every route (chat also enforces conversation membership server-side) |

`optionalAuth` routes are public reads; if a deactivated user's token is sent, `attachProfileContext` still returns 403 and the handler treats them as anonymous — correct behavior.

---

## 4. Logout Verification

### 4.1 Backend behavior

`authService.logoutUser(accessToken, refreshToken, scope='local')` (`:506-536`):
- **Primary:** `supabaseAdmin.auth.admin.signOut(accessToken, safeScope)` — **accessToken is the user's JWT** (Phase 2E fix; old code wrongly passed userId). `scope ∈ {local, global, others}`; invalid → `local`.
- **Idempotent:** `401/403`, `session_not_found`, `user_not_found` treated as success.
- **Fallback (no access token):** best-effort `supabase.auth.signOut({ scope })`, never throws.

Route (`authRoutes.js:155-166`): `resolvedScope = scope || (revokeAllSessions ? 'global' : 'local')`; passes `req.accessToken` (set by `verifyToken`). Default is **local** (current device only). `revokeAllSessions=true` or `scope=global` revokes all devices; `scope=others` revokes other devices.

### 4.2 Token effects (documented Supabase semantics + code)

| Item | Effect of `local` logout | Effect of `global` logout |
|------|--------------------------|---------------------------|
| Refresh token of current session | Revoked (cannot mint new access tokens) | Revoked |
| Refresh tokens of other devices | Untouched | Revoked |
| Access token of current session | Still valid until expiry (~1h) — stateless JWT | Same |
| Access tokens of other devices | Untouched | Still valid until expiry; blocked early if account suspended |

This is **standard** for stateless JWTs; the code comments (`authService.js:503-505`) and Phase 2E report document it.

### 4.3 Frontend behavior (`frontend/src/context/AuthContext.jsx`)

- Namespaces: `customer` and `admin` with separate localStorage keys (`kindee:{customer|admin}:{token|user|refreshToken}`) (`:7-18`).
- `logout(mode)` (`:120-139`): calls `authAPI.logout(session.refreshToken, mode)` (default **local** scope — backend resolves to `local`), catches/logs errors, then in `finally` **clears only that mode's keys** (`clearSession(mode)` at `:53-56`) and resets only that React state slice.
- Cross-tab sync (`storage` event, `:290-304`) ensures a logout in one tab propagates to other tabs of the **same namespace** on next read.
- On load, `validateSession` (`:253-278`) calls `/auth/profile`; on 401 it attempts one refresh; if refresh fails it clears the session. A suspended (`is_active=false`) user gets 403 from `/auth/profile` → `validateSession` **clears the session** (non-401 path) and the user is redirected to login.
- Admin logout (`AdminAccount.jsx:139`, `AdminLogin.jsx:44`) and customer logout (`Navbar.jsx:38`, `Account.jsx:120`, `CourierDashboard.jsx:285`) all call `logout(mode)` with the correct namespace.

### 4.4 Error handling when Supabase is unreachable

- Backend logout never throws on missing token/session (idempotent). Other errors produce 500 `Logout failed: ...`.
- Frontend `logout` wraps the API call in try/catch and **always** clears local storage in `finally` — so even if Supabase is down, the user is locally logged out and will be forced to re-authenticate on next protected call.

---

## 5. Remaining Risks (Medium/Low from 2E) — Disposition

| ID | Issue | Disposition in 2F |
|----|-------|-------------------|
| **M1** | Phone-only legacy migration skipped because `profiles.email NOT NULL` and migrator inserts `email: null` (`migrateLegacyUsers.js:136-162`, schema migration 006 keeps `email NOT NULL`). | **NOT FIXED — needs approval.** Suggested: synthesize `phone-<legacyId>@kindee.local` (mirroring `resolveSocialUser` placeholder) and pass it to both `createUser` and `profiles.insert`. Low security risk (accounts are simply not migrated; no data loss). Schedule with migration tooling owner. |
| **M2** | No safe reactivation clears the ban. After `deactivateAccount`, the only way back is manual `is_active=true` + `ban_duration:'none'`. | **NOT FIXED — needs approval.** Suggested: add `PATCH /admin/users/:id/reactivate` (admin/owner only) that sets `is_active=true` **and** `admin.updateUserById(userId, { ban_duration: 'none' })` in one transaction-like flow. Until then, document the manual runbook and never promise reversible suspend. |
| **M3** | LINE `redirectUri` is client-supplied (`authRoutes.js:97-107`, `authService.js:582-601`) and not server-whitelisted. | **NOT FIXED — low practical risk** (LINE validates `redirect_uri` against the registered callback). Defense-in-depth: add an env allow-list (`LINE_ALLOWED_REDIRECT_URIS`) and reject mismatches with 400. |
| **L1** | LINE `state` validated only in browser `sessionStorage`, not server-side. | **ACCEPTABLE for login** (per-browser state is effective CSRF defense for login). Revisit for any account-linking flow. |
| **L2** | `createAdminSupabase.js` referenced out-of-scope `users` in fallback path (`:82` vs `:91`). | **FIXED in this pass (one-liner).** Moved `const { data: users }` outside the `if (!authUserId)` block so the fallback lookup works. (See §6.) |
| **New (2F)** | History still contains admin password **and** a service-role key line (`6686f7c` and earlier). | **OPEN — requires rotation + approved purge.** Blocking for GO. |

No other confirmed security bug was found that requires a code change in this pass. The Phase 2E Critical fixes remain intact and regression-tested.

---

## 6. Files Changed in This Pass

Only **one** code change was made (L2 fix); everything else is verification and the new report.

| File | Change | Reason |
|------|--------|--------|
| `backend/scripts/createAdminSupabase.js` | Moved `const { data: users } = await supabaseAdmin.auth.admin.listUsers();` above the `if (!authUserId)` guard and reuse `users.users.find(...)` at `:91` (single lookup, correct scope). | Fixes L2 `ReferenceError` in the fallback path without changing behavior of the happy path. |
| `PHASE_2F_PRE_DEPLOYMENT_REPORT.md` | Created (this file). | Deliverable. |

No other files were edited. No tests were added or modified in this pass (Phase 2E tests already cover logout/deactivate; they continue to pass).

### Untracked / modified files present in the working tree (not created by this pass)

These existed before 2F and are **not** committed. They include all Phase 2 implementation work. Highlights relevant to deploy review:
- Modified (41 files): `backend/middleware/auth.js`, `backend/routes/{auth,admin,product,order,store,chat,upload}Routes.js`, `backend/services/{auth,chat,order,product,socket}Service.js`, `backend/scripts/createAdminSupabase.js`, `frontend/src/context/AuthContext.jsx`, `frontend/src/api/{index,auth,admin}.js`, `frontend/src/components/ProtectedRoute.jsx`, `frontend/src/pages/{Login,Register,AdminLogin,AdminAccount,...}.jsx`, etc.
- Deleted: `backend/controllers/settingController.js` (logic moved to `backend/utils/settings.js` + `routes/settingRoutes.js`).
- Untracked: `backend/__tests__/`, `backend/scripts/migrateLegacyUsers.js`, `backend/utils/phone.js`, `backend/utils/productPricing.js`, `frontend/src/utils/lineState.js`, `supabase/migrations/005_create_admin_user.sql`, `supabase/migrations/006_social_provider_ids.sql`, `supabase/promote_admin.sql`, `supabase/audit_discount_price.sql`, and phase reports.

**Recommendation:** stage and commit in logical batches (auth hardening, chat/product fixes, tests, migration 006 as plan-only) **after** credential rotation is verified. Do not commit while secrets remain in history without an approved purge plan (or accept the risk explicitly).

---

## 7. Git Safety Inspection

| Check | Result |
|-------|--------|
| `git status` | Not clean (see §6). No staged changes. |
| Untracked files | Present (tests, scripts, migrations 005/006, reports). None are secrets; `005_create_admin_user.sql` and `006_social_provider_ids.sql` are plan-only SQL, not executed. |
| `git diff` | Large diff (auth, chat, product, frontend). No secret literals added in the diff; new code reads credentials from env. |
| Migration 006 | Plan-only, additive, `IF NOT EXISTS`, partial unique indexes, transactional. **Not executed.** Requires staging → production approval. |
| Scripts affecting Production | `backend/scripts/createAdminSupabase.js` (now env-based, requires env vars), `backend/scripts/migrateLegacyUsers.js` (dry-run capable, refuses without `--input`, skips already-migrated). Neither was executed in this pass. |
| Secrets in Git history | **YES** — admin password in `6686f7c` (`backend/scripts/createAdminSupabase.js:10` of that blob) and printed at `:117`; a `SUPABASE_SERVICE_ROLE_KEY` assignment also appears in history blobs. Treat both as compromised. |
| Commits made this pass | **None.** |
| Pushes / force-pushes / deploys / migrations run | **None.** |

---

## 8. Regression Results

| Suite | Result |
|-------|--------|
| `npm --prefix backend test` | **PASS — 82/82** (includes auth logout scope, deactivate ban, LINE iss/aud, legacy refresh, pricing, chat, phone validation). |
| `npm --prefix frontend run build` | **PASS** — built in ~3s. Warnings: (1) `>` inside JSX text in `AdminAccount.jsx` (3 occurrences) flagged by esbuild but non-fatal; (2) chunk >500 kB. Both pre-existing and unrelated to auth security. |
| Auth route coverage (manual review) | Every non-public route chains `verifyToken` (+ `verifyAdmin`/`authorize` where needed); public reads use `optionalAuth` and degrade to anonymous for inactive tokens. |
| Role authorization | `authorize(...allowedRoles)` and `verifyAdmin` read role from `profiles.role` (never from JWT). Owner-only actions (grant owner, delete owner) guarded in `adminRoutes.js`. Frontend `ProtectedRoute` mirrors this for admin/seller/courier/owner. |
| Customer / Seller / Admin / Owner / Courier | All five roles have distinct route guards; courier routes require `authorize('courier')`; admin/owner require `verifyAdmin`. |
| Legacy fallback | `verifyToken` falls back to custom JWT only for non-migrated accounts; role still read from `profiles.role`; `refreshAccessToken` upgrades legacy refresh tokens without rotating a real password. |
| Refresh & logout | Unit tests assert: access-token (not userId) passed to `admin.signOut`; `local` and `global` scopes; idempotent no-token fallback; deactivate issues `ban_duration`. |
| LINE callback security | `iss === https://access.line.me`, `aud === channelId`, `exp` checked (`authService.js:618-626`); signature verified by LINE `/verify`; state checked client-side (L1 accepted). |
| Live Supabase E2E (logout/refresh/deactivate on real project) | **NOT TESTED — BLOCKED** (no staging credentials). Code + mocks only. |
| Production account login test | **NOT TESTED — forbidden by scope.** |

Legend: **PASS** = verified by code review and/or mock tests; **FAIL** = proven broken (none); **BLOCKED** = cannot verify without staging/live credentials; **NOT TESTED** = intentionally not run per constraints.

---

## 9. Approval Checklist (required before Deploy)

- [ ] **Rotate admin password** (Staging first, then Production) and confirm old value fails.
- [ ] **Rotate `SUPABASE_SERVICE_ROLE_KEY`** and update all secret stores / `.env` files; revoke old key.
- [ ] Confirm `ADMIN_EMAIL` / `ADMIN_PASSWORD` / `ADMIN_ROLE` exist in the **deployment secret store** (not in repo).
- [ ] **Approve or reject Git history purge.** If approved: schedule window, notify collaborators, run `git filter-repo --replace-text` for the old password **and** service-role key, force-push with approval, require re-clone.
- [ ] **Run migration 006 on Staging**, verify columns/indexes, then approve Production run.
- [ ] **Staging smoke test**: admin login, customer login, logout `local` then `global`, suspend a test account and confirm login + refresh blocked + other-device session revoked, reactivate manually per runbook (or approve M2 endpoint first).
- [ ] Decide M1 (phone-only migration placeholder) and M3 (LINE redirect allow-list) schedule; M2 reactivation endpoint build vs. manual runbook.
- [ ] Review the large uncommitted diff (auth, chat, product, frontend) and commit in approved batches; do not ship the working tree as-is without review.

---

## 10. GO / NO-GO Recommendation

**NO-GO** at this time.

**Reasons (blocking):**
1. **Credential exposure is not remediated end-to-end.** The current code is clean, but the admin password **and** a service-role key line remain recoverable in Git history (`6686f7c` and earlier). Rotation has **not** been performed (correctly — it requires human action on the Supabase project), and history purge requires explicit approval that has not been given. Shipping now leaves a known-compromised credential in the repo's history.
2. **Session revocation is code-correct but not proven live.** Logout (`admin.signOut(accessToken, scope)`) and suspension (`ban_duration`) are backed by Phase 2E tests and code review, but no staging E2E was run. The Phase 2F mandate forbids declaring GO until session safety is confirmed; that confirmation needs a staging Supabase project.

**What is already green:**
- Phase 2E Critical logout/deactivate bugs are fixed and covered by 82 passing tests.
- Middleware enforces `is_active` on all protected routes (including sockets).
- Frontend logout is scope-correct, namespace-correct, and fails safe.
- LINE iss/aud/exp and Facebook token checks are in place.
- No new security bug was found that would block deploy once the two items above are closed.

**Path to GO:**
1. Perform the rotation steps in §2.4 and verify.
2. Approve and execute the history purge in §2.5 (or formally accept the residual risk of keeping history, with compensating controls: rotate everything that was ever committed, restrict repo access, enable secret scanning).
3. Run the staging smoke test in §9 and attach evidence.
4. Re-issue this checklist as GO once all boxes are checked.

Until then, **hold deploy and do not commit/push the pending changes** without the credential remediation plan agreed by the repo owner.