-- 00_base_schema.sql
-- Local/Staging TEST harness emulating the Supabase environment required by 010.
-- Creates the auth schema + uid()/role(), the anon/authenticated/service_role
-- roles, and minimal profiles/stores/conversations tables mirroring 001.
-- This is NOT part of the migration; it exists only so the 010 tests can run
-- against an isolated PostgreSQL instance.

-- Extensions used by the migration (uuid_generate_v4 in table/function defaults)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Roles (idempotent)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        CREATE ROLE anon NOLOGIN;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        CREATE ROLE authenticated NOLOGIN;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
        CREATE ROLE service_role NOLOGIN BYPASSRLS;
    END IF;
END $$;

-- auth schema + uid()/role() reading request.jwt.claims (Supabase convention)
CREATE SCHEMA IF NOT EXISTS auth;

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS UUID
LANGUAGE sql
STABLE
AS $$
    SELECT COALESCE(
        NULLIF(current_setting('request.jwt.claim.sub', true), ''),
        (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    )::uuid
$$;

CREATE OR REPLACE FUNCTION auth.role()
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$
    SELECT COALESCE(
        NULLIF(current_setting('request.jwt.claim.role', true), ''),
        (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
    )
$$;

-- Minimal profiles (mirror 001)
CREATE TABLE IF NOT EXISTS profiles (
    id UUID PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    phone TEXT UNIQUE,
    name TEXT,
    avatar_url TEXT,
    role TEXT NOT NULL DEFAULT 'customer',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Minimal stores (mirror 001)
CREATE TABLE IF NOT EXISTS stores (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    owner_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    is_active BOOLEAN DEFAULT true,
    is_verified BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Minimal conversations (010 adds a policy referencing store_id)
CREATE TABLE IF NOT EXISTS conversations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    type TEXT NOT NULL DEFAULT 'direct',
    store_id UUID REFERENCES stores(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Base table grants so RLS is the only gate for anon/authenticated (Supabase-like).
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE profiles TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE stores TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE conversations TO authenticated, service_role;
GRANT SELECT ON TABLE profiles TO anon;
GRANT SELECT ON TABLE stores TO anon;
GRANT SELECT ON TABLE conversations TO anon;

-- Allow client roles to call auth.uid()/auth.role() (Supabase grants this).
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.role() TO anon, authenticated, service_role;

-- Emulate Supabase default privileges: tables created later by postgres (the
-- migration runner) are automatically granted to anon/authenticated/service_role.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
    GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;

-- RLS on base tables (010 tests rely on these being on)
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;

-- Simple permissive-ish base policies for profiles/stores so FK lookups by
-- SECURITY DEFINER helpers are not blocked and authenticated can read records.
DROP POLICY IF EXISTS test_profiles_self ON profiles;
CREATE POLICY test_profiles_self ON profiles FOR SELECT USING (id = auth.uid() OR auth.uid() IS NULL);
DROP POLICY IF EXISTS test_stores_read ON stores;
CREATE POLICY test_stores_read ON stores FOR SELECT USING (true);
DROP POLICY IF EXISTS test_conversations_read ON conversations;
CREATE POLICY test_conversations_read ON conversations FOR SELECT USING (true);