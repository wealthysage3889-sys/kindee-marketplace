-- ============================================================================
-- Migration 027: security_alerts table (new device / new country / failed logins)
-- ============================================================================
-- STATUS: PLAN ONLY — DO NOT RUN AUTOMATICALLY.
--   Review and execute on STAGING first. Apply to production only after
--   explicit approval. Do NOT commit/push/deploy until approved.
--
-- WHY
--   Store security alerts raised from login_history patterns:
--   * new_device      — login from a device_id never seen for this profile
--   * new_country     — login from a country never seen for this profile
--   * multiple_failed_logins — N failed login attempts within a time window
--   Alerts support the "เจ้าของข้อมูลเท่านั้น" RLS model: the owner reads
--   their own alerts and marks them as read; admins can resolve any alert.
--
-- WHAT CHANGES
--   * Creates table security_alerts (owned by profiles.id, UUID FK).
--   * RLS: owner can SELECT own rows and mark own alerts as read; service_role
--     inserts; admins can resolve any alert.
--
-- IMPACT / RISK
--   * Additive: new table only.
--   * Alerts are derived from login_history; no raw credentials stored.
--
-- ROLLBACK
--   DROP TRIGGER IF EXISTS security_alerts_enforce_update_trg ON security_alerts;
--   DROP FUNCTION IF EXISTS public.security_alerts_enforce_update();
--   DROP POLICY IF EXISTS "Admins can resolve alerts" ON security_alerts;
--   DROP POLICY IF EXISTS "Users can mark own alerts as read" ON security_alerts;
--   DROP POLICY IF EXISTS "Users can view own alerts" ON security_alerts;
--   DROP POLICY IF EXISTS "Service can insert alerts" ON security_alerts;
--   DROP INDEX IF EXISTS idx_security_alerts_profile_created;
--   DROP INDEX IF EXISTS idx_security_alerts_profile_unread;
--   DROP INDEX IF EXISTS idx_security_alerts_alert_type;
--   DROP INDEX IF EXISTS idx_security_alerts_created_at;
--   ALTER TABLE security_alerts DISABLE ROW LEVEL SECURITY;
--   DROP TABLE IF EXISTS security_alerts;
--
-- POST-MIGRATION VERIFICATION
--   SELECT id, profile_id, alert_type, severity, is_read, created_at
--   FROM security_alerts LIMIT 5;
--   SELECT polname FROM pg_policies WHERE tablename = 'security_alerts';
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS security_alerts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    alert_type TEXT NOT NULL,
    severity TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    ip_address TEXT,
    country TEXT,
    device_id TEXT,
    is_read BOOLEAN NOT NULL DEFAULT false,
    read_at TIMESTAMPTZ,
    resolved_at TIMESTAMPTZ,
    resolved_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_security_alerts_profile_id
    ON security_alerts(profile_id);
CREATE INDEX IF NOT EXISTS idx_security_alerts_profile_unread
    ON security_alerts(profile_id, is_read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_security_alerts_alert_type
    ON security_alerts(alert_type);
CREATE INDEX IF NOT EXISTS idx_security_alerts_created_at
    ON security_alerts(created_at DESC);

-- RLS
ALTER TABLE security_alerts ENABLE ROW LEVEL SECURITY;

-- Owner (and admins) can view their own alerts
CREATE POLICY "Users can view own alerts" ON security_alerts
    FOR SELECT USING (profile_id = auth.uid() OR is_admin_or_owner());

-- Backend (service_role) inserts alerts; users cannot insert
CREATE POLICY "Service can insert alerts" ON security_alerts
    FOR INSERT WITH CHECK (auth.role() = 'service_role');

-- Owner can mark their own alert as read (only is_read/read_at may change)
CREATE POLICY "Users can mark own alerts as read" ON public.security_alerts
    FOR UPDATE USING (profile_id = auth.uid())
    WITH CHECK (profile_id = auth.uid());

-- Trigger function: enforces field-level restrictions for non-admin/non-service users
CREATE OR REPLACE FUNCTION public.security_alerts_enforce_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    -- service_role and admins manage freely
    IF auth.role() = 'service_role' OR is_admin_or_owner() THEN
        RETURN NEW;
    END IF;

    -- Owner may only change is_read/read_at
    IF NEW.id IS DISTINCT FROM OLD.id THEN RAISE EXCEPTION 'id cannot be changed'; END IF;
    IF NEW.profile_id IS DISTINCT FROM OLD.profile_id THEN RAISE EXCEPTION 'profile_id cannot be changed'; END IF;
    IF NEW.alert_type IS DISTINCT FROM OLD.alert_type THEN RAISE EXCEPTION 'alert_type cannot be changed'; END IF;
    IF NEW.severity IS DISTINCT FROM OLD.severity THEN RAISE EXCEPTION 'severity cannot be changed'; END IF;
    IF NEW.title IS DISTINCT FROM OLD.title THEN RAISE EXCEPTION 'title cannot be changed'; END IF;
    IF NEW.description IS DISTINCT FROM OLD.description THEN RAISE EXCEPTION 'description cannot be changed'; END IF;
    IF NEW.ip_address IS DISTINCT FROM OLD.ip_address THEN RAISE EXCEPTION 'ip_address cannot be changed'; END IF;
    IF NEW.country IS DISTINCT FROM OLD.country THEN RAISE EXCEPTION 'country cannot be changed'; END IF;
    IF NEW.device_id IS DISTINCT FROM OLD.device_id THEN RAISE EXCEPTION 'device_id cannot be changed'; END IF;
    IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN RAISE EXCEPTION 'created_at cannot be changed'; END IF;
    IF NEW.resolved_at IS DISTINCT FROM OLD.resolved_at THEN RAISE EXCEPTION 'resolved_at cannot be changed'; END IF;
    IF NEW.resolved_by IS DISTINCT FROM OLD.resolved_by THEN RAISE EXCEPTION 'resolved_by cannot be changed'; END IF;

    -- is_read cannot revert true -> false
    IF OLD.is_read = true AND NEW.is_read = false THEN
        RAISE EXCEPTION 'cannot mark alert as unread';
    END IF;
    -- read_at must be set when marking read
    IF NEW.is_read = true AND OLD.is_read = false THEN
        IF NEW.read_at IS NULL THEN
            RAISE EXCEPTION 'read_at is required when marking read';
        END IF;
    ELSE
        IF NEW.read_at IS DISTINCT FROM OLD.read_at THEN
            RAISE EXCEPTION 'read_at cannot be changed';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.security_alerts_enforce_update() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.security_alerts_enforce_update() TO authenticated, service_role;

DROP TRIGGER IF EXISTS security_alerts_enforce_update_trg ON public.security_alerts;
CREATE TRIGGER security_alerts_enforce_update_trg
    BEFORE UPDATE ON public.security_alerts
    FOR EACH ROW
    EXECUTE FUNCTION public.security_alerts_enforce_update();

-- Admins/owners can resolve any alert
CREATE POLICY "Admins can resolve alerts" ON public.security_alerts
    FOR UPDATE USING (is_admin_or_owner())
    WITH CHECK (is_admin_or_owner());

COMMIT;
