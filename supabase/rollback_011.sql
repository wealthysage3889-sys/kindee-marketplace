-- rollback_011_conversation_customer_id.sql
-- 011 is NOT fully reversible: merged conversations deleted cannot be restored without backup.
-- This script restores schema only and re-points from archive if present.
-- Step 1: restore deleted conversations from archive (best-effort)
INSERT INTO conversations (id, customer_id, store_id, type, created_at, updated_at, last_message_at)
SELECT id, customer_id, store_id, type, archived_at, archived_at, NULL
FROM conversations_merge_archive a
WHERE NOT EXISTS (SELECT 1 FROM conversations c WHERE c.id = a.id)
ON CONFLICT DO NOTHING;

-- Step 2: drop new constraints/indexes
DROP INDEX IF EXISTS ux_conversations_store_customer;
DROP INDEX IF EXISTS idx_conversations_customer_id;
ALTER TABLE conversation_members DROP CONSTRAINT IF EXISTS conversation_members_role_check;

-- Step 3: remove customer_id column (loses data)
ALTER TABLE conversations DROP COLUMN IF EXISTS customer_id;

-- Note: messages/call_history re-pointed to keep_id are NOT automatically split back.
-- Use backup or conversations_merge_archive payload to manually restore if needed.
-- Archive table retained for forensic recovery.
