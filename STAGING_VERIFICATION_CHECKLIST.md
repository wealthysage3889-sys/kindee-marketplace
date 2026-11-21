# Migration 020 Staging Verification Checklist

**Migration:** `020_payment_slips_upload.sql`
**Environment:** Staging (Supabase Staging Project) — **NOT VERIFIED as non-Production**
**Date:** 2026-11-20
**Executor:** _______________
**Reviewer:** _______________

---

## Current Status: BLOCKED — Staging Environment Not Verified

**DO NOT EXECUTE THIS CHECKLIST** until the staging environment is confirmed as non-Production.

### Evidence Required from Owner to Confirm Staging Project
The owner must provide **one or more** of the following to confirm `bzkjtvsqqxnbbnkgcrko` is a non-Production (staging) environment:
1. **Supabase Dashboard screenshot** showing the project with an explicit "Staging" label or environment tag
2. **Supabase CLI output** from `supabase projects list` showing environment designation
3. **Organization/project naming convention evidence** (e.g., project name contains "staging", "dev", "test")
4. **Written confirmation** from the infrastructure owner that this ref is designated for staging
5. **Database connection string analysis** showing it points to a non-production cluster/region
6. **Supabase config.toml** with explicit `environment = "staging"` (if added)

**Do not connect to or modify any cloud project until this confirmation is received.**

---

## Pre-Verification Setup

- [ ] Staging Supabase project is accessible
- [ ] Staging database is at migration 019 (or earlier) — confirm with `SELECT * FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 5;`
- [ ] Test users exist: at least 1 customer, 1 admin/owner
- [ ] Test orders exist with `payment_status = 'pending'` for the customer user
- [ ] Supabase CLI or Dashboard access for running migration

---

## Phase 1: Migration Application

### 1.1 Apply Migration
- [ ] Run migration: `supabase db push --include-all` or apply `020_payment_slips_upload.sql` via Dashboard SQL Editor
- [ ] Verify no errors in migration output
- [ ] Confirm migration recorded in `supabase_migrations.schema_migrations`

### 1.2 Verify Table Creation
```sql
-- Run in Staging SQL Editor
SELECT table_name, column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'payment_slips'
ORDER BY ordinal_position;
```
- [ ] Table `payment_slips` exists with all 15 columns
- [ ] Column types match specification (UUID, TEXT, NUMERIC, TIMESTAMPTZ, etc.)
- [ ] `id` has default `uuid_generate_v4()`
- [ ] `slip_status` default = `'uploaded'`
- [ ] `created_at` / `updated_at` defaults = `NOW()`

### 1.3 Verify Constraints
```sql
SELECT conname, contype, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'payment_slips'::regclass;
```
- [ ] PRIMARY KEY on `id`
- [ ] FOREIGN KEY `order_id → orders(id) ON DELETE CASCADE`
- [ ] FOREIGN KEY `customer_id → profiles(id) ON DELETE RESTRICT`
- [ ] FOREIGN KEY `reviewed_by → profiles(id) ON DELETE SET NULL`
- [ ] UNIQUE on `order_id`
- [ ] CHECK `slip_status IN ('uploaded', 'approved', 'rejected')`
- [ ] CHECK `amount_thb > 0`

### 1.4 Verify Indexes
```sql
SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public' AND tablename = 'payment_slips';
```
- [ ] `idx_payment_slips_order_id` exists
- [ ] `idx_payment_slips_customer_id` exists
- [ ] `idx_payment_slips_status` exists
- [ ] Unique index on `order_id` (from UNIQUE constraint)

### 1.5 Verify RLS Enabled
```sql
SELECT relname, relrowsecurity
FROM pg_class
WHERE relname = 'payment_slips';
```
- [ ] `relrowsecurity = true`

### 1.6 Verify Table RLS Policies
```sql
SELECT policyname, cmd, qual, with_check
FROM pg_policies
WHERE tablename = 'payment_slips';
```
- [ ] "Customers can view own payment slips" — SELECT, `customer_id = auth.uid()`
- [ ] "Customers can insert own payment slips" — INSERT, checks order ownership + pending status
- [ ] "Admins can view all payment slips" — SELECT, role IN ('admin','owner')
- [ ] "Admins can update payment slips" — UPDATE, role IN ('admin','owner'), both USING and WITH CHECK

---

## Phase 2: Storage Bucket Verification

### 2.1 Verify Bucket Creation
```sql
SELECT id, name, public, file_size_limit, allowed_mime_types
FROM storage.buckets
WHERE id = 'payment-slips';
```
- [ ] Bucket `payment-slips` exists
- [ ] `public = false`
- [ ] `file_size_limit = 10485760` (10MB)
- [ ] `allowed_mime_types` = `['image/jpeg','image/png','image/webp','application/pdf']`

### 2.2 Verify Storage Policies
```sql
SELECT policyname, cmd, qual, with_check
FROM pg_policies
WHERE tablename = 'objects' AND policyname LIKE '%payment slip%';
```
- [ ] "Customers can upload payment slips" — INSERT, validates bucket + order ownership + pending status
- [ ] "Admins can view all payment slips" — SELECT, role IN ('admin','owner')
- [ ] "Customers can view own payment slips" — SELECT, validates bucket + order ownership
- [ ] "Admins can delete payment slips" — DELETE, role IN ('admin','owner')

---

## Phase 3: Functional Testing

### 3.1 Test Data Setup
- [ ] Create test customer user (note `auth.uid()`)
- [ ] Create test admin user (role = 'admin' or 'owner')
- [ ] Create test order for customer with `payment_status = 'pending'` (note `order_id`)
- [ ] Create test order for customer with `payment_status = 'paid'` (negative test)

### 3.2 Customer Upload — Happy Path
**As test customer (via Supabase Dashboard or client SDK):**

```sql
-- Simulate upload by inserting into payment_slips (bypassing storage for speed)
INSERT INTO payment_slips (order_id, customer_id, slip_url, slip_filename, amount_thb)
VALUES ('<pending_order_id>', '<customer_uid>', 'payment-slips/<pending_order_id>/test.jpg', 'test.jpg', 100.00);
```
- [ ] Insert succeeds
- [ ] Row created with `slip_status = 'uploaded'`
- [ ] `created_at` / `updated_at` populated

### 3.3 Customer Upload — Duplicate Prevention
```sql
-- Attempt second insert for same order_id
INSERT INTO payment_slips (order_id, customer_id, slip_url, slip_filename, amount_thb)
VALUES ('<pending_order_id>', '<customer_uid>', 'payment-slips/<pending_order_id>/test2.jpg', 'test2.jpg', 100.00);
```
- [ ] Insert fails with unique violation on `order_id`

### 3.4 Customer Upload — Wrong Order (Not Owned)
```sql
-- Use another customer's pending order_id
INSERT INTO payment_slips (order_id, customer_id, slip_url, slip_filename, amount_thb)
VALUES ('<other_customer_pending_order_id>', '<customer_uid>', '...', '...', 100.00);
```
- [ ] Insert fails (RLS policy blocks: order.customer_id != auth.uid())

### 3.5 Customer Upload — Non-Pending Order
```sql
-- Use own order with payment_status = 'paid'
INSERT INTO payment_slips (order_id, customer_id, slip_url, slip_filename, amount_thb)
VALUES ('<own_paid_order_id>', '<customer_uid>', '...', '...', 100.00);
```
- [ ] Insert fails (RLS policy blocks: order.payment_status != 'pending')

### 3.6 Customer View Own Slips
```sql
SELECT * FROM payment_slips WHERE customer_id = '<customer_uid>';
```
- [ ] Returns only customer's own slips
- [ ] Does NOT return other customers' slips

### 3.7 Admin View All Slips
**As test admin:**
```sql
SELECT * FROM payment_slips;
```
- [ ] Returns all slips (including other customers')

### 3.8 Admin Approve Slip
**As test admin:**
```sql
UPDATE payment_slips
SET slip_status = 'approved', reviewed_by = '<admin_uid>', reviewed_at = NOW()
WHERE id = '<slip_id>';
```
- [ ] Update succeeds
- [ ] `slip_status` = 'approved'
- [ ] `reviewed_by` = admin UID
- [ ] `reviewed_at` populated

### 3.9 Admin Reject Slip
**As test admin:**
```sql
UPDATE payment_slips
SET slip_status = 'rejected', reviewed_by = '<admin_uid>', reviewed_at = NOW(), reject_reason = 'Invalid amount'
WHERE id = '<slip_id>';
```
- [ ] Update succeeds
- [ ] `slip_status` = 'rejected'
- [ ] `reject_reason` populated

### 3.10 Customer Cannot Update Slip
**As test customer:**
```sql
UPDATE payment_slips SET slip_status = 'approved' WHERE id = '<slip_id>';
```
- [ ] Update fails (RLS: no UPDATE policy for customers)

### 3.11 Customer Cannot Delete Slip
**As test customer:**
```sql
DELETE FROM payment_slips WHERE id = '<slip_id>';
```
- [ ] Delete fails (no DELETE policy for customers)

### 3.12 Admin Can Delete Slip
**As test admin:**
```sql
DELETE FROM payment_slips WHERE id = '<slip_id>';
```
- [ ] Delete succeeds

---

## Phase 4: Storage Integration Testing

### 4.1 Customer Upload File to Storage
- [ ] Using Supabase Dashboard → Storage → `payment-slips` bucket
- [ ] Upload file as test customer to path: `payment-slips/<pending_order_id>/test-slip.jpg`
- [ ] Upload succeeds

### 4.2 Customer Cannot Upload to Other's Order Path
- [ ] Attempt upload to `payment-slips/<other_order_id>/test.jpg`
- [ ] Upload fails (policy validates order ownership via foldername)

### 4.3 Customer Cannot Upload to Non-Pending Order Path
- [ ] Attempt upload to `payment-slips/<paid_order_id>/test.jpg`
- [ ] Upload fails (policy validates payment_status = 'pending')

### 4.4 Customer View Own Uploaded File
- [ ] Download/view the file uploaded in 4.1
- [ ] Access succeeds

### 4.5 Admin View Any File
- [ ] As admin, view/download any file in `payment-slips` bucket
- [ ] Access succeeds

### 4.6 Admin Delete File
- [ ] As admin, delete a file from `payment-slips` bucket
- [ ] Delete succeeds

### 4.7 File Type Restriction
- [ ] Attempt upload `.exe` or `.txt` file
- [ ] Upload fails (bucket `allowed_mime_types` rejects)

### 4.8 File Size Limit
- [ ] Attempt upload >10MB file
- [ ] Upload fails (bucket `file_size_limit` rejects)

---

## Phase 5: Idempotency Verification

### 5.1 Re-run Migration
- [ ] Apply `020_payment_slips_upload.sql` a second time
- [ ] No errors
- [ ] Schema unchanged (verify table, indexes, policies, bucket still exist)

---

## Phase 6: Rollback Verification (Optional)

### 6.1 Safe Staged Rollback Procedure (Recommended)

**Phase 1 — Disable Access (Reversible):**
```sql
-- Revoke policies without dropping objects
DROP POLICY IF EXISTS "Customers can view own payment slips" ON payment_slips;
DROP POLICY IF EXISTS "Customers can insert own payment slips" ON payment_slips;
DROP POLICY IF EXISTS "Admins can view all payment slips" ON payment_slips;
DROP POLICY IF EXISTS "Admins can update payment slips" ON payment_slips;
DROP POLICY IF EXISTS "Customers can upload payment slips" ON storage.objects;
DROP POLICY IF EXISTS "Admins can view all payment slips" ON storage.objects;
DROP POLICY IF EXISTS "Customers can view own payment slips" ON storage.objects;
DROP POLICY IF EXISTS "Admins can delete payment slips" ON storage.objects;
```

**Phase 2 — Verify No Active Usage (Observation Period):**
- [ ] Monitor for 24-48 hours to confirm no application errors
- [ ] Check logs for any code paths still referencing `payment_slips` table or bucket

**Phase 3 — Destructive Cleanup (Irreversible — Only After Phase 2 Confirmation):**
```sql
DROP TABLE payment_slips CASCADE;
DELETE FROM storage.buckets WHERE id = 'payment-slips';
-- Storage policies already dropped in Phase 1
```
- [ ] Table dropped
- [ ] Bucket removed
- [ ] Storage policies removed
- [ ] No errors
- [ ] Existing tables (`orders`, `profiles`, `payments`, etc.) unaffected

---

## Phase 7: Performance Spot-Check

### 7.1 Query Plans
```sql
EXPLAIN ANALYZE SELECT * FROM payment_slips WHERE order_id = '<some_id>';
EXPLAIN ANALYZE SELECT * FROM payment_slips WHERE customer_id = '<some_uid>';
EXPLAIN ANALYZE SELECT * FROM payment_slips WHERE slip_status = 'pending';
```
- [ ] All queries use index scans (not sequential scans)

---

## Sign-off

| Phase | Status | Executor Initials | Reviewer Initials | Notes |
|-------|--------|-------------------|-------------------|-------|
| 1: Migration Apply | ☐ **NOT RUN** | | | |
| 2: Storage Bucket | ☐ **NOT RUN** | | | |
| 3: Functional (Table) | ☐ **NOT RUN** | | | |
| 4: Functional (Storage) | ☐ **NOT RUN** | | | |
| 5: Idempotency | ☐ **NOT RUN** | | | |
| 6: Rollback (Optional) | ☐ **NOT RUN** / ☐ SKIP | | | |
| 7: Performance | ☐ **NOT RUN** | | | |

**Overall Result:** ☐ PASS — Ready for Production Migration
**Overall Result:** ☐ FAIL — Blockers: _________________________________

**Executor Signature:** _______________  **Date:** _______________
**Reviewer Signature:** _______________  **Date:** _______________

---

## Blocker Tracking

| # | Description | Severity | Resolution | Verified |
|---|-------------|----------|------------|----------|
| 1 | Staging environment NOT VERIFIED as non-Production (project ref `bzkjtvsqqxnbbnkgcrko`) | **BLOCKER** | Requires owner confirmation | ☐ |
| 2 | | | | |
| 3 | | | | |

---

*Checklist Version 1.1 — Migration 020 — Updated with safety corrections*

## Production Application Status (2026-11-20)
- Migration 020 applied successfully to project bzkjtvsqqxnbbnkgcrko (REAL production).
- Verified: payment_slips table, UNIQUE(order_id), RLS enabled, 4 table policies, payment-slips bucket private (10MB, MIME restricted), 4 storage policies using [2] order ID path segment.

## Production Verification Results (2026-11-20)
- Production schema/RLS/storage: PASS (user-reported).
- Backend automated tests: PASS — 258/258.
- Frontend lint: NOT RUN (missing ESLint config, pre-existing).
- Frontend production build: PASS (Vite build succeeded).
- Authorization boundaries: STATIC REVIEW PASS.
- Orphaned storage files after rejected-slip replacement: KNOWN GAP.
- Overall Production readiness: PARTIAL PASS.

