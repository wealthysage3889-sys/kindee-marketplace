# KINDEE MIGRATION 010 FINAL SECURITY REPORT

Status: READY FOR STAGING VERIFICATION (not Production approved)

## Scope
- `supabase/migrations/010_store_memberships.sql` (rewritten)
- `supabase/rollback_010.sql` (rewritten)
- Test harness: `supabase/tests/010/00_base_schema.sql` (local/staging only)

## Verified environment
- Isolated local PostgreSQL 15 in Docker (port 55432), NOT production.
- Linked Supabase project was NOT touched.

## Test results
Automated suite (`supabase/tests/010` harness, `pg` driver): **81 passed, 0 failed**.
- Schema & seeding: PASS
- Sole-owner single-transaction (demote/suspend/remove/delete): 10 PASS
- Sole-owner CONCURRENT (demotion, suspension, deletion, mixed op, same-row): 12 PASS
- Manager lifecycle allow-list (allowed + forbidden fields, actor forging): 8 PASS
- Manager INSERT (active-only staff, anti-forgery of timestamps/actor/audit): 11 PASS
- RLS & IDOR (outsider read/write, non-member_write manager): 6 PASS
- Audit log & actor attribution (end_user / service_role / sql_editor, access control): 11 PASS
- Grants, SECURITY DEFINER, search_path: 14 PASS
- Rollback (objects dropped, dependencies intact): 6 PASS
- Idempotent re-apply (twice): PASS

Concurrency counter-proof (`counter_proof.mjs`): with NO locking, two concurrent
demotions both commit -> 0 active owners (invariant broken); with advisory lock +
SELECT ... FOR UPDATE -> exactly one commits -> 1 active owner (invariant preserved).

## Items addressed
1. Fixed SQL syntax of `prevent_sole_owner_change()` / `prevent_sole_owner_delete()`
   (broken `"""` placeholder replaced with a real `SELECT ... FROM store_memberships`).
2. Sole-owner concurrency protection redesigned with row-level `SELECT ... FOR UPDATE`
   over the active owner set PLUS a transaction-scoped advisory lock. Proven under
   READ COMMITTED; advisory lock alone is documented as insufficient by itself.
3. Manager lifecycle updates restricted to staff rows on an allow-list of fields
   (left_at, suspended_at, suspended_reason, removed_reason, rejoined_at); role,
   permissions, joined_at, store_id, profile_id and owner/manager rows are
   immutable for managers.
4. Manager INSERT restricted to active staff only; joined_at, lifecycle and actor
   fields are server-normalized (anti-forgery); member_write cannot be granted.
5. `store_membership_audit_log` RLS enabled; privileges revoked from
   PUBLIC/anon/authenticated; writes only via the SECURITY DEFINER trigger.
6. Audit actor attribution records auth.uid() (actor_id), session_user
   (actor_db_role), auth.role() (actor_jwt_role) and a classification
   (end_user / service_role / sql_editor / system). No reliance on current_user.
7. SECURITY DEFINER, search_path, ownership and EXECUTE grants audited and set
   least-privilege for all functions.
8. Rollback drops triggers, policies, functions, indexes, constraint and tables in
   dependency order without touching other migrations.
9. Automated tests added for concurrency, last-owner protection, manager privilege
   escalation, metadata tampering, audit access, RLS, IDOR and rollback.

## NOT VERIFIED
- Execution against a real staging Supabase instance (this report is based on
  local PostgreSQL 15 emulation). Recommended: run the same harness on staging.
- `service_role` BYPASSRLS behaviour in Supabase (emulated locally).
- Performance of `SELECT ... FOR UPDATE` over the owner set under load (not
  benchmarked).

## Verdict
READY FOR STAGING VERIFICATION