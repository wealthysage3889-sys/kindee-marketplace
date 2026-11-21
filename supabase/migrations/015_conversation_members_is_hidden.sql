-- 015_conversation_members_is_hidden.sql
-- ---------------------------------------------------------------------------
-- Fix: column conversation_members.is_hidden does not exist
--
-- Root cause
--   `backend/services/chatService.js` (getUserConversations,
--   getStoreConversations, updateConversationHidden) and the frontend
--   Messages component all reference `conversation_members.is_hidden`.
--   Migration 014_chat_voice_enhancements.sql declares the column but was
--   NEVER applied to the active local database, so the SELECT / UPDATE /
--   PATCH against that column fail with:
--       ERROR: column conversation_members.is_hidden does not exist
--
-- Intended behavior (unchanged by this migration)
--   `is_hidden` is a per-user, per-conversation boolean on
--   `conversation_members`. When true it hides that conversation from the
--   owner's chat list only. It never touches messages, order links, call
--   history or any other row. A hidden chat is still readable by direct id
--   and still receives messages/notifications.
--
-- Safety
--   - Additive only (ADD COLUMN IF NOT EXISTS). No existing column, row or
--     data is modified or dropped.
--   - NOT NULL DEFAULT false: every existing row is backfilled to false
--     implicitly by the DEFAULT, so the column is safe to query immediately.
--   - Idempotent: re-running on an already-applied DB is a no-op.
--   - LOCAL ONLY. Must NOT be run against Supabase Cloud / production
--     without the separate approval + runbook required by the Kindee
--     deployment policy.
--
-- Rollback
--   ALTER TABLE conversation_members DROP COLUMN IF EXISTS is_hidden;
--   DROP INDEX IF EXISTS idx_conversation_members_hidden;
-- ---------------------------------------------------------------------------

BEGIN;

ALTER TABLE conversation_members
    ADD COLUMN IF NOT EXISTS is_hidden BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_conversation_members_hidden
    ON conversation_members (profile_id, is_hidden);

COMMIT;

-- Rollback (manual, NOT executed by this file):
-- BEGIN;
-- ALTER TABLE conversation_members DROP COLUMN IF EXISTS is_hidden;
-- DROP INDEX IF EXISTS idx_conversation_members_hidden;
-- COMMIT;