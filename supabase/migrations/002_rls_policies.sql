-- Row Level Security Policies
-- Enable RLS on all tables
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE store_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE store_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE refunds ENABLE ROW LEVEL SECURITY;
ALTER TABLE couriers ENABLE ROW LEVEL SECURITY;
ALTER TABLE deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_destinations ENABLE ROW LEVEL SECURITY;
ALTER TABLE courier_live_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE call_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;

-- Helper functions for RLS
CREATE OR REPLACE FUNCTION get_current_user_id()
RETURNS UUID AS $$
    SELECT auth.uid();
$$ LANGUAGE sql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION get_current_user_role()
RETURNS user_role AS $$
    SELECT role FROM profiles WHERE id = auth.uid();
$$ LANGUAGE sql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION is_admin_or_owner()
RETURNS BOOLEAN AS $$
    SELECT role IN ('admin', 'owner') FROM profiles WHERE id = auth.uid();
$$ LANGUAGE sql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION is_seller()
RETURNS BOOLEAN AS $$
    SELECT role = 'seller' FROM profiles WHERE id = auth.uid();
$$ LANGUAGE sql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION is_courier()
RETURNS BOOLEAN AS $$
    SELECT role = 'courier' FROM profiles WHERE id = auth.uid();
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- ============================================
-- PROFILES POLICIES
-- ============================================
-- Users can view their own profile
CREATE POLICY "Users can view own profile" ON profiles
    FOR SELECT USING (id = auth.uid());

-- Users can update their own profile (except role)
CREATE POLICY "Users can update own profile" ON profiles
    FOR UPDATE USING (id = auth.uid())
    WITH CHECK (id = auth.uid() AND role = (SELECT role FROM profiles WHERE id = auth.uid()));

-- Admins/Owners can view all profiles
CREATE POLICY "Admins can view all profiles" ON profiles
    FOR SELECT USING (is_admin_or_owner());

-- Admins can update any profile (but not owner's role without permission)
CREATE POLICY "Admins can update profiles" ON profiles
    FOR UPDATE USING (is_admin_or_owner())
    WITH CHECK (
        is_admin_or_owner() AND 
        NOT (role = 'owner' AND (SELECT role FROM profiles WHERE id = auth.uid()) = 'admin')
    );

-- ============================================
-- STORES POLICIES
-- ============================================
-- Public can view active verified stores
CREATE POLICY "Public can view active stores" ON stores
    FOR SELECT USING (is_active = true AND is_verified = true);

-- Store owners can view their own stores (including inactive)
CREATE POLICY "Owners can view own stores" ON stores
    FOR SELECT USING (owner_id = auth.uid());

-- Store owners can create stores
CREATE POLICY "Owners can create stores" ON stores
    FOR INSERT WITH CHECK (owner_id = auth.uid() AND is_seller());

-- Store owners can update their own stores
CREATE POLICY "Owners can update own stores" ON stores
    FOR UPDATE USING (owner_id = auth.uid())
    WITH CHECK (owner_id = auth.uid());

-- Admins can view all stores
CREATE POLICY "Admins can view all stores" ON stores
    FOR SELECT USING (is_admin_or_owner());

-- Admins can update any store
CREATE POLICY "Admins can update stores" ON stores
    FOR UPDATE USING (is_admin_or_owner())
    WITH CHECK (is_admin_or_owner());

-- ============================================
-- CATEGORIES POLICIES
-- ============================================
-- Public can view active categories
CREATE POLICY "Public can view categories" ON categories
    FOR SELECT USING (is_active = true);

-- Admins can manage categories
CREATE POLICY "Admins can manage categories" ON categories
    FOR ALL USING (is_admin_or_owner())
    WITH CHECK (is_admin_or_owner());

-- ============================================
-- PRODUCTS POLICIES
-- ============================================
-- Public can view active products from active verified stores
CREATE POLICY "Public can view active products" ON products
    FOR SELECT USING (
        is_active = true AND 
        EXISTS (
            SELECT 1 FROM stores 
            WHERE stores.id = products.store_id 
            AND stores.is_active = true 
            AND stores.is_verified = true
        )
    );

-- Store owners can view their own products (including inactive)
CREATE POLICY "Owners can view own products" ON products
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM stores 
            WHERE stores.id = products.store_id 
            AND stores.owner_id = auth.uid()
        )
    );

-- Store owners can create products for their stores
CREATE POLICY "Owners can create products" ON products
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM stores 
            WHERE stores.id = products.store_id 
            AND stores.owner_id = auth.uid()
        )
    );

-- Store owners can update their own products
CREATE POLICY "Owners can update own products" ON products
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM stores 
            WHERE stores.id = products.store_id 
            AND stores.owner_id = auth.uid()
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM stores 
            WHERE stores.id = products.store_id 
            AND stores.owner_id = auth.uid()
        )
    );

-- Admins can view all products
CREATE POLICY "Admins can view all products" ON products
    FOR SELECT USING (is_admin_or_owner());

-- Admins can update any product
CREATE POLICY "Admins can update products" ON products
    FOR UPDATE USING (is_admin_or_owner())
    WITH CHECK (is_admin_or_owner());

-- ============================================
-- STORE_PRODUCTS POLICIES
-- ============================================
-- Store owners can manage their store_products
CREATE POLICY "Owners can manage store_products" ON store_products
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM stores 
            WHERE stores.id = store_products.store_id 
            AND stores.owner_id = auth.uid()
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM stores 
            WHERE stores.id = store_products.store_id 
            AND stores.owner_id = auth.uid()
        )
    );

-- Admins can manage all store_products
CREATE POLICY "Admins can manage store_products" ON store_products
    FOR ALL USING (is_admin_or_owner())
    WITH CHECK (is_admin_or_owner());

-- ============================================
-- ORDERS POLICIES
-- ============================================
-- Customers can view their own orders
CREATE POLICY "Customers can view own orders" ON orders
    FOR SELECT USING (customer_id = auth.uid());

-- Customers can create orders
CREATE POLICY "Customers can create orders" ON orders
    FOR INSERT WITH CHECK (customer_id = auth.uid());

-- Store owners can view orders for their stores
CREATE POLICY "Owners can view store orders" ON orders
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM store_orders 
            WHERE store_orders.parent_order_id = orders.id 
            AND EXISTS (
                SELECT 1 FROM stores 
                WHERE stores.id = store_orders.store_id 
                AND stores.owner_id = auth.uid()
            )
        )
    );

-- Couriers can view assigned orders
CREATE POLICY "Couriers can view assigned orders" ON orders
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM store_orders 
            WHERE store_orders.parent_order_id = orders.id 
            AND store_orders.courier_id = auth.uid()
        )
    );

-- Admins can view all orders
CREATE POLICY "Admins can view all orders" ON orders
    FOR SELECT USING (is_admin_or_owner());

-- Admins can update order status
CREATE POLICY "Admins can update orders" ON orders
    FOR UPDATE USING (is_admin_or_owner())
    WITH CHECK (is_admin_or_owner());

-- ============================================
-- STORE_ORDERS POLICIES
-- ============================================
-- Customers can view their store orders
CREATE POLICY "Customers can view own store_orders" ON store_orders
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM orders 
            WHERE orders.id = store_orders.parent_order_id 
            AND orders.customer_id = auth.uid()
        )
    );

-- Store owners can view their store orders
CREATE POLICY "Owners can view own store_orders" ON store_orders
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM stores 
            WHERE stores.id = store_orders.store_id 
            AND stores.owner_id = auth.uid()
        )
    );

-- Store owners can update their store orders (status, etc.)
CREATE POLICY "Owners can update own store_orders" ON store_orders
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM stores 
            WHERE stores.id = store_orders.store_id 
            AND stores.owner_id = auth.uid()
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM stores 
            WHERE stores.id = store_orders.store_id 
            AND stores.owner_id = auth.uid()
        )
    );

-- Couriers can view assigned store orders
CREATE POLICY "Couriers can view assigned store_orders" ON store_orders
    FOR SELECT USING (courier_id = auth.uid());

-- Couriers can update assigned store orders (status)
CREATE POLICY "Couriers can update assigned store_orders" ON store_orders
    FOR UPDATE USING (courier_id = auth.uid())
    WITH CHECK (courier_id = auth.uid());

-- Admins can view all store orders
CREATE POLICY "Admins can view all store_orders" ON store_orders
    FOR SELECT USING (is_admin_or_owner());

-- Admins can update any store order
CREATE POLICY "Admins can update store_orders" ON store_orders
    FOR UPDATE USING (is_admin_or_owner())
    WITH CHECK (is_admin_or_owner());

-- ============================================
-- ORDER_ITEMS POLICIES
-- ============================================
-- Access through parent order/store_order
CREATE POLICY "Order items accessible via orders" ON order_items
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM store_orders so
            JOIN orders o ON o.id = so.parent_order_id
            WHERE so.id = order_items.store_order_id
            AND (o.customer_id = auth.uid() 
                 OR EXISTS (SELECT 1 FROM stores s WHERE s.id = so.store_id AND s.owner_id = auth.uid())
                 OR so.courier_id = auth.uid()
                 OR is_admin_or_owner())
        )
    );

-- ============================================
-- ORDER_STATUS_HISTORY POLICIES
-- ============================================
CREATE POLICY "Order status history accessible via orders" ON order_status_history
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM orders 
            WHERE orders.id = order_status_history.order_id
            AND (orders.customer_id = auth.uid() OR is_admin_or_owner())
        ) OR
        EXISTS (
            SELECT 1 FROM store_orders so
            JOIN orders o ON o.id = so.parent_order_id
            WHERE so.id = order_status_history.store_order_id
            AND (o.customer_id = auth.uid() 
                 OR EXISTS (SELECT 1 FROM stores s WHERE s.id = so.store_id AND s.owner_id = auth.uid())
                 OR so.courier_id = auth.uid()
                 OR is_admin_or_owner())
        )
    );

-- ============================================
-- INVENTORY_RESERVATIONS POLICIES
-- ============================================
-- Store owners can view their product reservations
CREATE POLICY "Owners can view inventory reservations" ON inventory_reservations
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM products p
            JOIN stores s ON s.id = p.store_id
            WHERE p.id = inventory_reservations.product_id
            AND s.owner_id = auth.uid()
        )
    );

-- System can create reservations (via service role)
CREATE POLICY "Service can manage inventory reservations" ON inventory_reservations
    FOR ALL USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

-- ============================================
-- PAYMENTS POLICIES
-- ============================================
-- Customers can view their payments
CREATE POLICY "Customers can view own payments" ON payments
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM orders 
            WHERE orders.id = payments.order_id 
            AND orders.customer_id = auth.uid()
        )
    );

-- Store owners can view payments for their store orders
CREATE POLICY "Owners can view store payments" ON payments
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM store_orders so
            JOIN stores s ON s.id = so.store_id
            WHERE so.id = payments.store_order_id
            AND s.owner_id = auth.uid()
        )
    );

-- Admins can view all payments
CREATE POLICY "Admins can view all payments" ON payments
    FOR SELECT USING (is_admin_or_owner());

-- Service role can create/update payments
CREATE POLICY "Service can manage payments" ON payments
    FOR ALL USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

-- ============================================
-- REFUNDS POLICIES
-- ============================================
-- Customers can view their refunds
CREATE POLICY "Customers can view own refunds" ON refunds
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM orders 
            WHERE orders.id = refunds.order_id 
            AND orders.customer_id = auth.uid()
        )
    );

-- Store owners can view refunds for their store orders
CREATE POLICY "Owners can view store refunds" ON refunds
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM store_orders so
            JOIN stores s ON s.id = so.store_id
            WHERE so.id = refunds.store_order_id
            AND s.owner_id = auth.uid()
        )
    );

-- Admins can manage all refunds
CREATE POLICY "Admins can manage refunds" ON refunds
    FOR ALL USING (is_admin_or_owner())
    WITH CHECK (is_admin_or_owner());

-- ============================================
-- COURIERS POLICIES
-- ============================================
-- Couriers can view their own profile
CREATE POLICY "Couriers can view own profile" ON couriers
    FOR SELECT USING (profile_id = auth.uid());

-- Couriers can update their own profile
CREATE POLICY "Couriers can update own profile" ON couriers
    FOR UPDATE USING (profile_id = auth.uid())
    WITH CHECK (profile_id = auth.uid());

-- Admins can view all couriers
CREATE POLICY "Admins can view all couriers" ON couriers
    FOR SELECT USING (is_admin_or_owner());

-- Admins can manage couriers
CREATE POLICY "Admins can manage couriers" ON couriers
    FOR ALL USING (is_admin_or_owner())
    WITH CHECK (is_admin_or_owner());

-- ============================================
-- DELIVERIES POLICIES
-- ============================================
-- Customers can view their deliveries
CREATE POLICY "Customers can view own deliveries" ON deliveries
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM store_orders so
            JOIN orders o ON o.id = so.parent_order_id
            WHERE so.id = deliveries.store_order_id
            AND o.customer_id = auth.uid()
        )
    );

-- Store owners can view their deliveries
CREATE POLICY "Owners can view store deliveries" ON deliveries
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM store_orders so
            JOIN stores s ON s.id = so.store_id
            WHERE so.id = deliveries.store_order_id
            AND s.owner_id = auth.uid()
        )
    );

-- Couriers can view their assigned deliveries
CREATE POLICY "Couriers can view assigned deliveries" ON deliveries
    FOR SELECT USING (courier_id = auth.uid());

-- Couriers can update their assigned deliveries (status, location)
CREATE POLICY "Couriers can update assigned deliveries" ON deliveries
    FOR UPDATE USING (courier_id = auth.uid())
    WITH CHECK (courier_id = auth.uid());

-- Admins can view all deliveries
CREATE POLICY "Admins can view all deliveries" ON deliveries
    FOR SELECT USING (is_admin_or_owner());

-- Admins can manage all deliveries
CREATE POLICY "Admins can manage deliveries" ON deliveries
    FOR ALL USING (is_admin_or_owner())
    WITH CHECK (is_admin_or_owner());

-- ============================================
-- DELIVERY_ASSIGNMENTS POLICIES
-- ============================================
-- Couriers can view their assignments
CREATE POLICY "Couriers can view own assignments" ON delivery_assignments
    FOR SELECT USING (courier_id = auth.uid());

-- Couriers can respond to assignments
CREATE POLICY "Couriers can respond to assignments" ON delivery_assignments
    FOR UPDATE USING (courier_id = auth.uid())
    WITH CHECK (courier_id = auth.uid());

-- Admins can view all assignments
CREATE POLICY "Admins can view all assignments" ON delivery_assignments
    FOR SELECT USING (is_admin_or_owner());

-- Admins can manage assignments
CREATE POLICY "Admins can manage assignments" ON delivery_assignments
    FOR ALL USING (is_admin_or_owner())
    WITH CHECK (is_admin_or_owner());

-- ============================================
-- DELIVERY_STATUS_HISTORY POLICIES
-- ============================================
CREATE POLICY "Delivery status history accessible via deliveries" ON delivery_status_history
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM deliveries d
            JOIN store_orders so ON so.id = d.store_order_id
            JOIN orders o ON o.id = so.parent_order_id
            WHERE d.id = delivery_status_history.delivery_id
            AND (o.customer_id = auth.uid() 
                 OR EXISTS (SELECT 1 FROM stores s WHERE s.id = so.store_id AND s.owner_id = auth.uid())
                 OR d.courier_id = auth.uid()
                 OR is_admin_or_owner())
        )
    );

-- ============================================
-- CUSTOMER_DESTINATIONS POLICIES
-- ============================================
-- Customers can view their own destinations
CREATE POLICY "Customers can view own destinations" ON customer_destinations
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM orders 
            WHERE orders.id = customer_destinations.order_id 
            AND orders.customer_id = auth.uid()
        )
    );

-- Store owners can view destinations for their orders
CREATE POLICY "Owners can view order destinations" ON customer_destinations
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM store_orders so
            JOIN stores s ON s.id = so.store_id
            JOIN orders o ON o.id = so.parent_order_id
            WHERE o.id = customer_destinations.order_id
            AND s.owner_id = auth.uid()
        )
    );

-- Couriers can view destinations for assigned deliveries
CREATE POLICY "Couriers can view assigned destinations" ON customer_destinations
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM deliveries d
            WHERE d.store_order_id IN (
                SELECT so.id FROM store_orders so
                JOIN orders o ON o.id = so.parent_order_id
                WHERE o.id = customer_destinations.order_id
            )
            AND d.courier_id = auth.uid()
        )
    );

-- Admins can view all destinations
CREATE POLICY "Admins can view all destinations" ON customer_destinations
    FOR SELECT USING (is_admin_or_owner());

-- ============================================
-- COURIER_LIVE_LOCATIONS POLICIES
-- ============================================
-- Couriers can insert their own locations
CREATE POLICY "Couriers can insert own locations" ON courier_live_locations
    FOR INSERT WITH CHECK (courier_id = auth.uid());

-- Couriers can view their own locations
CREATE POLICY "Couriers can view own locations" ON courier_live_locations
    FOR SELECT USING (courier_id = auth.uid());

-- Customers can view courier locations for their deliveries
CREATE POLICY "Customers can view courier locations" ON courier_live_locations
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM deliveries d
            JOIN store_orders so ON so.id = d.store_order_id
            JOIN orders o ON o.id = so.parent_order_id
            WHERE d.id = courier_live_locations.delivery_id
            AND o.customer_id = auth.uid()
            AND courier_live_locations.is_active = true
        )
    );

-- Store owners can view courier locations for their deliveries
CREATE POLICY "Owners can view courier locations" ON courier_live_locations
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM deliveries d
            JOIN store_orders so ON so.id = d.store_order_id
            JOIN stores s ON s.id = so.store_id
            WHERE d.id = courier_live_locations.delivery_id
            AND s.owner_id = auth.uid()
            AND courier_live_locations.is_active = true
        )
    );

-- Admins can view all locations
CREATE POLICY "Admins can view all locations" ON courier_live_locations
    FOR SELECT USING (is_admin_or_owner());

-- ============================================
-- CONVERSATIONS POLICIES
-- ============================================
-- Users can view conversations they're members of
CREATE POLICY "Users can view own conversations" ON conversations
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM conversation_members 
            WHERE conversation_members.conversation_id = conversations.id 
            AND conversation_members.profile_id = auth.uid()
            AND conversation_members.left_at IS NULL
        )
    );

-- Users can create conversations (direct, group)
CREATE POLICY "Users can create conversations" ON conversations
    FOR INSERT WITH CHECK (true); -- Validated in application logic

-- Store owners can view conversations for their stores
CREATE POLICY "Owners can view store conversations" ON conversations
    FOR SELECT USING (
        store_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM stores 
            WHERE stores.id = conversations.store_id 
            AND stores.owner_id = auth.uid()
        )
    );

-- Admins can view all conversations
CREATE POLICY "Admins can view all conversations" ON conversations
    FOR SELECT USING (is_admin_or_owner());

-- ============================================
-- CONVERSATION_MEMBERS POLICIES
-- ============================================
-- Users can view members of conversations they're in
CREATE POLICY "Users can view conversation members" ON conversation_members
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM conversation_members cm2
            WHERE cm2.conversation_id = conversation_members.conversation_id
            AND cm2.profile_id = auth.uid()
            AND cm2.left_at IS NULL
        )
    );

-- Users can join conversations (insert self)
CREATE POLICY "Users can join conversations" ON conversation_members
    FOR INSERT WITH CHECK (profile_id = auth.uid());

-- Users can update their own membership (leave, mute, read)
CREATE POLICY "Users can update own membership" ON conversation_members
    FOR UPDATE USING (profile_id = auth.uid())
    WITH CHECK (profile_id = auth.uid());

-- Conversation admins can manage members
CREATE POLICY "Conversation admins can manage members" ON conversation_members
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM conversation_members cm2
            WHERE cm2.conversation_id = conversation_members.conversation_id
            AND cm2.profile_id = auth.uid()
            AND cm2.role IN ('admin', 'owner')
            AND cm2.left_at IS NULL
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM conversation_members cm2
            WHERE cm2.conversation_id = conversation_members.conversation_id
            AND cm2.profile_id = auth.uid()
            AND cm2.role IN ('admin', 'owner')
            AND cm2.left_at IS NULL
        )
    );

-- ============================================
-- MESSAGES POLICIES
-- ============================================
-- Users can view messages in conversations they're members of
CREATE POLICY "Users can view conversation messages" ON messages
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM conversation_members 
            WHERE conversation_members.conversation_id = messages.conversation_id 
            AND conversation_members.profile_id = auth.uid()
            AND conversation_members.left_at IS NULL
        )
        AND messages.is_deleted = false
    );

-- Users can send messages to conversations they're members of
CREATE POLICY "Users can send messages" ON messages
    FOR INSERT WITH CHECK (
        sender_id = auth.uid() AND
        EXISTS (
            SELECT 1 FROM conversation_members 
            WHERE conversation_members.conversation_id = messages.conversation_id 
            AND conversation_members.profile_id = auth.uid()
            AND conversation_members.left_at IS NULL
        )
    );

-- Users can update their own messages (edit)
CREATE POLICY "Users can update own messages" ON messages
    FOR UPDATE USING (sender_id = auth.uid())
    WITH CHECK (sender_id = auth.uid());

-- Users can delete their own messages (soft delete)
CREATE POLICY "Users can delete own messages" ON messages
    FOR UPDATE USING (sender_id = auth.uid())
    WITH CHECK (sender_id = auth.uid() AND is_deleted = true);

-- Conversation admins can delete any message
CREATE POLICY "Conversation admins can delete messages" ON messages
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM conversation_members cm
            WHERE cm.conversation_id = messages.conversation_id
            AND cm.profile_id = auth.uid()
            AND cm.role IN ('admin', 'owner')
            AND cm.left_at IS NULL
        )
    )
    WITH CHECK (is_deleted = true);

-- ============================================
-- MESSAGE_ATTACHMENTS POLICIES
-- ============================================
-- Access through parent message
CREATE POLICY "Message attachments accessible via messages" ON message_attachments
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM messages m
            JOIN conversation_members cm ON cm.conversation_id = m.conversation_id
            WHERE m.id = message_attachments.message_id
            AND cm.profile_id = auth.uid()
            AND cm.left_at IS NULL
            AND m.is_deleted = false
        )
    );

-- Users can upload attachments for their messages
CREATE POLICY "Users can upload attachments" ON message_attachments
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM messages m
            WHERE m.id = message_attachments.message_id
            AND m.sender_id = auth.uid()
        )
    );

-- ============================================
-- NOTIFICATIONS POLICIES
-- ============================================
-- Users can view their own notifications
CREATE POLICY "Users can view own notifications" ON notifications
    FOR SELECT USING (recipient_id = auth.uid());

-- Users can update their own notifications (mark as read)
CREATE POLICY "Users can update own notifications" ON notifications
    FOR UPDATE USING (recipient_id = auth.uid())
    WITH CHECK (recipient_id = auth.uid());

-- System can create notifications
CREATE POLICY "Service can create notifications" ON notifications
    FOR INSERT WITH CHECK (auth.role() = 'service_role');

-- ============================================
-- CALL_HISTORY POLICIES
-- ============================================
-- Users can view their own call history
CREATE POLICY "Users can view own call history" ON call_history
    FOR SELECT USING (caller_id = auth.uid() OR callee_id = auth.uid());

-- System can create call history
CREATE POLICY "Service can create call history" ON call_history
    FOR INSERT WITH CHECK (auth.role() = 'service_role');

-- ============================================
-- SETTINGS POLICIES
-- ============================================
-- Public can view public settings
CREATE POLICY "Public can view public settings" ON settings
    FOR SELECT USING (is_public = true);

-- Admins can manage all settings
CREATE POLICY "Admins can manage settings" ON settings
    FOR ALL USING (is_admin_or_owner())
    WITH CHECK (is_admin_or_owner());

-- ============================================
-- REVIEWS POLICIES
-- ============================================
-- Public can view reviews
CREATE POLICY "Public can view reviews" ON reviews
    FOR SELECT USING (true);

-- Customers can create reviews for their orders
CREATE POLICY "Customers can create reviews" ON reviews
    FOR INSERT WITH CHECK (
        customer_id = auth.uid() AND
        EXISTS (
            SELECT 1 FROM orders 
            WHERE orders.id = reviews.order_id 
            AND orders.customer_id = auth.uid()
            AND orders.status = 'delivered'
        )
    );

-- Customers can update their own reviews
CREATE POLICY "Customers can update own reviews" ON reviews
    FOR UPDATE USING (customer_id = auth.uid())
    WITH CHECK (customer_id = auth.uid());

-- Store owners can respond to reviews for their stores
CREATE POLICY "Owners can respond to reviews" ON reviews
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM stores 
            WHERE stores.id = reviews.store_id 
            AND stores.owner_id = auth.uid()
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM stores 
            WHERE stores.id = reviews.store_id 
            AND stores.owner_id = auth.uid()
        )
    );

-- Admins can manage all reviews
CREATE POLICY "Admins can manage reviews" ON reviews
    FOR ALL USING (is_admin_or_owner())
    WITH CHECK (is_admin_or_owner());