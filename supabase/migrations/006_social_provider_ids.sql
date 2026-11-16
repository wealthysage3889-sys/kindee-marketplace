-- ============================================================================
-- Migration 006: app-owned social provider identity columns on profiles
-- ============================================================================
--
-- STATUS: PLAN ONLY — DO NOT RUN AUTOMATICALLY.
--   This file is provided for review. It has NOT been executed against any
--   database. Run it manually on a STAGING Supabase project first, verify, then
--   apply to production only after explicit approval.
--
-- WHY
--   LINE is not a Supabase built-in provider and LINE web-login ID tokens are
--   HS256-signed (channel secret), so Supabase Custom OIDC (JWKS/ES256) cannot
--   verify them. Facebook JS SDK yields a Graph API access token (not an OIDC
--   ID token) that Supabase signInWithIdToken cannot consume either. Both
--   providers are therefore verified server-side, and the app must track the
--   provider identity itself. We store it in app-owned `profiles` columns
--   (NOT on the internal `auth.users` tables, which Supabase manages).
--
-- WHAT CHANGES
--   * Adds nullable columns: google_id, facebook_id, line_id
--   * Adds partial UNIQUE indexes on each (only where NOT NULL)
--   * email stays NOT NULL (placeholder emails are used for phone-only/social
--     accounts), so this migration does NOT alter email nullability.
--
-- IMPACT / RISK
--   * Additive and backward compatible: existing code that does not reference
--     the new columns is unaffected. SELECT * callers simply see extra columns.
--   * Partial unique indexes prevent two accounts claiming the same provider id
--     while allowing many rows with NULL (the common case).
--   * No data is rewritten; no NOT NULL constraints are added.
--   * RLS on profiles is unchanged (see 002_rls_policies.sql); these columns are
--     protected by the existing "update own profile" / "admin update" policies.
--     NOTE: the current "Users can update own profile" policy WITH CHECK requires
--     role to be unchanged, so a user cannot self-escalate role via this path.
--
-- ROLLBACK
--   DROP INDEX IF EXISTS idx_profiles_google_id;
--   DROP INDEX IF EXISTS idx_profiles_facebook_id;
--   DROP INDEX IF EXISTS idx_profiles_line_id;
--   ALTER TABLE profiles DROP COLUMN IF EXISTS line_id;
--   ALTER TABLE profiles DROP COLUMN IF EXISTS facebook_id;
--   ALTER TABLE profiles DROP COLUMN IF EXISTS google_id;
--
-- POST-MIGRATION VERIFICATION
--   SELECT id, email, role, google_id, facebook_id, line_id FROM profiles LIMIT 20;
--   -- confirm indexes exist:
--   SELECT indexname FROM pg_indexes WHERE tablename = 'profiles';
-- ============================================================================

BEGIN;

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS google_id TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS facebook_id TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS line_id TEXT;

-- Partial unique indexes: uniqueness enforced only when the provider id exists.
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_google_id
  ON profiles (google_id) WHERE google_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_facebook_id
  ON profiles (facebook_id) WHERE facebook_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_line_id
  ON profiles (line_id) WHERE line_id IS NOT NULL;

COMMIT;