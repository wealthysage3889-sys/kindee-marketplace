-- ============================================================================
-- Migration 026: login_history table (append-only auth audit log)
-- ============================================================================
-- STATUS: PLAN ONLY — DO NOT RUN AUTOMATICALLY.
--   Review and execute on STAGING first. Apply to production only after
--   explicit approval. Do NOT commit/push/deploy until approved.
--
-- WHY
--   Immutable log of authentication events (login success/failure, logout,
--   password change, social link/unlink, session revocation) per user, with
--   the request context (IP, User-Agent, device, browser, OS, approximate
--   location) used for security alerts and forensics.
--
-- WHAT CHANGES
--   * Creates table login_history (owned by profiles.id, UUID FK).
--   * RLS: owner can SELECT own rows; service_role inserts; append-only
--     (no UPDATE/DELETE for auth users, preventing log tampering).
--
-- IMPACT / RISK
--   * Additive: new table only.
--   * Append-only by design: users cannot edit or delete their own history.
--
-- ROLLBACK
--   DROP POLICY IF EXISTS "Users can view own login history" ON login_history;
--   DROP POLICY IF EXISTS "Service can insert login history" ON login_history;
--   DROP INDEX IF EXISTS idx_login_history_profile_created;
--   DROP INDEX IF EXISTS idx_login_history_event_type;
--   DROP INDEX IF EXISTS idx_login_history_profile_id;
--   DROP INDEX IF EXISTS idx_login_history_created_at;
--   ALTER TABLE login_history DISABLE ROW LEVEL SECURITY;
--   DROP TABLE IF EXISTS login_history;
--
-- POST-MIGRATION VERIFICATION
--   SELECT id, profile_id, event_type, success, created_at
--   FROM login_history LIMIT 5;
--   SELECT polname FROM pg_policies WHERE tablename = 'login_history';
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS login_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    success BOOLEAN NOT NULL,
    failure_reason TEXT,
    ip_address TEXT,
    user_agent TEXT,
    device_id TEXT,
    device_name TEXT,
    browser TEXT,
    os TEXT,
    country TEXT,
    city TEXT,
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_login_history_profile_id
    ON login_history(profile_id);
CREATE INDEX IF NOT EXISTS idx_login_history_created_at
    ON login_history(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_login_history_profile_created
    ON login_history(profile_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_login_history_event_type
    ON login_history(event_type);

-- RLS
ALTER TABLE login_history ENABLE ROW LEVEL SECURITY;

-- Owner (and admins) can view their own login history
CREATE POLICY "Users can view own login history" ON login_history
    FOR SELECT USING (profile_id = auth.uid() OR is_admin_or_owner());

-- Backend (service_role) appends login/audit events; users cannot insert
CREATE POLICY "Service can insert login history" ON login_history
    FOR INSERT WITH CHECK (auth.role() = 'service_role');

COMMIT;
