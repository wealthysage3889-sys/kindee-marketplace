-- Migration: 020_payment_slips_upload.sql
-- Additive / idempotent migration for manual payment-slip upload (Existing Order Payment).
-- Creates payment_slips table and payment-slips storage bucket.
-- Does NOT modify orders, payments, store_orders, VAT, cart, order creation,
-- chat, call, or realtime subsystems. No existing data is touched.
--
-- payment_slips: one slip per order (UNIQUE on order_id prevents duplicates).
-- storage bucket payment-slips: private, 10MB limit, images + PDF only.
-- RLS: customers upload/view own slips for pending orders; admins/owners manage all.

-- ============================================================================
-- payment_slips table
-- ============================================================================
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'payment_slips'
    ) THEN
        CREATE TABLE payment_slips (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
            customer_id UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
            slip_url TEXT NOT NULL,
            slip_filename TEXT NOT NULL,
            slip_status TEXT NOT NULL DEFAULT 'uploaded'
                CHECK (slip_status IN ('uploaded', 'approved', 'rejected')),
            amount_thb NUMERIC(12,2) NOT NULL CHECK (amount_thb > 0),
            note TEXT,
            reviewed_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
            reviewed_at TIMESTAMPTZ,
            reject_reason TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE(order_id)
        );
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public' AND indexname = 'idx_payment_slips_order_id'
    ) THEN
        CREATE INDEX idx_payment_slips_order_id ON payment_slips(order_id);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public' AND indexname = 'idx_payment_slips_customer_id'
    ) THEN
        CREATE INDEX idx_payment_slips_customer_id ON payment_slips(customer_id);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public' AND indexname = 'idx_payment_slips_status'
    ) THEN
        CREATE INDEX idx_payment_slips_status ON payment_slips(slip_status);
    END IF;
END $$;

ALTER TABLE payment_slips ENABLE ROW LEVEL SECURITY;

-- Customers can view their own slips
DROP POLICY IF EXISTS "Customers can view own payment slips" ON payment_slips;
CREATE POLICY "Customers can view own payment slips" ON payment_slips
    FOR SELECT USING (customer_id = auth.uid());

-- Customers can insert slips for their own pending orders
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

-- Customers can upload slips for their own pending orders
-- Path layout: payment-slips/<order_id>/<filename>
DROP POLICY IF EXISTS "Customers can upload payment slips" ON storage.objects;
CREATE POLICY "Customers can upload payment slips" ON storage.objects
    FOR INSERT WITH CHECK (
        bucket_id = 'payment-slips'
        AND EXISTS (
            SELECT 1 FROM orders
            WHERE orders.id::TEXT = (storage.foldername(storage.objects.name))[2]
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
            WHERE orders.id::TEXT = (storage.foldername(storage.objects.name))[2]
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
