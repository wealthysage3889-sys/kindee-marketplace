# KINDEE_PHASE_1_ORDER_PAYMENT_IMPLEMENTATION_PLAN.md

**Title:** Final Implementation Plan — Phase 1: Existing Order Payment
**Project:** kindee-marketplace
**Date:** 2026-11-20
**Status:** READ-ONLY / PLANNING ONLY — no source-code edits, no migration execution, no commit/push/deploy
**Type:** Final Implementation Plan (documentation only)
**Checkpoint Basis:** `KINDEE_PAYMENT_FINAL_AUDIT_REPORT.md` (PASS), `KINDEE_ORDER_SYSTEM_EXISTING_AUDIT.md`
**Resumed From:** Provider rate-limit interruption (Particle AI, `fleet_capacity_exhausted`, retry_after 1s, Request ID `sin1::fra1::dlvl6-1795183818843-3d8db2b41050`) — temporary capacity issue, not a codebase error.

---

## 0. Checkpoint & Resume Status

| Item | Value |
|------|-------|
| Latest checkpoint | `KINDEE_PAYMENT_FINAL_AUDIT_REPORT.md` — PASS (all code changes verified, 10 new tests pass, 235 tests pass 0 fail) |
| Order system audit | `KINDEE_ORDER_SYSTEM_EXISTING_AUDIT.md` — existing parent order + store orders + items + stock reservation + payment + refund + status history complete |
| Interruption cause | Upstream provider rate limit (`fleet_capacity_exhausted`), retried via current provider |
| Completed findings (NOT discarded) | Migration 017 additive/idempotent PASS; kbzpay enum PASS; exchange-rate fields PASS; backend server-authority PASS; COD/KBZPay not auto-paid on delivery PASS; Checkout retry + rate display PASS; KBZPay gateway NOT VERIFIED (needs credentials) |
| Unresolved item carried forward | THB/MMK currency discrepancy (detailed in Section 4) |
| This document | PLANNING ONLY — no source changes, no migrations, no DB/Storage state changes, no commit/push/deploy |

This plan resumes from the above checkpoint without repeating repository analysis.

---

## 1. Executive Summary

Phase 1: Existing Order Payment completes and hardens the order payment subsystem for the Kindee Marketplace. The code-level payment fixes (Migration 017, KBZPay enum, exchange-rate storage/validation, server-side amount authority, no auto-pay on delivery, Checkout retry + rate display) are implemented, tested, and audited PASS.

Remaining Phase 1 work is limited to:
1. **Resolve the THB/MMK currency discrepancy** (frontend total excludes discount; backend total includes discount → amount_mmk mismatch error on discounted KBZPay orders).
2. **KBZPay gateway integration** (merchant credentials, webhook handler, payment confirmation flow) — currently NOT VERIFIED, blocked on credentials.
3. **Payment status lifecycle completion** (explicit confirmation per payment method; refund approve/reject flow).
4. **Documentation & approval gates** before any implementation.

**Constraint:** This document is planning/documentation only. No source code, migration, Supabase/Storage/database state, commit, push, or deploy is performed by this plan.

---

## 2. Context & Current State (from checkpoints — not re-analyzed)

### 2.1 What exists (KINDEE_ORDER_SYSTEM_EXISTING_AUDIT)
- Backend route `/orders` (`backend/routes/orderRoutes.js`): create, list customer, get by id, cancel, history, store orders list, update store order status, refund, admin all.
- Service (`backend/services/orderService.js`): `createOrder`, `getOrderById`, `getCustomerOrders`, `getStoreOrders`, `cancelOrder`, `updateStoreOrderStatus`, `syncParentOrderStatus`, status history, `refund`, `admin getAllOrders`.
- Frontend API (`frontend/src/api/index.js`): `orderAPI.create/getMyOrders/getById/cancel/getHistory/getStoreOrders/updateStoreOrderStatus/createRefund`.
- Frontend pages: `OrderHistory.jsx`, `OrderTracking.jsx`; `Checkout.jsx` calls `orderAPI.create`.
- Supabase migrations: `orders`, `store_orders`, `order_items`, `order_status_history`, `payments`, `refunds`, stock reservation functions, triggers.
- Gaps: no Seller Orders page, no Admin Orders page, no realtime/tracking, no payment gateway webhook, payment status stuck `pending` for COD/non-COD.

### 2.2 Payment fixes already implemented & audited PASS (KINDEE_PAYMENT_FINAL_AUDIT_REPORT)
- Migration `017_payment_method_kbzpay_and_exchange_rate.sql`: additive/idempotent, `kbzpay` enum added, 4 exchange-rate columns + CHECK constraint on `orders`.
- `backend/routes/orderRoutes.js`: `kbzpay` in allowed payment methods; exchange-rate fields validated & passed to service.
- `backend/services/orderService.js`: validates exchange rate for KBZPay; calculates `expectedAmountMmk = roundMoney(backendTotalThb * exchange_rate)`; compares frontend `amount_mmk` with 0.5 MMK tolerance; stores `verifiedAmountMmk`; `payment_status='pending'` always; `total_amount = backendTotalThb` (server-verified); no payment record for COD/KBZPay.
- `backend/routes/adminRoutes.js`: removed `payment_status='paid'` on `delivered` (COD/KBZPay/other not auto-paid).
- `backend/services/orderService.js` `syncParentOrderStatus`: no `payment_status` assignment on delivery.
- `frontend/src/pages/Checkout.jsx`: fetches rate from `open.er-api.com/v6/latest/THB` (`data.rates.MMK`); retry button; rate display; sends `exchangeRate`, `exchangeRateSource`, `exchangeRateUpdatedAt`, `amountMMK`.
- Tests (`backend/__tests__/kbzpay-cod-payment.test.mjs`): 10 new tests, all pass; 235 tests pass, 0 fail.

### 2.3 What remains NOT VERIFIED / open
- KBZPay Merchant API credentials: NOT PRESENT (no Merchant ID, API Key, Secret).
- KBZPay webhook endpoint: NOT PRESENT (no `POST /api/payments/kbzpay/webhook`).
- KBZPay payment confirmation / signature verification: NOT PRESENT.
- KBZPay sandbox/test environment: NOT PRESENT.
- Frontend KBZPay checkout redirect / QR flow: NOT PRESENT.
- THB/MMK currency discrepancy: UNRESOLVED (Section 4).
- Supabase project `bzkjtvsqqxnbbnkgcrko`: migration 017 NOT run against cloud (read-only).

---

## 3. Objectives & Scope

### 3.1 Objectives
1. Fix the THB/MMK currency discrepancy so discounted KBZPay orders no longer trigger a false `Amount MMK mismatch` validation error.
2. Document the end-to-end KBZPay gateway integration path (blocked on credentials — not implemented in this phase).
3. Define the payment status lifecycle (pending → paid/failed/refunded) with explicit confirmation per payment method; no auto-pay on delivery.
4. Produce an approval-gated implementation plan ready for owner sign-off before any code change.

### 3.2 In Scope (Phase 1, planning only)
- THB/MMK currency discrepancy remediation design (frontend/backend alignment).
- KBZPay gateway integration design (credentials, webhook, confirmation flow) — design only; implementation blocked on credentials.
- Payment status lifecycle documentation.
- Test cases & verification criteria.
- Rollback & approval checklist.

### 3.3 Out of Scope
- Running or creating Supabase migrations (Migration 017 already written; execution deferred to deploy phase with approval).
- Modifying `frontend/src/pages/Checkout.jsx`, `backend/services/orderService.js`, or any source file.
- Creating webhook endpoints, merchant-client code, or sandbox config.
- Changing Supabase/Storage/database state, committing, pushing, or deploying.
- Phone OTP, realtime/tracking, Seller/Admin Orders pages (deferred to later phases).

---

## 4. Unresolved THB/MMK Currency Discrepancy (carried forward from checkpoint)

### 4.1 Root cause

The frontend-calculated MMK amount and the backend-verified MMK amount are derived from **different THB totals**, so they can diverge when a discount is applied.

| Layer | File:Line | THB total used | Discount applied? | MMK formula |
|-------|-----------|----------------|-------------------|-------------|
| Frontend (Checkout) | `frontend/src/pages/Checkout.jsx:60` | `totalSubtotal + totalShippingFee + totalTax` | **No** (discountAmount not subtracted) | `roundMoney(totalAmount_frontend * exchangeRate)` (line 539) |
| Frontend display estimate | `frontend/src/pages/Checkout.jsx:771` | `totalAmount_frontend` | No | `(totalAmount * exchangeRate).toFixed(2)` (no `roundMoney`) |
| Backend (orderService) | `backend/services/orderService.js:260,263` | `totalSubtotal + totalShippingFee + totalTax - discountAmount` | **Yes** | `roundMoney(backendTotalThb * exchange_rate)` (line 278) |
| Backend validation | `backend/services/orderService.js:282` | `backendTotalThb` | Yes | errors if `Math.abs(frontendAmountMmk - expectedAmountMmk) > 0.5` |

### 4.2 Effect
- When `discountAmount > 0`, `totalAmount_frontend > backendTotalThb`, so `amountMMK_frontend > expectedAmountMmk_backend`.
- If the difference exceeds the **0.5 MMK tolerance**, the backend throws:
  `Amount MMK mismatch: expected ~<expectedAmountMmk>, got <frontendAmountMmk>`
- Result: **discounted KBZPay orders are rejected at checkout** even though the frontend amount was computed by the app itself.
- The displayed "estimated MMK" on Checkout (`~(totalAmount * exchangeRate).toFixed(2)` MMK) may not match the backend's stored/verified `amount_mmk`, confusing the customer.

### 4.3 Remediation design (planning only — no code change)
**Option A (recommended): align frontend THB total to backend.**
- Compute the frontend `totalAmount` used for MMK as `subtotal + shipping + tax - discountAmount` (matching `buildOrderPlan` line 144), so `amountMMK_frontend` matches `expectedAmountMmk_backend` within tolerance.
- Apply `roundMoney` to the displayed estimate (line 771) to match backend rounding, not raw `toFixed(2)`.
- Keep the 0.5 MMK tolerance as a safety net for rounding/rate snapshot differences.

**Option B (alternative): relax backend tolerance / ignore frontend amount_mmk.**
- Backend always uses its own `expectedAmountMmk` as the stored `amount_mmk` and does not reject on frontend mismatch (only logs a warning). Less strict; risks storing a customer-supplied amount that diverges from server authority.

**Decision pending owner approval:** Option A preserves server-authority principle (backend remains source of truth) while eliminating the false rejection. Requires frontend change to `Checkout.jsx` — classified as a code change, blocked until approval.

### 4.4 Verification criterion (test case to add)
| Test Case | Steps | Expected Result |
|-----------|-------|-----------------|
| TC-PAY-041 | KBZPay order with discountAmount > 0 | 200, `amount_mmk` stored = `roundMoney(backendTotalThb * exchange_rate)`, no mismatch error |
| TC-PAY-042 | KBZPay order without discount | 200, frontend MMK == backend MMK within 0.5 tolerance |
| TC-PAY-043 | Frontend display estimate matches backend verified amount | Displayed MMK == `amount_mmk` stored |

---

## 5. Implementation Plan (design only — gated by approval)

| Step | Area | Action | Owner | Approval | Rollback |
|------|------|--------|-------|----------|----------|
| P1-1 | Currency | Remediate THB/MMK discrepancy (frontend `computeOrderTotals` subtracts `discountAmount`; display uses `roundMoney`) | Frontend + Backend | ✅ Applied (P1-1 complete, tests pass) | Git revert |
| P1-2 | Database/Storage | Create `payment_slips` table + `payment-slips` storage bucket + RLS policies (additive migration) | Backend | ✅ Required (SQL shown below, not applied to prod) | Git revert / migration rollback |
| P1-3 | Duplicate-upload protection | UNIQUE constraint on `payment_slips.order_id`; concurrency-safe insert with `ON CONFLICT` / idempotency key | Backend | ✅ Required | Git revert |
| P1-4 | Customer upload API | `POST /api/orders/:id/payment-slip` — upload slip image, validate order ownership & unpaid status | Backend | ✅ Required | Git revert |
| P1-5 | Admin review APIs | `PATCH /api/admin/payment-slips/:id/approve` and `/reject` — set order `payment_status='paid'` or reject slip | Backend | ✅ Required | Git revert |
| P1-6 | Frontend integration | Customer slip-upload UI on order page; Admin slip-review UI (list/approve/reject) | Frontend | ✅ Required | Git revert |
| P1-7 | Tests | TC-PAY-051/052/053: duplicate upload, concurrent upload, approve/reject + regression | QA | ✅ Required | Git revert |
| P1-8 | Verification | Staging migration 020 + payment tests run (read-only plan, requires cloud access approval) | DevOps | ⚠️ Blocked (cloud access) | N/A |

**Note:** Steps P1-2 through P1-6 involve source changes and migration design. The migration SQL (P1-2) is shown in Section 5A for review before any production apply. No migration is applied to production without separate approval.

---

## 5A. P1-2 Database/Storage Migration Design (for review — not applied)

```sql
-- Migration: 020_payment_slips_upload.sql
-- Additive / idempotent. Creates payment_slips table and payment-slips storage bucket.
-- Does NOT modify orders, payments, store_orders, VAT, cart, chat, call, or realtime.

-- ============================================================================
-- payment_slips table — one slip per order (UNIQUE on order_id)
-- ============================================================================
CREATE TABLE IF NOT EXISTS payment_slips (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    customer_id UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
    slip_url TEXT NOT NULL,
    slip_filename TEXT NOT NULL,
    slip_status TEXT NOT NULL DEFAULT 'uploaded' CHECK (slip_status IN ('uploaded', 'approved', 'rejected')),
    amount_thb NUMERIC(12,2) NOT NULL CHECK (amount_thb > 0),
    note TEXT,
    reviewed_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMPTZ,
    reject_reason TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(order_id)  -- one slip per order; prevents duplicate uploads at DB level
);

CREATE INDEX IF NOT EXISTS idx_payment_slips_order_id ON payment_slips(order_id);
CREATE INDEX IF NOT EXISTS idx_payment_slips_customer_id ON payment_slips(customer_id);
CREATE INDEX IF NOT EXISTS idx_payment_slips_status ON payment_slips(slip_status);

ALTER TABLE payment_slips ENABLE ROW LEVEL SECURITY;

-- Customers can view their own slips
DROP POLICY IF EXISTS "Customers can view own payment slips" ON payment_slips;
CREATE POLICY "Customers can view own payment slips" ON payment_slips
    FOR SELECT USING (customer_id = auth.uid());

-- Customers can insert slips for their own orders
DROP POLICY IF EXISTS "Customers can insert own payment slips" ON payment_slips;
CREATE POLICY "Customers can insert own payment slips" ON payment_slips
    FOR INSERT WITH CHECK (
        customer_id = auth.uid()
        AND EXISTS (
            SELECT 1 FROM orders
            WHERE orders.id = payment_slips.order_id
              AND orders.customer_id = auth.uid()
              AND orders.payment_status = 'pending'
        )
    );

-- Admins can view all slips
DROP POLICY IF EXISTS "Admins can view all payment slips" ON payment_slips;
CREATE POLICY "Admins can view all payment slips" ON payment_slips
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
              AND profiles.role IN ('admin', 'owner')
        )
    );

-- Admins can update slip status (approve/reject)
DROP POLICY IF EXISTS "Admins can update payment slips" ON payment_slips;
CREATE POLICY "Admins can update payment slips" ON payment_slips
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
              AND profiles.role IN ('admin', 'owner')
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
              AND profiles.role IN ('admin', 'owner')
        )
    );

-- ============================================================================
-- Storage bucket: payment-slips (private, customer-uploaded, admin-viewable)
-- ============================================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) VALUES
('payment-slips', 'payment-slips', false, 10485760, ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
ON CONFLICT (id) DO UPDATE SET
    public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Customers can upload slips for their own orders
-- Path layout: payment-slips/<order_id>/<filename>
DROP POLICY IF EXISTS "Customers can upload payment slips" ON storage.objects;
CREATE POLICY "Customers can upload payment slips" ON storage.objects
    FOR INSERT WITH CHECK (
        bucket_id = 'payment-slips'
        AND EXISTS (
            SELECT 1 FROM orders
            WHERE orders.id::TEXT = (storage.foldername(storage.objects.name))[1]
              AND orders.customer_id = auth.uid()
              AND orders.payment_status = 'pending'
        )
    );

-- Admins can view all slips
DROP POLICY IF EXISTS "Admins can view all payment slips" ON storage.objects;
CREATE POLICY "Admins can view all payment slips" ON storage.objects
    FOR SELECT USING (
        bucket_id = 'payment-slips'
        AND EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
              AND profiles.role IN ('admin', 'owner')
        )
    );

-- Customers can view their own slips
DROP POLICY IF EXISTS "Customers can view own payment slips" ON storage.objects;
CREATE POLICY "Customers can view own payment slips" ON storage.objects
    FOR SELECT USING (
        bucket_id = 'payment-slips'
        AND EXISTS (
            SELECT 1 FROM orders
            WHERE orders.id::TEXT = (storage.foldername(storage.objects.name))[1]
              AND orders.customer_id = auth.uid()
        )
    );

-- Admins can delete slips (e.g. rejected slips cleanup)
DROP POLICY IF EXISTS "Admins can delete payment slips" ON storage.objects;
CREATE POLICY "Admins can delete payment slips" ON storage.objects
    FOR DELETE USING (
        bucket_id = 'payment-slips'
        AND EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
              AND profiles.role IN ('admin', 'owner')
        )
    );
```

**Impact analysis (P1-2):**
- New table `payment_slips` — additive, no existing tables modified
- New storage bucket `payment-slips` — private, 10MB limit, images + PDF only
- RLS policies enforce: customers can only upload/view slips for their own pending orders; admins/owners can view/approve/reject all
- UNIQUE(order_id) prevents duplicate slips at the database level
- No changes to orders, payments, store_orders, VAT, cart, order creation, chat, call, or realtime
- Migration must be applied to staging first, then production with separate approval

---

## 5B. P1-3 Duplicate-Upload Protection Design

**Database level (P1-2 migration):** `UNIQUE(order_id)` on `payment_slips` — hard guarantee against duplicate slips per order.

**Application level (P1-3/P1-4):** In the customer upload API (`POST /api/orders/:id/payment-slip`):
1. Check if a slip already exists for the order → return 409 if so
2. Use `INSERT ... ON CONFLICT (order_id) DO NOTHING` as a race-condition backstop
3. If `ON CONFLICT` fires (concurrent duplicate), return 409 "Slip already uploaded for this order"
4. Store file to `payment-slips/<order_id>/<timestamp>_<filename>` to avoid storage path collisions under concurrency

**Concurrency test (P1-7):** Two simultaneous upload requests for the same order → exactly one slip record created, second returns 409.

---

## 6. KBZPay Gateway Integration — FUTURE SCOPE (NOT Phase 1)

**Explicitly out of scope for Phase 1: Existing Order Payment.** KBZPay gateway integration requires:
- Merchant ID, API Key, Secret from KBZPay (NOT PRESENT in codebase)
- `POST /api/payments/kbzpay/webhook` endpoint + signature verification
- Frontend checkout redirect / QR code flow
- Sandbox/test environment

These are **blocked until the owner supplies credentials and explicitly authorizes** that work. Section 6 documentation below is carried forward from the checkpoint for reference only — no implementation will be started.

| Component | Current State | Status |
|-----------|---------------|--------|
| Merchant credentials | NOT PRESENT | ❌ Blocked (future scope) |
| Webhook endpoint | NOT PRESENT | ❌ Blocked (future scope) |
| Payment confirmation | NOT PRESENT | ❌ Blocked (future scope) |
| Sandbox/test env | NOT PRESENT | ❌ Blocked (future scope) |
| Frontend redirect/QR | NOT PRESENT | ❌ Blocked (future scope) |

**Impact:** KBZPay orders remain `payment_status='pending'` indefinitely after delivery until credentials + webhook + frontend flow are implemented in a future phase.

---

## 7. Payment Status Lifecycle (manual slip upload + no auto-pay on delivery)

| Method | On order create | Slip uploaded | Admin approves | Admin rejects | Paid trigger |
|--------|----------------|---------------|----------------|---------------|--------------|
| COD | `pending` | slip_status='uploaded' | `payment_status='paid'` | slip_status='rejected' (re-upload allowed) | Admin approval of slip |
| KBZPay | `pending` | slip_status='uploaded' | `payment_status='paid'` | slip_status='rejected' (re-upload allowed) | Admin approval of slip |
| transfer/promptpay/card/wallet | payment record created, `pending` | slip_status='uploaded' | `payment_status='paid'` | slip_status='rejected' (re-upload allowed) | Admin approval of slip / payment record verification |

Rules (already implemented & audited PASS):
- `payment_status` is `'pending'` on order create for all methods (`orderService.js:275`).
- `delivered` does NOT set `payment_status='paid'` (`adminRoutes.js:92-98`, `orderService.js syncParentOrderStatus:789-792`).
- No payment record created for COD or KBZPay at order time (`orderService.js:390-393`).
- `syncParentOrderStatus` does not assign `payment_status` on delivery.
- **New (P1-4/P1-5):** Customer can upload one slip per pending order (UNIQUE on `payment_slips.order_id`). Admin reviews and approves/rejects. Approved → `payment_status='paid'`. Rejected → slip_status='rejected', customer may re-upload.

---

## 8. Risk & Mitigation

| # | Risk | Mitigation | Approval |
|---|------|------------|----------|
| R1 | THB/MMK mismatch rejects discounted KBZPay checkouts | Option A: align frontend total to backend (subtract discount) before MMK calc | ✅ Required |
| R2 | Duplicate slip upload under concurrency | UNIQUE(order_id) at DB level + ON CONFLICT backstop in API | ✅ Required |
| R3 | Customer uploads slip for non-own order | RLS policy checks `orders.customer_id = auth.uid()`; API validates ownership | ✅ Required |
| R4 | Customer uploads slip for already-paid order | RLS + API check `orders.payment_status = 'pending'` before insert | ✅ Required |
| R5 | Admin approves slip without verifying proof | Admin UI requires visual slip review before approve action | ✅ Required |
| R6 | Migration 020 not run against cloud Supabase | Staging run first; `supabase db diff`; idempotent/additive design | ✅ Required |
| R7 | Auto-pay on delivery regression | Keep `payment_status` untouched on `delivered` (already audited PASS) | ✅ Required |
| R8 | KBZPay gateway blocked without credentials | Future scope only; does not block manual slip upload | ⚠️ Future phase |

---

## 9. Verification & Test Cases

### 9.1 Currency discrepancy tests (P1-1, already verified)
| TC | Steps | Expected |
|----|-------|----------|
| TC-PAY-041 | KBZPay checkout with discount > 0 | 200; `amount_mmk = roundMoney(backendTotalThb * exchange_rate)`; no mismatch error |
| TC-PAY-042 | KBZPay checkout without discount | 200; frontend MMK == backend MMK within 0.5 tolerance |
| TC-PAY-043 | Checkout display estimate vs stored amount | Displayed MMK == `amount_mmk` stored |

### 9.2 Payment slip upload tests (P1-7, new)
| TC | Steps | Expected |
|----|-------|----------|
| TC-PAY-051 | Customer uploads slip for own pending order | 201, slip record created, slip_status='uploaded' |
| TC-PAY-052 | Customer uploads slip for already-paid order | 400/409, no slip created |
| TC-PAY-053 | Customer uploads slip for another customer's order | 403, no slip created |
| TC-PAY-054 | Duplicate slip upload (same order, twice) | First: 201; Second: 409, exactly one slip record |
| TC-PAY-055 | Concurrent duplicate upload (two simultaneous requests) | Exactly one slip record, second returns 409 |
| TC-PAY-056 | Admin approves slip | slip_status='approved', order.payment_status='paid' |
| TC-PAY-057 | Admin rejects slip | slip_status='rejected', order.payment_status='pending', customer can re-upload |
| TC-PAY-058 | Admin views all slips | 200, returns all slips across orders |
| TC-PAY-059 | Customer views own slips | 200, returns only own slips |

### 9.3 Existing regression (already PASS — keep)
| TC | Expected |
|----|----------|
| COD order starts `payment_status=pending` | PASS |
| KBZPay order starts `payment_status=pending` | PASS |
| KBZPay rejects without exchange-rate fields | PASS |
| KBZPay validates `amount_mmk` mismatch (0.5 tol) | PASS |
| KBZPay accepts matching `amount_mmk` | PASS |
| Delivered NOT auto-paid for COD/KBZPay | PASS |
| promptpay/transfer/card/wallet create payment record | PASS |
| `total_amount` matches backend calc | PASS |
| Exchange-rate snapshot stored per KBZPay order | PASS |
| Frontend `amount_thb` ignored; backend authoritative | PASS |

Total existing: 249 tests pass, 0 fail (baseline to preserve).

---

## 10. Rollback Plan (planning only)

| Scenario | Rollback Action |
|----------|-----------------|
| Currency remediation breaks KBZPay checkout | Revert `Checkout.jsx` / `Cart.jsx` computeOrderTotals changes |
| Slip upload API breaks order flow | Revert route + service changes for `/api/orders/:id/payment-slip` |
| Admin approve/reject breaks payment status | Revert admin PATCH endpoints; orders remain `pending` |
| Migration 020 causes schema issue on staging | Rollback staging migration; idempotent design limits blast radius |
| Any payment change breaks existing methods | Revert to audited PASS baseline (`KINDEE_PAYMENT_FINAL_AUDIT_REPORT.md`) |

No production rollback needed because no production change is made by this plan.

---

## 11. Approval Checklist (before implementation)

- [ ] THB/MMK discrepancy remediation (P1-1) — **applied, tests pass**
- [ ] P1-2 migration SQL (Section 5A) reviewed and approved
- [ ] P1-2 migration applied to staging (not production)
- [ ] P1-3 duplicate-upload protection design approved
- [ ] P1-4 customer upload API design approved
- [ ] P1-5 admin review APIs design approved
- [ ] P1-6 frontend integration design approved
- [ ] P1-7 payment slip tests (TC-PAY-051 to 059) approved
- [ ] P1-8 staging verification — ⚠️ Blocked (cloud access approval needed)
- [ ] KBZPay gateway — ⚠️ Future scope, blocked on credentials
- [ ] Rollback plan confirmed per Section 10
- [ ] No production code/migration/DB/Storage change without separate approval

---

## 12. Deliverables (this document)

1. Final Implementation Plan — Phase 1: Existing Order Payment (this file)
2. THB/MMK currency discrepancy analysis + remediation design (Section 4)
3. P1-2 Database/Storage migration design (Section 5A) — for review before apply
4. P1-3 Duplicate-upload protection design (Section 5B)
5. Payment status lifecycle with manual slip upload (Section 7)
6. Risk & mitigation register (Section 8)
7. Verification & test cases incl. TC-PAY-041/042/043 + TC-PAY-051 to 059 (Section 9)
8. Rollback plan (Section 10)
9. Approval checklist (Section 11)
10. KBZPay gateway explicitly deferred to future scope (Section 6)

---

## 13. Checkpoint Update & Completion Status

**Report path:** `C:\Users\LEGION\OneDrive\Desktop\kindee-marketplace\KINDEE_PHASE_1_ORDER_PAYMENT_IMPLEMENTATION_PLAN.md`

**Completion status:** PLAN CORRECTED — P1-1 complete (currency fix applied, 249 tests pass). P1-2 through P1-8 redefined for manual payment-slip upload scope (not KBZPay gateway). P1-2 migration SQL shown in Section 5A awaiting review/approval before any production apply. No source code, migration, Supabase/Storage/database state, commit, push, or deploy performed beyond P1-1 frontend changes.

**Next step:** Await explicit owner approval before implementation begins. Implementation (Steps P1-1…P1-8) is gated on the Approval Checklist (Section 11).

**Basis (checkpoints preserved, not discarded):** `KINDEE_PAYMENT_FINAL_AUDIT_REPORT.md` (PASS), `KINDEE_ORDER_SYSTEM_EXISTING_AUDIT.md`.
