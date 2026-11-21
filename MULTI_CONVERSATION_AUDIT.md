# Kindee Multi-Conversation / Multi-Store Chat — Audit & Plan

## Root Cause of Data Leakage
1. `chatService.getOrCreateConversation` filters existing conversations only by `type='store_customer'` and `store_id`, then loops members to find the customer. Store-owner membership is inserted but store staff membership is not. A single customer_id is not enough to isolate conversations across stores.
2. `getStoreConversations` authorizes only by `stores.owner_id === ownerId`; store staff (members) are not supported, and there is no store_membership table.
3. Socket isolation: `emitNewMessage` / `emitToUser` broadcast to broad user rooms; sender can receive own incoming notification unless filtered. No conversation/store room routing enforced at join.
4. `getConversationById` membership check exists but admin bypass / store membership not modeled.
5. No unique constraint preventing duplicate customer-store conversations (race condition).

## Current Data Model
- conversations(id, type, store_id, order_id, store_order_id, title, avatar_url, metadata, last_message_at, legacy_id, created_at, updated_at)
- conversation_members(id, conversation_id, profile_id, role, joined_at, left_at, last_read_at, unread_count, is_muted) UNIQUE(conversation_id, profile_id)
- messages, message_attachments

## Proposed Data Model (no schema change needed for base; additions)
- Add `store_memberships` table: id, store_id, profile_id, role (owner/staff), permissions JSONB, joined_at, UNIQUE(store_id, profile_id).
- Add unique partial index on conversations for (type, customer participant, store_id) to prevent duplicates. Requires conversation_type enum values: 'admin_customer', 'store_customer', 'store_internal', 'group'.
- Add `participant_role` already in conversation_members.role.

## Room Routing
- Backend-authoritative: user:<id>, conversation:<id>, store:<id>.
- Join conversation room only after membership check; join store room only after store_memberships check.
- Sender sync via conversation room ack; recipient notification via user rooms of other members only (never sender).

## Authorization Rules
- Customer: only conversations where conversation_members.profile_id = user and left_at IS NULL.
- Store owner/staff: only conversations where store_id in (select store_id from store_memberships where profile_id = user).
- Admin: central conversations type='admin_customer' only, scoped by permission; not auto-joined to all events.

## Migration (not run)
- 010_store_memberships.sql: create store_memberships + RLS.
- 011_conversation_unique.sql: unique partial index.
- RLS policies for conversations/members/messages keyed on membership and store membership.

## Files to modify (later)
- backend/services/chatService.js (store membership checks, unique conversation lookup)
- backend/services/socketService.js (room join guards, sender exclusion)
- backend/controllers/messageController.js (validated store_id routing)
- supabase migrations 010/011 (created, not run)

## Tests
- Preserve 179 existing tests.
- Add security regression tests for cross-account/cross-store scenarios (allow+deny).
