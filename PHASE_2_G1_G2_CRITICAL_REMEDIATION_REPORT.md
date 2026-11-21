# PHASE 2 G1/G2 CRITICAL REMEDIATION REPORT

**Date:** 2026-11-18
**Scope:** Critical + High findings from `PHASE_2_G1_G2_INDEPENDENT_AUDIT_REPORT.md`
**Constraint compliance:** No migration/SQL executed against Supabase; no CLI link/unlink; no credential/env changes; no commit/push/deploy. Static edits + offline regression tests only.

---

## 1. Migration 010 — `supabase/migrations/010_store_memberships.sql`

| # | Finding | Status | Evidence |
|---|---------|--------|----------|
| 1.1 | SECURITY DEFINER RLS bypass / missing `search_path` | **PASS** | `is_store_owner`, `is_active_store_manager`, `prevent_sole_owner_change`, `prevent_sole_owner_delete` now `SET search_path = public, pg_catalog` (lines 71, 81, 102, 152, 186). |
| 1.2 | RLS recursion: `conversations_store_members_select` queried `store_memberships` directly | **PASS** | Policy now calls `public.is_store_owner(...) OR public.is_active_store_member(...)` (lines 286-290). New `is_active_store_member` SECURITY DEFINER helper (lines 97-111) breaks the recursion. |
| 1.3 | `jsonb_bool` not used in `is_active_store_manager` | **PASS** | Line 90 uses `public.jsonb_bool(sm.permissions, 'member_write')`; also excludes `suspended_at IS NOT NULL` (line 88). |
| 1.4 | INSERT policy allowed arbitrary `permissions` JSONB | **PASS** | `validate_store_member_permissions()` allowlist (`member_write` boolean only) gates INSERT (line 224) and UPDATE (line 244). Manager branch blocks granting `member_write` (line 231). |
| 1.5 | UPDATE policy gap for `staff → manager` promotion | **PASS** | Manager UPDATE branch tightened: `NEW.role <> 'owner'`, same store/profile, role in `(staff, manager)`, and `NOT (NEW.role = 'staff' AND permissions ? 'member_write')` (lines 263-272). |
| 1.7 | Sole-owner trigger ignored `suspended_at` | **PASS** | `prevent_sole_owner_change` blocks `NEW.suspended_at IS NOT NULL` (line 159); delete trigger also checks `suspended_at IS NULL` (line 189). |
| 1.9 | Missing composite index for manager queries | **PASS** | `idx_store_memberships_store_role_active (store_id, role) WHERE left_at IS NULL` (lines 57-58) + `idx_store_memberships_suspended` (59-60). |

## 2. Migration 011 — `supabase/migrations/011_conversation_customer_id.sql`

| # | Finding | Status | Evidence |
|---|---------|--------|----------|
| 2.1 | Merge guards ran AFTER re-pointing | **PASS** | Authoritative post-condition guards remain immediately **before** `DELETE FROM conversations` (lines ~140-152); archive insert moved to the top of the block so a forensic record exists even if a later step fails. Re-point order: archive → members → messages → call_history → notifications → recompute → guard → delete. |
| 2.3 | `left_at` upsert `COALESCE` marked active members as left | **PASS** | `left_at` now uses nulls-last CASE/LEAST (lines ~108-113): keep-side NULL wins; otherwise `LEAST`. |
| 2.4 | `last_message_at` recompute counted deleted messages | **PASS** | Subquery filters `AND is_deleted = false` (lines ~128-130). |
| 2.6 | Archive table had no PK/indexes | **PASS** | `id UUID PRIMARY KEY`, `original_conversation_id NOT NULL`, indexes on `keep_conversation_id`, `customer_id`, `store_id`, `original_conversation_id`. |
| 2.7 | `conversation_members_role_check` not validated | **PASS** | Pre-validates existing rows; raises if invalid roles present before adding constraint. |

## 3. `backend/services/chatService.js`

| # | Finding | Status | Evidence |
|---|---------|--------|----------|
| 4.1.1 | Unique conflict matched `error.message` string | **PASS** | Now `error.constraint === 'ux_conversations_store_customer'` (with legacy message fallback only when `constraint` absent). |
| 4.1.3 | Fallback membership lookup non-deterministic | **PASS** | Added `.order('created_at', { ascending: true, nullsFirst: true }).order('id', { ascending: true })`. |

## 4. `backend/services/callService.js`

| # | Finding | Status | Evidence |
|---|---------|--------|----------|
| 4.2.1 | `heartbeatCall` used `.single()` → crash on missing membership | **PASS** | Membership lookup now `.maybeSingle()` + `if (!member) return false;`. |

## 5. `backend/services/socketService.js`

| # | Finding | Status | Evidence |
|---|---------|--------|----------|
| 4.3.1 | Store room blocked managers/staff | **PASS** | `joinStore` now allows owner, active `manager`/`staff` (`store_memberships`, `left_at IS NULL`, `suspended_at IS NULL`), or platform `admin`/`owner`. |
| 4.3.2 | `.single()` in 3 handlers crashed on missing rows | **PASS** | `joinConversation`, `typing`, `stopTyping`, `callSignal`, `joinCall`, `joinDelivery`, `courierLocationUpdate` all use `.maybeSingle()` with null guards. |

## 6. Tests — `backend/__tests__/phase2_remediation.test.mjs`

| # | Finding | Status | Evidence |
|---|---------|--------|----------|
| 5.1 | 13 × `assert.ok(true, ...)` no-op tests | **PASS** | All 13 replaced with logic-asserting tests: owner backfill, manager self-add block, owner-role block, UPDATE WITH CHECK matrix, sole-owner demote/remove/suspend block, suspend/remove/re-add lifecycle (state asserted via fake update API), unambiguous backfill, duplicate merge (members/messages/call_history re-point + `last_message_at`), NULL customer_id insert, legacy fallback + backfill UPDATE, conflict-via-`error.constraint`, concurrent convergence. |
| 5.1 (helper) | Fake could not express `.single()` vs `.maybeSingle()` or unique conflicts | **PASS** | `fakeSupabase.mjs`: `.single()` → PGRST116 on miss; `.maybeSingle()` → null; conversations insert simulates `23505` with `.constraint`. Added `fake.seed(...)` test helper. |

## 7. High-Priority cross-cutting items

| Item | Status | Evidence |
|------|--------|----------|
| `jsonb_bool` used in manager permission check | **PASS** | 010 line 90. |
| `permissions` JSONB allowlist validation | **PASS** | `validate_store_member_permissions` + INSERT/UPDATE policy gates. |
| Sole-owner trigger + `suspended_at` | **PASS** | 010 lines 159, 189. |
| `last_message_at` excludes deleted | **PASS** | 011 `is_deleted = false`. |
| Archive table indexes | **PASS** | 011 archive PK + 4 indexes. |
| Deterministic fallback membership query | **PASS** | chatService ordered by `created_at, id`. |

## 8. Git Safety

| Check | Result |
|-------|--------|
| `.gitignore` includes `supabase/.temp/` | **PASS** (line 32) |
| `supabase/.temp/` files on disk | **PASS** — all 9 files still present, untouched |
| Staged deletions of `supabase/.temp/*` | **PRE-EXISTING** (not introduced by this work); left as-is per "do not restore/delete/overwrite .temp" |
| 26 untracked reports | **PASS** — none deleted |
| `frontend/src/api/auth.js` | **UNTOUCHED** — left as-is (out of scope) |

## 9. Regression Test Results

```
npm --prefix backend test
ℹ tests 207
ℹ pass 207
ℹ fail 0
```

Ran twice; stable. Baseline before changes: 206 pass / 0 fail.

---

## 10. Files Changed

- `supabase/migrations/010_store_memberships.sql`
- `supabase/migrations/011_conversation_customer_id.sql`
- `backend/services/chatService.js`
- `backend/services/callService.js`
- `backend/services/socketService.js`
- `backend/__tests__/helpers/fakeSupabase.mjs`
- `backend/__tests__/phase2_remediation.test.mjs`

## 11. Not Done (out of scope / requires approval)

- Rollback 011 remains a schema-only revert (requires `pg_dump` backup for true data recovery) — **BLOCKED by design**, documented, not modified.
- Did not run migrations/SQL against any Supabase project.
- Did not commit/push/deploy.
- Did not start G3.

**Verdict:** All Critical and High findings from the independent audit are remediated with offline-verifiable evidence. Awaiting approval for the next verification round.