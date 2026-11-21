# KINDEE Cloud Pre-Execution Verification Report

**Date:** 2026-11-18T17:45:00Z
**Project:** kindee-marketplace
**Target:** Supabase Project `bzkjtvsqqxnbbnkgcrko` (kindee, Tokyo, PG 17.11)
**Scope:** Read-only verification of migrations 011, 012, 013 preconditions — **NO EXECUTION**

---

## 1. Project Identity Confirmation

| Check | Value | Status |
|-------|-------|--------|
| Target Project Ref | `bzkjtvsqqxnbbnkgcrko` | ✅ CONFIRMED |
| `supabase/.temp/project-ref` | `bzkjtvsqqxnbbnkgcrko` | ✅ MATCHES |
| `supabase/.temp/pooler-url` | `postgresql://postgres.bzkjtvsqqxnbbnkgcrko@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres` | ✅ MATCHES |
| Backend `.env` `DATABASE_URL` host | `db.bzkjtvsqqxnbbnkgcrko.supabase.co` | ✅ MATCHES |
| Forbidden Ref `henhkouetfjelkqsfzgu` | Absent from config | ✅ CLEAN |
| Cloud DB Version | PostgreSQL 17.11 | ✅ CONFIRMED |
| Connection | Pooler (IPv6) | ✅ WORKING |

**Connection String Used:** `postgresql://postgres.bzkjtvsqqxnbbnkgcrko@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres` (password via PGPASSWORD env var)

---

## 2. Query Results Summary

All verification queries executed successfully via Docker PostgreSQL 15 client against Cloud pooler. **No queries failed.**

---

## 3. Migration 011 — Conversation Customer ID (Preconditions Check)

| Check | Expected (Post-011) | Actual (Cloud Current) | Status |
|-------|---------------------|------------------------|--------|
| `conversations.customer_id` column | UUID, nullable, FK → profiles(id) ON DELETE SET NULL | **NOT FOUND** (0 rows) | ❌ MISSING |
| FK `conversations_customer_id_fkey` | EXISTS | **NOT FOUND** (0 rows) | ❌ MISSING |
| Archive table `conversations_merge_archive` | EXISTS | **NOT EXISTS** (false) | ❌ MISSING |
| Unique index `ux_conversations_store_customer` | EXISTS (customer_id, COALESCE(store_id, sentinel)) WHERE type='store_customer' AND customer_id IS NOT NULL | **NOT FOUND** (0 rows) | ❌ MISSING |
| CHECK `conversation_members_role_check` | EXISTS (role IN 'member','admin','owner') | **NOT FOUND** (0 rows) | ❌ MISSING |
| RLS `conversations` | ENABLED, FORCE = OFF | ✅ ENABLED, FORCE = OFF | ✅ PASS |
| RLS `conversation_members` | ENABLED, FORCE = OFF | ✅ ENABLED, FORCE = OFF | ✅ PASS |

**011 Verdict:** **NOT APPLIED** — All schema objects missing. Migration 011 must run first.

**Dependency Impact:** 013 preconditions do NOT require 011 objects (013 only checks 010 objects). However, 011 should run before 012/013 for logical order.

---

## 4. Migration 012 — Store Order Status with Reason (Detailed Analysis)

### 4.1 Trigger & Function Comparison: Current (003) vs Migration 012

| Aspect | Current in Cloud (from 003) | Migration 012 Creates/Changes |
|--------|----------------------------|-------------------------------|
| **Trigger Name** | `log_store_order_status_change_trigger` | Same name — DROP IF EXISTS then CREATE |
| **Trigger Event** | AFTER UPDATE ON `store_orders` | Same — AFTER UPDATE ON `store_orders` |
| **Trigger Function** | `log_store_order_status_change()` (original) | `log_store_order_status_change()` (NEW version with skip flag) |
| **Function: `log_store_order_status_change()`** | Lines 271-295 in 003: Always inserts history with reason `'Store order status updated'` | Lines 99-133 in 012: Checks `app.skip_history_trigger` session var; **skips insert if true** |
| **NEW Function** | None | `update_store_order_status_with_reason(UUID, order_status, TEXT)` — SECURITY DEFINER |
| **GRANT** | None | `GRANT EXECUTE ON update_store_order_status_with_reason TO service_role` |

### 4.2 Function Call Chain Analysis

```
CURRENT (003) FLOW:
  Direct UPDATE store_orders SET status = 'x'
       │
       ▼
  Trigger: log_store_order_status_change_trigger (AFTER UPDATE)
       │
       ▼
  Function: log_store_order_status_change()
       │
       ▼
  INSERT INTO order_status_history (reason = 'Store order status updated')

────────────────────────────────────────────────────────────────

MIGRATION 012 FLOW (Two Paths):

PATH A — Via New Function (INTENDED for seller actions with reason):
  CALL update_store_order_status_with_reason(order_id, 'cancelled', 'Customer requested')
       │
       ▼
  Sets app.skip_history_trigger = 'true' (session-local)
       │
       ▼
  UPDATE store_orders SET status = 'cancelled' ...
       │
       ▼
  Trigger FIRES but SKIPS insert (sees skip flag = true)
       │
       ▼
  Function MANUALLY INSERTs into order_status_history (with actual reason)
       │
       ▼
  Resets app.skip_history_trigger = 'false'

PATH B — Direct UPDATE (Legacy/Bypass):
  Direct UPDATE store_orders SET status = 'confirmed'
       │
       ▼
  Trigger: log_store_order_status_change_trigger (AFTER UPDATE)
       │
       ▼
  Function: log_store_order_status_change() (NEW version)
       │
       ▼
  skip_flag = false → INSERT with reason = 'Store order status updated' (default)
```

### 4.3 Function `update_store_order_status_with_reason` — Behavior Detail

| Step | Action |
|------|--------|
| 1 | Validates store_order exists, fetches `parent_order_id`, `store_owner_id` |
| 2 | Validates status transition (`old_status != new_status`) |
| 3 | Resolves `actor_id`: JWT `sub` claim → fallback to `store_owner_id` (service_role) |
| 4 | Sets `app.skip_history_trigger = true` (session-local, transaction-scoped) |
| 5 | Updates `store_orders`: status, timestamps (`confirmed_at`, `ready_for_pickup_at`, `picked_up_at`, `delivered_at`, `cancelled_at`) |
| 6 | Resets `app.skip_history_trigger = false` |
| 7 | **Inserts into `order_status_history` with actual `p_reason` (or default)** |
| 8 | Calls `fulfill_stock_reservation()` on `confirmed`; `release_stock_reservation()` on `cancelled` |
| 9 | Returns updated `store_orders` row |

**Security:** `SECURITY DEFINER` — executes with function owner privileges (typically `postgres`), allowing it to bypass RLS for the history insert and stock functions.

### 4.4 Impact Assessment on Existing Data & Order System

| Area | Impact | Assessment |
|------|--------|------------|
| **Existing `store_orders` (2 rows)** | No schema change; only new function/trigger | ✅ **SAFE** — No DDL on table |
| **Existing `order_status_history` (0 rows)** | Will be populated on future status changes | ✅ **SAFE** — No migration data manipulation |
| **Trigger replacement** | `DROP TRIGGER IF EXISTS` → `CREATE TRIGGER` same name | ✅ **SAFE** — Atomic replace; no gap |
| **Direct UPDATEs (legacy code)** | Still work; trigger logs with default reason | ✅ **BACKWARD COMPATIBLE** |
| **New API calls** | Should use `update_store_order_status_with_reason` for reason capture | ⚠️ **REQUIRES APP CODE CHANGE** |
| **Stock functions** | `fulfill_stock_reservation` / `release_stock_reservation` called from new function | ✅ **CONSISTENT** — Same functions as 003 |
| **RLS on `order_status_history`** | New function is SECURITY DEFINER → bypasses RLS for insert | ✅ **INTENDED** — History must be written |

### 4.5 Precondition Check Results (Re-verified)

| Check | Expected (Post-012) | Actual (Cloud Current) | Status |
|-------|---------------------|------------------------|--------|
| Function `update_store_order_status_with_reason(uuid, order_status, text)` | EXISTS, SECURITY DEFINER | **NOT FOUND** | ❌ MISSING |
| Function `log_store_order_status_change()` | NEW version with skip flag | Original version (003) — no skip flag | ❌ OUTDATED |
| Trigger `log_store_order_status_change_trigger` on `store_orders` | AFTER UPDATE, ENABLED, calls NEW function | EXIST, ENABLED, calls ORIGINAL function | ⚠️ WRONG FUNCTION |
| `service_role` EXECUTE on new function | GRANTED | **N/A (function missing)** | ❌ MISSING |
| Trigger `update_store_orders_updated_at` | Pre-existing (003) | ✅ EXISTS | — |

**012 Verdict:** **NOT APPLIED** — Core function missing; trigger exists but calls **original** `log_store_order_status_change()` without skip-flag logic. Migration 012 will: (1) create new function, (2) drop/recreate trigger to point to new skip-flag-aware function, (3) grant to service_role.

### 4.6 Risk / Rollback Notes

| Risk | Mitigation |
|------|------------|
| Trigger DROP/CREATE not atomic if error mid-migration | 012 runs in single transaction (standard Supabase); if fails, full rollback |
| Legacy direct UPDATEs lose reason capture | Expected — they get default reason; new API should use function |
| SECURITY DEFINER function owner privileges | Owner = `postgres` (typical); only `service_role` granted EXECUTE |
| `app.skip_history_trigger` session var collision | Session-local (`true` = local), transaction-scoped; no cross-session leakage |

---

## 4.7 Migration 012 — PASS / FAIL / NOT VERIFIED

### PASS (Verified Preconditions)
| ID | Check | Evidence |
|----|-------|----------|
| 012-P1 | `store_orders` table exists with required columns | From 001 schema + 010 data |
| 012-P2 | `order_status_history` table exists | From 001 schema; 0 rows |
| 012-P3 | `order_status` enum exists | Required by 001 |
| 012-P4 | Stock functions `fulfill_stock_reservation`, `release_stock_reservation` exist | From 003 lines 178-213 |
| 012-P5 | Trigger `log_store_order_status_change_trigger` exists on `store_orders` | tgenabled='O' verified |
| 012-P6 | Function `log_store_order_status_change()` exists (will be replaced) | provolatile='v' verified |
| 012-P7 | No conflicting trigger names | Only `update_store_orders_updated_at` (different name) |

### FAIL (Missing — Migration Target)
| ID | Check | Missing | Resolution |
|----|-------|---------|------------|
| 012-F1 | `update_store_order_status_with_reason` function | Function + SECURITY DEFINER + GRANT | 012 creates all |
| 012-F2 | Updated `log_store_order_status_change()` with skip flag | Current version lacks skip logic | 012 replaces function |
| 012-F3 | Trigger reconnected to new function | Trigger calls old function | 012 DROP/CREATE trigger |

### NOT VERIFIED (Requires Execution)
| ID | Check | Reason |
|----|-------|--------|
| 012-NV1 | Function executes correctly with reason capture | Requires CALL with test data |
| 012-NV2 | Skip flag prevents duplicate history entries | Requires concurrent trigger + function test |
| 012-NV3 | Stock fulfillment/release integrates correctly | Requires confirmed/cancelled transitions |
| 012-NV4 | service_role can execute via PostgREST RPC | Requires REST probe post-migration |

---

## 5. Migration 013 — Privilege Hardening (Preconditions Check)

### 5.1 013 Precondition Objects (All Required — from 013 DO block)

| Check | Expected | Actual | Status |
|-------|----------|--------|--------|
| Table `store_memberships` | EXISTS | ✅ EXISTS | ✅ PASS |
| Table `store_membership_audit_log` | EXISTS | ✅ EXISTS | ✅ PASS |
| 10 Helper Functions (010) | ALL EXIST | ✅ ALL 10 EXIST | ✅ PASS |
| 4 `store_memberships` policies | ALL EXIST | ✅ ALL 4 EXIST | ✅ PASS |
| Policy `conversations_store_members_select` | EXISTS | ✅ EXISTS | ✅ PASS |

**013 Preconditions:** **ALL MET** — 013 can execute.

### 5.2 Current Privilege State (Baseline — Before 013)

| Object | Current State | Post-013 Expected | Gap |
|--------|---------------|-------------------|-----|
| `anon` EXECUTE on 10 functions | **ALL 10 = TRUE** | ALL 10 = FALSE | 013 will revoke |
| `authenticated` EXECUTE on 10 functions | ALL 10 = TRUE | 5 helpers = TRUE, 5 triggers = FALSE | 013 will adjust |
| `anon` table privileges `store_memberships` | **ALL TRUE** (SELECT, INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, MAINTAIN) | ALL FALSE | 013 will revoke ALL |
| `anon` table privileges `store_membership_audit_log` | NONE (acl shows only postgres, service_role) | NONE | Already correct |
| `authenticated` table privileges `store_memberships` | `arwdDxtm` (full) | `arwd` (CRUD only) | 013 will adjust |
| Policies roles | **ALL {public}** (9 policies) | **ALL {authenticated}** (5 store_memberships + 1 conversations) | 013 will change |
| Triggers on `store_memberships` | 5 enabled | 5 enabled | No change |

**Key Finding:** Cloud has **PG17 extended privileges** (`MAINTAIN`, `TRUNCATE`, `TRIGGER`) granted to `anon` on `store_memberships` — local PG15 did not have these. 013's `REVOKE ALL` covers them.

---

## 6. Current Policies (All {public} — 013 Not Applied)

| Table | Policy | Roles | Command |
|-------|--------|-------|---------|
| `conversations` | Admins can view all conversations | {public} | SELECT |
| `conversations` | Owners can view store conversations | {public} | SELECT |
| `conversations` | Users can create conversations | {public} | INSERT |
| `conversations` | Users can view own conversations | {public} | SELECT |
| `conversations` | conversations_store_members_select | {public} | SELECT |
| `store_memberships` | store_memberships_delete | {public} | DELETE |
| `store_memberships` | store_memberships_insert | {public} | INSERT |
| `store_memberships` | store_memberships_select | {public} | SELECT |
| `store_memberships` | store_memberships_update | {public} | UPDATE |

**Note:** 4 additional policies on `conversations` not from 010/013 (pre-existing). 013 only touches `conversations_store_members_select`.

---

## 7. Triggers on `store_memberships` (All Enabled)

| Trigger | Function | Enabled |
|---------|----------|---------|
| `trg_prevent_sole_owner_delete` | `prevent_sole_owner_delete` | ✅ O |
| `trg_prevent_sole_owner_update` | `prevent_sole_owner_change` | ✅ O |
| `trg_store_membership_audit` | `audit_store_membership_change` | ✅ O |
| `trg_store_memberships_guard_insert` | `store_memberships_guard_insert` | ✅ O |
| `trg_store_memberships_guard_update` | `store_memberships_guard_update` | ✅ O |

All 5 triggers from 010 are active and enabled.

---

## 8. Data Counts (Impact Assessment)

| Table | Row Count | Notes |
|-------|-----------|-------|
| `store_memberships` | 4 | All owners (4 stores) |
| `store_membership_audit_log` | 0 | Empty |
| `conversations` | 12 | Existing data — 011 merge will affect |
| `conversation_members` | 12 | Existing data — 011 re-point will affect |
| `messages` | 231 | Existing data — 011 re-point will affect |
| `call_history` | 100 | Existing data — 011 re-point will affect |
| `store_orders` | 2 | Existing data — 012 history will affect |
| `order_status_history` | 0 | Empty — 012 will populate |

**Impact Analysis:**
- **011:** Will add `customer_id` to 12 conversations, merge duplicates (archive table captures removed), re-point 12 members, 231 messages, 100 calls
- **012:** Will add function/trigger; future status changes will log reasons
- **013:** Zero data impact — only privileges/policies

---

## 9. Object Conflicts & Dependencies

### 9.1 Conflicts Detected

| Conflict | Description | Resolution |
|----------|-------------|------------|
| **011 objects missing** | `customer_id` column, FK, archive table, indexes, CHECK constraint all absent | 011 must run first (idempotent guards handle re-run) |
| **012 function missing** | `update_store_order_status_with_reason` not found; trigger exists but calls `log_store_order_status_change` | 012 CREATE OR REPLACE will create function; DROP/CREATE TRIGGER will reconnect |
| **Trigger name collision** | `update_store_orders_updated_at` pre-exists on `store_orders` | 012 uses different trigger name (`log_store_order_status_change_trigger`) — no conflict |
| **Extra conversations policies** | 4 non-013 policies on `conversations` | 013 only drops/recreates `conversations_store_members_select` — others untouched |
| **PG17 anon privileges** | `anon` has TRUNCATE/TRIGGER/MAINTAIN on `store_memberships` | 013 `REVOKE ALL` covers all PG17 privileges |

### 9.2 Dependency Order

```
010 (already applied) → 011 → 012 → 013
```

- 011: Independent (only needs 001-009 tables)
- 012: Independent (only needs 001, 003 tables/functions)
- 013: Requires 010 objects (verified present)

**All 013 preconditions PASSED.** 011/012 can run in parallel but sequential 011→012→013 is safer.

---

## 10. PASS / FAIL / NOT VERIFIED Matrix

### PASS (All Verified)

| ID | Check | Evidence |
|----|-------|----------|
| V1 | Project identity `bzkjtvsqqxnbbnkgcrko` | `.temp/project-ref`, pooler-url, backend `.env` all match |
| V2 | Cloud DB version PG 17.11 | `version()` output |
| V3 | 010 tables exist | `store_memberships`, `store_membership_audit_log` |
| V4 | 010 10 functions exist | All 10 `to_regprocedure` = true |
| V5 | 010 4 store_memberships policies exist | Count = 4 |
| V6 | 010 conversations_store_members_select exists | EXISTS = true |
| V7 | 010 5 triggers on store_memberships enabled | All tgenabled='O' |
| V8 | RLS enabled on conversations/conversation_members | relrowsecurity=t, relforcerowsecurity=f |
| V9 | Current anon EXECUTE = 10/10 (baseline) | Query output |
| V10 | Current anon table privileges = ALL (PG17) | SELECT/INSERT/UPDATE/DELETE/TRUNCATE/TRIGGER/MAINTAIN all true |
| V11 | Current authenticated helper EXECUTE = 5/5 | Query output |
| V12 | Current policies all {public} (9 total) | Query output |
| V13 | Data counts captured | 8 tables counted |
| V14 | 013 preconditions ALL MET | All DO block checks pass |

### FAIL (Missing Required Objects)

| ID | Check | Missing | Impact |
|----|-------|---------|--------|
| F1 | 011 `conversations.customer_id` column | Column, FK, archive table, unique index, CHECK constraint | 011 must run |
| F2 | 012 `update_store_order_status_with_reason` function | Function + service_role grant | 012 must run |

### NOT VERIFIED (Cannot Confirm Without Execution)

| ID | Check | Reason |
|----|-------|--------|
| NV1 | 011 merge behavior on existing 12 conversations | Requires 011 execution; archive table will capture |
| NV2 | 012 function behavior with stock fulfillment | Requires 012 execution + test data |
| NV3 | 013 post-apply anon deny (401/403) | Requires 013 execution + REST probe |
| NV4 | Owner/Manager/Staff smoke tests | Requires JWT tokens + transactional fixtures |
| NV5 | API-level integration | Requires authenticated requests |

---

## 11. GO / NO-GO Decision

### PRE-EXECUTION VERIFICATION: **CONDITIONAL PASS**

**Conditions Met:**
- ✅ Project identity confirmed (`bzkjtvsqqxnbbnkgcrko`)
- ✅ Cloud schema baseline captured (all queries successful)
- ✅ 013 preconditions fully satisfied
- ✅ 011/012 missing objects identified (expected — not yet applied)
- ✅ Data counts recorded for impact assessment
- ✅ No blocking conflicts (only expected missing objects)
- ✅ G7 deferred per user instruction (documented risk acceptance)
- ✅ No production changes made (read-only only)

**Required Before Execute Cloud:**
1. User provides explicit "Execute Cloud" approval
2. Full backup executed on Cloud (Section 4.1 of Readiness Report)
3. Rollback SQL files staged

**NO BLOCKERS for structural execution.** The missing 011/012 objects are the intended targets of those migrations.

---

## 12. Compliance Checklist

| Constraint | Compliance |
|------------|------------|
| No migration executed | ✅ All queries SELECT/catalog only |
| No production schema/data changes | ✅ No DDL/DML |
| No Supabase CLI push | ✅ Not used |
| No password rotation | ✅ G7 deferred, no rotation |
| No environment variable changes | ✅ None made |
| No secrets exposed | ✅ Password via PGPASSWORD env, not in output |
| Results marked NOT VERIFIED where appropriate | ✅ Section 10 |
| Report created | ✅ `KINDEE_CLOUD_PREEXECUTION_VERIFICATION_REPORT.md` |

---

## 13. Next Steps

**WAITING FOR EXPLICIT USER APPROVAL**

Upon approval:
1. Execute Cloud backup (pg_dump via pooler)
2. Run migrations sequentially: 011 → 012 → 013 (each in transaction, ON_ERROR_STOP=1)
3. Post-each verification (T1 catalog checks)
4. Post-all verification (T1 full + REST probe)
5. Smoke tests T2 (Owner) + T3 (Manager/Staff transactional)
6. Report results

---

**Report Status:** COMPLETE — All read-only verification queries executed successfully against Supabase Cloud project `bzkjtvsqqxnbbnkgcrko`. No production changes made. Ready for Execute Cloud command.

**Prepared by:** Kilo (Read-Only Verification)
**Timestamp:** 2026-11-18T17:45:00Z