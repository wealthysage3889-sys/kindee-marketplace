-- KINDEE Migration 010 Security Verification - Audit Log Tests
-- All writes in BEGIN/ROLLBACK
\echo '=== TEST 4: AUDIT LOG ==='

-- Test 4a: Direct INSERT to audit_log by authenticated -> should FAIL
\echo '--- 4a: Direct INSERT to audit_log (should FAIL - permission denied) ---'
BEGIN;
SET ROLE authenticated;
SET request.jwt.claim.sub = 'dd5caa6b-4487-4f85-b3bb-74998afcfe98';
SET request.jwt.claim.role = 'authenticated';
INSERT INTO store_membership_audit_log (actor_id, actor_db_role, actor_jwt_role, actor_kind, store_id, member_id, operation, old_values, new_values, reason)
VALUES ('dd5caa6b-4487-4f85-b3bb-74998afcfe98', 'postgres', 'authenticated', 'end_user', '2a12be88-07fe-430c-9771-319f25a02e3b', '00000000-0000-0000-0000-000000000000', 'TEST', NULL, NULL, 'test');
RESET ROLE;
ROLLBACK;

-- Test 4b: Direct UPDATE to audit_log -> should FAIL
\echo '--- 4b: Direct UPDATE to audit_log (should FAIL) ---'
BEGIN;
SET ROLE authenticated;
UPDATE store_membership_audit_log SET reason = 'tampered' WHERE id = '00000000-0000-0000-0000-000000000000';
RESET ROLE;
ROLLBACK;

-- Test 4c: Direct DELETE to audit_log -> should FAIL
\echo '--- 4c: Direct DELETE from audit_log (should FAIL) ---'
BEGIN;
SET ROLE authenticated;
DELETE FROM store_membership_audit_log;
RESET ROLE;
ROLLBACK;

-- Test 4d: Audit entry created on INSERT membership (trusted context)
\echo '--- 4d: Audit entry on trusted INSERT (should SUCCEED, audit logged) ---'
BEGIN;
-- No JWT claims -> auth.uid() IS NULL -> trusted write
INSERT INTO store_memberships (store_id, profile_id, role, permissions)
VALUES ('2a12be88-07fe-430c-9771-319f25a02e3b', '8664df4f-b1ad-42e0-9b30-f06351fff8f6', 'staff', '{}');
SELECT count(*) AS audit_rows FROM store_membership_audit_log;
ROLLBACK;

-- Test 4e: Audit entry created on UPDATE membership (end_user context)
\echo '--- 4e: Audit entry on UPDATE by end_user (should SUCCEED, audit logged) ---'
BEGIN;
SET ROLE authenticated;
SET request.jwt.claim.sub = 'dd5caa6b-4487-4f85-b3bb-74998afcfe98';
SET request.jwt.claim.role = 'authenticated';
UPDATE store_memberships SET suspended_reason = 'test audit' WHERE id = 'f79fb7b6-4d79-4269-8270-17f6a153be20';
SELECT actor_id, actor_db_role, actor_jwt_role, actor_kind, operation, reason FROM store_membership_audit_log;
RESET ROLE;
ROLLBACK;

-- Test 4f: Audit actor_kind classification
\echo '--- 4f: Actor kind classification (end_user vs service_role vs system) ---'
BEGIN;
-- end_user: auth.uid() IS NOT NULL
SET ROLE authenticated;
SET request.jwt.claim.sub = 'dd5caa6b-4487-4f85-b3bb-74998afcfe98';
SET request.jwt.claim.role = 'authenticated';
UPDATE store_memberships SET suspended_reason = 'end_user test' WHERE id = 'f79fb7b6-4d79-4269-8270-17f6a153be20';
SELECT actor_kind AS kind_end_user FROM store_membership_audit_log ORDER BY created_at DESC LIMIT 1;
RESET ROLE;

-- service_role: auth.uid() IS NULL, auth.role() = 'service_role'
SET request.jwt.claim.sub = '';
SET request.jwt.claim.role = 'service_role';
UPDATE store_memberships SET suspended_reason = NULL WHERE id = 'f79fb7b6-4d79-4269-8270-17f6a153be20';
SELECT actor_kind AS kind_service_role FROM store_membership_audit_log ORDER BY created_at DESC LIMIT 1;
RESET ROLE;
ROLLBACK;

\echo '=== AUDIT LOG TESTS COMPLETE ==='
