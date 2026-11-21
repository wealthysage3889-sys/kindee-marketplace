# PHASE 2 FORWARD RECOVERY PLAN

Project: kindee-marketplace | Branch: main | Date: 2026-11-18
Scope: Forward (non-rollback) recovery for migration 011 destructive duplicate-conversation merge.

## 1. Why Forward Recovery (not rollback)
Migration 011 (lines 84-86) executes `DELETE FROM conversations WHERE id = ANY(remove_ids)` after re-pointing members/messages/calls. Deleted conversation rows cannot be recovered by `ALTER TABLE ... DROP COLUMN`. Recovery must be forward: restore from backup + re-point.

## 2. Recovery Sources (evidence-based only)
- Pre-migration backup (full logical dump) — authoritative source of deleted duplicate conversation rows.
- Pre-migration row-count checkpoint + per-table CSV exports.
- Application logs / audit trail (if available) for conversation IDs.
No synthetic/fabricated data may be inserted. If a deleted conversation cannot be located in backup, mark as unrecoverable and escalate; do not invent placeholder rows.

## 3. Forward Recovery Steps
1. Stop traffic; put staging in maintenance mode.
2. Restore deleted `conversations` rows from backup into a temporary table `recovery_conversations` (not directly into `conversations`).
3. For each recovered duplicate conversation:
   a. Inspect whether its members/messages/calls were re-pointed to `keep_id` (verify via counts in `conversation_members`, `messages`, `call_history`).
   b. If re-pointed correctly and no data loss, the conversation row alone may be re-inserted only if needed for audit; otherwise leave merged (preferred).
   c. If re-pointing was partial (some rows still reference removed id), re-point them to `keep_id` using backup evidence, then verify.
4. Re-establish partial unique index `ux_conversations_store_customer` only after duplicate groups are resolved.
5. Re-run count + FK integrity checks; compare to backup baseline adjusted for intended merge.
6. Re-enable traffic.

## 4. Preventing Duplicate Re-creation
- Rely on DB partial unique index `ux_conversations_store_customer (customer_id, store_id) WHERE type='store_customer' AND customer_id IS NOT NULL`.
- Application: `chatService.getOrCreateConversation` fast-path + conflict retry on 23505; never bypass with client-supplied customer_id.
- Add monitoring: alert on 23505 spikes; periodic query for duplicate `(customer_id, store_id)` groups.

## 5. Verification Checklist (members, messages, attachments, read state, call history)
- conversation_members: count per conversation_id; no orphaned member rows referencing deleted conversations.
- messages: count per conversation_id; no orphaned messages.
- message_attachments: every attachment's message_id exists; count unchanged.
- Read state: `conversation_members` unread/read flags consistent (verify via unread count triggers).
- call_history: count per conversation_id; no orphaned calls; caller/callee profiles exist.

## 6. Restrictions
- No recovery script that fabricates or guesses data.
- No production access.
- Real recovery only after staging test.