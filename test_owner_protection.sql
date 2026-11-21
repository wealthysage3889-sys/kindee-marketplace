-- KINDEE Migration 010 Security Verification - Test Script
-- All write operations are wrapped in BEGIN/ROLLBACK to avoid data changes
-- Run with: psql -h localhost -p 55432 -U postgres -d kindee -f test_owner_protection.sql

\echo '=== TEST 1: OWNER PROTECTION ==='

-- Test 1a: Owner tries to DELETE their own sole owner membership -> should FAIL
\echo '--- 1a: Delete sole owner (should FAIL with P0001) ---'
BEGIN;
SET request.jwt.claim.sub = 'dd5caa6b-4487-4f85-b3bb-74998afcfe98';
SET request.jwt.claim.role = 'authenticated';
DELETE FROM store_memberships WHERE id = '08299c3f-62c6-4581-9cad-679440500fb8';
ROLLBACK;

-- Test 1b: Owner tries to demote self from owner to staff -> should FAIL
\echo '--- 1b: Demote sole owner to staff (should FAIL with P0001) ---'
BEGIN;
SET request.jwt.claim.sub = 'dd5caa6b-4487-4f85-b3bb-74998afcfe98';
SET request.jwt.claim.role = 'authenticated';
UPDATE store_memberships SET role = 'staff' WHERE id = '08299c3f-62c6-4581-9cad-679440500fb8';
ROLLBACK;

-- Test 1c: Owner tries to suspend self -> should FAIL
\echo '--- 1c: Suspend sole owner (should FAIL with P0001) ---'
BEGIN;
SET request.jwt.claim.sub = 'dd5caa6b-4487-4f85-b3bb-74998afcfe98';
SET request.jwt.claim.role = 'authenticated';
UPDATE store_memberships SET suspended_at = NOW() WHERE id = '08299c3f-62c6-4581-9cad-679440500fb8';
ROLLBACK;

-- Test 1d: Delete NON-sole owner (if there were another owner) -> should SUCCEED
-- Currently both stores have only one owner, so we test with a different scenario:
-- Owner of store 1 tries to delete membership in store 2 (cross-store) -> should FAIL (RLS)
\echo '--- 1d: Cross-store delete by owner (should FAIL - RLS) ---'
BEGIN;
SET request.jwt.claim.sub = 'dd5caa6b-4487-4f85-b3bb-74998afcfe98';
SET request.jwt.claim.role = 'authenticated';
DELETE FROM store_memberships WHERE id = 'f79fb7b6-4d79-4269-8270-17f6a153be20';
ROLLBACK;

\echo '=== OWNER PROTECTION TESTS COMPLETE ==='
