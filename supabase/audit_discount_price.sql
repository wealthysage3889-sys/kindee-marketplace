-- ============================================================================
-- READ-ONLY audit: products whose discount_price = 0
-- ============================================================================
-- Purpose
--   The checkout now treats discount_price = 0 as "no discount" (regular
--   price), because payments.amount is CHECK (amount > 0) and a 100% discount
--   can never be paid. New writes of 0 are rejected by the API.
--
--   Run this BEFORE deploying to confirm how many existing rows are affected.
--
-- SAFETY
--   * This file contains SELECT statements only. It never writes.
--   * Do NOT run it against Production without approval from the owner.
--   * Run it with a read-only role / read replica where possible.
-- ============================================================================


-- 1) How many products in total have discount_price = 0?
SELECT COUNT(*) AS products_with_zero_discount
FROM products
WHERE discount_price = 0;


-- 2) How many of those are currently purchasable (is_active = true)?
--    These are the only rows that can change the amount a customer is charged.
SELECT COUNT(*) AS active_products_with_zero_discount
FROM products
WHERE discount_price = 0
  AND is_active = true;


-- 3) List them so the owner can decide: fix the price, or clear the discount.
SELECT
    id,
    store_id,
    name,
    price,
    discount_price,
    stock,
    is_active,
    created_at
FROM products
WHERE discount_price = 0
ORDER BY is_active DESC, created_at DESC;


-- 4) Other inconsistent legacy rows (not written by the current API, but worth
--    knowing about because the checkout falls back to the regular price for
--    them instead of undercharging).
SELECT
    COUNT(*) FILTER (WHERE discount_price IS NOT NULL AND discount_price < 0)  AS negative_discounts,
    COUNT(*) FILTER (WHERE discount_price IS NOT NULL AND discount_price >= price) AS discount_not_lower_than_price
FROM products;


-- 5) Historical impact: order items that were already written with unit_price 0
--    (only possible before this fix). These orders exist and are NOT modified.
SELECT
    COUNT(*)                                  AS order_items_with_zero_unit_price,
    COALESCE(SUM(oi.total_price), 0)          AS total_price_of_those_items
FROM order_items oi
WHERE oi.unit_price = 0;


-- 6) Orders whose stored total is 0 (cannot be paid through the payments table).
SELECT
    o.id,
    o.order_number,
    o.status,
    o.payment_status,
    o.payment_method,
    o.total_amount,
    o.created_at
FROM orders o
WHERE o.total_amount <= 0
ORDER BY o.created_at DESC;