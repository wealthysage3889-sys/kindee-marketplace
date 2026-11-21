-- 014_chat_voice_enhancements.sql
-- Chat/voice enhancements: spam management, per-user chat preferences,
-- read markers and idempotent message delivery.
--
-- LOCAL ONLY. Do NOT run this against Supabase Cloud / production without the
-- separate approval + runbook required by the Kindee deployment policy.
--
-- Preconditions: 001_initial_schema.sql (conversations, conversation_members,
-- messages, profiles) and 011_conversation_customer_id.sql have been applied.
-- All changes are additive; no existing column, row or data is modified.

BEGIN;

-- ---------------------------------------------------------------------------
-- Spam management (store side)
-- A conversation marked as spam is hidden from the store's main inbox but is
-- never deleted: messages, order links and call history stay intact.
-- ---------------------------------------------------------------------------
ALTER TABLE conversations
    ADD COLUMN IF NOT EXISTS is_spam BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE conversations
    ADD COLUMN IF NOT EXISTS spam_marked_at TIMESTAMPTZ;

ALTER TABLE conversations
    ADD COLUMN IF NOT EXISTS spam_marked_by UUID REFERENCES profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_store_spam
    ON conversations (store_id, is_spam, last_message_at DESC);

-- ---------------------------------------------------------------------------
-- Per-user chat preferences
-- `alias` lets one participant rename the chat for themselves without changing
-- the counterpart profile or any message content. `is_hidden` hides a chat from
-- that user's list only. Neither touches message/order data.
-- ---------------------------------------------------------------------------
ALTER TABLE conversation_members
    ADD COLUMN IF NOT EXISTS alias TEXT;

ALTER TABLE conversation_members
    ADD COLUMN IF NOT EXISTS is_hidden BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_conversation_members_hidden
    ON conversation_members (profile_id, is_hidden);

-- Persisted read marker so a reconnect can restore accurate read receipts
-- instead of relying only on the last_read_at timestamp.
ALTER TABLE conversation_members
    ADD COLUMN IF NOT EXISTS last_read_message_id UUID REFERENCES messages(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- Idempotent message delivery
-- The client attaches a UUID per send attempt. A retry (network timeout,
-- reconnect replay, double submit) with the same id returns the original
-- message instead of inserting a duplicate.
-- ---------------------------------------------------------------------------
ALTER TABLE messages
    ADD COLUMN IF NOT EXISTS client_message_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS ux_messages_client_id
    ON messages (conversation_id, sender_id, client_message_id)
    WHERE client_message_id IS NOT NULL;

COMMIT;
