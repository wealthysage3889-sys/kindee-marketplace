-- KINDEE Migration 010 - Privilege Escalation Follow-up
-- Investigate anon role function execution privileges
\echo '=== TEST 5-FOLLOWUP: ANON FUNCTION PRIVILEGES ==='

-- Check explicit function grants
\echo '--- Function grants for is_store_owner ---'
SELECT routine_name, grantee, privilege_type 
FROM information_schema.routine_privileges 
WHERE routine_name = 'is_store_owner' AND routine_schema = 'public'
ORDER BY grantee, privilege_type;

-- Check if anon has any privileges on store_memberships
\echo '--- Table grants for anon on store_memberships ---'
SELECT grantee, table_name, privilege_type 
FROM information_schema.role_table_grants 
WHERE table_name = 'store_memberships' AND table_schema = 'public'
ORDER BY grantee, privilege_type;

-- Test: Can anon SELECT from store_memberships?
\echo '--- anon SELECT store_memberships ---'
BEGIN;
SET ROLE anon;
SELECT count(*) FROM store_memberships;
RESET ROLE;
ROLLBACK;

-- Test: Can anon call jsonb_bool (granted to authenticated only)?
\echo '--- anon execute jsonb_bool ---'
BEGIN;
SET ROLE anon;
SELECT public.jsonb_bool('{}'::jsonb, 'member_write') AS result;
RESET ROLE;
ROLLBACK;

-- Test: Can anon call prevent_sole_owner_change (trigger function)?
\echo '--- anon execute prevent_sole_owner_change ---'
BEGIN;
SET ROLE anon;
SELECT public.prevent_sole_owner_change();
RESET ROLE;
ROLLBACK;

\echo '=== ANON PRIVILEGE TESTS COMPLETE ==='
