-- KINDEE Migration 010 Security Verification - RLS Tests
-- Uses SET ROLE authenticated (non-superuser, RLS enforced)
-- All writes in BEGIN/ROLLBACK
\echo '=== TEST 3: ROW LEVEL SECURITY ==='

-- Helper: run as specific profile
\echo '--- 3a: Owner sees own membership in own store ---'
BEGIN;
SET ROLE authenticated;
SET request.jwt.claim.sub = 'dd5caa6b-4487-4f85-b3bb-74998afcfe98';
SET request.jwt.claim.role = 'authenticated';
SELECT count(*) AS visible_rows FROM store_memberships;
RESET ROLE;
ROLLBACK;

\echo '--- 3b: Owner sees only own store membership (cross-store blocked) ---'
BEGIN;
SET ROLE authenticated;
SET request.jwt.claim.sub = 'dd5caa6b-4487-4f85-b3bb-74998afcfe98';
SET request.jwt.claim.role = 'authenticated';
SELECT id, store_id, profile_id, role FROM store_memberships;
RESET ROLE;
ROLLBACK;

\echo '--- 3c: Outsider sees nothing ---'
BEGIN;
SET ROLE authenticated;
SET request.jwt.claim.sub = '8664df4f-b1ad-42e0-9b30-f06351fff8f6';
SET request.jwt.claim.role = 'authenticated';
SELECT count(*) AS visible_rows FROM store_memberships;
RESET ROLE;
ROLLBACK;

\echo '--- 3d: Staff with no membership sees nothing ---'
BEGIN;
SET ROLE authenticated;
SET request.jwt.claim.sub = 'd3a5833e-4684-4b53-97bc-9586e8b79a6a';
SET request.jwt.claim.role = 'authenticated';
SELECT count(*) AS visible_rows FROM store_memberships;
RESET ROLE;
ROLLBACK;

\echo '--- 3e: Owner cannot UPDATE other store membership (IDOR) ---'
BEGIN;
SET ROLE authenticated;
SET request.jwt.claim.sub = 'dd5caa6b-4487-4f85-b3bb-74998afcfe98';
SET request.jwt.claim.role = 'authenticated';
UPDATE store_memberships SET suspended_at = NOW() WHERE id = '08299c3f-62c6-4581-9cad-679440500fb8';
RESET ROLE;
ROLLBACK;

\echo '--- 3f: Owner cannot DELETE other store membership (IDOR) ---'
BEGIN;
SET ROLE authenticated;
SET request.jwt.claim.sub = 'dd5caa6b-4487-4f85-b3bb-74998afcfe98';
SET request.jwt.claim.role = 'authenticated';
DELETE FROM store_memberships WHERE id = '08299c3f-62c6-4581-9cad-679440500fb8';
RESET ROLE;
ROLLBACK;

\echo '--- 3g: Staff INSERT own membership (should succeed - RLS allows via owner check? No, staff is not owner) ---'
BEGIN;
SET ROLE authenticated;
SET request.jwt.claim.sub = 'd3a5833e-4684-4b53-97bc-9586e8b79a6a';
SET request.jwt.claim.role = 'authenticated';
INSERT INTO store_memberships (store_id, profile_id, role, permissions)
VALUES ('2a12be88-07fe-430c-9771-319f25a02e3b', 'd3a5833e-4684-4b53-97bc-9586e8b79a6a', 'staff', '{}');
RESET ROLE;
ROLLBACK;

\echo '=== RLS TESTS COMPLETE ==='
