-- 016_consolidated_chat_schema_drift.sql
-- Consolidated, idempotent repair for chat schema drift.
-- LOCAL ONLY. Do not run against production without approval.
BEGIN;

ALTER TABLE conversations
    ADD COLUMN IF NOT EXISTS is_spam BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE conversations
    ADD COLUMN IF NOT EXISTS spam_marked_at TIMESTAMPTZ;

ALTER TABLE conversations
    ADD COLUMN IF NOT EXISTS spam_marked_by UUID REFERENCES profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_store_spam
    ON conversations (store_id, is_spam, last_message_at DESC);

ALTER TABLE conversation_members
    ADD COLUMN IF NOT EXISTS alias TEXT;

ALTER TABLE conversation_members
    ADD COLUMN IF NOT EXISTS is_hidden BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE conversation_members
    ADD COLUMN IF NOT EXISTS last_read_message_id UUID REFERENCES messages(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_conversation_members_hidden
    ON conversation_members (profile_id, is_hidden);

ALTER TABLE messages
    ADD COLUMN IF NOT EXISTS client_message_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS ux_messages_client_id
    ON messages (conversation_id, sender_id, client_message_id)
    WHERE client_message_id IS NOT NULL;

COMMIT;
