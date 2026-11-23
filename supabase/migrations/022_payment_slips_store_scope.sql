-- Migration: 022_payment_slips_store_scope.sql
-- Additive / idempotent migration that builds on 021_payment_slips_multi_order.sql.
--
-- Problem this fixes:
--   021 kept UNIQUE(order_id) ("one slip row per order"). That is correct for a
--   single-store order, but a single checkout can produce ONE parent order whose
--   store_orders span MULTIPLE stores (each store is paid separately). With
--   UNIQUE(order_id) the second store's slip insert for the same parent order
--   fails, so a multi-store KBZPay checkout can never attach per-store slips.
--
-- Change:
--   Replace the order_id-only uniqueness with:
--     * UNIQUE(order_id, store_id) for rows that carry a store_id (multi-store /
--       multi-order flow in submitStorePaymentSlips), and
--     * UNIQUE(order_id) for legacy rows with store_id IS NULL (the original
--       single-slip-per-order flow in uploadPaymentSlip, which never sets
--       store_id), preserving the "one slip per order" guarantee for that path.
--
-- Safety:
--   No existing row is deleted or rewritten. Because UNIQUE(order_id) existed,
--   there cannot be duplicate order_id values, so both new unique indexes build
--   without conflict. Backend uses the service role and is unaffected by RLS.

-- ============================================================================
-- 1) Drop the order_id-only uniqueness constraint created inline by 020.
-- ============================================================================
ALTER TABLE payment_slips
    DROP CONSTRAINT IF EXISTS payment_slips_order_id_key;

-- ============================================================================
-- 2) Per-(order, store) uniqueness for rows that carry a store_id.
-- ============================================================================
CREATE UNIQUE INDEX IF NOT EXISTS payment_slips_order_store_uidx
    ON payment_slips(order_id, store_id)
    WHERE store_id IS NOT NULL;

-- ============================================================================
-- 3) Legacy rows (store_id IS NULL) keep one slip per order.
-- ============================================================================
CREATE UNIQUE INDEX IF NOT EXISTS payment_slips_order_legacy_uidx
    ON payment_slips(order_id)
    WHERE store_id IS NULL;