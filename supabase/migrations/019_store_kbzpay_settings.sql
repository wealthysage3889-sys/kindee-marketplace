-- Add per-store KBZPay payment settings to the `stores` table.
-- Additive / idempotent: uses ADD COLUMN IF NOT EXISTS and DO blocks so it can
-- be re-run safely. Does NOT modify existing data and does NOT touch orders,
-- VAT, payments, chat, call, or realtime subsystems.
--
-- Columns:
--   kbzpay_account_name   ชื่อบัญชี KBZPay ของร้านค้า
--   kbzpay_phone_number   เบอร์โทรศัพท์ / หมายเลขบัญชี KBZPay
--   kbzpay_receiver_name  ชื่อผู้รับเงิน
--   kbzpay_qr_url         Public URL ของรูป QR Code (เก็บใน bucket store-kbzpay-qr)
--   kbzpay_enabled        สถานะเปิด/ปิด KBZPay ของร้านค้า
--
-- These fields are payment-display data intended to be shown to customers at
-- checkout time. No secrets are stored here.

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'stores' AND column_name = 'kbzpay_account_name'
    ) THEN
        ALTER TABLE stores ADD COLUMN kbzpay_account_name TEXT;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'stores' AND column_name = 'kbzpay_phone_number'
    ) THEN
        ALTER TABLE stores ADD COLUMN kbzpay_phone_number TEXT;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'stores' AND column_name = 'kbzpay_receiver_name'
    ) THEN
        ALTER TABLE stores ADD COLUMN kbzpay_receiver_name TEXT;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'stores' AND column_name = 'kbzpay_qr_url'
    ) THEN
        ALTER TABLE stores ADD COLUMN kbzpay_qr_url TEXT;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'stores' AND column_name = 'kbzpay_enabled'
    ) THEN
        ALTER TABLE stores ADD COLUMN kbzpay_enabled BOOLEAN DEFAULT false;
    END IF;
END $$;

COMMENT ON COLUMN stores.kbzpay_account_name IS 'KBZPay account name for this store (payment display data)';
COMMENT ON COLUMN stores.kbzpay_phone_number IS 'KBZPay phone number / account number for this store (payment display data)';
COMMENT ON COLUMN stores.kbzpay_receiver_name IS 'Receiver name for KBZPay transfers to this store (payment display data)';
COMMENT ON COLUMN stores.kbzpay_qr_url IS 'Public URL of the store KBZPay QR code image';
COMMENT ON COLUMN stores.kbzpay_enabled IS 'Whether KBZPay is enabled for this store';

-- ============================================================================
-- Storage bucket for store KBZPay QR codes (public read, owner-managed write)
-- ============================================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) VALUES
('store-kbzpay-qr', 'store-kbzpay-qr', true, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
ON CONFLICT (id) DO UPDATE SET
    public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Public can view KBZPay QR images (payment display data).
DROP POLICY IF EXISTS "Public can view store KBZPay QR" ON storage.objects;
CREATE POLICY "Public can view store KBZPay QR" ON storage.objects
    FOR SELECT USING (bucket_id = 'store-kbzpay-qr');

-- Store owners can upload KBZPay QR for their own store.
-- Path layout: store-kbzpay-qr/<store_id>/<year>/<month>/<file>
DROP POLICY IF EXISTS "Store owners can upload KBZPay QR" ON storage.objects;
CREATE POLICY "Store owners can upload KBZPay QR" ON storage.objects
    FOR INSERT WITH CHECK (
        bucket_id = 'store-kbzpay-qr'
        AND EXISTS (
            SELECT 1 FROM stores
            WHERE stores.id::TEXT = (storage.foldername(storage.objects.name))[1]
              AND stores.owner_id = auth.uid()
        )
    );

-- Store owners can update their own KBZPay QR.
DROP POLICY IF EXISTS "Store owners can update KBZPay QR" ON storage.objects;
CREATE POLICY "Store owners can update KBZPay QR" ON storage.objects
    FOR UPDATE USING (
        bucket_id = 'store-kbzpay-qr'
        AND EXISTS (
            SELECT 1 FROM stores
            WHERE stores.id::TEXT = (storage.foldername(storage.objects.name))[1]
              AND stores.owner_id = auth.uid()
        )
    )
    WITH CHECK (
        bucket_id = 'store-kbzpay-qr'
        AND EXISTS (
            SELECT 1 FROM stores
            WHERE stores.id::TEXT = (storage.foldername(storage.objects.name))[1]
              AND stores.owner_id = auth.uid()
        )
    );

-- Store owners can delete their own KBZPay QR.
DROP POLICY IF EXISTS "Store owners can delete KBZPay QR" ON storage.objects;
CREATE POLICY "Store owners can delete KBZPay QR" ON storage.objects
    FOR DELETE USING (
        bucket_id = 'store-kbzpay-qr'
        AND EXISTS (
            SELECT 1 FROM stores
            WHERE stores.id::TEXT = (storage.foldername(storage.objects.name))[1]
              AND stores.owner_id = auth.uid()
        )
    );

-- Admins can manage all KBZPay QR storage.
DROP POLICY IF EXISTS "Admins can manage store KBZPay QR" ON storage.objects;
CREATE POLICY "Admins can manage store KBZPay QR" ON storage.objects
    FOR ALL USING (
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
