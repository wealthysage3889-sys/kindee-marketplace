-- Function to update store order status with reason for history tracking
-- This replaces the trigger-based approach for seller-initiated status changes
-- to allow capturing the actual rejection/cancellation reason from the seller

CREATE OR REPLACE FUNCTION update_store_order_status_with_reason(
    p_store_order_id UUID,
    p_new_status order_status,
    p_reason TEXT DEFAULT NULL
)
RETURNS store_orders AS $$
DECLARE
    v_store_order store_orders%ROWTYPE;
    v_old_status order_status;
    v_parent_order_id UUID;
    v_actor_id UUID;
    v_store_owner_id UUID;
BEGIN
    -- Get current store order and verify it exists
    SELECT so.* INTO v_store_order
    FROM store_orders so
    WHERE so.id = p_store_order_id;

    SELECT s.owner_id INTO v_store_owner_id
    FROM store_orders so JOIN stores s ON s.id = so.store_id
    WHERE so.id = p_store_order_id;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Store order not found';
    END IF;
    
    v_old_status := v_store_order.status;
    v_parent_order_id := v_store_order.parent_order_id;
    
    -- Verify the status transition is valid
    IF v_old_status = p_new_status THEN
        RAISE EXCEPTION 'Status unchanged';
    END IF;
    
    -- Get actor_id from current JWT claims (when called via user token)
    -- For service_role calls, this will be NULL, so we fall back to store owner
    BEGIN
        v_actor_id := NULLIF(current_setting('request.jwt.claims', true), '')::jsonb->>'sub';
    EXCEPTION WHEN OTHERS THEN
        v_actor_id := NULL;
    END;
    
    -- If no actor from JWT, use store owner (for service_role calls)
    IF v_actor_id IS NULL THEN
        v_actor_id := v_store_owner_id;
    END IF;
    
    -- Set session variable to skip trigger (we handle history manually)
    PERFORM set_config('app.skip_history_trigger', 'true', true);
    
    -- Update the store order
    UPDATE store_orders
    SET 
        status = p_new_status,
        updated_at = NOW(),
        confirmed_at = CASE WHEN p_new_status = 'confirmed' THEN NOW() ELSE confirmed_at END,
        ready_for_pickup_at = CASE WHEN p_new_status = 'ready_for_pickup' THEN NOW() ELSE ready_for_pickup_at END,
        picked_up_at = CASE WHEN p_new_status = 'picked_up' THEN NOW() ELSE picked_up_at END,
        delivered_at = CASE WHEN p_new_status = 'delivered' THEN NOW() ELSE delivered_at END,
        cancelled_at = CASE WHEN p_new_status = 'cancelled' THEN NOW() ELSE cancelled_at END
    WHERE id = p_store_order_id
    RETURNING * INTO v_store_order;
    
    -- Reset session variable
    PERFORM set_config('app.skip_history_trigger', 'false', false);
    
    -- Insert into order_status_history with the actual reason
    INSERT INTO order_status_history (order_id, store_order_id, from_status, to_status, changed_by, reason)
    VALUES (
        v_parent_order_id,
        p_store_order_id,
        v_old_status,
        p_new_status,
        v_actor_id,
        COALESCE(p_reason, 'Store order status updated')
    );
    
    -- Handle stock fulfillment/release based on status
    IF p_new_status = 'confirmed' THEN
        PERFORM fulfill_stock_reservation(p_store_order_id);
    ELSIF p_new_status = 'cancelled' THEN
        PERFORM release_stock_reservation(p_store_order_id);
    END IF;
    
    RETURN v_store_order;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission to service_role
GRANT EXECUTE ON FUNCTION update_store_order_status_with_reason(UUID, order_status, TEXT) TO service_role;

-- Update the store order status trigger to respect the skip flag
DROP TRIGGER IF EXISTS log_store_order_status_change_trigger ON store_orders;

CREATE OR REPLACE FUNCTION log_store_order_status_change()
RETURNS TRIGGER AS $$
DECLARE
    actor_id UUID;
    skip_trigger BOOLEAN := false;
BEGIN
    IF OLD.status IS DISTINCT FROM NEW.status THEN
        -- Check if we should skip (history already handled by update_store_order_status_with_reason)
        BEGIN
            skip_trigger := current_setting('app.skip_history_trigger', true) = 'true';
        EXCEPTION WHEN OTHERS THEN
            skip_trigger := false;
        END;
        
        IF NOT skip_trigger THEN
            BEGIN
                actor_id := NULLIF(current_setting('request.jwt.claims', true), '')::jsonb->>'sub';
            EXCEPTION WHEN OTHERS THEN
                actor_id := NULL;
            END;

            INSERT INTO order_status_history (order_id, store_order_id, from_status, to_status, changed_by, reason)
            VALUES (
                (SELECT parent_order_id FROM store_orders WHERE id = NEW.id),
                NEW.id,
                OLD.status,
                NEW.status,
                actor_id,
                'Store order status updated'
            );
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER log_store_order_status_change_trigger
    AFTER UPDATE ON store_orders
    FOR EACH ROW EXECUTE FUNCTION log_store_order_status_change();