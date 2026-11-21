# KINDEE MIGRATION 011 REVIEW REPORT

## Scope
Reviewed migration 011 against schema (001), RLS (002), 010, 012. Local PostgreSQL only; no cloud execution.

## Checks
1. Schema conversations/conversation_members/messages/call_history/notifications: FKs cascade to conversations; messages/call_history re-pointed before delete. PASS.
2. Dependencies 001-010,012: 010 adds store_memberships + conversations_store_members_select; 012 independent function. PASS.
3. Backfill store owner detection scoped to conversation.store_id. FIXED/PASS.
4. Merge semantics last_read_at NULL-safe, unread GREATEST, role upgrade to admin/owner. FIXED/PASS.
5. Notifications re-point guarded by related_type='conversation'. FIXED/PASS.
6. Archive + idempotency + unique index including NULL store_id via COALESCE sentinel. FIXED/PASS.
7. RLS enabled after policies exist (002 + 010). PASS.
8. Local merge test: not executed (no fixture data loaded); migration idempotent guards present. PENDING.
9. FK/trigger impact: message_attachments via messages cascade; reply_to_id set null. PASS.
10. Report created. PASS.

## SQL Changes Applied
See supabase/migrations/011_conversation_customer_id.sql.

## Readiness
011 ready for local execution. Proceed to review 012.