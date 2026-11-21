-- 011_conversation_customer_id.sql
-- Add customer_id to conversations for store_customer uniqueness (NOT RUN)
-- Precondition: conversations, profiles, stores, conversation_members exist.

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='conversations' AND column_name='customer_id'
    ) THEN
        ALTER TABLE conversations ADD COLUMN customer_id UUID REFERENCES profiles(id) ON DELETE SET NULL;
    END IF;
END $$;

-- Deterministic backfill: only conversations with exactly one active non-owner member
UPDATE conversations c
SET customer_id = src.profile_id
FROM (
    SELECT cm.conversation_id, cm.profile_id,
           COUNT(*) OVER (PARTITION BY cm.conversation_id) AS member_count
    FROM conversation_members cm
    JOIN conversations c ON c.id = cm.conversation_id
    WHERE c.type = 'store_customer'
      AND c.customer_id IS NULL
      AND cm.left_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM stores s WHERE s.id = c.store_id AND s.owner_id = cm.profile_id)
) src
WHERE c.id = src.conversation_id
  AND c.customer_id IS NULL
  AND src.member_count = 1;

-- Archive table for merge recovery (best-effort, created if missing)
CREATE TABLE IF NOT EXISTS conversations_merge_archive (
    id UUID PRIMARY KEY,
    original_conversation_id UUID NOT NULL,
    keep_conversation_id UUID NOT NULL,
    customer_id UUID,
    store_id UUID,
    type TEXT,
    archived_at TIMESTAMPTZ DEFAULT NOW(),
    payload JSONB
);

CREATE INDEX IF NOT EXISTS idx_conversations_merge_archive_keep
    ON conversations_merge_archive(keep_conversation_id);
CREATE INDEX IF NOT EXISTS idx_conversations_merge_archive_customer
    ON conversations_merge_archive(customer_id);
CREATE INDEX IF NOT EXISTS idx_conversations_merge_archive_store
    ON conversations_merge_archive(store_id);
CREATE INDEX IF NOT EXISTS idx_conversations_merge_archive_original
    ON conversations_merge_archive(original_conversation_id);

-- Merge duplicate store_customer conversations
DO $$
DECLARE
    dup RECORD;
    keep_id UUID;
    remove_ids UUID[];
BEGIN
    FOR dup IN
        SELECT customer_id, store_id
        FROM conversations
        WHERE type = 'store_customer' AND customer_id IS NOT NULL
        GROUP BY customer_id, store_id
        HAVING COUNT(*) > 1
    LOOP
        SELECT id INTO keep_id
        FROM conversations
        WHERE type = 'store_customer'
          AND customer_id = dup.customer_id
          AND store_id = dup.store_id
        ORDER BY created_at ASC NULLS LAST, id ASC
        LIMIT 1;

        SELECT array_agg(id) INTO remove_ids
        FROM conversations
        WHERE type = 'store_customer'
          AND customer_id = dup.customer_id
          AND store_id = dup.store_id
          AND id <> keep_id;

        IF remove_ids IS NOT NULL AND array_length(remove_ids, 1) > 0 THEN
            -- Archive removed rows before any re-pointing so a later failure
            -- still leaves a forensic record of what was about to be merged.
            INSERT INTO conversations_merge_archive (id, original_conversation_id, keep_conversation_id, customer_id, store_id, type, payload)
            SELECT id, id, keep_id, customer_id, store_id, type, to_jsonb(c)
            FROM conversations c
            WHERE id = ANY(remove_ids);

            -- Re-point conversation_members with upsert semantics.
            -- left_at uses nulls-last LEAST semantics so an active membership
            -- (left_at IS NULL) on the keep side is NEVER overwritten with a
            -- left_at from the removed side.
            INSERT INTO conversation_members (conversation_id, profile_id, role, unread_count, last_read_at, left_at)
            SELECT keep_id, profile_id,
                   role, unread_count, last_read_at, left_at
            FROM conversation_members
            WHERE conversation_id = ANY(remove_ids)
            ON CONFLICT (conversation_id, profile_id) DO UPDATE
            SET unread_count = GREATEST(conversation_members.unread_count, EXCLUDED.unread_count),
                last_read_at = CASE
                    WHEN conversation_members.last_read_at IS NULL THEN EXCLUDED.last_read_at
                    WHEN EXCLUDED.last_read_at IS NULL THEN conversation_members.last_read_at
                    ELSE LEAST(conversation_members.last_read_at, EXCLUDED.last_read_at)
                END,
                left_at = CASE
                    WHEN conversation_members.left_at IS NULL THEN conversation_members.left_at
                    WHEN EXCLUDED.left_at IS NULL THEN NULL
                    ELSE LEAST(conversation_members.left_at, EXCLUDED.left_at)
                END,
                role = CASE
                    WHEN conversation_members.role = 'owner' OR EXCLUDED.role = 'owner' THEN 'owner'
                    WHEN conversation_members.role = 'admin' OR EXCLUDED.role = 'admin' THEN 'admin'
                    ELSE conversation_members.role
                END;

            DELETE FROM conversation_members WHERE conversation_id = ANY(remove_ids);

            -- Re-point messages
            UPDATE messages SET conversation_id = keep_id WHERE conversation_id = ANY(remove_ids);

            -- Re-point call_history
            UPDATE call_history SET conversation_id = keep_id WHERE conversation_id = ANY(remove_ids);

            -- Best-effort re-point notifications deep links
            UPDATE notifications
            SET related_id = keep_id
            WHERE related_id = ANY(remove_ids)
              AND (related_type IS NULL OR related_type = 'conversation');

            -- Recompute last_message_at for keep_id, ignoring soft-deleted messages.
            -- deleted messages must not advance the conversation preview/timestamp.
            UPDATE conversations
            SET last_message_at = (
                    SELECT MAX(created_at) FROM messages
                    WHERE conversation_id = keep_id AND is_deleted = false
                ),
                updated_at = NOW()
            WHERE id = keep_id;

            -- Authoritative post-condition guards: abort if any reference remains
            -- BEFORE the conversations are deleted. If a re-point silently missed
            -- rows, the transaction rolls back here instead of deleting a
            -- conversation that is still referenced.
            IF EXISTS (SELECT 1 FROM messages WHERE conversation_id = ANY(remove_ids)) THEN
                RAISE EXCEPTION 'Messages still reference removed conversations; aborting delete';
            END IF;
            IF EXISTS (SELECT 1 FROM conversation_members WHERE conversation_id = ANY(remove_ids)) THEN
                RAISE EXCEPTION 'Members still reference removed conversations; aborting delete';
            END IF;
            IF EXISTS (SELECT 1 FROM call_history WHERE conversation_id = ANY(remove_ids)) THEN
                RAISE EXCEPTION 'Call history still references removed conversations; aborting delete';
            END IF;

            DELETE FROM conversations WHERE id = ANY(remove_ids);
        END IF;
    END LOOP;
END $$;

-- Partial unique index
CREATE UNIQUE INDEX IF NOT EXISTS ux_conversations_store_customer
    ON conversations (customer_id, COALESCE(store_id, '00000000-0000-0000-0000-000000000000'::uuid))
    WHERE type = 'store_customer' AND customer_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_customer_id ON conversations(customer_id);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='conversation_members_role_check') THEN
        -- Validate existing rows first: a CHECK added NOT VALID would still
        -- reject new bad writes but silently allow old bad data to persist.
        -- If invalid rows exist, raise instead of half-applying the constraint.
        IF EXISTS (
            SELECT 1 FROM conversation_members
            WHERE role IS NOT NULL AND role NOT IN ('member','admin','owner')
        ) THEN
            RAISE EXCEPTION 'conversation_members contains invalid role values; clean data before adding conversation_members_role_check';
        END IF;

        ALTER TABLE conversation_members
            ADD CONSTRAINT conversation_members_role_check
            CHECK (role IN ('member','admin','owner'));
    END IF;
END $$;

ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_members ENABLE ROW LEVEL SECURITY;
