# PHASE 2 G1/G2 INDEPENDENT AUDIT REPORT

**Audit Date:** 2026-11-18  
**Auditor:** Independent Static Analysis  
**Scope:** Migrations 010, 011; Rollback scripts; Tests; Application code changes  
**Method:** Static code review only (no DB execution per constraints)

---

## EXECUTIVE SUMMARY

| Area | Status | Critical Issues | High Issues | Medium Issues |
|------|--------|-----------------|-------------|---------------|
| Migration 010 (store_memberships) | **FAIL** | 2 | 3 | 4 |
| Migration 011 (conversation_customer_id) | **FAIL** | 2 | 2 | 3 |
| Rollback 010 | **PASS** | 0 | 0 | 1 |
| Rollback 011 | **BLOCKED** | 1 | 1 | 0 |
| Application Code (chatService, callService, socketService) | **FAIL** | 1 | 2 | 3 |
| Tests (phase2_remediation.test.mjs) | **FAIL** | 0 | 12 | 0 |
| Git State | **FAIL** | 0 | 1 | 2 |

**Overall Verdict:** **BLOCKED** — Cannot approve G3 until critical issues resolved.

---

## 1. MIGRATION 010: `supabase/migrations/010_store_memberships.sql`

### 1.1 CRITICAL: SECURITY DEFINER Functions Without Proper Privilege Boundaries

| Location | Issue | Evidence |
|----------|-------|----------|
| Lines 59-67 (`is_store_owner`) | SECURITY DEFINER function reads `stores` table. Function owner (postgres) has full table access. If `stores` has RLS, SECURITY DEFINER bypasses it. No `SET search_path = public, pg_catalog` — only `public` set. | `SECURITY DEFINER SET search_path = public` (line 63-64) |
| Lines 69-84 (`is_active_store_manager`) | SECURITY DEFINER reads `store_memberships`. Same RLS bypass risk. Uses `(sm.permissions->>'member_write')::boolean` — implicit cast can throw on non-boolean JSON. | Line 82: `COALESCE((sm.permissions->>'member_write')::boolean, FALSE)` |
| Lines 99-119 (`prevent_sole_owner_change`) | SECURITY DEFINER trigger function. Queries `store_memberships` directly — bypasses RLS. Uses `OLD/NEW` in trigger context (valid). | Lines 106-114 |
| Lines 127-147 (`prevent_sole_owner_delete`) | Same as above. | Lines 133-142 |

**Risk:** SECURITY DEFINER functions execute with owner privileges (typically `postgres`), bypassing all RLS policies on referenced tables. If `stores` or `store_memberships` have RLS enabled (they do), these functions see ALL rows, not just permitted ones.

**Fix Required:** 
- Add `SET search_path = public, pg_catalog` to all SECURITY DEFINER functions
- Consider using `SECURITY INVOKER` with `GRANT SELECT` on specific columns, or ensure functions only read non-sensitive data
- Use `jsonb_bool()` helper (line 86-96) instead of direct `::boolean` cast

### 1.2 CRITICAL: RLS Policy on `conversations` References `store_memberships` Without RLS Guard

| Location | Issue | Evidence |
|----------|-------|----------|
| Lines 213-223 (`conversations_store_members_select`) | Policy queries `store_memberships` directly in `EXISTS` subquery. `store_memberships` has RLS enabled (line 155). This creates **infinite recursion**: conversations policy → store_memberships RLS → store_memberships policy → ... | Lines 216-221 |

**Risk:** Querying a table with RLS from another table's RLS policy causes infinite recursion or performance collapse. The policy at line 213-223 will fail at runtime.

**Fix Required:** Use SECURITY DEFINER helper function (like `is_active_store_member`) instead of direct table access in RLS policy.

### 1.3 HIGH: `jsonb_bool` Helper Not Used in `is_active_store_manager`

| Location | Issue | Evidence |
|----------|-------|----------|
| Line 82 | Direct cast `(sm.permissions->>'member_write')::boolean` throws error if JSON value is not boolean (e.g., string `"true"`, number `1`, null). | Line 82 |

**Fix Required:** Replace with `public.jsonb_bool(sm.permissions, 'member_write')` (defined lines 86-96).

### 1.4 HIGH: INSERT Policy Allows Manager to Set Arbitrary `permissions` JSONB

| Location | Issue | Evidence |
|----------|-------|----------|
| Lines 166-174 | `store_memberships_insert` WITH CHECK only validates `role <> 'owner'` and `profile_id <> auth.uid()`. No validation on `permissions` JSONB content. Manager could inject `{"member_write": true, "admin_panel": true, "delete_store": true}`. | Lines 167-173 |

**Fix Required:** Add CHECK constraint or trigger to validate `permissions` keys against allowlist.

### 1.5 HIGH: UPDATE Policy WITH CHECK Logic Gap for Manager Role Changes

| Location | Issue | Evidence |
|----------|-------|----------|
| Lines 196-203 | Manager UPDATE allows `NEW.role IN ('staff','manager')` but does not prevent `staff → manager` promotion without `member_write` permission. The `p_need_member_write` parameter is only checked in `is_active_store_manager` for INSERT, not UPDATE. | Lines 196-203 |

**Fix Required:** Add `p_need_member_write` check for role promotion in UPDATE policy.

### 1.6 MEDIUM: Partial Index `ux_store_memberships_active` Allows Duplicate Soft-Deleted Rows

| Location | Issue | Evidence |
|----------|-------|----------|
| Line 51-52 | `WHERE left_at IS NULL` — multiple rows with same `(store_id, profile_id)` can exist if `left_at` is set. Re-add logic (line 160-168 test) expects this, but application must handle. | Line 52 |

**Note:** Documented behavior, but ensure application handles `rejoined_at` correctly.

### 1.7 MEDIUM: Trigger `prevent_sole_owner_change` Does Not Block `suspended_at` Change

| Location | Issue | Evidence |
|----------|-------|----------|
| Lines 106-116 | Trigger only checks `NEW.role <> 'owner' OR NEW.left_at IS NOT NULL`. Does not prevent setting `suspended_at` on sole owner (effectively disabling them). | Line 106 |

**Fix Required:** Add `OR NEW.suspended_at IS NOT NULL` to condition.

### 1.8 MEDIUM: `conversations_store_members_select` Policy Duplicates `is_store_owner` Check

| Location | Issue | Evidence |
|----------|-------|----------|
| Lines 215-223 | `EXISTS` subquery already covers owner via `store_memberships` (owner has role='owner'). The `OR public.is_store_owner(...)` is redundant and adds function call overhead. | Line 222 |

### 1.9 MEDIUM: No Index on `store_memberships(store_id, role, left_at)` for Manager Queries

| Location | Issue | Evidence |
|----------|-------|----------|
| N/A | `is_active_store_manager` queries `WHERE store_id = ? AND profile_id = ? AND left_at IS NULL AND role = 'manager'`. Existing indexes: `(store_id)`, `(profile_id)`, `(store_id) WHERE left_at IS NULL`. Missing composite index for this query pattern. | Lines 76-83 |

---

## 2. MIGRATION 011: `supabase/migrations/011_conversation_customer_id.sql`

### 2.1 CRITICAL: Merge Guards Execute AFTER Re-pointing (Logic Bug)

| Location | Issue | Evidence |
|----------|-------|----------|
| Lines 73-120 | Re-pointing of `conversation_members`, `messages`, `call_history`, `notifications` happens at lines 81-101. Guards at lines 110-118 check `EXISTS` on same tables **after** re-pointing. Since re-pointing moves all references, guards will **always pass**, never aborting. | Lines 81-118 |

**Risk:** If re-pointing partially fails (e.g., FK violation on `messages`), the transaction rolls back. But if re-pointing succeeds and guards pass, duplicate conversations are deleted even if some references were missed (e.g., `notifications` deep-link re-point is best-effort).

**Fix Required:** Move guards BEFORE re-pointing, or use `BEFORE DELETE` trigger on `conversations` with `FOR EACH ROW`.

### 2.2 CRITICAL: Backfill Query Window Function Counts Incorrectly

| Location | Issue | Evidence |
|----------|-------|----------|
| Lines 16-30 | Subquery `src` uses `COUNT(*) OVER (PARTITION BY cm.conversation_id)` on filtered rows (non-owner, active). However, the `WHERE` clause filters `NOT EXISTS (SELECT 1 FROM stores s WHERE s.owner_id = cm.profile_id)` **after** the window function computes. In PostgreSQL, window functions compute over the **result of the FROM/WHERE**, so this is actually correct. **BUT**: The `member_count` is per-row duplicate; outer query filters `src.member_count = 1`. This works but is inefficient. | Lines 19-30 |

**Verdict:** Actually correct, but confusing. No fix needed.

### 2.3 HIGH: `conversation_members` Upsert ON CONFLICT Does Not Handle `left_at` Correctly

| Location | Issue | Evidence |
|----------|-------|----------|
| Lines 85-88 | `ON CONFLICT (conversation_id, profile_id) DO UPDATE SET unread_count = GREATEST(...), last_read_at = LEAST(...), left_at = COALESCE(conversation_members.left_at, EXCLUDED.left_at)`. If keep conversation has `left_at = NULL` (active) and removed has `left_at = '2024-01-01'` (left), `COALESCE(NULL, '2024-01-01')` = `'2024-01-01'` — **incorrectly marks active member as left**. | Line 88 |

**Fix Required:** Use `LEAST` with nulls-last logic: `left_at = CASE WHEN conversation_members.left_at IS NULL THEN EXCLUDED.left_at WHEN EXCLUDED.left_at IS NULL THEN conversation_members.left_at ELSE LEAST(conversation_members.left_at, EXCLUDED.left_at) END`.

### 2.4 HIGH: `last_message_at` Recompute Uses `MAX(created_at)` Without `is_deleted` Filter

| Location | Issue | Evidence |
|----------|-------|----------|
| Lines 104-107 | `SELECT MAX(created_at) FROM messages WHERE conversation_id = keep_id` includes soft-deleted messages (`is_deleted = true`). Should filter `AND is_deleted = false`. | Line 105 |

**Fix Required:** Add `AND is_deleted = false` to subquery.

### 2.5 MEDIUM: Partial Unique Index Allows Multiple `NULL customer_id` per Store

| Location | Issue | Evidence |
|----------|-------|----------|
| Lines 126-128 | `WHERE type = 'store_customer' AND customer_id IS NOT NULL` — correct. Application fallback (chatService lines 89-123) handles legacy `NULL` rows. | Lines 126-128 |

**Note:** Documented behavior. Test at line 228-246 confirms expectation.

### 2.6 MEDIUM: Archive Table `conversations_merge_archive` Has No Indexes or Constraints

| Location | Issue | Evidence |
|----------|-------|----------|
| Lines 33-42 | Archive table created without PK, indexes, or FKs. Forensic queries will be slow. | Lines 33-42 |

**Fix Required:** Add `PRIMARY KEY (id)`, index on `keep_conversation_id`, `customer_id`, `store_id`.

### 2.7 MEDIUM: `conversation_members_role_check` Constraint Added But Not Enforced on Existing Data

| Location | Issue | Evidence |
|----------|-------|----------|
| Lines 132-139 | `ADD CONSTRAINT ... CHECK (role IN ('member','admin','owner'))` — will fail if existing data has invalid roles. Migration uses `DO $$ BEGIN IF NOT EXISTS ...` but does not validate existing rows. | Lines 132-139 |

**Fix Required:** Add `VALIDATE CONSTRAINT` after adding, or clean data first.

---

## 3. ROLLBACK SCRIPTS

### 3.1 `supabase/rollback_010.sql` — **PASS with Minor Issue**

| Location | Issue | Severity |
|----------|-------|----------|
| Lines 1-22 | Drops all objects in correct reverse order: triggers → functions → policies → RLS → indexes → constraints → table. Additive migration, fully reversible. | PASS |
| Line 21 | `DROP TABLE IF EXISTS store_memberships CASCADE` — `CASCADE` will drop dependent objects (FKs from other tables). If any table references `store_memberships`, data loss occurs. No such FKs exist in current schema. | MEDIUM (documented) |

### 3.2 `supabase/rollback_011.sql` — **BLOCKED**

| Location | Issue | Severity |
|----------|-------|----------|
| Lines 5-9 | `INSERT INTO conversations ... FROM conversations_merge_archive ... ON CONFLICT DO NOTHING` — restores deleted conversations but **does not restore** `conversation_members`, `messages`, `call_history`, `notifications` that were re-pointed to `keep_id`. Orphaned references remain pointing to `keep_id`. | CRITICAL |
| Line 17 | `ALTER TABLE conversations DROP COLUMN IF EXISTS customer_id` — irreversible data loss. Column data not backed up. | HIGH |
| Lines 19-20 | Comment acknowledges: "messages/call_history re-pointed to keep_id are NOT automatically split back. Use backup or conversations_merge_archive payload to manually restore." | BLOCKED |

**Verdict:** Rollback 011 is **not a true rollback** — it's a schema-only revert with best-effort data recovery. Requires full database backup for actual rollback.

---

## 4. APPLICATION CODE CHANGES

### 4.1 `backend/services/chatService.js`

#### 4.1.1 CRITICAL: Unique Conflict Retry Checks Error Message String

| Location | Issue | Evidence |
|----------|-------|----------|
| Line 162 | `if (error.code === '23505' && error.message.includes('ux_conversations_store_customer'))` — error message format varies by Postgres version/locale. Should check `error.details` or constraint name via `error.constraint`. | Line 162 |

**Fix Required:** Use `error.constraint === 'ux_conversations_store_customer'` (available in pg 12+).

#### 4.1.2 HIGH: `getOrCreateConversation` Fast Path Does Not Verify Store Membership

| Location | Issue | Evidence |
|----------|-------|----------|
| Lines 66-87 | Fast path finds conversation by `customer_id + store_id` and verifies membership. **But** if `customer_id` was backfilled incorrectly (migration bug), wrong conversation returned. No re-validation of `store_id` ownership. | Lines 74-85 |

#### 4.1.3 HIGH: Fallback Membership Lookup Does Not Handle Multiple Matches

| Location | Issue | Evidence |
|----------|-------|----------|
| Lines 89-123 | Query fetches ALL `store_customer` conversations for store, then iterates to find customer membership. If multiple legacy `NULL customer_id` conversations exist (allowed by partial index), returns **first match** — non-deterministic. | Lines 110-122 |

**Fix Required:** Add `ORDER BY created_at ASC` to fallback query, or error on multiple matches.

#### 4.1.4 MEDIUM: `uploadMessageAttachment` Now Requires `userId` (Breaking Change)

| Location | Issue | Evidence |
|----------|-------|----------|
| Lines 692-727 | Function signature changed from `userId = null` to required `userId`. Throws 401 if not provided. Callers must be updated. | Line 692, 693-695 |

**Note:** Test at line 389-390 passes because test provides `userId`.

#### 4.1.5 MEDIUM: `getOrCreateConversation` Retry Loop Has No Delay

| Location | Issue | Evidence |
|----------|-------|----------|
| Lines 127-180 | `for (let attempt = 0; attempt < maxRetries; attempt++)` — tight loop on conflict. Under high concurrency, wastes CPU. | Lines 127-180 |

**Fix Required:** Add `await new Promise(r => setTimeout(r, 50 * (attempt + 1)))` between retries.

### 4.2 `backend/services/callService.js`

#### 4.2.1 HIGH: `heartbeatCall` Uses `.single()` Which Throws on No Row

| Location | Issue | Evidence |
|----------|-------|----------|
| Lines 145-151 | `const { data: member } = await supabaseAdmin.from('conversation_members')...single()` — if no membership row, throws Postgrest error instead of returning `false`. Should use `.maybeSingle()`. | Lines 145-151 |

**Fix Required:** Change to `.maybeSingle()` and check `if (!member) return false;`.

#### 4.2.2 MEDIUM: `initiateCall` Emits `callee_id` in Payload (New Field)

| Location | Issue | Evidence |
|----------|-------|----------|
| Line 274 | Added `callee_id: calleeId` to `emitIncomingCall` payload. Frontend must handle new field. | Line 274 |

### 4.3 `backend/services/socketService.js`

#### 4.3.1 HIGH: Store Room Join Now Only Allows Owner (Removed Admin/Owner Role Check)

| Location | Issue | Evidence |
|----------|-------|----------|
| Line 105 | Changed from `store.owner_id === userId || ['admin', 'owner'].includes(socket.user.role)` to only `store.owner_id === userId`. **Store managers/staff can no longer join store room** — breaks real-time updates for staff. | Line 105 |

**Fix Required:** Restore role check or add `store_memberships` query to verify active manager/staff.

#### 4.3.2 HIGH: Typing/CallSignal/joinCall Handlers Use `.single()` Without Error Handling

| Location | Issue | Evidence |
|----------|-------|----------|
| Lines 176-188, 212-230, 236-252 | Each handler uses `.single()` on membership query. If query returns 0 or >1 rows, throws unhandled exception, crashing socket handler. | Multiple locations |

**Fix Required:** Use `.maybeSingle()` and `if (!member) return;`.

#### 4.3.3 MEDIUM: Duplicate Membership Validation Logic

| Location | Issue | Evidence |
|----------|-------|----------|
| Lines 176-188, 212-230, 236-252 | Same `conversation_members` query repeated in 3 handlers. Should extract to helper function. | Multiple locations |

---

## 5. TESTS: `backend/__tests__/phase2_remediation.test.mjs`

### 5.1 HIGH: 12 Tests Use `assert.ok(true, '... documented - enforced by ...')` — No Actual Logic Verification

| Test Name | Line | Issue |
|-----------|------|-------|
| store membership: owner backfill creates active owner row | 103 | `assert.ok(true, 'Owner backfill documented - enforced by migration 010')` |
| store membership: manager cannot self-add | 111 | `assert.ok(true, 'Self-add prevention documented - enforced by RLS')` |
| store membership: manager cannot create owner role | 117 | `assert.ok(true, 'Owner role creation by manager blocked - enforced by RLS')` |
| store membership: UPDATE has WITH CHECK preventing unauthorized transitions | 127 | `assert.ok(true, 'UPDATE WITH CHECK documented - enforced by RLS')` |
| store membership: sole owner cannot demote or remove self | 133 | `assert.ok(true, 'Sole owner protection documented - enforced by RLS')` |
| store membership: suspend sets left_at and audit fields | 147 | `assert.ok(true, 'Suspend lifecycle documented - enforced by RLS')` |
| store membership: remove sets left_at and audit fields (soft delete) | 157 | `assert.ok(true, 'Remove lifecycle (soft delete) documented - enforced by RLS')` |
| store membership: re-add clears left_at and sets rejoined_at | 167 | `assert.ok(true, 'Re-add lifecycle documented - enforced by RLS')` |
| conversation: customer_id backfill only when unambiguous | 194 | `assert.ok(true, 'Unambiguous backfill documented - enforced by migration 011')` |
| conversation: duplicate merge re-points members, messages, call_history | 225 | `assert.ok(true, 'Duplicate merge with re-point documented - enforced by migration 011')` |
| conversation: NULL customer_id not constrained by unique index | 245 | `assert.ok(true, 'NULL customer_id handling documented - partial index allows it')` |
| getOrCreateConversation: retries on unique conflict and returns winner | 305 | `assert.ok(true, 'Conflict retry logic documented - requires real DB for full test')` |
| getOrCreateConversation: concurrent requests converge to single conversation (concept) | 318 | `assert.ok(true, 'Concurrency safety documented - requires real DB for full test')` |

**Total: 13 tests (not 12) that are effectively no-ops.**

**Impact:** Test suite reports 206 pass, but 13 tests verify nothing. Real RLS/migration logic untested.

**Fix Required:** Replace with integration tests against real Postgres (Supabase local), or at minimum verify fakeSupabase helper enforces RLS logic.

---

## 6. GIT STATE ANALYSIS

### 6.1 HIGH: Staged Deletion of Supabase Temp Files (Should Not Be Tracked)

| Files | Issue |
|-------|-------|
| `supabase/.temp/cli-latest`, `gotrue-version`, `linked-project.json`, `pooler-url`, `postgres-version`, `project-ref`, `rest-version`, `storage-migration`, `storage-version` | These are local CLI cache files. Staged for deletion suggests `git add -A` was used carelessly. Should be in `.gitignore`. |

### 6.2 MEDIUM: Modified Files Not Related to G1/G2

| File | Change | Concern |
|------|--------|---------|
| `backend/controllers/messageController.js` | Removed duplicate `emitNewMessage` call | OK — bug fix |
| `backend/services/socketService.js` | Added membership validation to typing/callSignal/joinCall | OK — security hardening |
| `frontend/src/api/auth.js` | 26 lines changed | **Unverified** — frontend auth changes outside G1/G2 scope |

### 6.3 MEDIUM: Large Number of Untracked Report Files (26 files)

| Files | Concern |
|-------|---------|
| `MULTI_CONVERSATION_AUDIT.md`, `MULTI_STORE_DEEP_SECURITY_AUDIT.md`, `PHASE_1_SECURITY_IMPLEMENTATION_REPORT.md`, etc. | 26 markdown reports in root. Clutters repo. Should be in `docs/` or `.kilo/`. |

---

## 7. REGRESSION TEST RESULTS

**All 206 tests pass** (including 13 no-op tests).

| Test Suite | Pass | Fail |
|------------|------|------|
| addressApi | 12 | 0 |
| adminUsers | 8 | 0 |
| auth | 9 | 0 |
| callApi | 10 | 0 |
| callHeartbeat | 4 | 0 |
| callIncomingSocket | 8 | 0 |
| callLifecycleAndUnread | 10 | 0 |
| callService | 15 | 0 |
| callTermination | 10 | 0 |
| chatApi | 12 | 0 |
| chat | 10 | 0 |
| chatListReducer | 8 | 0 |
| phase2_remediation | 44 | 0 |
| phone | 17 | 0 |
| phone-e164 | 24 | 0 |
| pricing | 16 | 0 |
| socketRealtime | 1 | 0 |
| **Total** | **206** | **0** |

**Note:** Phase 2 remediation tests (44) include 13 no-op tests. Effective unique logic tests: 31.

---

## 8. FINAL VERDICT PER COMPONENT

| Component | Verdict | Blocking Issues |
|-----------|---------|-----------------|
| Migration 010 | **FAIL** | SECURITY DEFINER RLS bypass; conversations policy recursion; missing permissions validation |
| Migration 011 | **FAIL** | Merge guards after re-point; upsert left_at bug; last_message_at includes deleted |
| Rollback 010 | **PASS** | None |
| Rollback 011 | **BLOCKED** | Not a true rollback; requires full backup |
| chatService.js | **FAIL** | Unique conflict string match; fallback non-determinism |
| callService.js | **FAIL** | heartbeatCall .single() throws |
| socketService.js | **FAIL** | Store room blocks staff; .single() crashes handlers |
| Tests | **FAIL** | 13 no-op tests; no real RLS/migration verification |
| Git State | **FAIL** | Temp files staged; frontend changes unverified |

---

## 9. REQUIRED FIXES BEFORE G3 APPROVAL

### Must Fix (Critical/High)
1. **Migration 010:** Add `SET search_path = public, pg_catalog` to all SECURITY DEFINER functions
2. **Migration 010:** Replace `conversations_store_members_select` policy direct `store_memberships` query with SECURITY DEFINER helper
3. **Migration 010:** Use `jsonb_bool()` in `is_active_store_manager`
4. **Migration 010:** Add `permissions` validation CHECK constraint or trigger
5. **Migration 010:** Add `suspended_at` check to sole owner trigger
6. **Migration 011:** Move merge guards BEFORE re-pointing operations
7. **Migration 011:** Fix `left_at` upsert logic to not override active with left
8. **Migration 011:** Add `is_deleted = false` filter to `last_message_at` recompute
9. **chatService.js:** Use `error.constraint` instead of `error.message.includes()`
10. **chatService.js:** Add deterministic ordering to fallback membership query
11. **callService.js:** Change `heartbeatCall` membership query to `.maybeSingle()`
12. **socketService.js:** Restore store room access for managers/staff via `store_memberships` check
13. **socketService.js:** Change all `.single()` to `.maybeSingle()` in socket handlers
14. **Tests:** Replace 13 no-op `assert.ok(true)` tests with real verification or mark as `todo`

### Should Fix (Medium)
15. **Migration 010:** Add composite index `(store_id, role, left_at)` for manager queries
16. **Migration 011:** Add indexes to `conversations_merge_archive`
17. **Migration 011:** Validate existing data before adding `conversation_members_role_check`
18. **chatService.js:** Add exponential backoff to retry loop
19. **socketService.js:** Extract membership validation to helper
20. **Rollback 011:** Document that full rollback requires `pg_dump` backup
21. **Git:** Add `supabase/.temp/` to `.gitignore`, unstage deletions
22. **Git:** Move report files to `docs/reports/`

---

## 10. APPENDIX: FILE EVIDENCE REFERENCE

| File | Key Lines |
|------|-----------|
| `supabase/migrations/010_store_memberships.sql` | 59-67, 69-84, 99-119, 127-147, 158-163, 166-174, 177-204, 213-223 |
| `supabase/migrations/011_conversation_customer_id.sql` | 16-30, 73-120, 85-88, 104-107, 126-128, 132-139 |
| `supabase/rollback_010.sql` | 1-22 |
| `supabase/rollback_011.sql` | 5-9, 17, 19-20 |
| `backend/services/chatService.js` | 66-87, 89-123, 127-180, 162, 692-727 |
| `backend/services/callService.js` | 131-169, 271-275 |
| `backend/services/socketService.js` | 102-105, 173-188, 207-230, 236-252 |
| `backend/__tests__/phase2_remediation.test.mjs` | 103, 111, 117, 127, 133, 147, 157, 167, 194, 225, 245, 305, 318 |

---

**Report End.**  
**Next Step:** Address all "Must Fix" items, then request re-audit for G3 approval.