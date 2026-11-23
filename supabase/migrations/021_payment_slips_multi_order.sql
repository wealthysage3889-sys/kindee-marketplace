-- Migration: 021_payment_slips_multi_order.sql
-- Additive / idempotent migration that builds on 020_payment_slips_upload.sql.
--
-- Goal: support ONE slip upload covering MULTIPLE orders from the SAME store
-- (customer pays several KBZPay orders to one shop in a single transfer), move
-- the order into an "awaiting review" payment state, and notify the store owner.
--
-- Does NOT modify orders totals, store_orders, payments, VAT, THB->MMK
-- conversion, cart/order creation, chat, voice calls, or realtime subsystems.
-- No existing row is deleted or rewritten; only new columns / policies are added.
--
-- payment_slips keeps one row per (order, store). 021 originally kept
-- UNIQUE(order_id); 022_payment_slips_store_scope.sql replaces that with
-- UNIQUE(order_id, store_id) (for store-scoped rows) so one parent order that
-- spans multiple stores can carry one slip per store. A single uploaded file
-- shared by several orders is represented by several payment_slips rows that
-- share the same `submission_id` and `slip_path`. This preserves the
-- duplicate-submit guard while modelling "one transfer, many orders".

-- ============================================================================
-- 1) payment_status: add 'awaiting_review' (รอตรวจสอบการชำระเงิน)
--    Postgres forbids using a freshly added enum value in the same transaction,
--    so this only declares the label. The new value is first written at runtime
--    by the API after this migration has committed.
-- ============================================================================
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t
        JOIN pg_enum e ON t.oid = e.enumtypid
        WHERE t.typname = 'payment_status'
          AND e.enumlabel = 'awaiting_review'
    ) THEN
        ALTER TYPE payment_status ADD VALUE IF NOT EXISTS 'awaiting_review';
    END IF;
END $$;

-- ============================================================================
-- 2) payment_slips: additive columns for multi-order submissions
-- ============================================================================
ALTER TABLE payment_slips
    ADD COLUMN IF NOT EXISTS store_id UUID REFERENCES stores(id) ON DELETE RESTRICT,
    ADD COLUMN IF NOT EXISTS submission_id UUID,
    ADD COLUMN IF NOT EXISTS slip_path TEXT,
    ADD COLUMN IF NOT EXISTS slip_mime TEXT,
    ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'MMK',
    ADD COLUMN IF NOT EXISTS amount NUMERIC(14,2);

-- submission_id groups the per-order rows created by one upload.
CREATE INDEX IF NOT EXISTS idx_payment_slips_submission_id ON payment_slips(submission_id);
CREATE INDEX IF NOT EXISTS idx_payment_slips_store_id ON payment_slips(store_id);

-- Backfill store_id from the order's store for any pre-existing rows so the
-- store-owner RLS policies below have a value to match on.
UPDATE payment_slips ps
SET store_id = so.store_id
FROM store_orders so
WHERE ps.store_id IS NULL
  AND so.parent_order_id = ps.order_id;

-- ============================================================================
-- 3) RLS policies for payment_slips (store-owner access via store ownership,
--    not via profiles.role). Platform admins keep full access.
-- ============================================================================
ALTER TABLE payment_slips ENABLE ROW LEVEL SECURITY;

-- Customers view their own slips (kept from 020).
DROP POLICY IF EXISTS "Customers can view own payment slips" ON payment_slips;
CREATE POLICY "Customers can view own payment slips" ON payment_slips
    FOR SELECT USING (customer_id = auth.uid());

-- Customers insert their own slip for a pending order (kept from 020).
DROP POLICY IF EXISTS "Customers can insert own payment slips" ON payment_slips;
CREATE POLICY "Customers can insert own payment slips" ON payment_slips
    FOR INSERT WITH CHECK (
        customer_id = auth.uid()
        AND EXISTS (
            SELECT 1 FROM orders o
            WHERE o.id = payment_slips.order_id
              AND o.customer_id = auth.uid()
              AND o.payment_status = 'pending'
        )
    );

-- Platform admins/owners can view all slips.
DROP POLICY IF EXISTS "Admins can view all payment slips" ON payment_slips;
CREATE POLICY "Admins can view all payment slips" ON payment_slips
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM profiles p
            WHERE p.id = auth.uid()
              AND p.role IN ('admin', 'owner')
        )
    );

-- Store owners/managers can view slips for orders of their own store.
-- Uses SECURITY DEFINER helpers from 010 so this policy never recurses into
-- store_memberships RLS, and never grants a store sight of another store's slips.
DROP POLICY IF EXISTS "Store owners can view store payment slips" ON payment_slips;
CREATE POLICY "Store owners can view store payment slips" ON payment_slips
    FOR SELECT USING (
        public.is_store_owner(payment_slips.store_id, auth.uid())
        OR public.is_active_store_member(payment_slips.store_id, auth.uid())
    );

-- Platform admins/owners can update slip status (approve/reject).
DROP POLICY IF EXISTS "Admins can update payment slips" ON payment_slips;
CREATE POLICY "Admins can update payment slips" ON payment_slips
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM profiles p
            WHERE p.id = auth.uid()
              AND p.role IN ('admin', 'owner')
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM profiles p
            WHERE p.id = auth.uid()
              AND p.role IN ('admin', 'owner')
        )
    );

-- Store owners/managers can update slips of their own store (manual review).
DROP POLICY IF EXISTS "Store owners can update store payment slips" ON payment_slips;
CREATE POLICY "Store owners can update store payment slips" ON payment_slips
    FOR UPDATE USING (
        public.is_store_owner(payment_slips.store_id, auth.uid())
        OR public.is_active_store_member(payment_slips.store_id, auth.uid())
    )
    WITH CHECK (
        public.is_store_owner(payment_slips.store_id, auth.uid())
        OR public.is_active_store_member(payment_slips.store_id, auth.uid())
    );

-- ============================================================================
-- 4) Storage bucket + policies (payment-slips, private — never public)
--    Re-assert the bucket exactly as 020 so a re-run is safe.
-- ============================================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) VALUES
('payment-slips', 'payment-slips', false, 10485760, ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
ON CONFLICT (id) DO UPDATE SET
    public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Customers upload to their own pending order folder: payment-slips/<order_id>/<file>
DROP POLICY IF EXISTS "Customers can upload payment slips" ON storage.objects;
CREATE POLICY "Customers can upload payment slips" ON storage.objects
    FOR INSERT WITH CHECK (
        bucket_id = 'payment-slips'
        AND EXISTS (
            SELECT 1 FROM orders o
            WHERE o.id::TEXT = (storage.foldername(storage.objects.name))[2]
              AND o.customer_id = auth.uid()
              AND o.payment_status = 'pending'
        )
    );

-- Customers read their own slips.
DROP POLICY IF EXISTS "Customers can view own payment slips" ON storage.objects;
CREATE POLICY "Customers can view own payment slips" ON storage.objects
    FOR SELECT USING (
        bucket_id = 'payment-slips'
        AND EXISTS (
            SELECT 1 FROM orders o
            WHERE o.id::TEXT = (storage.foldername(storage.objects.name))[2]
              AND o.customer_id = auth.uid()
        )
    );

-- Platform admins/owners can read all slips.
DROP POLICY IF EXISTS "Admins can view all payment slips" ON storage.objects;
CREATE POLICY "Admins can view all payment slips" ON storage.objects
    FOR SELECT USING (
        bucket_id = 'payment-slips'
        AND EXISTS (
            SELECT 1 FROM profiles p
            WHERE p.id = auth.uid()
              AND p.role IN ('admin', 'owner')
        )
    );

-- Store owners/managers can read slips whose order belongs to their store.
DROP POLICY IF EXISTS "Store owners can view store payment slips" ON storage.objects;
CREATE POLICY "Store owners can view store payment slips" ON storage.objects
    FOR SELECT USING (
        bucket_id = 'payment-slips'
        AND EXISTS (
            SELECT 1
            FROM orders o
            JOIN store_orders so ON so.parent_order_id = o.id
            WHERE o.id::TEXT = (storage.foldername(storage.objects.name))[2]
              AND (
                  public.is_store_owner(so.store_id, auth.uid())
                  OR public.is_active_store_member(so.store_id, auth.uid())
              )
        )
    );

-- Platform admins/owners can delete slips.
DROP POLICY IF EXISTS "Admins can delete payment slips" ON storage.objects;
CREATE POLICY "Admins can delete payment slips" ON storage.objects
    FOR DELETE USING (
        bucket_id = 'payment-slips'
        AND EXISTS (
            SELECT 1 FROM profiles p
            WHERE p.id = auth.uid()
              AND p.role IN ('admin', 'owner')
        )
    );