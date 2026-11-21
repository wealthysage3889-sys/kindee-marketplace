-- 010_store_memberships.sql
-- Store membership for multi-tenant store staff access.
-- Idempotent & migration-safe. Precondition: stores, profiles exist.
--
-- SECURITY MODEL (summary; full proof in KINDEE_MIGRATION_010_FINAL_SECURITY_REPORT.md)
--   * RLS is enabled on store_memberships and store_membership_audit_log and is never
--     disabled here. No GRANT ALL is used.
--   * Owner/manager/staff authority is enforced by RLS policies + BEFORE-row trigger
--     guards that can compare OLD vs NEW (policies cannot reference OLD/NEW).
--   * Sole active-owner protection is enforced by row-level locks (SELECT ... FOR
--     UPDATE over the active owner set) plus a transaction-scoped advisory lock, so
--     concurrent demotion / suspension / deletion cannot leave a store with zero
--     active owners under the default READ COMMITTED isolation (and fails safe by
--     serialization error under REPEATABLE READ / SERIALIZABLE).
--   * The audit trail records the acting end-user id (auth.uid()), the real database
--     role (session_user) and a coarse actor classification. It is written only by a
--     SECURITY DEFINER trigger owned by the schema owner; direct DML by
--     anon/authenticated/PUBLIC is revoked.

-- ============================================================================
-- Table
-- ============================================================================
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='store_memberships') THEN
        CREATE TABLE store_memberships (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
            profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
            role TEXT NOT NULL DEFAULT 'staff',
            permissions JSONB NOT NULL DEFAULT '{}'::jsonb,
            joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            left_at TIMESTAMPTZ,
            suspended_at TIMESTAMPTZ,
            suspended_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
            suspended_reason TEXT,
            removed_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
            removed_reason TEXT,
            rejoined_at TIMESTAMPTZ
        );
    END IF;
END $$;

-- Allow a former member to re-join: drop any full unique (store_id, profile_id)
-- constraint and rely on the partial unique index on active rows only.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='store_memberships_store_id_profile_id_key') THEN
        ALTER TABLE store_memberships DROP CONSTRAINT store_memberships_store_id_profile_id_key;
    END IF;
END $$;

-- Backfill one owner membership row per store from stores.owner_id.
INSERT INTO store_memberships (store_id, profile_id, role, joined_at, left_at)
SELECT s.id, s.owner_id, 'owner', COALESCE(s.created_at, NOW()), NULL
FROM stores s
WHERE s.owner_id IS NOT NULL
  AND NOT EXISTS (
      SELECT 1 FROM store_memberships sm
      WHERE sm.store_id = s.id AND sm.profile_id = s.owner_id AND sm.left_at IS NULL
  );

-- Role CHECK constraint. Validate existing rows first so a re-run never leaves
-- half-applied constraints silently accepting bad historical data.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='store_memberships_role_check') THEN
        IF EXISTS (SELECT 1 FROM store_memberships WHERE role IS NOT NULL AND role NOT IN ('owner','manager','staff')) THEN
            RAISE EXCEPTION 'store_memberships contains invalid role values; clean data before adding store_memberships_role_check';
        END IF;
        ALTER TABLE store_memberships
            ADD CONSTRAINT store_memberships_role_check
            CHECK (role IN ('owner','manager','staff'));
    END IF;
END $$;

-- Indexes. The partial unique index enforces at most one active membership per
-- (store, profile) while allowing history rows (left_at NOT NULL).
CREATE UNIQUE INDEX IF NOT EXISTS ux_store_memberships_active
    ON store_memberships (store_id, profile_id) WHERE left_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_store_memberships_store ON store_memberships(store_id);
CREATE INDEX IF NOT EXISTS idx_store_memberships_profile ON store_memberships(profile_id);
CREATE INDEX IF NOT EXISTS idx_store_memberships_active ON store_memberships(store_id) WHERE left_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_store_memberships_store_role_active
    ON store_memberships(store_id, role) WHERE left_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_store_memberships_suspended
    ON store_memberships(store_id) WHERE suspended_at IS NOT NULL;

-- ============================================================================
-- SECURITY DEFINER helpers (avoid self-referencing RLS recursion).
-- search_path is pinned so a definer cannot be tricked into resolving unqualified
-- names from a writable schema. These functions only read data and return booleans.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.is_store_owner(p_store_id UUID, p_uid UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
    SELECT EXISTS (SELECT 1 FROM stores s WHERE s.id = p_store_id AND s.owner_id = p_uid)
$$;

-- JSONB boolean helper: fail-closed. Returns TRUE only when p_key exists in
-- p_obj AND its JSONB value is a real boolean equal to true. NULL object,
-- NULL key, missing key, non-boolean value all yield FALSE so permission checks
-- never accidentally grant access.
CREATE OR REPLACE FUNCTION public.jsonb_bool(p_obj JSONB, p_key TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_catalog
AS $$
    SELECT CASE
        WHEN p_obj IS NULL THEN FALSE
        WHEN p_key IS NULL THEN FALSE
        WHEN NOT (p_obj ? p_key) THEN FALSE
        WHEN jsonb_typeof(p_obj->p_key) <> 'boolean' THEN FALSE
        ELSE (p_obj->>p_key)::boolean
    END
$$;

CREATE OR REPLACE FUNCTION public.is_active_store_manager(p_store_id UUID, p_uid UUID, p_need_member_write BOOLEAN DEFAULT FALSE)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
    SELECT EXISTS (
        SELECT 1 FROM store_memberships sm
        WHERE sm.store_id = p_store_id
          AND sm.profile_id = p_uid
          AND sm.left_at IS NULL
          AND sm.suspended_at IS NULL
          AND sm.role = 'manager'
          AND (NOT p_need_member_write OR public.jsonb_bool(sm.permissions, 'member_write') = TRUE)
    )
$$;

-- Active membership check (any non-owner role) used by RLS policies to avoid
-- querying store_memberships directly from another table's policy (recursion).
CREATE OR REPLACE FUNCTION public.is_active_store_member(p_store_id UUID, p_uid UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
    SELECT EXISTS (
        SELECT 1 FROM store_memberships sm
        WHERE sm.store_id = p_store_id
          AND sm.profile_id = p_uid
          AND sm.left_at IS NULL
          AND sm.suspended_at IS NULL
    )
$$;

-- Validate store_memberships.permissions: only known boolean flags are allowed.
-- Prevents injecting arbitrary JSON (e.g. admin_panel, delete_store) or non-boolean
-- values via the permissions column.
CREATE OR REPLACE FUNCTION public.validate_store_member_permissions(p_perms JSONB)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_catalog
AS $$
    SELECT CASE
        WHEN p_perms IS NULL THEN TRUE
        WHEN jsonb_typeof(p_perms) <> 'object' THEN FALSE
        WHEN EXISTS (
            SELECT 1
            FROM jsonb_each(p_perms) AS kv
            WHERE kv.key NOT IN ('member_write')
               OR jsonb_typeof(kv.value) <> 'boolean'
        ) THEN FALSE
        ELSE TRUE
    END
$$;

-- ============================================================================
-- Sole active-owner protection.
--
-- Why advisory lock alone is not sufficient:
--   The advisory lock only serializes callers that take the SAME lock; it does
--   not, by itself, make the "is there another active owner?" read reflect a
--   concurrent transaction's commit under READ COMMITTED unless the re-check is
--   performed AFTER the lock is held AND the active-owner rows are row-locked so
--   that same-row and overlapping writers block and re-evaluate. We therefore use
--   BOTH:
--     (1) pg_advisory_xact_lock(hashtext(store_id))  -> cross-path serialization,
--         held until commit/rollback.
--     (2) SELECT ... FOR UPDATE over the active owner set -> row locks that make
--         concurrent demotions/suspensions/deletions of different owner rows
--         serialize, and force a fresh per-command snapshot on the re-check.
--   The re-check runs after both locks are held, so under the default READ
--   COMMITTED isolation it observes every committed owner-affecting change. Under
--   REPEATABLE READ / SERIALIZABLE a conflicting FOR UPDATE raises a
--   serialization failure instead, which aborts the losing transaction (fail-safe).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.prevent_sole_owner_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
    v_store_id UUID := OLD.store_id;
    v_other_active_owners INTEGER;
BEGIN
    -- Only a transition of an ACTIVE owner row to a non-active state can reduce
    -- the active-owner count. If OLD was already inactive, this change cannot
    -- violate the invariant, so we do not block it.
    IF OLD.role = 'owner'
       AND OLD.left_at IS NULL
       AND OLD.suspended_at IS NULL
       AND (
            NEW.role <> 'owner'
            OR NEW.left_at IS NOT NULL
            OR NEW.suspended_at IS NOT NULL
       )
    THEN
        -- (1) Serialize all owner-affecting operations for this store.
        PERFORM pg_advisory_xact_lock(hashtext(v_store_id::text));

        -- (2) Row-lock the current active owner set so concurrent operations that
        --     touch any owner row serialize and we re-read the latest committed
        --     state on the re-check below.
        PERFORM 1
        FROM store_memberships sm
        WHERE sm.store_id = v_store_id
          AND sm.role = 'owner'
          AND sm.left_at IS NULL
          AND sm.suspended_at IS NULL
        FOR UPDATE;

        SELECT count(*) INTO v_other_active_owners
        FROM store_memberships sm
        WHERE sm.store_id = v_store_id
          AND sm.profile_id <> OLD.profile_id
          AND sm.role = 'owner'
          AND sm.left_at IS NULL
          AND sm.suspended_at IS NULL;

        IF v_other_active_owners = 0 THEN
            RAISE EXCEPTION 'Cannot demote, remove, or suspend the sole active owner of store %', v_store_id
                USING ERRCODE = 'P0001';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_sole_owner_update ON store_memberships;
CREATE TRIGGER trg_prevent_sole_owner_update
    BEFORE UPDATE ON store_memberships
    FOR EACH ROW
    EXECUTE FUNCTION public.prevent_sole_owner_change();

CREATE OR REPLACE FUNCTION public.prevent_sole_owner_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
    v_store_id UUID := OLD.store_id;
    v_other_active_owners INTEGER;
BEGIN
    IF OLD.role = 'owner' AND OLD.left_at IS NULL AND OLD.suspended_at IS NULL THEN
        PERFORM pg_advisory_xact_lock(hashtext(v_store_id::text));

        PERFORM 1
        FROM store_memberships sm
        WHERE sm.store_id = v_store_id
          AND sm.role = 'owner'
          AND sm.left_at IS NULL
          AND sm.suspended_at IS NULL
        FOR UPDATE;

        SELECT count(*) INTO v_other_active_owners
        FROM store_memberships sm
        WHERE sm.store_id = v_store_id
          AND sm.profile_id <> OLD.profile_id
          AND sm.role = 'owner'
          AND sm.left_at IS NULL
          AND sm.suspended_at IS NULL;

        IF v_other_active_owners = 0 THEN
            RAISE EXCEPTION 'Cannot delete the sole active owner of store %', v_store_id
                USING ERRCODE = 'P0001';
        END IF;
    END IF;
    RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_sole_owner_delete ON store_memberships;
CREATE TRIGGER trg_prevent_sole_owner_delete
    BEFORE DELETE ON store_memberships
    FOR EACH ROW
    EXECUTE FUNCTION public.prevent_sole_owner_delete();

-- ============================================================================
-- Maintenance audit trail.
-- Written ONLY by the SECURITY DEFINER trigger (owned by the schema owner, which
-- bypasses RLS because FORCE ROW LEVEL SECURITY is intentionally not used). Direct
-- DML by anon/authenticated/PUBLIC is revoked below.
-- ============================================================================
CREATE TABLE IF NOT EXISTS store_membership_audit_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    -- Who performed the action:
    actor_id UUID,          -- auth.uid() (end user); NULL for service_role / SQL editor
    actor_db_role TEXT,     -- session_user (real login role), NOT current_user
    actor_jwt_role TEXT,    -- auth.role() (authenticated / anon / service_role / NULL)
    actor_kind TEXT,        -- end_user | service_role | sql_editor | system
    store_id UUID,
    member_id UUID,
    operation TEXT NOT NULL,
    old_values JSONB,
    new_values JSONB,
    reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_store_membership_audit_store ON store_membership_audit_log(store_id);
CREATE INDEX IF NOT EXISTS idx_store_membership_audit_member ON store_membership_audit_log(member_id);
CREATE INDEX IF NOT EXISTS idx_store_membership_audit_created ON store_membership_audit_log(created_at DESC);

CREATE OR REPLACE FUNCTION public.audit_store_membership_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
    v_uid UUID := auth.uid();
    v_jwt_role TEXT := auth.role();
    v_db_role TEXT := session_user;
    v_kind TEXT;
    v_store_id UUID;
    v_member_id UUID;
    v_reason TEXT;
BEGIN
    -- Classify the actor. We never rely on current_user alone: inside a SECURITY
    -- DEFINER function current_user is the function owner, so the real login role
    -- is session_user, and the end-user identity is auth.uid().
    IF v_uid IS NOT NULL THEN
        v_kind := 'end_user';
    ELSIF v_jwt_role = 'service_role' THEN
        v_kind := 'service_role';
    ELSIF v_jwt_role IS NULL AND v_db_role IN ('postgres', 'supabase_admin') THEN
        -- No JWT claims and a privileged direct connection => SQL editor / psql.
        v_kind := 'sql_editor';
    ELSE
        v_kind := 'system';
    END IF;

    IF TG_OP = 'INSERT' THEN
        v_store_id := NEW.store_id;
        v_member_id := NEW.id;
        v_reason := NULL;
    ELSIF TG_OP = 'UPDATE' THEN
        v_store_id := NEW.store_id;
        v_member_id := NEW.id;
        v_reason := COALESCE(NEW.removed_reason, NEW.suspended_reason);
    ELSE -- DELETE
        v_store_id := OLD.store_id;
        v_member_id := OLD.id;
        v_reason := OLD.removed_reason;
    END IF;

    INSERT INTO store_membership_audit_log (
        actor_id, actor_db_role, actor_jwt_role, actor_kind,
        store_id, member_id, operation, old_values, new_values, reason
    ) VALUES (
        v_uid, v_db_role, v_jwt_role, v_kind,
        v_store_id, v_member_id, TG_OP,
        CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END,
        CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END,
        v_reason
    );

    RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_store_membership_audit ON store_memberships;
CREATE TRIGGER trg_store_membership_audit
    AFTER INSERT OR UPDATE OR DELETE ON store_memberships
    FOR EACH ROW
    EXECUTE FUNCTION public.audit_store_membership_change();

-- Audit-log access control: RLS on, no policy for anon/authenticated => deny-all
-- for them; privileges revoked. The SECURITY DEFINER writer (schema owner) is
-- exempt from RLS because FORCE RLS is not enabled.
ALTER TABLE store_membership_audit_log ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE store_membership_audit_log FROM PUBLIC;
REVOKE ALL ON TABLE store_membership_audit_log FROM anon;
REVOKE ALL ON TABLE store_membership_audit_log FROM authenticated;

-- ============================================================================
-- Manager lifecycle guard (BEFORE INSERT). Runs as the invoking user (NOT
-- SECURITY DEFINER) so RLS still applies; it only normalizes NEW and rejects
-- unauthorized inserts as defense-in-depth behind the INSERT policy.
--   * Trusted writes (service_role / SQL editor / superuser): passed through.
--   * Store owner: may insert any valid role (subject to RLS + role CHECK).
--   * Manager (member_write): may insert STAFF only, forced active, joined_at
--     server-set (no timestamp forgery), lifecycle/actor/reason fields cleared,
--     and may not grant member_write.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.store_memberships_guard_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
DECLARE
    v_actor UUID := auth.uid();
    v_is_owner BOOLEAN;
    v_is_manager_write BOOLEAN;
BEGIN
    IF v_actor IS NULL THEN
        RETURN NEW; -- trusted insert (migration/backfill/service maintenance)
    END IF;

    v_is_owner := public.is_store_owner(NEW.store_id, v_actor);
    v_is_manager_write := public.is_active_store_manager(NEW.store_id, v_actor, TRUE);

    IF v_is_owner THEN
        RETURN NEW;
    ELSIF v_is_manager_write THEN
        IF NEW.profile_id = v_actor THEN
            RAISE EXCEPTION 'Managers cannot add themselves as members' USING ERRCODE = 'P0001';
        END IF;
        IF NEW.role <> 'staff' THEN
            RAISE EXCEPTION 'Managers may only add staff members' USING ERRCODE = 'P0001';
        END IF;
        -- Force a clean, active staff membership; never trust client timestamps or
        -- lifecycle/actor/reason columns from a manager insert.
        NEW.joined_at := NOW();
        NEW.left_at := NULL;
        NEW.suspended_at := NULL;
        NEW.suspended_by := NULL;
        NEW.suspended_reason := NULL;
        NEW.removed_by := NULL;
        NEW.removed_reason := NULL;
        NEW.rejoined_at := NULL;
        -- A manager cannot confer member_write on a new member.
        IF public.jsonb_bool(NEW.permissions, 'member_write') THEN
            RAISE EXCEPTION 'Managers cannot grant member_write' USING ERRCODE = 'P0001';
        END IF;
        RETURN NEW;
    ELSE
        RAISE EXCEPTION 'Not authorized to insert store membership' USING ERRCODE = 'P0001';
    END IF;
END;
$$;

DROP TRIGGER IF EXISTS trg_store_memberships_guard_insert ON store_memberships;
CREATE TRIGGER trg_store_memberships_guard_insert
    BEFORE INSERT ON store_memberships
    FOR EACH ROW
    EXECUTE FUNCTION public.store_memberships_guard_insert();

-- ============================================================================
-- Manager lifecycle guard (BEFORE UPDATE) + owner/role rules.
-- Policies can only see the row being written (no OLD/NEW), so every rule that
-- must compare pre-update (OLD) with post-update (NEW) lives here. This function
-- is intentionally NOT SECURITY DEFINER so RLS policies still apply and it cannot
-- be used as a backdoor to bypass them.
--
-- Trigger order on UPDATE: BEFORE ROW triggers fire in alphabetical order by name,
-- so trg_prevent_sole_owner_update (p...) runs BEFORE
-- trg_store_memberships_guard_update (s...). The specific sole-owner error stays
-- authoritative for the last-owner case; this guard enforces the remaining rules.
--
-- Rules:
--   * store_id / profile_id are immutable for everyone (no cross-store move).
--   * Trusted writes (auth.uid() IS NULL) skip actor guards; sole-owner protection
--     still applies (previous trigger).
--   * Store owner: may change any non-identity field.
--   * Manager (member_write) may only manage the lifecycle of STAFF rows on an
--     allow-list of fields (left_at, suspended_at, suspended_reason,
--     removed_reason, rejoined_at). It may not change role, permissions, joined_at,
--     or touch owner/manager rows. suspended_by/removed_by are forced to the
--     acting manager so they cannot be forged to another identity.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.store_memberships_guard_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
DECLARE
    v_actor UUID := auth.uid();
    v_is_store_owner BOOLEAN;
    v_is_manager_write BOOLEAN;
BEGIN
    -- 1) Immutable identity columns for everyone (incl. trusted maintenance):
    --    a membership cannot be moved to another store or reassigned to a profile.
    IF NEW.store_id IS DISTINCT FROM OLD.store_id THEN
        RAISE EXCEPTION 'store_memberships.store_id is immutable' USING ERRCODE = 'P0001';
    END IF;
    IF NEW.profile_id IS DISTINCT FROM OLD.profile_id THEN
        RAISE EXCEPTION 'store_memberships.profile_id is immutable' USING ERRCODE = 'P0001';
    END IF;

    -- Trusted context: maintenance allowed; sole-owner protection already ran.
    IF v_actor IS NULL THEN
        RETURN NEW;
    END IF;

    v_is_store_owner := public.is_store_owner(OLD.store_id, v_actor);
    v_is_manager_write := public.is_active_store_manager(OLD.store_id, v_actor, TRUE);

    IF v_is_store_owner THEN
        -- Store owner may change any non-identity field (incl. roles).
        RETURN NEW;
    ELSIF v_is_manager_write THEN
        -- Manager may only manage STAFF lifecycle on an allow-list of fields.
        IF OLD.role <> 'staff' THEN
            RAISE EXCEPTION 'Managers cannot modify owner or manager memberships' USING ERRCODE = 'P0001';
        END IF;
        IF NEW.role IS DISTINCT FROM OLD.role THEN
            RAISE EXCEPTION 'Only the store owner may change a member role' USING ERRCODE = 'P0001';
        END IF;
        IF NEW.permissions IS DISTINCT FROM OLD.permissions THEN
            RAISE EXCEPTION 'Managers cannot change member permissions' USING ERRCODE = 'P0001';
        END IF;
        IF NEW.joined_at IS DISTINCT FROM OLD.joined_at THEN
            RAISE EXCEPTION 'Managers cannot change joined_at' USING ERRCODE = 'P0001';
        END IF;

        -- Force actor attribution to the acting manager; never trust a client
        -- supplied suspended_by/removed_by (prevents forging another identity).
        IF NEW.suspended_at IS NOT NULL AND NEW.suspended_at IS DISTINCT FROM OLD.suspended_at THEN
            NEW.suspended_by := v_actor;
        ELSIF NEW.suspended_at IS NULL THEN
            NEW.suspended_by := NULL;
        END IF;
        IF NEW.left_at IS NOT NULL AND NEW.left_at IS DISTINCT FROM OLD.left_at THEN
            NEW.removed_by := v_actor;
        ELSIF NEW.left_at IS NULL THEN
            NEW.removed_by := NULL;
        END IF;
        RETURN NEW;
    ELSE
        -- 2) Caller is neither owner nor manager: fail closed.
        RAISE EXCEPTION 'Not authorized to update store membership' USING ERRCODE = 'P0001';
    END IF;
END;
$$;

DROP TRIGGER IF EXISTS trg_store_memberships_guard_update ON store_memberships;
CREATE TRIGGER trg_store_memberships_guard_update
    BEFORE UPDATE ON store_memberships
    FOR EACH ROW
    EXECUTE FUNCTION public.store_memberships_guard_update();

-- ============================================================================
-- Function privileges: deny PUBLIC, allow only where RLS needs them.
-- Trigger functions need no client EXECUTE (triggers run regardless); they are
-- revoked from PUBLIC so they cannot be called directly as a backdoor.
-- ============================================================================
REVOKE ALL ON FUNCTION public.is_store_owner(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_active_store_manager(UUID, UUID, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_active_store_member(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.jsonb_bool(JSONB, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.validate_store_member_permissions(JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prevent_sole_owner_change() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prevent_sole_owner_delete() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.store_memberships_guard_update() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.store_memberships_guard_insert() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.audit_store_membership_change() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.is_store_owner(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_active_store_manager(UUID, UUID, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_active_store_member(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.jsonb_bool(JSONB, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.validate_store_member_permissions(JSONB) TO authenticated;

-- ============================================================================
-- Row Level Security policies for store_memberships.
-- ============================================================================
ALTER TABLE store_memberships ENABLE ROW LEVEL SECURITY;

-- SELECT: a member sees their own row; the owner or any active manager sees all.
DROP POLICY IF EXISTS store_memberships_select ON store_memberships;
CREATE POLICY store_memberships_select ON store_memberships
    FOR SELECT USING (
        profile_id = auth.uid()
        OR public.is_store_owner(store_id, auth.uid())
        OR public.is_active_store_manager(store_id, auth.uid(), FALSE)
    );

-- INSERT: owner may add any valid role; a manager (member_write) may add only
-- active STAFF (never itself, never member_write). Field normalization and
-- timestamp/actor/reason anti-forgery are enforced by store_memberships_guard_insert.
DROP POLICY IF EXISTS store_memberships_insert ON store_memberships;
CREATE POLICY store_memberships_insert ON store_memberships
    FOR INSERT WITH CHECK (
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

-- UPDATE: USING checks the pre-update row; WITH CHECK checks the post-update row.
-- All OLD/NEW comparisons live in trg_store_memberships_guard_update.
DROP POLICY IF EXISTS store_memberships_update ON store_memberships;
CREATE POLICY store_memberships_update ON store_memberships
    FOR UPDATE
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

-- DELETE: only the store owner may hard-delete a membership.
DROP POLICY IF EXISTS store_memberships_delete ON store_memberships;
CREATE POLICY store_memberships_delete ON store_memberships
    FOR DELETE USING (
        public.is_store_owner(store_id, auth.uid())
    );

-- ============================================================================
-- Conversations: allow store owner/manager/staff to view conversations of their
-- store. Uses SECURITY DEFINER helpers instead of querying store_memberships
-- directly, which would recurse into store_memberships RLS.
-- ============================================================================
DROP POLICY IF EXISTS conversations_store_members_select ON conversations;
CREATE POLICY conversations_store_members_select ON conversations
    FOR SELECT USING (
        public.is_store_owner(conversations.store_id, auth.uid())
        OR public.is_active_store_member(conversations.store_id, auth.uid())
    );