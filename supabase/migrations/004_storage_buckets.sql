-- Storage Buckets and Policies
-- ============================================
-- Every reference to the object path is written as storage.objects.name.
-- Inside a policy subquery a bare `name` is ambiguous (42702) because tables
-- such as stores/products also expose a `name` column.
-- Each policy is preceded by DROP POLICY IF EXISTS so the file can be re-run
-- after a partial run.

-- Create storage buckets
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) VALUES
('avatars', 'avatars', true, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']),
('store-logos', 'store-logos', true, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']),
('store-covers', 'store-covers', true, 10485760, ARRAY['image/jpeg', 'image/png', 'image/webp']),
('product-images', 'product-images', true, 10485760, ARRAY['image/jpeg', 'image/png', 'image/webp']),
('chat-attachments', 'chat-attachments', false, 20971520, ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']),
('voice-recordings', 'voice-recordings', false, 10485760, ARRAY['audio/webm', 'audio/ogg', 'audio/mpeg'])
ON CONFLICT (id) DO UPDATE SET
    public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ============================================
-- AVATARS BUCKET POLICIES
-- ============================================
-- Public can view avatars
DROP POLICY IF EXISTS "Public can view avatars" ON storage.objects;
CREATE POLICY "Public can view avatars" ON storage.objects
    FOR SELECT USING (bucket_id = 'avatars');

-- Users can upload their own avatar
DROP POLICY IF EXISTS "Users can upload own avatar" ON storage.objects;
CREATE POLICY "Users can upload own avatar" ON storage.objects
    FOR INSERT WITH CHECK (
        bucket_id = 'avatars' 
        AND auth.uid()::TEXT = (storage.foldername(storage.objects.name))[1]
    );

-- Users can update their own avatar
DROP POLICY IF EXISTS "Users can update own avatar" ON storage.objects;
CREATE POLICY "Users can update own avatar" ON storage.objects
    FOR UPDATE USING (
        bucket_id = 'avatars' 
        AND auth.uid()::TEXT = (storage.foldername(storage.objects.name))[1]
    )
    WITH CHECK (
        bucket_id = 'avatars' 
        AND auth.uid()::TEXT = (storage.foldername(storage.objects.name))[1]
    );

-- Users can delete their own avatar
DROP POLICY IF EXISTS "Users can delete own avatar" ON storage.objects;
CREATE POLICY "Users can delete own avatar" ON storage.objects
    FOR DELETE USING (
        bucket_id = 'avatars' 
        AND auth.uid()::TEXT = (storage.foldername(storage.objects.name))[1]
    );

-- ============================================
-- STORE LOGOS BUCKET POLICIES
-- ============================================
-- Public can view store logos
DROP POLICY IF EXISTS "Public can view store logos" ON storage.objects;
CREATE POLICY "Public can view store logos" ON storage.objects
    FOR SELECT USING (bucket_id = 'store-logos');

-- Store owners can upload logos for their stores
DROP POLICY IF EXISTS "Store owners can upload logos" ON storage.objects;
CREATE POLICY "Store owners can upload logos" ON storage.objects
    FOR INSERT WITH CHECK (
        bucket_id = 'store-logos' 
        AND EXISTS (
            SELECT 1 FROM stores 
            WHERE stores.id::TEXT = (storage.foldername(storage.objects.name))[1] 
            AND stores.owner_id = auth.uid()
        )
    );

-- Store owners can update their store logos
DROP POLICY IF EXISTS "Store owners can update logos" ON storage.objects;
CREATE POLICY "Store owners can update logos" ON storage.objects
    FOR UPDATE USING (
        bucket_id = 'store-logos' 
        AND EXISTS (
            SELECT 1 FROM stores 
            WHERE stores.id::TEXT = (storage.foldername(storage.objects.name))[1] 
            AND stores.owner_id = auth.uid()
        )
    )
    WITH CHECK (
        bucket_id = 'store-logos' 
        AND EXISTS (
            SELECT 1 FROM stores 
            WHERE stores.id::TEXT = (storage.foldername(storage.objects.name))[1] 
            AND stores.owner_id = auth.uid()
        )
    );

-- Store owners can delete their store logos
DROP POLICY IF EXISTS "Store owners can delete logos" ON storage.objects;
CREATE POLICY "Store owners can delete logos" ON storage.objects
    FOR DELETE USING (
        bucket_id = 'store-logos' 
        AND EXISTS (
            SELECT 1 FROM stores 
            WHERE stores.id::TEXT = (storage.foldername(storage.objects.name))[1] 
            AND stores.owner_id = auth.uid()
        )
    );

-- ============================================
-- STORE COVERS BUCKET POLICIES
-- ============================================
-- Public can view store covers
DROP POLICY IF EXISTS "Public can view store covers" ON storage.objects;
CREATE POLICY "Public can view store covers" ON storage.objects
    FOR SELECT USING (bucket_id = 'store-covers');

-- Store owners can manage their store covers
DROP POLICY IF EXISTS "Store owners can manage covers" ON storage.objects;
CREATE POLICY "Store owners can manage covers" ON storage.objects
    FOR ALL USING (
        bucket_id = 'store-covers' 
        AND EXISTS (
            SELECT 1 FROM stores 
            WHERE stores.id::TEXT = (storage.foldername(storage.objects.name))[1] 
            AND stores.owner_id = auth.uid()
        )
    )
    WITH CHECK (
        bucket_id = 'store-covers' 
        AND EXISTS (
            SELECT 1 FROM stores 
            WHERE stores.id::TEXT = (storage.foldername(storage.objects.name))[1] 
            AND stores.owner_id = auth.uid()
        )
    );

-- ============================================
-- PRODUCT IMAGES BUCKET POLICIES
-- ============================================
-- Public can view product images
DROP POLICY IF EXISTS "Public can view product images" ON storage.objects;
CREATE POLICY "Public can view product images" ON storage.objects
    FOR SELECT USING (bucket_id = 'product-images');

-- Store owners can manage their product images
DROP POLICY IF EXISTS "Store owners can manage product images" ON storage.objects;
CREATE POLICY "Store owners can manage product images" ON storage.objects
    FOR ALL USING (
        bucket_id = 'product-images' 
        AND EXISTS (
            SELECT 1 FROM products p
            JOIN stores s ON s.id = p.store_id
            WHERE p.id::TEXT = (storage.foldername(storage.objects.name))[1] 
            AND s.owner_id = auth.uid()
        )
    )
    WITH CHECK (
        bucket_id = 'product-images' 
        AND EXISTS (
            SELECT 1 FROM products p
            JOIN stores s ON s.id = p.store_id
            WHERE p.id::TEXT = (storage.foldername(storage.objects.name))[1] 
            AND s.owner_id = auth.uid()
        )
    );

-- ============================================
-- CHAT ATTACHMENTS BUCKET POLICIES
-- ============================================
-- Conversation members can view attachments
DROP POLICY IF EXISTS "Conversation members can view attachments" ON storage.objects;
CREATE POLICY "Conversation members can view attachments" ON storage.objects
    FOR SELECT USING (
        bucket_id = 'chat-attachments' 
        AND EXISTS (
            SELECT 1 FROM conversation_members cm
            JOIN messages m ON m.conversation_id = cm.conversation_id
            JOIN message_attachments ma ON ma.message_id = m.id
            WHERE ma.file_url LIKE '%' || storage.objects.name
            AND cm.profile_id = auth.uid()
            AND cm.left_at IS NULL
        )
    );

-- Conversation members can upload attachments
DROP POLICY IF EXISTS "Conversation members can upload attachments" ON storage.objects;
CREATE POLICY "Conversation members can upload attachments" ON storage.objects
    FOR INSERT WITH CHECK (
        bucket_id = 'chat-attachments' 
        AND EXISTS (
            SELECT 1 FROM conversation_members 
            WHERE conversation_members.conversation_id::TEXT = (storage.foldername(storage.objects.name))[1] 
            AND conversation_members.profile_id = auth.uid()
            AND conversation_members.left_at IS NULL
        )
    );

-- ============================================
-- VOICE RECORDINGS BUCKET POLICIES
-- ============================================
-- Call participants can access recordings
DROP POLICY IF EXISTS "Call participants can access recordings" ON storage.objects;
CREATE POLICY "Call participants can access recordings" ON storage.objects
    FOR SELECT USING (
        bucket_id = 'voice-recordings' 
        AND EXISTS (
            SELECT 1 FROM call_history ch
            WHERE (ch.caller_id = auth.uid() OR ch.callee_id = auth.uid())
            AND ch.id::TEXT = (storage.foldername(storage.objects.name))[1]
        )
    );

-- System can upload recordings (with consent)
DROP POLICY IF EXISTS "System can upload recordings" ON storage.objects;
CREATE POLICY "System can upload recordings" ON storage.objects
    FOR INSERT WITH CHECK (
        bucket_id = 'voice-recordings' 
        AND auth.role() = 'service_role'
    );

-- ============================================
-- ADMIN ACCESS TO ALL BUCKETS
-- ============================================
DROP POLICY IF EXISTS "Admins can manage all storage" ON storage.objects;
CREATE POLICY "Admins can manage all storage" ON storage.objects
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