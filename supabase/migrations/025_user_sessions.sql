-- ============================================================================
-- Migration 025: user_sessions table (device/session tracking)
-- ============================================================================
-- STATUS: PLAN ONLY — DO NOT RUN AUTOMATICALLY.
--   Review and execute on STAGING first. Apply to production only after
--   explicit approval. Do NOT commit/push/deploy until approved.
--
-- WHY
--   Track active user sessions per device so users can view and revoke their
--   own sessions, and so the backend can detect refresh-token rotation mismatches.
--   Approach A: store ONLY a SHA-256 hash of the refresh token. The raw refresh
--   token is NEVER written to this table (or any table).
--
-- WHAT CHANGES
--   * Creates table user_sessions (owned by profiles.id, UUID FK).
--   * RLS enabled: owner (profile_id) can SELECT own rows; service_role handles
--     all INSERT/UPDATE/DELETE (backend manages sessions during login/refresh/logout).
--   * Indexes for profile lookups, active-session listing, and refresh-token
--     hash lookup during rotation.
--
-- IMPACT / RISK
--   * Additive: new table only, no existing column or table is altered.
--   * Does not store raw tokens, so a table leak does not expose sessions.
--   * Session revocation here is a soft flag (is_revoked); actual token
--     revocation still goes through Supabase auth.admin.signOut().
--
-- ROLLBACK
--   DROP TRIGGER IF EXISTS user_sessions_enforce_update_trg ON user_sessions;
--   DROP FUNCTION IF EXISTS public.user_sessions_enforce_update();
--   DROP POLICY IF EXISTS "Users can revoke own session" ON user_sessions;
--   DROP POLICY IF EXISTS "Users can view own sessions" ON user_sessions;
--   DROP POLICY IF EXISTS "Service can manage sessions" ON user_sessions;
--   DROP INDEX IF EXISTS idx_user_sessions_device_id;
--   DROP INDEX IF EXISTS idx_user_sessions_refresh_token_hash;
--   DROP INDEX IF EXISTS idx_user_sessions_profile_active;
--   DROP INDEX IF EXISTS idx_user_sessions_profile_id;
--   ALTER TABLE user_sessions DISABLE ROW LEVEL SECURITY;
--   DROP TABLE IF EXISTS user_sessions;
--
-- POST-MIGRATION VERIFICATION
--   SELECT id, profile_id, device_name, ip_address, is_revoked, created_at
--   FROM user_sessions LIMIT 5;
--   SELECT polname FROM pg_policies WHERE tablename = 'user_sessions';
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS user_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    refresh_token_hash TEXT NOT NULL,
    device_id TEXT NOT NULL,
    device_name TEXT,
    ip_address TEXT NOT NULL,
    user_agent TEXT NOT NULL,
    browser TEXT,
    os TEXT,
    country TEXT,
    city TEXT,
    last_activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    is_revoked BOOLEAN NOT NULL DEFAULT false,
    revoked_at TIMESTAMPTZ,
    revoked_reason TEXT,
    UNIQUE (profile_id, refresh_token_hash)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_user_sessions_profile_id
    ON user_sessions(profile_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_profile_active
    ON user_sessions(profile_id, is_revoked, expires_at);
CREATE INDEX IF NOT EXISTS idx_user_sessions_device_id
    ON user_sessions(profile_id, device_id);

-- RLS
ALTER TABLE user_sessions ENABLE ROW LEVEL SECURITY;

-- Owner (and admins) can view their own sessions
CREATE POLICY "Users can view own sessions" ON user_sessions
    FOR SELECT USING (profile_id = auth.uid() OR is_admin_or_owner());

-- Backend (service_role) creates/manages session rows during login/refresh/logout
CREATE POLICY "Service can manage sessions" ON user_sessions
    FOR ALL USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

-- Owner can revoke their own session (soft flag only). Ownership enforced here;
-- field-level protection is enforced by trigger function below.
CREATE POLICY "Users can revoke own session" ON user_sessions
    FOR UPDATE USING (profile_id = auth.uid())
    WITH CHECK (profile_id = auth.uid());

-- Trigger function: enforces that non-service roles may only revoke their own
-- session (false -> true) with revoked_at and revoked_reason, and cannot change
-- any other field. service_role bypasses all restrictions.
CREATE OR REPLACE FUNCTION public.user_sessions_enforce_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    -- service_role manages sessions freely
    IF auth.role() = 'service_role' THEN
        RETURN NEW;
    END IF;

    -- Ownership / protected fields must not change
    IF NEW.id IS DISTINCT FROM OLD.id THEN
        RAISE EXCEPTION 'id cannot be changed';
    END IF;
    IF NEW.profile_id IS DISTINCT FROM OLD.profile_id THEN
        RAISE EXCEPTION 'profile_id cannot be changed';
    END IF;
    IF NEW.device_id IS DISTINCT FROM OLD.device_id THEN
        RAISE EXCEPTION 'device_id cannot be changed';
    END IF;
    IF NEW.refresh_token_hash IS DISTINCT FROM OLD.refresh_token_hash THEN
        RAISE EXCEPTION 'refresh_token_hash cannot be changed';
    END IF;
    IF NEW.ip_address IS DISTINCT FROM OLD.ip_address THEN
        RAISE EXCEPTION 'ip_address cannot be changed';
    END IF;
    IF NEW.user_agent IS DISTINCT FROM OLD.user_agent THEN
        RAISE EXCEPTION 'user_agent cannot be changed';
    END IF;
    IF NEW.expires_at IS DISTINCT FROM OLD.expires_at THEN
        RAISE EXCEPTION 'expires_at cannot be changed';
    END IF;
    IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'created_at cannot be changed';
    END IF;
    IF NEW.last_activity_at IS DISTINCT FROM OLD.last_activity_at THEN
        RAISE EXCEPTION 'last_activity_at cannot be changed';
    END IF;

    -- is_revoked cannot be flipped back to false
    IF OLD.is_revoked = true AND NEW.is_revoked = false THEN
        RAISE EXCEPTION 'cannot un-revoke a session';
    END IF;

    -- Only allow false -> true revoke, requiring revoked_at and revoked_reason
    IF NEW.is_revoked = true AND OLD.is_revoked = false THEN
        IF NEW.revoked_at IS NULL THEN
            RAISE EXCEPTION 'revoked_at is required when revoking';
        END IF;
        IF NEW.revoked_reason IS NULL THEN
            RAISE EXCEPTION 'revoked_reason is required when revoking';
        END IF;
        IF NEW.revoked_at IS DISTINCT FROM OLD.revoked_at AND OLD.revoked_at IS NOT NULL THEN
            RAISE EXCEPTION 'revoked_at cannot be changed';
        END IF;
        IF NEW.revoked_reason IS DISTINCT FROM OLD.revoked_reason AND OLD.revoked_reason IS NOT NULL THEN
            RAISE EXCEPTION 'revoked_reason cannot be changed';
        END IF;
    ELSE
        -- no revoke: revoked fields must stay unchanged
        IF NEW.revoked_at IS DISTINCT FROM OLD.revoked_at THEN
            RAISE EXCEPTION 'revoked_at cannot be changed';
        END IF;
        IF NEW.revoked_reason IS DISTINCT FROM OLD.revoked_reason THEN
            RAISE EXCEPTION 'revoked_reason cannot be changed';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.user_sessions_enforce_update() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_sessions_enforce_update() TO authenticated, service_role;

DROP TRIGGER IF EXISTS user_sessions_enforce_update_trg ON public.user_sessions;
CREATE TRIGGER user_sessions_enforce_update_trg
    BEFORE UPDATE ON public.user_sessions
    FOR EACH ROW
    EXECUTE FUNCTION public.user_sessions_enforce_update();

COMMIT;
