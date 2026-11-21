-- Snapshot the VAT rate (percent) used at order time so historical orders keep
-- their original VAT rate and amount even after the admin changes the setting.
--
-- Nullable by design: the backend always writes the actual rate from Settings
-- (orderService.getVatRate), so a NOT NULL DEFAULT 7 would mask missing values
-- and could silently stamp 7% on orders that should have used a different rate.
-- Existing rows keep their stored value; new orders are written with the
-- configured rate by createOrderInternal (orderService.js:99,136,319,374).
ALTER TABLE orders ADD COLUMN IF NOT EXISTS vat_rate NUMERIC(5,2);
ALTER TABLE store_orders ADD COLUMN IF NOT EXISTS vat_rate NUMERIC(5,2);

COMMENT ON COLUMN orders.vat_rate IS 'VAT rate percent applied to this order (snapshot)';
COMMENT ON COLUMN store_orders.vat_rate IS 'VAT rate percent applied to this store order (snapshot)';
