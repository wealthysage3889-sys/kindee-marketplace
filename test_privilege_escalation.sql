-- KINDEE Migration 010 Security Verification - Privilege Escalation Tests
-- All writes in BEGIN/ROLLBACK
\echo '=== TEST 5: PRIVILEGE ESCALATION ==='

-- Test 5a: authenticated calls permitted function is_store_owner -> should SUCCEED
\echo '--- 5a: authenticated execute is_store_owner (should SUCCEED) ---'
BEGIN;
SET ROLE authenticated;
SET request.jwt.claim.sub = 'dd5caa6b-4487-4f85-b3bb-74998afcfe98';
SET request.jwt.claim.role = 'authenticated';
SELECT public.is_store_owner('2a12be88-07fe-430c-9771-319f25a02e3b', 'dd5caa6b-4487-4f85-b3bb-74998afcfe98') AS is_owner;
RESET ROLE;
ROLLBACK;

-- Test 5b: authenticated calls revoked function prevent_sole_owner_change -> should FAIL
\echo '--- 5b: authenticated execute prevent_sole_owner_change (should FAIL) ---'
BEGIN;
SET ROLE authenticated;
SELECT public.prevent_sole_owner_change();
RESET ROLE;
ROLLBACK;

-- Test 5c: authenticated calls revoked function audit_store_membership_change -> should FAIL
\echo '--- 5c: authenticated execute audit_store_membership_change (should FAIL) ---'
BEGIN;
SET ROLE authenticated;
SELECT public.audit_store_membership_change();
RESET ROLE;
ROLLBACK;

-- Test 5d: anon calls permitted function -> should FAIL (no EXECUTE grant to anon)
\echo '--- 5d: anon execute is_store_owner (should FAIL - no grant) ---'
BEGIN;
SET ROLE anon;
SELECT public.is_store_owner('2a12be88-07fe-430c-9771-319f25a02e3b', 'dd5caa6b-4487-4f85-b3bb-74998afcfe98');
RESET ROLE;
ROLLBACK;

-- Test 5e: authenticated SELECT from store_memberships (RLS enforced)
\echo '--- 5e: authenticated SELECT store_memberships with own profile (RLS) ---'
BEGIN;
SET ROLE authenticated;
SET request.jwt.claim.sub = 'dd5caa6b-4487-4f85-b3bb-74998afcfe98';
SET request.jwt.claim.role = 'authenticated';
SELECT id, store_id, profile_id, role FROM store_memberships;
RESET ROLE;
ROLLBACK;

-- Test 5f: authenticated SELECT from store_membership_audit_log -> should FAIL (no SELECT grant)
\echo '--- 5f: authenticated SELECT audit_log (should FAIL - no grant) ---'
BEGIN;
SET ROLE authenticated;
SELECT count(*) FROM store_membership_audit_log;
RESET ROLE;
ROLLBACK;

-- Test 5g: SECURITY DEFINER function runs with owner privileges (is_store_owner accessible to authenticated)
\echo '--- 5g: SECURITY DEFINER is_store_owner accessible to authenticated ---'
BEGIN;
SET ROLE authenticated;
SET request.jwt.claim.sub = '8664df4f-b1ad-42e0-9b30-f06351fff8f6';
SET request.jwt.claim.role = 'authenticated';
-- Outsider checking if they own a store -> should return FALSE (not an error)
SELECT public.is_store_owner('2a12be88-07fe-430c-9771-319f25a02e3b', '8664df4f-b1ad-42e0-9b30-f06351fff8f6') AS outsider_is_owner;
RESET ROLE;
ROLLBACK;

-- Test 5h: Try to escalate via search_path manipulation (SECURITY DEFINER functions pin search_path)
\echo '--- 5h: search_path pinned on SECURITY DEFINER functions ---'
SELECT proname, proconfig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND proname IN ('is_store_owner','prevent_sole_owner_change','audit_store_membership_change')
AND prosecdef = true;

\echo '=== PRIVILEGE ESCALATION TESTS COMPLETE ==='
