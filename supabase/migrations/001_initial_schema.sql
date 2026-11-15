-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "postgis";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- pg_trgm backs the ILIKE '%q%' product search. Supabase ships no 'thai' text
-- search configuration, and Thai has no word boundaries for a tsvector parser to
-- split on, so trigram matching is the option that works on Supabase.
-- Installed into the extensions schema (Supabase's convention) and always
-- referenced schema-qualified, so it does not depend on search_path.
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

-- Custom types
CREATE TYPE user_role AS ENUM ('customer', 'seller', 'admin', 'owner', 'courier');
CREATE TYPE order_status AS ENUM ('pending', 'confirmed', 'preparing', 'ready_for_pickup', 'picked_up', 'in_transit', 'delivered', 'cancelled', 'refunded');
CREATE TYPE payment_status AS ENUM ('pending', 'paid', 'failed', 'refunded', 'partially_refunded');
CREATE TYPE payment_method AS ENUM ('cod', 'transfer', 'promptpay', 'card', 'wallet');
CREATE TYPE delivery_type AS ENUM ('store_delivery', 'platform_courier');
CREATE TYPE delivery_status AS ENUM ('pending', 'assigned', 'picked_up', 'in_transit', 'delivered', 'failed', 'cancelled');
CREATE TYPE conversation_type AS ENUM ('direct', 'group', 'store_customer', 'order_support');
CREATE TYPE message_type AS ENUM ('text', 'image', 'file', 'location', 'system', 'order_update', 'voice_call');
CREATE TYPE call_status AS ENUM ('ringing', 'accepted', 'rejected', 'missed', 'ended');
CREATE TYPE notification_type AS ENUM ('new_message', 'order_status', 'delivery_update', 'incoming_call', 'missed_call', 'payment', 'refund', 'system', 'promotion');
CREATE TYPE inventory_reservation_status AS ENUM ('active', 'expired', 'fulfilled', 'cancelled');

-- Profiles table (extends Supabase auth.users)
CREATE TABLE profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT UNIQUE NOT NULL,
    phone TEXT UNIQUE,
    name TEXT,
    avatar_url TEXT,
    role user_role NOT NULL DEFAULT 'customer',
    is_active BOOLEAN DEFAULT true,
    legacy_id TEXT, -- For MongoDB migration reference
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_profiles_email ON profiles(email);
CREATE INDEX idx_profiles_phone ON profiles(phone);
CREATE INDEX idx_profiles_role ON profiles(role);
CREATE INDEX idx_profiles_legacy_id ON profiles(legacy_id);

-- Stores table
CREATE TABLE stores (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    owner_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    description TEXT,
    logo_url TEXT,
    cover_image_url TEXT,
    address JSONB NOT NULL DEFAULT '{}', -- {street, district, province, postal_code, coordinates: {lat, lng}}
    phone TEXT,
    email TEXT,
    opening_hours JSONB DEFAULT '{}',
    categories TEXT[] DEFAULT '{}',
    is_active BOOLEAN DEFAULT true,
    is_verified BOOLEAN DEFAULT false,
    rating_average NUMERIC(3,2) DEFAULT 0,
    rating_count INTEGER DEFAULT 0,
    delivery_fee NUMERIC(10,2) DEFAULT 0,
    minimum_order NUMERIC(10,2) DEFAULT 0,
    estimated_delivery_time INTEGER DEFAULT 30, -- minutes
    delivery_type delivery_type DEFAULT 'store_delivery',
    legacy_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_stores_owner_id ON stores(owner_id);
CREATE INDEX idx_stores_slug ON stores(slug);
CREATE INDEX idx_stores_is_active ON stores(is_active, is_verified);
CREATE INDEX idx_stores_legacy_id ON stores(legacy_id);

-- Store coordinates as a real column so a plain GiST index can be built on it.
-- An expression index cannot be written as USING GIST (ST_SetSRID(...)::geography)
-- because the cast at the top level of the index element is a syntax error; the
-- column keeps the index simple and lets PostGIS use its default geography opclass.
ALTER TABLE stores ADD COLUMN IF NOT EXISTS location GEOGRAPHY(POINT, 4326);

-- Convert address.coordinates {lat, lng} into a geography point.
-- Returns NULL for missing, malformed or out-of-range coordinates instead of raising.
CREATE OR REPLACE FUNCTION stores_address_to_geography(p_address JSONB)
RETURNS GEOGRAPHY AS $$
DECLARE
    v_lat DOUBLE PRECISION;
    v_lng DOUBLE PRECISION;
BEGIN
    IF p_address IS NULL OR NOT (p_address ? 'coordinates') THEN
        RETURN NULL;
    END IF;

    v_lat := NULLIF(p_address->'coordinates'->>'lat', '')::DOUBLE PRECISION;
    v_lng := NULLIF(p_address->'coordinates'->>'lng', '')::DOUBLE PRECISION;

    IF v_lat IS NULL OR v_lng IS NULL THEN
        RETURN NULL;
    END IF;

    IF v_lat < -90 OR v_lat > 90 OR v_lng < -180 OR v_lng > 180 THEN
        RETURN NULL;
    END IF;

    RETURN ST_SetSRID(ST_MakePoint(v_lng, v_lat), 4326)::GEOGRAPHY;
EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Backfill existing rows (invalid coordinates become NULL)
UPDATE stores SET location = stores_address_to_geography(address);

CREATE INDEX IF NOT EXISTS idx_stores_location ON stores USING GIST (location);

-- Keep location in sync whenever address is inserted or changed
CREATE OR REPLACE FUNCTION stores_sync_location()
RETURNS TRIGGER AS $$
BEGIN
    NEW.location := stores_address_to_geography(NEW.address);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS stores_sync_location_trigger ON stores;
CREATE TRIGGER stores_sync_location_trigger
    BEFORE INSERT OR UPDATE OF address ON stores
    FOR EACH ROW EXECUTE FUNCTION stores_sync_location();

-- Categories table
CREATE TABLE categories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    description TEXT,
    image_url TEXT,
    parent_id UUID REFERENCES categories(id) ON DELETE SET NULL,
    sort_order INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    legacy_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_categories_parent_id ON categories(parent_id);
CREATE INDEX idx_categories_slug ON categories(slug);

-- Products table
CREATE TABLE products (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    description TEXT,
    price NUMERIC(10,2) NOT NULL CHECK (price >= 0),
    discount_price NUMERIC(10,2) CHECK (discount_price >= 0),
    stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
    reserved_stock INTEGER NOT NULL DEFAULT 0 CHECK (reserved_stock >= 0),
    images TEXT[] DEFAULT '{}',
    tags TEXT[] DEFAULT '{}',
    rating_average NUMERIC(3,2) DEFAULT 0,
    rating_count INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    legacy_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (store_id, slug)
);

-- IF NOT EXISTS so the migration can resume right after the products table
CREATE INDEX IF NOT EXISTS idx_products_store_id ON products(store_id);
CREATE INDEX IF NOT EXISTS idx_products_category_id ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_is_active ON products(is_active);
CREATE INDEX IF NOT EXISTS idx_products_legacy_id ON products(legacy_id);

-- Product search is `name ILIKE '%q%' OR description ILIKE '%q%'` (PostgREST OR filter),
-- so it needs trigram GIN indexes on those two columns. A tsvector index cannot serve it,
-- and there is no 'thai' text search configuration on Supabase to build one with.
CREATE INDEX IF NOT EXISTS idx_products_name_trgm ON products USING GIN (name extensions.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_products_description_trgm ON products USING GIN (description extensions.gin_trgm_ops);

-- Store Products (for marketplace - products from multiple stores)
CREATE TABLE store_products (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    price_override NUMERIC(10,2),
    stock_override INTEGER,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (store_id, product_id)
);

CREATE INDEX idx_store_products_store_id ON store_products(store_id);
CREATE INDEX idx_store_products_product_id ON store_products(product_id);

-- Orders (Parent Order)
CREATE TABLE orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_id UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
    order_number TEXT UNIQUE NOT NULL,
    status order_status NOT NULL DEFAULT 'pending',
    payment_status payment_status NOT NULL DEFAULT 'pending',
    payment_method payment_method NOT NULL DEFAULT 'cod',
    
    -- Pricing
    subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
    shipping_fee NUMERIC(10,2) NOT NULL DEFAULT 0,
    tax_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
    discount_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
    total_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
    
    -- Customer snapshot at order time
    customer_snapshot JSONB NOT NULL DEFAULT '{}', -- {name, phone, email, address}
    
    -- Delivery info
    delivery_type delivery_type NOT NULL DEFAULT 'store_delivery',
    estimated_delivery_time INTEGER,
    
    -- Notes
    customer_notes TEXT,
    admin_notes TEXT,
    
    -- Timestamps
    confirmed_at TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ,
    delivered_at TIMESTAMPTZ,
    legacy_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_orders_customer_id ON orders(customer_id);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_order_number ON orders(order_number);
CREATE INDEX idx_orders_legacy_id ON orders(legacy_id);
CREATE INDEX idx_orders_created_at ON orders(created_at DESC);

-- Store Orders (Child orders for each store)
CREATE TABLE store_orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    parent_order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
    store_order_number TEXT UNIQUE NOT NULL,
    status order_status NOT NULL DEFAULT 'pending',
    
    -- Pricing per store
    subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
    shipping_fee NUMERIC(10,2) NOT NULL DEFAULT 0,
    tax_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
    discount_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
    total_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
    
    -- Delivery
    delivery_type delivery_type NOT NULL DEFAULT 'store_delivery',
    courier_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
    estimated_delivery_time INTEGER,
    
    -- Store snapshot
    store_snapshot JSONB NOT NULL DEFAULT '{}', -- {name, address, phone}
    
    -- Timestamps
    confirmed_at TIMESTAMPTZ,
    ready_for_pickup_at TIMESTAMPTZ,
    picked_up_at TIMESTAMPTZ,
    delivered_at TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ,
    legacy_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_store_orders_parent_order_id ON store_orders(parent_order_id);
CREATE INDEX idx_store_orders_store_id ON store_orders(store_id);
CREATE INDEX idx_store_orders_courier_id ON store_orders(courier_id);
CREATE INDEX idx_store_orders_status ON store_orders(status);
CREATE INDEX idx_store_orders_legacy_id ON store_orders(legacy_id);

-- Order Items
CREATE TABLE order_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    store_order_id UUID NOT NULL REFERENCES store_orders(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    product_name TEXT NOT NULL,
    product_image TEXT,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    unit_price NUMERIC(10,2) NOT NULL CHECK (unit_price >= 0),
    discount_price NUMERIC(10,2),
    total_price NUMERIC(12,2) NOT NULL CHECK (total_price >= 0),
    product_snapshot JSONB NOT NULL DEFAULT '{}', -- Full product data at order time
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_order_items_store_order_id ON order_items(store_order_id);
CREATE INDEX idx_order_items_product_id ON order_items(product_id);

-- Order Status History
CREATE TABLE order_status_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    store_order_id UUID REFERENCES store_orders(id) ON DELETE CASCADE,
    from_status order_status,
    to_status order_status NOT NULL,
    changed_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
    reason TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_order_status_history_order_id ON order_status_history(order_id);
CREATE INDEX idx_order_status_history_store_order_id ON order_status_history(store_order_id);
CREATE INDEX idx_order_status_history_created_at ON order_status_history(created_at DESC);

-- Inventory Reservations
CREATE TABLE inventory_reservations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    store_order_id UUID NOT NULL REFERENCES store_orders(id) ON DELETE CASCADE,
    order_item_id UUID NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    status inventory_reservation_status NOT NULL DEFAULT 'active',
    expires_at TIMESTAMPTZ NOT NULL,
    fulfilled_at TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_inventory_reservations_product_id ON inventory_reservations(product_id);
CREATE INDEX idx_inventory_reservations_store_order_id ON inventory_reservations(store_order_id);
CREATE INDEX idx_inventory_reservations_status_expires ON inventory_reservations(status, expires_at);
CREATE INDEX idx_inventory_reservations_order_item_id ON inventory_reservations(order_item_id);

-- Payments
CREATE TABLE payments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    store_order_id UUID REFERENCES store_orders(id) ON DELETE CASCADE,
    payment_number TEXT UNIQUE NOT NULL,
    amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
    method payment_method NOT NULL,
    status payment_status NOT NULL DEFAULT 'pending',
    
    -- External payment reference
    external_reference TEXT,
    gateway_response JSONB DEFAULT '{}',
    
    -- Refund tracking
    refunded_amount NUMERIC(12,2) DEFAULT 0,
    
    processed_at TIMESTAMPTZ,
    failed_at TIMESTAMPTZ,
    legacy_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_payments_order_id ON payments(order_id);
CREATE INDEX idx_payments_store_order_id ON payments(store_order_id);
CREATE INDEX idx_payments_status ON payments(status);
CREATE INDEX idx_payments_external_reference ON payments(external_reference);
CREATE INDEX idx_payments_legacy_id ON payments(legacy_id);

-- Refunds
CREATE TABLE refunds (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    payment_id UUID NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    store_order_id UUID REFERENCES store_orders(id) ON DELETE CASCADE,
    refund_number TEXT UNIQUE NOT NULL,
    amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
    reason TEXT NOT NULL,
    status payment_status NOT NULL DEFAULT 'pending',
    approved_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
    processed_at TIMESTAMPTZ,
    legacy_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_refunds_payment_id ON refunds(payment_id);
CREATE INDEX idx_refunds_order_id ON refunds(order_id);
CREATE INDEX idx_refunds_status ON refunds(status);
CREATE INDEX idx_refunds_legacy_id ON refunds(legacy_id);

-- Couriers
CREATE TABLE couriers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    profile_id UUID NOT NULL UNIQUE REFERENCES profiles(id) ON DELETE CASCADE,
    vehicle_type TEXT, -- motorcycle, car, bicycle, walk
    vehicle_plate TEXT,
    license_number TEXT,
    is_available BOOLEAN DEFAULT true,
    is_verified BOOLEAN DEFAULT false,
    current_location GEOGRAPHY(POINT, 4326),
    last_location_update TIMESTAMPTZ,
    rating_average NUMERIC(3,2) DEFAULT 0,
    rating_count INTEGER DEFAULT 0,
    total_deliveries INTEGER DEFAULT 0,
    legacy_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_couriers_profile_id ON couriers(profile_id);
CREATE INDEX idx_couriers_is_available ON couriers(is_available, is_verified);
CREATE INDEX idx_couriers_location ON couriers USING GIST (current_location);

-- Deliveries
CREATE TABLE deliveries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    store_order_id UUID NOT NULL UNIQUE REFERENCES store_orders(id) ON DELETE CASCADE,
    courier_id UUID REFERENCES couriers(id) ON DELETE SET NULL,
    delivery_type delivery_type NOT NULL,
    
    -- Pickup location (store)
    pickup_address JSONB NOT NULL DEFAULT '{}',
    pickup_coordinates GEOGRAPHY(POINT, 4326),
    
    -- Delivery location (customer)
    delivery_address JSONB NOT NULL DEFAULT '{}',
    delivery_coordinates GEOGRAPHY(POINT, 4326),
    
    -- Route info
    distance_km NUMERIC(8,2),
    estimated_duration_min INTEGER,
    route_geometry JSONB, -- GeoJSON LineString
    
    status delivery_status NOT NULL DEFAULT 'pending',
    assigned_at TIMESTAMPTZ,
    picked_up_at TIMESTAMPTZ,
    delivered_at TIMESTAMPTZ,
    failed_at TIMESTAMPTZ,
    failure_reason TEXT,
    
    legacy_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_deliveries_store_order_id ON deliveries(store_order_id);
CREATE INDEX idx_deliveries_courier_id ON deliveries(courier_id);
CREATE INDEX idx_deliveries_status ON deliveries(status);
CREATE INDEX idx_deliveries_pickup_location ON deliveries USING GIST (pickup_coordinates);
CREATE INDEX idx_deliveries_delivery_location ON deliveries USING GIST (delivery_coordinates);

-- Delivery Assignments (for courier assignment workflow)
CREATE TABLE delivery_assignments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    delivery_id UUID NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE,
    courier_id UUID NOT NULL REFERENCES couriers(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'offered', -- offered, accepted, rejected, expired, cancelled
    offered_at TIMESTAMPTZ DEFAULT NOW(),
    responded_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_delivery_assignments_delivery_id ON delivery_assignments(delivery_id);
CREATE INDEX idx_delivery_assignments_courier_id ON delivery_assignments(courier_id);
CREATE INDEX idx_delivery_assignments_status ON delivery_assignments(status);

-- Delivery Status History
CREATE TABLE delivery_status_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    delivery_id UUID NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE,
    from_status delivery_status,
    to_status delivery_status NOT NULL,
    changed_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
    location GEOGRAPHY(POINT, 4326),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_delivery_status_history_delivery_id ON delivery_status_history(delivery_id);
CREATE INDEX idx_delivery_status_history_created_at ON delivery_status_history(created_at DESC);

-- Customer Destination (GPS snapshot at order time)
CREATE TABLE customer_destinations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id UUID NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
    coordinates GEOGRAPHY(POINT, 4326) NOT NULL,
    address JSONB NOT NULL DEFAULT '{}', -- Full formatted address
    place_name TEXT,
    is_verified BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_customer_destinations_order_id ON customer_destinations(order_id);
CREATE INDEX idx_customer_destinations_coordinates ON customer_destinations USING GIST (coordinates);

-- Courier Live Locations (real-time tracking during delivery)
CREATE TABLE courier_live_locations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    delivery_id UUID NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE,
    courier_id UUID NOT NULL REFERENCES couriers(id) ON DELETE CASCADE,
    coordinates GEOGRAPHY(POINT, 4326) NOT NULL,
    accuracy NUMERIC(8,2), -- meters
    speed_kmh NUMERIC(6,2),
    heading NUMERIC(6,2),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_courier_live_locations_delivery_id ON courier_live_locations(delivery_id);
CREATE INDEX idx_courier_live_locations_courier_id ON courier_live_locations(courier_id);
CREATE INDEX idx_courier_live_locations_created_at ON courier_live_locations(created_at DESC);

-- Conversations
CREATE TABLE conversations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    type conversation_type NOT NULL DEFAULT 'direct',
    store_id UUID REFERENCES stores(id) ON DELETE CASCADE,
    order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
    store_order_id UUID REFERENCES store_orders(id) ON DELETE SET NULL,
    title TEXT, -- For group chats
    avatar_url TEXT,
    metadata JSONB DEFAULT '{}',
    last_message_at TIMESTAMPTZ,
    legacy_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_conversations_store_id ON conversations(store_id);
CREATE INDEX idx_conversations_order_id ON conversations(order_id);
CREATE INDEX idx_conversations_store_order_id ON conversations(store_order_id);
CREATE INDEX idx_conversations_last_message_at ON conversations(last_message_at DESC);

-- Conversation Members
CREATE TABLE conversation_members (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    role TEXT DEFAULT 'member', -- member, admin, owner
    joined_at TIMESTAMPTZ DEFAULT NOW(),
    left_at TIMESTAMPTZ,
    last_read_at TIMESTAMPTZ,
    unread_count INTEGER DEFAULT 0,
    is_muted BOOLEAN DEFAULT false,
    UNIQUE (conversation_id, profile_id)
);

CREATE INDEX idx_conversation_members_conversation_id ON conversation_members(conversation_id);
CREATE INDEX idx_conversation_members_profile_id ON conversation_members(profile_id);
CREATE INDEX idx_conversation_members_unread ON conversation_members(profile_id, unread_count) WHERE unread_count > 0;

-- Messages
CREATE TABLE messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    sender_id UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
    type message_type NOT NULL DEFAULT 'text',
    content TEXT,
    metadata JSONB DEFAULT '{}', -- For system messages, order updates, call info, etc.
    reply_to_id UUID REFERENCES messages(id) ON DELETE SET NULL,
    is_edited BOOLEAN DEFAULT false,
    is_deleted BOOLEAN DEFAULT false,
    deleted_at TIMESTAMPTZ,
    legacy_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_messages_conversation_id ON messages(conversation_id);
CREATE INDEX idx_messages_sender_id ON messages(sender_id);
CREATE INDEX idx_messages_reply_to_id ON messages(reply_to_id);
CREATE INDEX idx_messages_created_at ON messages(created_at DESC);
CREATE INDEX idx_messages_legacy_id ON messages(legacy_id);

-- Message Attachments
CREATE TABLE message_attachments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    file_url TEXT NOT NULL,
    file_name TEXT NOT NULL,
    file_size INTEGER NOT NULL,
    mime_type TEXT NOT NULL,
    width INTEGER,
    height INTEGER,
    duration_seconds INTEGER, -- for audio/video
    thumbnail_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_message_attachments_message_id ON message_attachments(message_id);

-- Notifications
CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    recipient_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    type notification_type NOT NULL,
    title TEXT NOT NULL,
    body TEXT,
    data JSONB DEFAULT '{}',
    related_id UUID, -- order_id, conversation_id, call_id, etc.
    related_type TEXT, -- 'order', 'conversation', 'call', 'delivery', etc.
    is_read BOOLEAN DEFAULT false,
    read_at TIMESTAMPTZ,
    legacy_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_notifications_recipient_id ON notifications(recipient_id);
CREATE INDEX idx_notifications_is_read ON notifications(recipient_id, is_read) WHERE is_read = false;
CREATE INDEX idx_notifications_created_at ON notifications(created_at DESC);
CREATE INDEX idx_notifications_legacy_id ON notifications(legacy_id);

-- Call History
CREATE TABLE call_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    caller_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    callee_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
    store_order_id UUID REFERENCES store_orders(id) ON DELETE SET NULL,
    status call_status NOT NULL,
    started_at TIMESTAMPTZ,
    answered_at TIMESTAMPTZ,
    ended_at TIMESTAMPTZ,
    duration_seconds INTEGER,
    end_reason TEXT, -- ended, rejected, missed, failed, network_error
    metadata JSONB DEFAULT '{}',
    legacy_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_call_history_caller_id ON call_history(caller_id);
CREATE INDEX idx_call_history_callee_id ON call_history(callee_id);
CREATE INDEX idx_call_history_conversation_id ON call_history(conversation_id);
CREATE INDEX idx_call_history_store_order_id ON call_history(store_order_id);
CREATE INDEX idx_call_history_status ON call_history(status);
CREATE INDEX idx_call_history_created_at ON call_history(created_at DESC);

-- Settings (for platform-wide settings)
CREATE TABLE settings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    key TEXT UNIQUE NOT NULL,
    value JSONB NOT NULL DEFAULT '{}',
    description TEXT,
    is_public BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_settings_key ON settings(key);
CREATE INDEX idx_settings_is_public ON settings(is_public);

-- Reviews
CREATE TABLE reviews (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    product_id UUID REFERENCES products(id) ON DELETE CASCADE,
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    store_order_id UUID REFERENCES store_orders(id) ON DELETE CASCADE,
    customer_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
    title TEXT,
    comment TEXT,
    images TEXT[] DEFAULT '{}',
    response TEXT, -- Store owner response
    responded_at TIMESTAMPTZ,
    is_verified_purchase BOOLEAN DEFAULT true,
    legacy_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_reviews_store_id ON reviews(store_id);
CREATE INDEX idx_reviews_product_id ON reviews(product_id);
CREATE INDEX idx_reviews_customer_id ON reviews(customer_id);
CREATE INDEX idx_reviews_order_id ON reviews(order_id);