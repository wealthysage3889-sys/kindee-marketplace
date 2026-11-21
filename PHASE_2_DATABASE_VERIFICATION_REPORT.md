# PHASE_2_DATABASE_VERIFICATION_REPORT.md

**Date:** 2026-11-18  
**Scope:** Static/local verification only (no migration execution, no Supabase/production access, no source/SQL edits)  
**Project:** `C:\Users\LEGION\OneDrive\Desktop\kindee-marketplace` (`wealthysage3889-sys/kindee-marketplace`, `main`)  
**Baseline:** Phase 1 PASS, 179 backend tests expected preserved

## 1) Evidence Reviewed

| Artifact | Path | Key lines |
|---|---|---|
| Migration 010 | `supabase/migrations/010_store_memberships.sql` | 1-91 |
| Migration 011 | `supabase/migrations/011_conversation_customer_id.sql` | 1-78 |
| Impl report | `PHASE_2_DATABASE_IMPLEMENTATION_REPORT.md` | 1-30 |
| Design | `MULTI_STORE_SECURITY_DESIGN.md` | 1-283 (esp. D0.3/D0.4, §§4-6, deps/tests) |
| Phase 1 report | `PHASE_1_SECURITY_VERIFICATION_REPORT.md` | 1-31 |
| Initial schema | `supabase/migrations/001_initial_schema.sql` | 20 (enum), 470-575 (conversations/members/messages/attachments) |
| RLS policies | `supabase/migrations/002_rls_policies.sql` | 21-22, 617-760 (conversation/member/message/attachment policies) |
| Storage policies | `supabase/migrations/004_storage_buckets.sql` | sampled 1-120 |
| App logic | `backend/services/chatService.js` | 31-120 (`getOrCreateConversation`) |
| App routes | `backend/routes/chatRoutes.js` | 19-45 (`POST /conversations`, type filter includes `store_customer`) |
| App search | backend grep results | no `store_memberships`/`conversations.customer_id` usage in backend; `store_customer` widely used in services/routes/tests |

**Uncommitted/pre-existing state observed (not modified):** modified `backend/controllers/messageController.js`, `backend/services/callService.js`, `backend/services/chatService.js`, `backend/services/socketService.js`, `frontend/src/api/auth.js`; untracked reports/tests/migrations including `010_store_memberships.sql`, `011_conversation_customer_id.sql`.

## 2) Migration Results (PASS / FAIL / PARTIAL)

| Migration | Result | Rationale |
|---|---:|---|
| `010_store_memberships.sql` | **PARTIAL** | Core table/constraints/backfill/indexes present and mostly idempotent; RLS is incomplete/unsafe for required deny cases (self-add/member-management abuse, missing `WITH CHECK` on UPDATE, permissive manager rights, no DELETE path for non-owner revoke except row removal) and does not fully enforce "no unauthorized self-add into store". |
| `011_conversation_customer_id.sql` | **FAIL** | `customer_id` backfill is not guaranteed unambiguous (non-deterministic on multi-candidate rows), dedup deletes duplicate conversation rows (cascades to members/messages/attachments/call-related history) risking data loss, uniqueness does not cover NULL `customer_id`, and migration alone cannot satisfy concurrent `getOrCreateConversation` safety because app does not set `customer_id` or handle unique conflicts. |

## 3) Detailed Verification

### 3.1 Migration 010 — `supabase/migrations/010_store_memberships.sql`

#### SQL statements & order
- **Create table if missing:** `DO $$ ... information_schema.tables ... CREATE TABLE store_memberships (...) $$;` (L4-23). Additive/idempotent for missing table. Includes `store_id/profile_id` NOT NULL FKs with `ON DELETE CASCADE` to `stores(id)`/`profiles(id)` (L9-10), audit/suspension columns and FKs `suspended_by`/`removed_by` → `profiles(id) ON DELETE SET NULL` (L16-19), `role TEXT NOT NULL DEFAULT 'staff'` (L11), `left_at TIMESTAMPTZ` (L14).
- **Legacy unique replacement:** drops `store_memberships_store_id_profile_id_key` if exists (L26-31), then creates partial unique index `ux_store_memberships_active ON store_memberships (store_id, profile_id) WHERE left_at IS NULL` (L54-55). Correctly changes from full uniqueness to active-only uniqueness (supports rejoin/history rows). **Dependency:** if legacy constraint name differs, drop is skipped; `IF NOT EXISTS` index creation mitigates reruns.
- **Owner backfill:** idempotent insert for store owners with active membership absent (`NOT EXISTS ... left_at IS NULL`) (L34-41). Sets `role='owner'`, `joined_at=COALESCE(s.created_at,NOW())`, `left_at=NULL`.
- **Role CHECK:** adds `store_memberships_role_check CHECK (role IN ('owner','manager','staff'))` if missing (L44-51).
- **Indexes:** store/profile/active partial indexes (L57-59).
- **RLS:** enables RLS (L62); drops/recreates SELECT/INSERT/UPDATE/DELETE policies (L64-91).

#### Correctness checks
- **UNIQUE constraint -> partial unique index:** PASS for stated intent (L26-31,54-55).
- **Role CHECK & FKs:** PASS (L9-11,16-19,44-51).
- **Owner backfill & duplicate prevention:** PASS/IDEMPOTENT by active-row guard (L34-41) plus partial unique active index (L54-55).
- **RLS all operations:** PARTIAL.
  - `SELECT` (L65-70): allows self, store owner (`stores.owner_id`), or active `owner/manager` member of same store. **Gap:** active `staff` cannot read memberships (may be intentional) but design matrix allows some store-member visibility; not specified as required here. Platform admin not included (depends on RLS bypass/service role; acceptable if admin uses service role).
  - `INSERT` (L72-78): requires requester to be store owner or active `owner/manager` for target `store_id`. **Gaps/risk:** no restriction preventing manager from inserting `role='owner'` or arbitrary `permissions`; no explicit block on adding a row that makes requester self-manage in unintended ways beyond actor check; "cannot self-add unless authorized" is partially met because an unauthorized user cannot satisfy policy, but an authorized manager/owner can insert any `profile_id` (including potentially self) — policy does not encode business rules (e.g. sole-owner protection, self-elevation) required by design §4.2. No `TO` role scoping shown (applies to public by default in Supabase patterns) — relies on `auth.uid()` null behavior to deny anon.
  - `UPDATE` (L80-85): `USING` mirrors owner/active owner-manager authority, but **no `WITH CHECK`**. Updated values are not policy-revalidated; an authorized actor could mutate columns in ways not intended by policy (e.g. change `store_id`/`profile_id`/`role` subject only to constraints). Design requires controlled suspend/remove/re-add/role-change transitions.
  - `DELETE` (L87-91): store owner only. Managers cannot remove via DELETE (may force use of `left_at` soft-remove via UPDATE, but policy/transition not enforced). Hard delete would erase audit trail contrary to lifecycle design.
- **No unauthorized self-add:** PARTIAL/PASS at RLS gate for non-owner/non-manager principals (cannot satisfy INSERT policy), but application/service-role paths bypass RLS; no backend enforcement found (`store_memberships` unused in backend). Defense-in-depth incomplete.

### 3.2 Migration 011 — `supabase/migrations/011_conversation_customer_id.sql`

#### SQL statements & order
- **Add column:** nullable `customer_id UUID REFERENCES profiles(id) ON DELETE SET NULL` if missing (L6-14). Additive.
- **Backfill:** sets `c.customer_id = cm.profile_id` for `store_customer` conversations with NULL `customer_id`, selecting members where no store has `owner_id = cm.profile_id` (L18-31). **Issue:** comment claims "only set when unambiguous (single customer member)" but query does not aggregate/count to enforce uniqueness; if multiple candidate members exist, `UPDATE ... FROM` can assign an arbitrary candidate (non-deterministic).
- **Deduplicate before unique index:** groups duplicates by `(customer_id, store_id)` where `type='store_customer' AND customer_id IS NOT NULL`, keeps oldest (`ORDER BY created_at ASC, id ASC LIMIT 1`) and **deletes other conversation rows** (L33-57). No re-pointing of `conversation_members`, `messages`, `message_attachments`, `call_history`, or other dependents; FKs in schema use `ON DELETE CASCADE` for members/messages/attachments (`001_initial_schema.sql:533-575` area) so history in deleted duplicate conversations is destroyed.
- **Partial unique index:** `ux_conversations_store_customer ON conversations (customer_id, store_id) WHERE type='store_customer' AND customer_id IS NOT NULL` (L60-62). Correct shape for non-null pairs, but does not prevent duplicates when `customer_id IS NULL`.
- **Supporting index:** `idx_conversations_customer_id` (L64).
- **`conversation_members` role CHECK:** `member/admin/owner` if missing (L67-74). Compatible with existing usage/RLS (`002_rls_policies.sql` checks for `admin/owner`).
- **RLS enable:** `ALTER TABLE conversations/conversation_members ENABLE ROW LEVEL SECURITY` (L77-78). Redundant/idempotent relative to `002_rls_policies.sql:21-22`.

#### Correctness checks
- **`customer_id` backfill:** FAIL for correctness guarantee (ambiguous/non-deterministic; excludes store owners but not other non-customer participants) (L18-31).
- **Duplicate conversations before unique index:** PARTIAL detection/removal intent, **FAIL for safety** due to destructive deletes without merge/re-point (L33-57).
- **Partial unique index only for `store_customer`:** PASS for predicate intent `type='store_customer' AND customer_id IS NOT NULL` (L60-62), but incomplete for NULL-customer legacy/edge rows.
- **Concurrent `getOrCreateConversation` & conflict handling:** FAIL at system level. DB index can reject duplicates only when both `customer_id` and `store_id` are set and app hits conflict; current implementation (`backend/services/chatService.js:31-120`) selects existing by `type/store_id` and member match, then inserts `type/store_customer, store_id, store_order_id` **without `customer_id`** and with **no `ON CONFLICT`/retry**. Therefore: existing app cannot populate `customer_id`, new rows remain NULL (index ineffective), and any future conflict would surface as insert error not handled as idempotent reuse.
- **Rollback/recovery without destroying chat/call history:** PARTIAL/UNSAFE. Schema rollback (drop index/column/constraints) is possible if no dependent objects remain, but **data loss from dedup DELETE is not recoverable** without backup/restore; migration is not safe to run on data containing duplicates.
- **No unauthorized add to conversation:** Not materially improved by 011. Conversation creation/membership still enforced in app/RLS as before; 011 adds identity/index scaffolding only.

## 4) Compatibility With Current Source/Schema

| Check | Result | Evidence |
|---|---:|---|
| Migration vs current source behavior | **PARTIAL (gaps)** | `chatService.getOrCreateConversation` does not write/read `customer_id` and has no conflict retry (`backend/services/chatService.js:31-120`); backend has no `store_memberships` enforcement. |
| Table/column/enum/constraint/index names vs schema | **MOSTLY PASS (additive)** | `conversation_type` already includes `store_customer` (`001_initial_schema.sql:20`); `conversations`/`conversation_members`/`messages` exist (`001_initial_schema.sql:470-575`); RLS/admin-owner role semantics align (`002_rls_policies.sql:617-760`). 010/011 add objects without renaming existing ones. |
| Other conversation types unaffected | **PASS (structural), RISK (runtime/data)** | `customer_id` nullable; unique index partial to `store_customer` non-null. `direct/group/order_support` not constrained by new unique index. Dedup only targets `store_customer` groups. |
| Store owner/manager/staff vs platform roles | **PARTIAL** | 010 models store roles in `store_memberships.role` separate from `profiles.role` (design-aligned), but no app wiring/enforcement yet; socket/store access still relies on existing checks (e.g. `socketService.js` joinStore owner-only per Phase 1). |

## 5) Risks to Existing Data

1. **HIGH — Irreversible chat/call/member history loss on duplicate cleanup:** `011_conversation_customer_id.sql:33-57` deletes duplicate `conversations` rows; cascades can remove `conversation_members`, `messages`, `message_attachments` (and potentially other dependents) for removed duplicates.
2. **HIGH — Wrong `customer_id` assignment:** ambiguous backfill (`011:18-31`) may bind a `store_customer` conversation to the wrong profile, breaking future identity/uniqueness semantics and access assumptions.
3. **MEDIUM — Future duplicates / broken uniqueness intent:** if app continues inserting without `customer_id`, `ux_conversations_store_customer` (`011:60-62`) will not prevent duplicates for new rows (NULLs bypass predicate).
4. **MEDIUM — Membership policy misuse:** 010 UPDATE lacks `WITH CHECK` and INSERT/UPDATE policies are coarse (`010:72-85`), allowing over-broad mutations by authorized managers/owners under direct DB access contexts.
5. **LOW — Migration re-run/name drift:** legacy constraint/index name assumptions (`010:28-29`) depend on existing naming; safe in common cases but should be validated against live schema before execution.

## 6) Issues That Must Be Fixed Before Phase 3

1. **011 backfill correctness:** enforce true unambiguity (e.g. count candidate non-owner members = 1) and define deterministic fallback/manual review for ambiguous/missing cases; do not assign arbitrary `customer_id`.
2. **011 dedup safety:** replace destructive delete with merge/re-point strategy (move members/messages/attachments/call refs/unread/read state to canonical conversation) or quarantine + operator-reviewed cleanup; guarantee no history loss.
3. **011/app contract for uniqueness:** update `getOrCreateConversation` (and related flows) to set `customer_id`, use conflict-safe insert/upsert/retry on `ux_conversations_store_customer`, and handle existing NULL-customer rows during transition.
4. **010 RLS hardening:** add `WITH CHECK` to UPDATE, tighten INSERT/UPDATE/DELETE to lifecycle-safe transitions (suspend/remove/re-add/role change rules, sole-owner protections, prevent unauthorized self-escalation), and align with design §§4-6.
5. **Coverage for NULL/legacy cases:** define policy for `store_customer` rows where `customer_id` cannot be backfilled; index/policy/app must not assume non-null prematurely.
6. **Operational guardrails:** validate migration preconditions against real schema/data (duplicates, ambiguous members, constraint names) in a non-production rehearsal with backup/restore verification before any environment run.

## 7) Migration Dependencies

| Item | Depends on | Notes |
|---|---|---|
| `010_store_memberships.sql` | `stores`, `profiles` exist; D0.3 semantics finalized | Draft/unrun. Must be revised for RLS/lifecycle enforcement before Phase 3 reliance. |
| `011_conversation_customer_id.sql` | `conversations`, `conversation_members`, `profiles`, `stores` exist; D0.4; safe dedup/merge plan | Draft/unrun. Requires 010/app/store ownership semantics clarity for customer identification and **must not run** until dedup/backfill made non-destructive/correct. |
| Phase 3 app work (required) | 010/011 schema decisions + conflict/retry + membership/socket/service enforcement | `getOrCreateConversation` must adopt `customer_id` + unique-conflict retry; store membership checks must be wired into sockets/services/routes. |
| RLS/storage alignment (later phases) | D0.1 canonical storage keys and policy corrections | Out of scope for 010/011 but required by overall design. |

**Execution order (design intent, not performed):** finalize decisions → fix/review 010 & 011 → rehearse on copy with backup → run 010 → run 011 (safe variant) → deploy app conflict/membership handling → policy/test hardening.

## 8) Test Results (Actual)

- **Command:** `cd backend && npm test` (`node --test "__tests__/*.test.mjs"`)
- **Result:** **179 passed, 0 failed, 0 skipped** (`tests 179, pass 179, fail 0, cancelled 0, skipped 0`, duration ~55.4s)
- **Baseline comparison:** matches expected 179-test baseline (no regression observed in run output).
- **Relevant coverage observed:** chat/store_customer flows, attachments, call lifecycle/heartbeat/incoming socket, membership/access checks in existing tests all passed in current local state.
- **Static checks only for migrations:** SQL reviewed statically; **no migration applied locally/remote**, no Supabase production connection.

## 9) Overall Assessment

- **Migration 010:** **PARTIAL** — structurally close but RLS/lifecycle enforcement incomplete for production-safe multi-store membership control.
- **Migration 011:** **FAIL** — unsafe/correctness gaps (ambiguous backfill, destructive dedup, ineffective uniqueness with current app, no conflict handling path).
- **Phase 3 readiness:** **NOT READY** until 011 data-safety/correctness issues and 010 RLS/lifecycle gaps are fixed and app-level `customer_id`/conflict/membership enforcement is implemented.

**Constraints honored:** no source/SQL modifications, no migrations run, no Supabase/production access, no commit/push/deploy, pre-existing uncommitted/untracked changes left intact.