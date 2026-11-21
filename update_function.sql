CREATE OR REPLACE FUNCTION public.check_and_reserve_stock(p_store_order_id uuid, p_items jsonb)
RETURNS TABLE(product_id uuid, success boolean, message text)
LANGUAGE plpgsql
AS $function$
DECLARE
    item RECORD;
    available_stock INTEGER;
    reservation_expires TIMESTAMPTZ := NOW() + INTERVAL '15 minutes';
BEGIN
    FOR item IN SELECT * FROM jsonb_array_elements(p_items) AS elem
    LOOP
        -- Check available stock (stock - reserved_stock)
        SELECT (stock - reserved_stock) INTO available_stock
        FROM products
        WHERE id = (item.elem->>'product_id')::UUID
        FOR UPDATE;
        
        IF available_stock IS NULL THEN
            RETURN QUERY SELECT (item.elem->>'product_id')::UUID, false, 'Product not found';
        ELSIF available_stock < (item.elem->>'quantity')::INTEGER THEN
            RETURN QUERY SELECT (item.elem->>'product_id')::UUID, false, 'Insufficient stock';
        ELSE
            -- Reserve stock
            UPDATE products
            SET reserved_stock = reserved_stock + (item.elem->>'quantity')::INTEGER
            WHERE id = (item.elem->>'product_id')::UUID;
            
            -- Create reservation record
            INSERT INTO inventory_reservations (product_id, store_order_id, order_item_id, quantity, expires_at)
            SELECT (item.elem->>'product_id')::UUID, p_store_order_id, oi.id, (item.elem->>'quantity')::INTEGER, reservation_expires
            FROM order_items oi
            WHERE oi.store_order_id = p_store_order_id
            AND oi.product_id = (item.elem->>'product_id')::UUID;
            
            RETURN QUERY SELECT (item.elem->>'product_id')::UUID, true, 'Stock reserved';
        END IF;
    END LOOP;
END;
$function$;