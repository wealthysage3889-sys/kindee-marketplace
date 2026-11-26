-- ============================================================================
-- Migration 023: Extend profile_addresses for Thai/Myanmar delivery addresses
-- ============================================================================
--
-- WHY
--   The existing profile_addresses table (migration 007) has basic address
--   components but is missing Thai-specific subdistrict (ตำบล/แขวง) and
--   country fields, plus a free-text field for delivery instructions.
--   This migration adds these columns without breaking existing data.
--
-- WHAT CHANGES
--   * Adds subdistrict (ตำบล/แขวง) column
--   * Adds country column with default 'TH' (Thailand)
--   * Adds additional_details column for delivery notes
--   * Adds constraints for data integrity
--   * Updates RLS policies remain unchanged (owner-scoped)
--
-- IMPACT / RISK
--   * Additive and backward compatible. No existing column is altered.
--   * Existing addresses will have NULL for new columns, which is valid.
--   * Frontend/Backend validation will handle missing values gracefully.
--
-- POST-MIGRATION VERIFICATION
--   SELECT id, profile_id, label, subdistrict, country, additional_details
--   FROM profile_addresses LIMIT 20;
-- ============================================================================

BEGIN;

-- Add missing address components for Thai/Myanmar delivery
ALTER TABLE profile_addresses
    ADD COLUMN IF NOT EXISTS subdistrict TEXT,
    ADD COLUMN IF NOT EXISTS country TEXT NOT NULL DEFAULT 'TH',
    ADD COLUMN IF NOT EXISTS additional_details TEXT;

-- Constraints for new columns
ALTER TABLE profile_addresses
    ADD CONSTRAINT profile_addresses_subdistrict_not_blank
        CHECK (subdistrict IS NULL OR length(btrim(subdistrict)) > 0),
    ADD CONSTRAINT profile_addresses_country_not_blank
        CHECK (country IS NULL OR length(btrim(country)) > 0),
    ADD CONSTRAINT profile_addresses_country_length
        CHECK (country IS NULL OR length(country) <= 2);

-- Index for country-based queries (if needed)
CREATE INDEX IF NOT EXISTS idx_profile_addresses_profile_country
    ON profile_addresses(profile_id, country);

COMMIT;