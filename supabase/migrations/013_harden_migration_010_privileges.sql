-- 013_harden_migration_010_privileges.sql
-- Least-privilege hardening for objects created by migration 010.
-- REVIEW: KINDEE_MIGRATION_013_REVIEW_REPORT.md  (status: APPROVED-READY, NOT EXECUTED)
--
-- Scope (Part A only): remove anon EXECUTE / table privileges and restrict the
-- 010 RLS policies to the authenticated role. Idempotent and transactional.
--
-- DO NOT split the function revokes from the policy role changes: revoking first
-- alone makes anon queries hit "permission denied for function" instead of an
-- empty result. Both live in one transaction here on purpose.
--
-- DO NOT enable FORCE ROW LEVEL SECURITY on store_membership_audit_log: the
-- SECURITY DEFINER audit writer relies on table-owner (postgres) RLS bypass.
--
-- DO NOT revoke EXECUTE on is_store_owner / is_active_store_manager /
-- is_active_store_member / jsonb_bool / validate_store_member_permissions from
-- authenticated: RLS policies call them with the caller's privileges.

BEGIN;

-- ---------------------------------------------------------------------------
-- Preconditions: fail fast with a clear message before touching anything.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    v_missing text[] := ARRAY[]::text[];
BEGIN
    IF to_regclass('public.store_memberships') IS NULL THEN
        v_missing := v_missing || 'table public.store_memberships'::text;
    END IF;
    IF to_regclass('public.store_membership_audit_log') IS NULL THEN
        v_missing := v_missing || 'table public.store_membership_audit_log'::text;
    END IF;

    IF to_regprocedure('public.is_store_owner(uuid,uuid)') IS NULL THEN
        v_missing := v_missing || 'public.is_store_owner(uuid,uuid)'::text;
    END IF;
    IF to_regprocedure('public.jsonb_bool(jsonb,text)') IS NULL THEN
        v_missing := v_missing || 'public.jsonb_bool(jsonb,text)'::text;
    END IF;
    IF to_regprocedure('public.is_active_store_manager(uuid,uuid,boolean)') IS NULL THEN
        v_missing := v_missing || 'public.is_active_store_manager(uuid,uuid,boolean)'::text;
    END IF;
    IF to_regprocedure('public.is_active_store_member(uuid,uuid)') IS NULL THEN
        v_missing := v_missing || 'public.is_active_store_member(uuid,uuid)'::text;
    END IF;
    IF to_regprocedure('public.validate_store_member_permissions(jsonb)') IS NULL THEN
        v_missing := v_missing || 'public.validate_store_member_permissions(jsonb)'::text;
    END IF;
    IF to_regprocedure('public.prevent_sole_owner_change()') IS NULL THEN
        v_missing := v_missing || 'public.prevent_sole_owner_change()'::text;
    END IF;
    IF to_regprocedure('public.prevent_sole_owner_delete()') IS NULL THEN
        v_missing := v_missing || 'public.prevent_sole_owner_delete()'::text;
    END IF;
    IF to_regprocedure('public.store_memberships_guard_insert()') IS NULL THEN
        v_missing := v_missing || 'public.store_memberships_guard_insert()'::text;
    END IF;
    IF to_regprocedure('public.store_memberships_guard_update()') IS NULL THEN
        v_missing := v_missing || 'public.store_memberships_guard_update()'::text;
    END IF;
    IF to_regprocedure('public.audit_store_membership_change()') IS NULL THEN
        v_missing := v_missing || 'public.audit_store_membership_change()'::text;
    END IF;

    IF EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'store_memberships'
          AND policyname IN ('store_memberships_select','store_memberships_insert',
                             'store_memberships_update','store_memberships_delete')
        HAVING count(*) <> 4
    ) THEN
        v_missing := v_missing || 'expected 4 store_memberships policies'::text;
    END IF;

    IF EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'conversations'
          AND policyname = 'conversations_store_members_select'
    ) = false THEN
        v_missing := v_missing || 'policy conversations.conversations_store_members_select'::text;
    END IF;

    IF array_length(v_missing, 1) IS NOT NULL THEN
        RAISE EXCEPTION '013 preconditions failed; apply migration 010 first. Missing: %',
            array_to_string(v_missing, ', ');
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- H1. Remove anon EXECUTE from every function introduced by migration 010.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.is_store_owner(uuid, uuid)                     FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.jsonb_bool(jsonb, text)                        FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_active_store_manager(uuid, uuid, boolean)    FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_active_store_member(uuid, uuid)             FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.validate_store_member_permissions(jsonb)       FROM PUBLIC, anon;

-- Trigger / guard functions: no client role needs EXECUTE (PostgreSQL checks
-- EXECUTE only when CREATE TRIGGER runs, not when the trigger fires).
REVOKE ALL ON FUNCTION public.prevent_sole_owner_change()                  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prevent_sole_owner_delete()                  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.store_memberships_guard_insert()             FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.store_memberships_guard_update()             FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.audit_store_membership_change()              FROM PUBLIC, anon, authenticated;

-- Keep the five helpers that RLS policies invoke as the caller.
GRANT EXECUTE ON FUNCTION public.is_store_owner(uuid, uuid)                   TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_active_store_manager(uuid, uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_active_store_member(uuid, uuid)           TO authenticated;
GRANT EXECUTE ON FUNCTION public.jsonb_bool(jsonb, text)                      TO authenticated;
GRANT EXECUTE ON FUNCTION public.validate_store_member_permissions(jsonb)     TO authenticated;

-- ---------------------------------------------------------------------------
-- H2. Remove direct table privileges for anon.
-- ---------------------------------------------------------------------------
REVOKE ALL ON TABLE public.store_memberships FROM anon;
REVOKE ALL ON TABLE public.store_membership_audit_log FROM anon, authenticated;

-- Keep PostgREST CRUD for signed-in users (idempotent safeguard).
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.store_memberships TO authenticated;

-- ---------------------------------------------------------------------------
-- H3. Restrict RLS policies to authenticated (expressions unchanged from 010).
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS store_memberships_select ON public.store_memberships;
CREATE POLICY store_memberships_select ON public.store_memberships
    FOR SELECT TO authenticated USING (
        profile_id = auth.uid()
        OR public.is_store_owner(store_id, auth.uid())
        OR public.is_active_store_manager(store_id, auth.uid(), FALSE)
    );

DROP POLICY IF EXISTS store_memberships_insert ON public.store_memberships;
CREATE POLICY store_memberships_insert ON public.store_memberships
    FOR INSERT TO authenticated WITH CHECK (
        public.validate_store_member_permissions(permissions)
        AND (
            public.is_store_owner(store_id, auth.uid())
            OR (
                public.is_active_store_manager(store_id, auth.uid(), TRUE)
                AND profile_id <> auth.uid()
                AND role = 'staff'
                AND left_at IS NULL
                AND suspended_at IS NULL
                AND NOT public.jsonb_bool(permissions, 'member_write')
            )
        )
    );

DROP POLICY IF EXISTS store_memberships_update ON public.store_memberships;
CREATE POLICY store_memberships_update ON public.store_memberships
    FOR UPDATE TO authenticated
    USING (
        public.is_store_owner(store_id, auth.uid())
        OR public.is_active_store_manager(store_id, auth.uid(), TRUE)
    )
    WITH CHECK (
        public.validate_store_member_permissions(permissions)
        AND (
            public.is_store_owner(store_id, auth.uid())
            OR public.is_active_store_manager(store_id, auth.uid(), TRUE)
        )
    );

DROP POLICY IF EXISTS store_memberships_delete ON public.store_memberships;
CREATE POLICY store_memberships_delete ON public.store_memberships
    FOR DELETE TO authenticated USING (
        public.is_store_owner(store_id, auth.uid())
    );

DROP POLICY IF EXISTS conversations_store_members_select ON public.conversations;
CREATE POLICY conversations_store_members_select ON public.conversations
    FOR SELECT TO authenticated USING (
        public.is_store_owner(conversations.store_id, auth.uid())
        OR public.is_active_store_member(conversations.store_id, auth.uid())
    );

COMMIT;
