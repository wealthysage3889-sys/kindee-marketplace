# Kindee Multi-Store Chat — Verification Report (Phase 1/2 only)

## A. Current Schema (key tables)
- profiles(id UUID PK→auth.users, email UNIQUE, phone UNIQUE, name, avatar_url, role user_role, is_active, created_at, updated_at)
- stores(id UUID PK, owner_id UUID FK profiles, name, slug UNIQUE, is_active, is_verified, ...)
- conversations(id UUID PK, type conversation_type [direct,group,store_customer,order_support], store_id FK stores, order_id FK orders, store_order_id FK store_orders, title, avatar_url, metadata, last_message_at, created_at, updated_at)
- conversation_members(id UUID PK, conversation_id FK conversations, profile_id FK profiles, role text, joined_at, left_at, last_read_at, unread_count, is_muted, UNIQUE(conversation_id, profile_id))
- messages(id UUID PK, conversation_id FK conversations, sender_id FK profiles, type message_type, content, metadata, reply_to_id FK messages, is_edited, is_deleted, deleted_at, created_at)
- message_attachments(id UUID PK, message_id FK messages, file_url, file_name, file_size, mime_type, ...)
- call_history(id UUID PK, caller_id FK profiles, callee_id FK profiles, conversation_id FK conversations, store_order_id FK store_orders, status call_status, started_at, answered_at, ended_at, duration_seconds, end_reason, metadata, created_at)

## B. Identity & Role
- Auth UID = profiles.id. Role from profiles.role (customer/seller/admin/owner/courier).
- Store ownership: stores.owner_id → profiles.id. Store staff: proposed store_memberships(store_id, profile_id, role, permissions).
- Backend verifies via supabaseAdmin service role + explicit membership checks (getConversationById userId, store owner check).

## C. RLS & Authorization
- Existing RLS in 002_rls_policies.sql. Backend uses service role bypassing RLS, so all authz enforced in services.
- Customer reads only own member conversations. Store owner reads via stores.owner_id. Store staff not yet supported.
- Attachments: uploadMessageAttachment checks membership when userId provided.
- Call history: filtered by caller_id/callee_id in service.

## D. Socket.IO Room Isolation
- Current emits: emitNewMessage (conversation room + user rooms), emitToUser. Sender exclusion done in chatService via otherMembers filter.
- Proposed rooms: user:<id>, conversation:<id>, store:<id>. Join requires backend membership verification.

## E. Multi-Store Conversation Design
- Customer A→Store A: conversation type store_customer, store_id=A, members [A customer, ownerA admin].
- Customer A→Store B: separate conversation, store_id=B.
- Customer B→Store A: separate conversation (different customer member).
- Customer→Admin: type direct/admin_customer, store_id null.

## F. Migration Plan (files, NOT RUN)
- 010_store_memberships.sql: store_memberships table + RLS.
- 011 (planned): unique partial index on conversations (type, store_id) scoped by customer membership; requires store_memberships backfill from stores.owner_id.
- Backfill: insert store_memberships for each store owner.
- Rollback: drop table/index; data preserved (additive only).
- Risks: duplicate conversations from race; resolved by unique index + upsert.

## G. Test Plan
- Cross-account conversation read (allow/deny), cross-store message delivery, store staff scoping, sender self-notification exclusion, incoming call routing, attachment auth, read receipts, unread counts, multi-session reconnect.

## Compatibility
- 179 tests pass. Call controller/state machine/idempotency/heartbeat/WebRTC untouched.
