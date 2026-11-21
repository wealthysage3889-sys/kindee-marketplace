-- KINDEE Migration 010 Security Verification - Audit Log Tests (Revised)
-- Switch back to postgres role before reading audit_log
-- All writes in BEGIN/ROLLBACK
\echo '=== TEST 4: AUDIT LOG (REVISED) ==='

-- Test 4d: Audit entry on trusted INSERT (auth.uid IS NULL)
\echo '--- 4d: Audit entry on trusted INSERT ---'
BEGIN;
INSERT INTO store_memberships (store_id, profile_id, role, permissions)
VALUES ('2a12be88-07fe-430c-9771-319f25a02e3b', '8664df4f-b1ad-42e0-9b30-f06351fff8f6', 'staff', '{}');
SELECT count(*) AS audit_rows_after_insert FROM store_membership_audit_log;
ROLLBACK;

-- Test 4e: Audit entry on UPDATE by end_user (auth.uid set)
\echo '--- 4e: Audit entry on UPDATE by end_user ---'
BEGIN;
SET ROLE authenticated;
SET request.jwt.claim.sub = 'dd5caa6b-4487-4f85-b3bb-74998afcfe98';
SET request.jwt.claim.role = 'authenticated';
UPDATE store_memberships SET suspended_reason = 'end_user audit test' WHERE id = 'f79fb7b6-4d79-4269-8270-17f6a153be20';
RESET ROLE;
SELECT actor_id, actor_db_role, actor_jwt_role, actor_kind, operation, reason
FROM store_membership_audit_log
ORDER BY created_at DESC LIMIT 1;
ROLLBACK;

-- Test 4f: Actor kind classification - service_role
\echo '--- 4f: Actor kind = service_role ---'
BEGIN;
SET request.jwt.claim.sub = '';
SET request.jwt.claim.role = 'service_role';
UPDATE store_memberships SET suspended_reason = NULL WHERE id = 'f79fb7b6-4d79-4269-8270-17f6a153be20';
SELECT actor_kind AS kind_service_role, actor_jwt_role AS jwt_role
FROM store_membership_audit_log
ORDER BY created_at DESC LIMIT 1;
ROLLBACK;

-- Test 4g: Actor kind classification - sql_editor (no JWT, direct DB connection)
\echo '--- 4g: Actor kind = system (no JWT claims) ---'
BEGIN;
-- No request.jwt.claim.sub set -> auth.uid() IS NULL
-- No request.jwt.claim.role set -> auth.role() returns NULL
-- session_user = postgres -> v_kind = 'sql_editor' per the function logic
UPDATE store_memberships SET suspended_reason = NULL WHERE id = 'f79fb7b6-4d79-4269-8270-17f6a153be20';
SELECT actor_kind AS kind_direct_db, actor_db_role AS db_role
FROM store_membership_audit_log
ORDER BY created_at DESC LIMIT 1;
ROLLBACK;

\echo '=== AUDIT LOG TESTS COMPLETE ==='
