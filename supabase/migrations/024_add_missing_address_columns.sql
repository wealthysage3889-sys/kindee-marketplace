-- ============================================================================
-- Migration 024: Add missing profile_addresses columns confirmed absent in DB
-- ============================================================================
-- Confirmed via live Supabase REST probing:
--   subdistrict, country, additional_details do NOT exist in production.
-- Additive only. No data loss.
-- ============================================================================
BEGIN;

ALTER TABLE profile_addresses
    ADD COLUMN IF NOT EXISTS subdistrict TEXT,
    ADD COLUMN IF NOT EXISTS country TEXT NOT NULL DEFAULT 'TH',
    ADD COLUMN IF NOT EXISTS additional_details TEXT;

-- Constraints (idempotent-ish: guard with DO blocks)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profile_addresses_subdistrict_not_blank') THEN
        ALTER TABLE profile_addresses
            ADD CONSTRAINT profile_addresses_subdistrict_not_blank
            CHECK (subdistrict IS NULL OR length(btrim(subdistrict)) > 0);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profile_addresses_country_not_blank') THEN
        ALTER TABLE profile_addresses
            ADD CONSTRAINT profile_addresses_country_not_blank
            CHECK (country IS NULL OR length(btrim(country)) > 0);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profile_addresses_country_length') THEN
        ALTER TABLE profile_addresses
            ADD CONSTRAINT profile_addresses_country_length
            CHECK (country IS NULL OR length(country) <= 2);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_profile_addresses_profile_country
    ON profile_addresses(profile_id, country);

COMMIT;
