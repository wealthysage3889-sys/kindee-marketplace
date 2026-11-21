-- rollback_010_store_memberships.sql
-- Reverts migration 010 in dependency order. Idempotent (IF EXISTS throughout).
-- Scope: ONLY objects created by 010 (store_memberships, store_membership_audit_log,
-- the conversations_store_members_select policy, and the 010 helper/trigger
-- functions). No other migration is touched.
--
-- Order rationale:
--   1. Drop triggers first (they reference functions).
--   2. Drop RLS policies next (they reference helper functions).
--   3. Drop the functions.
--   4. Drop indexes and the CHECK constraint.
--   5. Drop the audit-log table, then the base table (audit table has no FK to it,
--      but dropping it explicitly keeps intent clear; CASCADE is a safety net).
-- RLS is never disabled on a shared table; the tables are dropped outright.

-- 1) Triggers --------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_store_membership_audit ON store_memberships;
DROP TRIGGER IF EXISTS trg_store_memberships_guard_insert ON store_memberships;
DROP TRIGGER IF EXISTS trg_store_memberships_guard_update ON store_memberships;
DROP TRIGGER IF EXISTS trg_prevent_sole_owner_delete ON store_memberships;
DROP TRIGGER IF EXISTS trg_prevent_sole_owner_update ON store_memberships;

-- 2) Policies (010-owned) --------------------------------------------------
DROP POLICY IF EXISTS conversations_store_members_select ON conversations;
DROP POLICY IF EXISTS store_memberships_delete ON store_memberships;
DROP POLICY IF EXISTS store_memberships_update ON store_memberships;
DROP POLICY IF EXISTS store_memberships_insert ON store_memberships;
DROP POLICY IF EXISTS store_memberships_select ON store_memberships;

-- 3) Functions -------------------------------------------------------------
DROP FUNCTION IF EXISTS public.audit_store_membership_change();
DROP FUNCTION IF EXISTS public.store_memberships_guard_insert();
DROP FUNCTION IF EXISTS public.store_memberships_guard_update();
DROP FUNCTION IF EXISTS public.prevent_sole_owner_delete();
DROP FUNCTION IF EXISTS public.prevent_sole_owner_change();
DROP FUNCTION IF EXISTS public.validate_store_member_permissions(JSONB);
DROP FUNCTION IF EXISTS public.is_active_store_member(UUID, UUID);
DROP FUNCTION IF EXISTS public.is_active_store_manager(UUID, UUID, BOOLEAN);
DROP FUNCTION IF EXISTS public.jsonb_bool(JSONB, TEXT);
DROP FUNCTION IF EXISTS public.is_store_owner(UUID, UUID);

-- 4) Indexes and CHECK constraint -----------------------------------------
DROP INDEX IF EXISTS ux_store_memberships_active;
DROP INDEX IF EXISTS idx_store_memberships_store;
DROP INDEX IF EXISTS idx_store_memberships_profile;
DROP INDEX IF EXISTS idx_store_memberships_active;
DROP INDEX IF EXISTS idx_store_memberships_store_role_active;
DROP INDEX IF EXISTS idx_store_memberships_suspended;

ALTER TABLE store_memberships DROP CONSTRAINT IF EXISTS store_memberships_role_check;

-- 5) Tables ----------------------------------------------------------------
-- Audit log first (its indexes are dropped implicitly by DROP TABLE).
DROP TABLE IF EXISTS store_membership_audit_log;
-- Base table: also drops the ux_ / idx_ indexes created inline above if any
-- remained (CASCADE covers dependent objects such as the CHECK constraint).
DROP TABLE IF EXISTS store_memberships CASCADE;