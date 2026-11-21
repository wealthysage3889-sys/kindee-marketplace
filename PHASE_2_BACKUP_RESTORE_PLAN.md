# PHASE 2 BACKUP & RESTORE PLAN

Project: kindee-marketplace | Branch: main | Date: 2026-11-18
Scope: Pre-Migration-011 backup/restore of Chat & Call data. Migrations NOT run.

## 1. Scope of Data to Back Up
Before running migration 011 (destructive duplicate-conversation merge), back up:
- `conversations` (id, type, store_id, customer_id, created_at, updated_at)
- `conversation_members` (id, conversation_id, profile_id, role, permissions, joined_at, left_at, suspended_*, removed_*, rejoined_at)
- `messages` (id, conversation_id, sender_id, content, type, created_at, edited_at, deleted_at, is_deleted)
- `message_attachments` (id, message_id, file_url, file_name, file_size, mime_type, created_at)
- `call_history` (id, conversation_id, caller_id, callee_id, status, started_at, ended_at, duration)
- `stores`, `profiles` (referenced FK targets; needed for re-point verification)

## 2. Referential Integrity & Restore Order
Restore in FK-safe order:
1. `profiles` (identity anchor)
2. `stores` (owner_id -> profiles)
3. `conversations` (store_id -> stores, customer_id -> profiles nullable)
4. `conversation_members` (conversation_id -> conversations, profile_id -> profiles)
5. `messages` (conversation_id -> conversations, sender_id -> profiles)
6. `message_attachments` (message_id -> messages)
7. `call_history` (conversation_id -> conversations, caller_id/callee_id -> profiles)

## 3. Backup Method (Supabase)
- Use Supabase Dashboard → Database → Backups → "Download backup" (full logical dump) OR `pg_dump` against staging only.
- Additionally export per-table CSV via SQL Editor for verification: `COPY (SELECT * FROM conversations) TO STDOUT WITH CSV HEADER;`
- Store backups in a secure, versioned location outside the repo. Never commit backups.
- Record backup timestamp, row counts, and checksums.

## 4. Verification of Backup Completeness
- Compare row counts in backup vs source for all 7 tables (pre vs backup).
- Verify FK integrity: every `conversation_members.conversation_id` exists in `conversations`; every `messages.conversation_id` exists; every attachment's `message_id` exists; every call_history `conversation_id` exists (or NULL).
- Spot-check sample rows (random 10 per table) for content fidelity.
- Test restore into an isolated staging DB (never production) and re-run count + integrity checks.

## 5. Pre/Post Migration Record Count Checkpoints
Capture counts (SQL) before and after migration 011:
```
SELECT 'conversations' t, count(*) FROM conversations
UNION ALL SELECT 'conversation_members', count(*) FROM conversation_members
UNION ALL SELECT 'messages', count(*) FROM messages
UNION ALL SELECT 'message_attachments', count(*) FROM message_attachments
UNION ALL SELECT 'call_history', count(*) FROM call_history;
```
Expected: members/messages/attachments/calls counts unchanged (only re-pointed). `conversations` count decreases by number of merged duplicates. All other counts invariant.

## 6. Restore Procedure (if migration fails)
1. Stop application traffic to staging.
2. Restore full DB from backup (Supabase point-in-time restore or `pg_restore`).
3. Re-run count + FK integrity checks.
4. Confirm migration state (`schema_migrations`) does not mark 011 as applied; re-run from clean state only after root cause fixed.
5. Document incident.

## 7. Restrictions
- No migration run in any environment by this phase.
- No production access.
- Backup verification on real DB is a human step (not yet performed).