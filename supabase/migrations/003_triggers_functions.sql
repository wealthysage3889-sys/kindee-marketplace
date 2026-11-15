-- Triggers and Functions for Automation
-- ============================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply updated_at triggers
CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON profiles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_stores_updated_at BEFORE UPDATE ON stores
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_categories_updated_at BEFORE UPDATE ON categories
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_products_updated_at BEFORE UPDATE ON products
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_store_products_updated_at BEFORE UPDATE ON store_products
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_orders_updated_at BEFORE UPDATE ON orders
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_store_orders_updated_at BEFORE UPDATE ON store_orders
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_payments_updated_at BEFORE UPDATE ON payments
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_refunds_updated_at BEFORE UPDATE ON refunds
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_couriers_updated_at BEFORE UPDATE ON couriers
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_deliveries_updated_at BEFORE UPDATE ON deliveries
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_conversations_updated_at BEFORE UPDATE ON conversations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_messages_updated_at BEFORE UPDATE ON messages
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_settings_updated_at BEFORE UPDATE ON settings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_reviews_updated_at BEFORE UPDATE ON reviews
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- ORDER NUMBER GENERATION
-- ============================================
CREATE OR REPLACE FUNCTION generate_order_number(prefix TEXT)
RETURNS TEXT AS $$
DECLARE
    date_part TEXT;
    seq_num INTEGER;
    order_num TEXT;
BEGIN
    date_part := TO_CHAR(NOW(), 'YYYYMMDD');
    SELECT COALESCE(MAX(CAST(SUBSTRING(order_number FROM LENGTH(prefix) + 9) AS INTEGER)), 0) + 1
    INTO seq_num
    FROM orders
    WHERE order_number LIKE prefix || date_part || '%';
    
    order_num := prefix || date_part || LPAD(seq_num::TEXT, 6, '0');
    RETURN order_num;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION generate_store_order_number(prefix TEXT)
RETURNS TEXT AS $$
DECLARE
    date_part TEXT;
    seq_num INTEGER;
    order_num TEXT;
BEGIN
    date_part := TO_CHAR(NOW(), 'YYYYMMDD');
    SELECT COALESCE(MAX(CAST(SUBSTRING(store_order_number FROM LENGTH(prefix) + 9) AS INTEGER)), 0) + 1
    INTO seq_num
    FROM store_orders
    WHERE store_order_number LIKE prefix || date_part || '%';
    
    order_num := prefix || date_part || LPAD(seq_num::TEXT, 6, '0');
    RETURN order_num;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION generate_payment_number()
RETURNS TEXT AS $$
DECLARE
    date_part TEXT;
    seq_num INTEGER;
    payment_num TEXT;
BEGIN
    date_part := TO_CHAR(NOW(), 'YYYYMMDD');
    SELECT COALESCE(MAX(CAST(SUBSTRING(payment_number FROM 10) AS INTEGER)), 0) + 1
    INTO seq_num
    FROM payments
    WHERE payment_number LIKE 'PAY' || date_part || '%';
    
    payment_num := 'PAY' || date_part || LPAD(seq_num::TEXT, 6, '0');
    RETURN payment_num;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION generate_refund_number()
RETURNS TEXT AS $$
DECLARE
    date_part TEXT;
    seq_num INTEGER;
    refund_num TEXT;
BEGIN
    date_part := TO_CHAR(NOW(), 'YYYYMMDD');
    SELECT COALESCE(MAX(CAST(SUBSTRING(refund_number FROM 10) AS INTEGER)), 0) + 1
    INTO seq_num
    FROM refunds
    WHERE refund_number LIKE 'REF' || date_part || '%';
    
    refund_num := 'REF' || date_part || LPAD(seq_num::TEXT, 6, '0');
    RETURN refund_num;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- STOCK MANAGEMENT FUNCTIONS
-- ============================================
CREATE OR REPLACE FUNCTION check_and_reserve_stock(
    p_store_order_id UUID,
    p_items JSONB -- Array of {product_id, quantity}
)
RETURNS TABLE(product_id UUID, success BOOLEAN, message TEXT) AS $$
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
        WHERE id = (item->>'product_id')::UUID
        FOR UPDATE;
        
        IF available_stock IS NULL THEN
            RETURN QUERY SELECT (item->>'product_id')::UUID, false, 'Product not found';
        ELSIF available_stock < (item->>'quantity')::INTEGER THEN
            RETURN QUERY SELECT (item->>'product_id')::UUID, false, 'Insufficient stock';
        ELSE
            -- Reserve stock
            UPDATE products
            SET reserved_stock = reserved_stock + (item->>'quantity')::INTEGER
            WHERE id = (item->>'product_id')::UUID;
            
            -- Create reservation record
            INSERT INTO inventory_reservations (product_id, store_order_id, order_item_id, quantity, expires_at)
            SELECT (item->>'product_id')::UUID, p_store_order_id, oi.id, (item->>'quantity')::INTEGER, reservation_expires
            FROM order_items oi
            WHERE oi.store_order_id = p_store_order_id
            AND oi.product_id = (item->>'product_id')::UUID;
            
            RETURN QUERY SELECT (item->>'product_id')::UUID, true, 'Stock reserved';
        END IF;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION release_stock_reservation(p_store_order_id UUID)
RETURNS VOID AS $$
DECLARE
    res RECORD;
BEGIN
    FOR res IN SELECT * FROM inventory_reservations WHERE store_order_id = p_store_order_id AND status = 'active'
    LOOP
        UPDATE products
        SET reserved_stock = reserved_stock - res.quantity
        WHERE id = res.product_id;
        
        UPDATE inventory_reservations
        SET status = 'cancelled', cancelled_at = NOW()
        WHERE id = res.id;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fulfill_stock_reservation(p_store_order_id UUID)
RETURNS VOID AS $$
DECLARE
    res RECORD;
BEGIN
    FOR res IN SELECT * FROM inventory_reservations WHERE store_order_id = p_store_order_id AND status = 'active'
    LOOP
        UPDATE products
        SET stock = stock - res.quantity,
            reserved_stock = reserved_stock - res.quantity
        WHERE id = res.product_id;
        
        UPDATE inventory_reservations
        SET status = 'fulfilled', fulfilled_at = NOW()
        WHERE id = res.id;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Cleanup expired reservations (run via cron)
CREATE OR REPLACE FUNCTION cleanup_expired_reservations()
RETURNS INTEGER AS $$
DECLARE
    cleaned_count INTEGER := 0;
    res RECORD;
BEGIN
    FOR res IN SELECT * FROM inventory_reservations WHERE status = 'active' AND expires_at < NOW()
    LOOP
        UPDATE products
        SET reserved_stock = reserved_stock - res.quantity
        WHERE id = res.product_id;
        
        UPDATE inventory_reservations
        SET status = 'expired', cancelled_at = NOW()
        WHERE id = res.id;
        
        cleaned_count := cleaned_count + 1;
    END LOOP;
    RETURN cleaned_count;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- ORDER STATUS TRIGGERS
-- ============================================
CREATE OR REPLACE FUNCTION log_order_status_change()
RETURNS TRIGGER AS $$
DECLARE
    actor_id UUID;
BEGIN
    IF OLD.status IS DISTINCT FROM NEW.status THEN
        BEGIN
            actor_id := NULLIF(current_setting('request.jwt.claims', true), '')::jsonb->>'sub';
        EXCEPTION WHEN OTHERS THEN
            actor_id := NULL;
        END;

        INSERT INTO order_status_history (order_id, store_order_id, from_status, to_status, changed_by, reason)
        VALUES (
            NEW.id,
            NULL,
            OLD.status,
            NEW.status,
            actor_id,
            COALESCE(NEW.admin_notes, 'Status updated')
        );
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER log_order_status_change_trigger
    AFTER UPDATE ON orders
    FOR EACH ROW EXECUTE FUNCTION log_order_status_change();

CREATE OR REPLACE FUNCTION log_store_order_status_change()
RETURNS TRIGGER AS $$
DECLARE
    actor_id UUID;
BEGIN
    IF OLD.status IS DISTINCT FROM NEW.status THEN
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
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER log_store_order_status_change_trigger
    AFTER UPDATE ON store_orders
    FOR EACH ROW EXECUTE FUNCTION log_store_order_status_change();

-- ============================================
-- DELIVERY STATUS TRIGGERS
-- ============================================
CREATE OR REPLACE FUNCTION log_delivery_status_change()
RETURNS TRIGGER AS $$
DECLARE
    actor_id UUID;
BEGIN
    IF OLD.status IS DISTINCT FROM NEW.status THEN
        BEGIN
            actor_id := NULLIF(current_setting('request.jwt.claims', true), '')::jsonb->>'sub';
        EXCEPTION WHEN OTHERS THEN
            actor_id := NULL;
        END;

        INSERT INTO delivery_status_history (delivery_id, from_status, to_status, changed_by)
        VALUES (
            NEW.id,
            OLD.status,
            NEW.status,
            actor_id
        );
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER log_delivery_status_change_trigger
    AFTER UPDATE ON deliveries
    FOR EACH ROW EXECUTE FUNCTION log_delivery_status_change();

-- ============================================
-- CONVERSATION LAST MESSAGE UPDATE
-- ============================================
CREATE OR REPLACE FUNCTION update_conversation_last_message()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' AND NEW.is_deleted = false THEN
        UPDATE conversations
        SET last_message_at = NEW.created_at
        WHERE id = NEW.conversation_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_conversation_last_message_trigger
    AFTER INSERT ON messages
    FOR EACH ROW EXECUTE FUNCTION update_conversation_last_message();

-- ============================================
-- UNREAD COUNT MANAGEMENT
-- ============================================
CREATE OR REPLACE FUNCTION increment_unread_count()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' AND NEW.is_deleted = false THEN
        UPDATE conversation_members
        SET unread_count = unread_count + 1
        WHERE conversation_id = NEW.conversation_id
        AND profile_id != NEW.sender_id
        AND left_at IS NULL;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER increment_unread_count_trigger
    AFTER INSERT ON messages
    FOR EACH ROW EXECUTE FUNCTION increment_unread_count();

CREATE OR REPLACE FUNCTION reset_unread_count()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'UPDATE' AND NEW.last_read_at IS DISTINCT FROM OLD.last_read_at THEN
        NEW.unread_count := 0;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER reset_unread_count_trigger
    BEFORE UPDATE OF last_read_at ON conversation_members
    FOR EACH ROW EXECUTE FUNCTION reset_unread_count();

-- ============================================
-- NOTIFICATION CREATION HELPERS
-- ============================================
CREATE OR REPLACE FUNCTION create_notification(
    p_recipient_id UUID,
    p_type notification_type,
    p_title TEXT,
    p_body TEXT,
    p_data JSONB DEFAULT '{}',
    p_related_id UUID DEFAULT NULL,
    p_related_type TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    notif_id UUID;
BEGIN
    INSERT INTO notifications (recipient_id, type, title, body, data, related_id, related_type)
    VALUES (p_recipient_id, p_type, p_title, p_body, p_data, p_related_id, p_related_type)
    RETURNING id INTO notif_id;
    RETURN notif_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- SEARCH FUNCTIONS
-- ============================================
CREATE OR REPLACE FUNCTION search_products(
    p_query TEXT,
    p_store_id UUID DEFAULT NULL,
    p_category_id UUID DEFAULT NULL,
    p_min_price NUMERIC DEFAULT NULL,
    p_max_price NUMERIC DEFAULT NULL,
    p_limit INTEGER DEFAULT 20,
    p_offset INTEGER DEFAULT 0
)
RETURNS TABLE(
    id UUID,
    store_id UUID,
    name TEXT,
    slug TEXT,
    description TEXT,
    price NUMERIC,
    discount_price NUMERIC,
    stock INTEGER,
    images TEXT[],
    rating_average NUMERIC,
    rating_count INTEGER,
    store_name TEXT,
    store_slug TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        p.id, p.store_id, p.name, p.slug, p.description, p.price, p.discount_price,
        p.stock, p.images, p.rating_average, p.rating_count,
        s.name as store_name, s.slug as store_slug
    FROM products p
    JOIN stores s ON s.id = p.store_id
    WHERE p.is_active = true
    AND s.is_active = true
    AND s.is_verified = true
    AND (p_store_id IS NULL OR p.store_id = p_store_id)
    AND (p_category_id IS NULL OR p.category_id = p_category_id)
    AND (p_min_price IS NULL OR p.price >= p_min_price)
    AND (p_max_price IS NULL OR p.price <= p_max_price)
    AND (
        p_query IS NULL OR p_query = ''
        OR p.name ILIKE '%' || p_query || '%'
        OR COALESCE(p.description, '') ILIKE '%' || p_query || '%'
    )
    ORDER BY 
        CASE WHEN p_query IS NOT NULL AND p_query != ''
             THEN extensions.similarity(p.name, p_query)
             ELSE 0 END DESC,
        p.rating_average DESC,
        p.created_at DESC
    LIMIT p_limit OFFSET p_offset;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- NEARBY STORES FUNCTION
-- ============================================
CREATE OR REPLACE FUNCTION find_nearby_stores(
    p_lat DOUBLE PRECISION,
    p_lng DOUBLE PRECISION,
    p_radius_km NUMERIC DEFAULT 10,
    p_limit INTEGER DEFAULT 20
)
RETURNS TABLE(
    id UUID,
    name TEXT,
    slug TEXT,
    logo_url TEXT,
    address JSONB,
    distance_km NUMERIC,
    rating_average NUMERIC,
    rating_count INTEGER,
    delivery_fee NUMERIC,
    minimum_order NUMERIC,
    estimated_delivery_time INTEGER
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        s.id, s.name, s.slug, s.logo_url, s.address,
        ROUND((ST_Distance(
            ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography,
            s.location
        ) / 1000)::NUMERIC, 2) as distance_km,
        s.rating_average, s.rating_count, s.delivery_fee, s.minimum_order, s.estimated_delivery_time
    FROM stores s
    WHERE s.is_active = true
    AND s.is_verified = true
    AND s.location IS NOT NULL
    AND ST_DWithin(
        ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography,
        s.location,
        p_radius_km * 1000
    )
    ORDER BY distance_km
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- AVAILABLE COURIERS FUNCTION
-- ============================================
CREATE OR REPLACE FUNCTION find_available_couriers(
    p_lat DOUBLE PRECISION,
    p_lng DOUBLE PRECISION,
    p_radius_km NUMERIC DEFAULT 5,
    p_limit INTEGER DEFAULT 10
)
RETURNS TABLE(
    id UUID,
    profile_id UUID,
    name TEXT,
    avatar_url TEXT,
    vehicle_type TEXT,
    current_location GEOGRAPHY(POINT, 4326),
    distance_km NUMERIC,
    rating_average NUMERIC,
    total_deliveries INTEGER
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        c.id, c.profile_id, p.name, p.avatar_url, c.vehicle_type, c.current_location,
        ROUND((ST_Distance(
            ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography,
            c.current_location
        ) / 1000)::NUMERIC, 2) as distance_km,
        c.rating_average, c.total_deliveries
    FROM couriers c
    JOIN profiles p ON p.id = c.profile_id
    WHERE c.is_available = true
    AND c.is_verified = true
    AND c.current_location IS NOT NULL
    AND p.is_active = true
    AND ST_DWithin(
        ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography,
        c.current_location,
        p_radius_km * 1000
    )
    ORDER BY distance_km
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- STORE RATING CALCULATION
-- ============================================
CREATE OR REPLACE FUNCTION update_store_rating(p_store_id UUID)
RETURNS VOID AS $$
BEGIN
    IF p_store_id IS NULL THEN
        RETURN;
    END IF;

    UPDATE stores
    SET rating_average = COALESCE((
        SELECT ROUND(AVG(rating)::NUMERIC, 2)
        FROM reviews
        WHERE store_id = p_store_id
    ), 0),
    rating_count = COALESCE((
        SELECT COUNT(*)
        FROM reviews
        WHERE store_id = p_store_id
    ), 0)
    WHERE id = p_store_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION update_product_rating(p_product_id UUID)
RETURNS VOID AS $$
BEGIN
    IF p_product_id IS NULL THEN
        RETURN;
    END IF;

    UPDATE products
    SET rating_average = COALESCE((
        SELECT ROUND(AVG(rating)::NUMERIC, 2)
        FROM reviews
        WHERE product_id = p_product_id
    ), 0),
    rating_count = COALESCE((
        SELECT COUNT(*)
        FROM reviews
        WHERE product_id = p_product_id
    ), 0)
    WHERE id = p_product_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION trigger_update_store_rating()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        PERFORM update_store_rating(OLD.store_id);
        RETURN OLD;
    ELSIF TG_OP = 'UPDATE' THEN
        IF NEW.store_id IS DISTINCT FROM OLD.store_id THEN
            PERFORM update_store_rating(OLD.store_id);
        END IF;
        PERFORM update_store_rating(NEW.store_id);
        RETURN NEW;
    ELSE
        PERFORM update_store_rating(NEW.store_id);
        RETURN NEW;
    END IF;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION trigger_update_product_rating()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        PERFORM update_product_rating(OLD.product_id);
        RETURN OLD;
    ELSIF TG_OP = 'UPDATE' THEN
        IF NEW.product_id IS DISTINCT FROM OLD.product_id THEN
            PERFORM update_product_rating(OLD.product_id);
        END IF;
        PERFORM update_product_rating(NEW.product_id);
        RETURN NEW;
    ELSE
        PERFORM update_product_rating(NEW.product_id);
        RETURN NEW;
    END IF;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_store_rating_after_review
    AFTER INSERT OR UPDATE OR DELETE ON reviews
    FOR EACH ROW EXECUTE FUNCTION trigger_update_store_rating();

CREATE TRIGGER update_product_rating_after_review
    AFTER INSERT OR UPDATE OR DELETE ON reviews
    FOR EACH ROW EXECUTE FUNCTION trigger_update_product_rating();

-- ============================================
-- COURIER RATING CALCULATION
-- ============================================
CREATE OR REPLACE FUNCTION update_courier_rating(p_courier_id UUID)
RETURNS VOID AS $$
BEGIN
    IF p_courier_id IS NULL THEN
        RETURN;
    END IF;

    UPDATE couriers
    SET rating_average = COALESCE((
        SELECT ROUND(AVG(rating)::NUMERIC, 2)
        FROM reviews r
        JOIN store_orders so ON so.id = r.store_order_id
        JOIN deliveries d ON d.store_order_id = so.id
        WHERE d.courier_id = p_courier_id
    ), 0),
    rating_count = COALESCE((
        SELECT COUNT(*)
        FROM reviews r
        JOIN store_orders so ON so.id = r.store_order_id
        JOIN deliveries d ON d.store_order_id = so.id
        WHERE d.courier_id = p_courier_id
    ), 0)
    WHERE id = p_courier_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- DEFAULT SETTINGS
-- ============================================
INSERT INTO settings (key, value, description, is_public) VALUES
('platform_name', '"Kindee Marketplace"', 'Platform name', true),
('platform_fee_percent', '5', 'Platform fee percentage', true),
('min_order_amount', '0', 'Minimum order amount', true),
('max_delivery_distance_km', '20', 'Maximum delivery distance in km', true),
('stock_reservation_minutes', '15', 'Stock reservation expiry in minutes', true),
('courier_assignment_timeout_seconds', '60', 'Courier assignment response timeout', true),
('max_courier_assignment_retries', '3', 'Max courier assignment retries', true),
('enable_voice_calls', 'true', 'Enable voice call feature', true),
('enable_gps_tracking', 'true', 'Enable GPS tracking', true),
('map_provider', '"leaflet"', 'Map provider (leaflet, google, mapbox)', true),
('turn_server_urls', '[]', 'TURN server URLs for WebRTC', false),
('stun_server_urls', '["stun:stun.l.google.com:19302"]', 'STUN server URLs for WebRTC', false)
ON CONFLICT (key) DO NOTHING;

-- ============================================
-- GRANT PERMISSIONS FOR SERVICE ROLE
-- ============================================
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO service_role;