-- ============================================================================
-- Migration 007: Customer address book (profile_addresses)
-- ============================================================================
--
-- STATUS: PLAN ONLY — DO NOT RUN AUTOMATICALLY.
--   This file is provided for review. It has NOT been executed against any
--   database. Run it manually on a STAGING Supabase project first, verify, then
--   apply to production only after explicit approval.
--
-- WHY
--   The customer account page needs a reusable address book: multiple saved
--   delivery addresses per profile, each with a label (Home / Work), recipient
--   name, phone, full Thai address components, a default flag, and optional
--   lat/lng coordinates for map pinning. The existing `customer_destinations`
--   table is per-order (order_id UNIQUE) and is NOT a reusable address book.
--   The `profiles` table has no address column, so profile updates no longer
--   whitelist an `address` field.
--
-- WHAT CHANGES
--   * New table `profile_addresses` owned by a profiles row (one profile can
--     have many addresses).
--   * Columns mirror the `stores.address` JSONB shape so checkout can reuse
--     the same validation/format helpers.
--   * RLS: owner-only SELECT/INSERT/UPDATE/DELETE, plus a service-role policy
--     for the trusted backend.
--   * A BEFORE INSERT/UPDATE trigger locks the profile row, then demotes any
--     prior default when a new default is saved. A partial unique index is the
--     final concurrency-safe guarantee.
--
-- IMPACT / RISK
--   * Additive and backward compatible. No existing table or column is altered.
--   * Existing code that does not reference profile_addresses is unaffected.
--   * RLS is owner-scoped, so a user can never read or modify another user's
--     saved address.
--
-- ROLLBACK
--   DROP TABLE IF EXISTS profile_addresses CASCADE;
--
-- POST-MIGRATION VERIFICATION
--   SELECT id, profile_id, label, is_default FROM profile_addresses LIMIT 20;
--   SELECT indexdef FROM pg_indexes WHERE tablename = 'profile_addresses';
--   SELECT polname, polcmd FROM pg_policy WHERE polrelid = 'profile_addresses'::regclass;
--   SELECT relrowsecurity FROM pg_class WHERE relname = 'profile_addresses';
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS profile_addresses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

    -- Display
    label TEXT,
    recipient_name TEXT NOT NULL,
    phone TEXT NOT NULL,

    -- Address components (mirror the stores.address JSONB field names)
    street TEXT,
    district TEXT,
    province TEXT,
    postal_code TEXT,

    -- Optional map pin
    lat DOUBLE PRECISION,
    lng DOUBLE PRECISION,

    -- One default per profile (enforced by trigger + unique index below)
    is_default BOOLEAN NOT NULL DEFAULT false,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT profile_addresses_recipient_name_not_blank
        CHECK (length(btrim(recipient_name)) > 0),
    CONSTRAINT profile_addresses_label_not_blank
        CHECK (label IS NULL OR length(btrim(label)) > 0),
    CONSTRAINT profile_addresses_phone_not_blank
        CHECK (length(btrim(phone)) > 0),
    CONSTRAINT profile_addresses_postal_code_format
        CHECK (postal_code IS NULL OR postal_code ~ '^[0-9]{5}$'),
    CONSTRAINT profile_addresses_coordinates_complete
        CHECK (
            (lat IS NULL AND lng IS NULL)
            OR (lat IS NOT NULL AND lng IS NOT NULL)
        ),
    CONSTRAINT profile_addresses_latitude_range
        CHECK (lat IS NULL OR (lat >= -90 AND lat <= 90)),
    CONSTRAINT profile_addresses_longitude_range
        CHECK (lng IS NULL OR (lng >= -180 AND lng <= 180))
);

CREATE INDEX IF NOT EXISTS idx_profile_addresses_profile_id
    ON profile_addresses(profile_id);
CREATE INDEX IF NOT EXISTS idx_profile_addresses_profile_created
    ON profile_addresses(profile_id, created_at);

-- ---------------------------------------------------------------------------
-- Helper: enforce a single default per profile.
--   The profile row lock serializes all address writes for the same profile,
--   so two concurrent "make default" requests cannot both keep is_default=true.
--   The partial unique index is the final database-level guarantee.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION profile_addresses_enforce_single_default()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'UPDATE' AND NEW.profile_id IS DISTINCT FROM OLD.profile_id THEN
        RAISE EXCEPTION 'profile_id cannot be changed';
    END IF;

    PERFORM 1 FROM profiles WHERE id = NEW.profile_id FOR UPDATE;

    IF TG_OP = 'INSERT' THEN
        IF NEW.is_default THEN
            UPDATE profile_addresses
            SET is_default = false, updated_at = NOW()
            WHERE profile_id = NEW.profile_id
              AND id <> NEW.id
              AND is_default = true;
        END IF;
    ELSIF NEW.is_default AND OLD.is_default IS DISTINCT FROM TRUE THEN
        UPDATE profile_addresses
        SET is_default = false, updated_at = NOW()
        WHERE profile_id = NEW.profile_id
          AND id <> NEW.id
          AND is_default = true;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS profile_addresses_default_insert_update ON profile_addresses;
CREATE TRIGGER profile_addresses_default_insert_update
    BEFORE INSERT OR UPDATE ON profile_addresses
    FOR EACH ROW EXECUTE FUNCTION profile_addresses_enforce_single_default();

CREATE UNIQUE INDEX IF NOT EXISTS uniq_profile_addresses_single_default
    ON profile_addresses(profile_id)
    WHERE is_default = true;

-- Keep updated_at fresh
DROP TRIGGER IF EXISTS profile_addresses_updated_at ON profile_addresses;
CREATE TRIGGER profile_addresses_updated_at
    BEFORE UPDATE ON profile_addresses
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ---------------------------------------------------------------------------
-- RLS: only the owning profile may read or mutate its addresses.
-- ---------------------------------------------------------------------------

ALTER TABLE profile_addresses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own addresses" ON profile_addresses;
CREATE POLICY "Users can view own addresses" ON profile_addresses
    FOR SELECT TO authenticated
    USING (profile_id = auth.uid());

DROP POLICY IF EXISTS "Users can insert own addresses" ON profile_addresses;
CREATE POLICY "Users can insert own addresses" ON profile_addresses
    FOR INSERT TO authenticated
    WITH CHECK (profile_id = auth.uid());

DROP POLICY IF EXISTS "Users can update own addresses" ON profile_addresses;
CREATE POLICY "Users can update own addresses" ON profile_addresses
    FOR UPDATE TO authenticated
    USING (profile_id = auth.uid())
    WITH CHECK (profile_id = auth.uid());

DROP POLICY IF EXISTS "Users can delete own addresses" ON profile_addresses;
CREATE POLICY "Users can delete own addresses" ON profile_addresses
    FOR DELETE TO authenticated
    USING (profile_id = auth.uid());

-- The trusted backend uses the service role. Keep this explicit so the table
-- remains manageable even in environments where service-role RLS is enforced.
DROP POLICY IF EXISTS "Service role can manage addresses" ON profile_addresses;
CREATE POLICY "Service role can manage addresses" ON profile_addresses
    FOR ALL TO service_role
    USING (true)
    WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE profile_addresses TO authenticated;
GRANT ALL PRIVILEGES ON TABLE profile_addresses TO service_role;

COMMIT;