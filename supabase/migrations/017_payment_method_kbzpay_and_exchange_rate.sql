-- Add kbzpay to payment_method enum and add exchange rate fields to orders table
-- This migration is additive/idempotent and does not modify existing data

-- 1. Add 'kbzpay' to payment_method enum
-- PostgreSQL does not support ALTER TYPE ... ADD VALUE IF NOT EXISTS directly,
-- so we use a DO block to handle idempotency
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_enum
        WHERE enumlabel = 'kbzpay'
        AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'payment_method')
    ) THEN
        ALTER TYPE payment_method ADD VALUE 'kbzpay';
    END IF;
END $$;

-- 2. Add exchange rate and MMK amount columns to orders table
ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS exchange_rate NUMERIC(12,6),
    ADD COLUMN IF NOT EXISTS exchange_rate_source TEXT,
    ADD COLUMN IF NOT EXISTS exchange_rate_updated_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS amount_mmk NUMERIC(14,2);

-- 3. Add constraint to ensure exchange rate fields are only set for kbzpay
ALTER TABLE orders
    DROP CONSTRAINT IF EXISTS orders_exchange_rate_kbzpay_check,
    ADD CONSTRAINT orders_exchange_rate_kbzpay_check
    CHECK (
        (payment_method = 'kbzpay' AND exchange_rate IS NOT NULL AND exchange_rate_source IS NOT NULL AND exchange_rate_updated_at IS NOT NULL AND amount_mmk IS NOT NULL)
        OR
        (payment_method != 'kbzpay' AND exchange_rate IS NULL AND exchange_rate_source IS NULL AND exchange_rate_updated_at IS NULL AND amount_mmk IS NULL)
    );

-- 4. Add index for querying orders by exchange rate source (for audit)
CREATE INDEX IF NOT EXISTS idx_orders_exchange_rate_source ON orders(exchange_rate_source) WHERE exchange_rate_source IS NOT NULL;

-- 5. Add comment for documentation
COMMENT ON COLUMN orders.exchange_rate IS 'THB to MMK exchange rate at order time (KBZPay only)';
COMMENT ON COLUMN orders.exchange_rate_source IS 'Source of exchange rate (e.g., open.er-api.com)';
COMMENT ON COLUMN orders.exchange_rate_updated_at IS 'Timestamp when exchange rate was fetched from source';
COMMENT ON COLUMN orders.amount_mmk IS 'Order total in MMK calculated at order time (KBZPay only)';