# Phase 2G — Credential Remediation Report

**Date:** 2026-11-16
**Baseline:** `PHASE_2F_PRE_DEPLOYMENT_REPORT.md`
**Repository:** `C:\Users\LEGION\OneDrive\Desktop\kindee-marketplace`
**Remote:** `https://github.com/wealthysage3889-sys/kindee-marketplace.git`
**Branch:** `main` (tracking `origin/main`, up to date)

---

## 1. Executive Summary

| Item | Status |
|------|--------|
| Current code tree | **CLEAN** — no hardcoded secrets in tracked files |
| Git history exposure | **CONFIRMED** — admin password and service-role key line in commit `6686f7c` and earlier |
| Admin password rotation | **PENDING** — requires Supabase Dashboard / Admin API action |
| Service-role key rotation | **PENDING** — requires new key generation in Supabase project settings |
| Git history purge | **PENDING APPROVAL** — requires explicit repo owner approval before execution |
| Staging verification | **BLOCKED** — no staging Supabase project available |
| Overall Phase 2G readiness | **PLAN COMPLETE** — execution requires operator actions and approvals |

---

## 2. Credential Exposure Inventory

### 2.1 Confirmed Exposed Credentials

| Credential Type | Location in History | Commit(s) | Exposure Detail | Severity |
|-----------------|---------------------|-----------|-----------------|----------|
| `ADMIN_PASSWORD` (hardcoded) | `backend/scripts/createAdminSupabase.js:10` | `6686f7c` (2026-11-15) | Literal password string in source; printed on success at line 117 | **CRITICAL** |
| `ADMIN_EMAIL` (hardcoded) | `backend/scripts/createAdminSupabase.js:9` | `6686f7c` | Literal email in source | **HIGH** |
| `ADMIN_ROLE` (hardcoded) | `backend/scripts/createAdminSupabase.js:11` | `6686f7c` | Literal role string | **LOW** |
| `SUPABASE_SERVICE_ROLE_KEY` (assignment line) | `backend/scripts/createAdminSupabase.js` (older blob) | `6686f7c` and earlier | Service-role key assignment in source; bypasses RLS | **CRITICAL** |

### 2.2 Exposure Timeline

| Date | Commit | Action |
|------|--------|--------|
| 2026-11-15 | `6686f7c` | Introduced `createAdminSupabase.js` with hardcoded credentials and password printing |
| 2026-11-16 | (uncommitted) | Phase 2E/2F: Refactored to env-based credentials; removed password printing; added env validation |

### 2.3 Current Tree Verification

**Confirmed clean** (verified by regex scan of tracked files in Phase 2F):
- `backend/scripts/createAdminSupabase.js` — reads all credentials from `process.env`
- No hardcoded passwords, API keys, or service-role keys in any tracked file
- `.env*` is gitignored; no `.env` files tracked

### 2.4 Blast Radius Assessment

| Vector | Impact |
|--------|--------|
| Anyone with clone/fetch access | Can recover old admin password and service-role key from history |
| Forks / mirrors | Retain exposed commits unless they also rewrite history |
| CI/CD logs | May have captured printed password if script was run in CI (not observed) |
| Deployment secret stores | Not affected (credentials were in source, not in deploy env) |

---

## 3. Rotation Checklist

### 3.1 Admin Account Password Rotation

**Prerequisites:**
- Access to Supabase Dashboard (project owner / admin)
- New strong password generated (recommend: 32+ chars, random, stored in password manager)

**Steps:**

| Step | Action | Verification |
|------|--------|--------------|
| 1 | Go to Supabase Dashboard → Authentication → Users | Admin user visible |
| 2 | Click the admin user → "Reset password" or use Admin API: `supabaseAdmin.auth.admin.updateUserById(adminId, { password: '<new>' })` | Password updated |
| 3 | Update deployment secret store (Vercel/Render/etc.) with new `ADMIN_PASSWORD` | Secret store updated |
| 4 | Update local `.env` files for operators | Local env updated |
| 5 | Test login with **new** password on Staging (if available) | Login succeeds |
| 6 | Confirm **old** password fails | Login rejected |
| 7 | Run `backend/scripts/createAdminSupabase.js` with new env — verify it does NOT print password | Script runs, password not printed |

**Rollback:** If new password fails, revert secret store and Supabase user password to previous value (if known) or generate another.

### 3.2 Service-Role Key Rotation

**Prerequisites:**
- Access to Supabase Dashboard → Settings → API
- New service-role key generated

**Steps:**

| Step | Action | Verification |
|------|--------|--------------|
| 1 | Go to Supabase Dashboard → Settings → API → "Reveal" service_role key → "Generate new key" | New key generated |
| 2 | Update deployment secret store with new `SUPABASE_SERVICE_ROLE_KEY` | Secret store updated |
| 3 | Update local `.env` files for operators | Local env updated |
| 4 | Update any script runner / CI environment variables | CI env updated |
| 5 | Run backend tests: `npm --prefix backend test` (requires valid service-role key) | 82/82 PASS |
| 6 | Verify old key is revoked / no longer works (Supabase revokes on generation) | Old key rejected |

**Note:** Service-role keys cannot be "changed" — only replaced. The old key becomes invalid immediately upon new key generation.

### 3.3 ADMIN_EMAIL / ADMIN_ROLE

- `ADMIN_EMAIL`: If the email was exposed, consider whether the account identifier itself is sensitive. If so, create a new admin user with a different email and deactivate the old one.
- `ADMIN_ROLE`: Not sensitive; value is `'admin'`.

### 3.4 Rotation Sign-Off

| Credential | Rotated | Verified | Operator | Date |
|------------|---------|----------|----------|------|
| ADMIN_PASSWORD | ☐ | ☐ | | |
| SUPABASE_SERVICE_ROLE_KEY | ☐ | ☐ | | |
| ADMIN_EMAIL (if needed) | ☐ | ☐ | | |

---

## 4. Git History Cleanup Plan

### 4.1 Requirements & Constraints

| Constraint | Detail |
|------------|--------|
| **Explicit approval required** | Repo owner must approve before any history rewrite |
| **No force-push without approval** | `git push --force` only after approval and rotation |
| **Collaborator notification** | All collaborators must be notified of rewrite window |
| **Re-clone required** | After force-push, every collaborator must re-clone |
| **No `git filter-repo` execution yet** | Planning only — tool not run in this phase |

### 4.2 Tool Selection

| Tool | Pros | Cons |
|------|------|------|
| `git filter-repo` | Native, fast, handles all refs, supports `--replace-text` | Requires Python / pip install |
| BFG Repo-Cleaner | Faster on large repos, simpler syntax | Requires fresh clone, Java |

**Recommendation:** `git filter-repo` (standalone binary available; no Python dependency issues on Windows).

### 4.3 Secret Map File (for `--replace-text`)

Create a file **outside the repo** (e.g., `~/secret-map.txt`) with literal→replacement mappings:

```
literal_old_admin_password==>REDACTED
literal_old_service_role_key==>REDACTED
```

> **CRITICAL:** Never commit this file. Keep it outside the repository. The literal values must match exactly what appears in Git history.

### 4.4 Execution Plan (Dry-Run First)

```bash
# 1. Install git-filter-repo (standalone binary recommended)
# 2. Fresh clone for safety
git clone https://github.com/wealthysage3889-sys/kindee-marketplace.git kindee-cleanup
cd kindee-cleanup

# 3. Dry-run: show what would be rewritten (no changes)
git filter-repo --replace-text ~/secret-map.txt --dry-run

# 4. If dry-run looks correct, execute
git filter-repo --replace-text ~/secret-map.txt --force

# 5. Verify: search history for old values
git log -p --all -S "literal_old_admin_password"
git log -p --all -S "literal_old_service_role_key"
# Should return no matches

# 6. Re-add remote and force-push (WITH APPROVAL ONLY)
git remote add origin https://github.com/wealthysage3889-sys/kindee-marketplace.git
git push --force --all
git push --force --tags
```

### 4.5 Post-Purge Actions

| Action | Owner |
|--------|-------|
| Notify all collaborators to re-clone | Repo owner |
| Rotate any other secret that lived in rewritten commits | Operators |
| Verify GitHub GC for unreachable commits (contact Support if needed) | Repo owner |
| Update CI/CD caches keyed by old SHAs | DevOps |

### 4.6 Alternative: Selective Path Rewrite (if approved)

If only `backend/scripts/createAdminSupabase.js` needs purging and the file is to be kept in current form:

```bash
# Rewrite only that path's history
git filter-repo --replace-text ~/secret-map.txt --path backend/scripts/createAdminSupabase.js --force
```

> This still changes all SHAs from the first commit touching that file onward.

### 4.7 Risk Matrix

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Collaborators push old history back | Medium | High | Enforce branch protection; require re-clone |
| GitHub retains unreachable commits by SHA | Medium | Medium | Contact GitHub Support for GC |
| Open PRs break | High | Medium | Close/merge PRs before rewrite; recreate after |
| CI caches invalidated | High | Low | Re-run pipelines; negligible cost |
| Force-push rejected by branch protection | Medium | Medium | Temporarily disable protection during window |

---

## 5. Verification Procedures

### 5.1 Post-Rotation Verification

| Check | Command / Action | Expected |
|-------|------------------|----------|
| Admin login with new password | Dashboard / API test | Success |
| Admin login with old password | Dashboard / API test | Failure |
| Service-role key validity | `npm --prefix backend test` | 82/82 PASS |
| Script no longer prints password | `node backend/scripts/createAdminSupabase.js` | Password not in output |
| No secrets in current tree | `grep -r "ADMIN_PASSWORD" --include="*.js" backend/` | Only env references |

### 5.2 Post-Purge Verification

| Check | Command | Expected |
|-------|---------|----------|
| Old password not in history | `git log -p --all -S "literal_old_admin_password"` | No matches |
| Old service-role key not in history | `git log -p --all -S "literal_old_service_role_key"` | No matches |
| All refs rewritten | `git log --oneline -1` | New SHA |
| Collaborators can clone | Fresh clone test | Success |

---

## 6. Staging Smoke Test (Required Before GO)

| Test | Description | Status |
|------|-------------|--------|
| Admin login (new password) | Verify rotated credentials work | ☐ PENDING STAGING |
| Customer login | Verify regular auth unaffected | ☐ PENDING STAGING |
| Logout `local` scope | Single-device logout | ☐ PENDING STAGING |
| Logout `global` scope | All-device revocation | ☐ PENDING STAGING |
| Account suspension | `deactivateAccount` → login blocked, refresh rejected | ☐ PENDING STAGING |
| Session revocation | Other-device sessions revoked after ban | ☐ PENDING STAGING |
| Reactivation (manual) | `is_active=true` + `ban_duration='none'` | ☐ PENDING STAGING |

> **Blocking:** No staging Supabase project currently available. This must be provisioned before GO.

---

## 7. Current Working Tree Status (Git)

```
Modified (41): backend/middleware/auth.js, backend/routes/*.js, backend/services/*.js,
               backend/scripts/createAdminSupabase.js, frontend/src/**/*.jsx, etc.
Deleted:       backend/controllers/settingController.js
Untracked:     Phase reports, backend/__tests__/, backend/scripts/migrateLegacyUsers.js,
               backend/utils/phone.js, backend/utils/productPricing.js,
               frontend/src/utils/lineState.js, supabase/migrations/005_create_admin_user.sql,
               supabase/migrations/006_social_provider_ids.sql, supabase/promote_admin.sql,
               supabase/audit_discount_price.sql
```

**Recommendation:** Do not commit until rotation is verified and purge is approved/executed.

---

## 8. Approval Gates for Phase 2G Completion

| Gate | Required | Status |
|------|----------|--------|
| Admin password rotated & verified | Yes | ☐ |
| Service-role key rotated & verified | Yes | ☐ |
| Git history purge approved by repo owner | Yes | ☐ |
| Git history purge executed (or risk accepted) | Yes | ☐ |
| Staging smoke test passed | Yes | ☐ |
| All Phase 2E/2F Critical fixes intact (regression) | Yes | ✅ 82/82 PASS |

---

## 9. GO / NO-GO Recommendation

**NO-GO** — same as Phase 2F.

**Blocking items unchanged:**
1. Credential rotation not performed (requires human action on Supabase project)
2. Git history purge not approved/executed
3. Staging verification not possible (no staging project)

**Path to GO:**
1. Complete Rotation Checklist (§3) and sign off
2. Approve and execute Git History Cleanup Plan (§4) or formally accept residual risk with compensating controls
3. Provision staging Supabase project and run Smoke Test (§6)
4. Re-evaluate with all gates checked

---

## 10. Files Created in This Phase

| File | Purpose |
|------|---------|
| `PHASE_2G_CREDENTIAL_REMEDIATION_REPORT.md` | This report — credential inventory, rotation checklist, git history cleanup plan |

---

**End of Report**

*Phase 2G delivers the remediation plan. Execution of rotation, purge, and staging verification are operator actions outside the codebase scope.*