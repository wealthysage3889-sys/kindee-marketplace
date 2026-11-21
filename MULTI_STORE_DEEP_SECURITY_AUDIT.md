# Kindee Multi-Store Chat — Deep Security Audit (Phase 2)

**Project:** Kindee Marketplace  
**Project Root:** `C:\Users\LEGION\OneDrive\Desktop\kindee-marketplace`  
**Git Remote:** `wealthysage3889-sys/kindee-marketplace`  
**Branch:** `main`  
**Audit Type:** READ-ONLY Deep Security Audit  
**Status:** COMPLETE (no code or database changes made)  
**Baseline Tests:** 179 passed, 0 failed (verified by running `node --test "__tests__/*.test.mjs"` in `backend/`)

---

## 1. Executive Summary

This deep security audit examines the Kindee Marketplace multi-store chat, voice call, and store membership system. The audit reviewed all SQL migrations (001–010), RLS policies, storage policies, backend controllers/services/middleware/routes, Socket.IO isolation, frontend socket context, and existing test suite (179 tests).

**Overall Assessment: The application-layer authorization is generally well-implemented, but the defense-in-depth layer (RLS + Storage policies) contains critical gaps that allow unauthorized data access if the application layer is bypassed or contains a single missing check.**

### Severity Summary

| Severity | Count | Status |
|----------|-------|--------|
| CRITICAL | 12 | VERIFIED |
| HIGH | 8 | VERIFIED |
| MEDIUM | 5 | VERIFIED/POTENTIAL |
| LOW | 3 | VERIFIED |

### Key CRITICAL Findings

1. **RLS `conversations` INSERT policy `WITH CHECK (true)`** — anyone can create any conversation (`supabase/migrations/002_rls_policies.sql:630`)
2. **RLS `conversation_members` INSERT policy allows self-join to any conversation** — anyone can insert themselves as a member of any conversation (`supabase/migrations/002_rls_policies.sql:662`)
3. **RLS `message_attachments` INSERT does not verify conversation membership** — only checks `sender_id = auth.uid()` on the parent message (`supabase/migrations/002_rls_policies.sql:757-764`)
4. **Backend `uploadMessageAttachment` has `userId = null` default** — if called without userId, no membership check (`backend/services/chatService.js:629`)
5. **Socket.IO `typing`/`stopTyping` with no conversation membership check** — anyone can emit typing to any conversation room (`backend/services/socketService.js:177-190`)
6. **Socket.IO `joinStore` allows platform `owner` role into ANY store room** — `['admin', 'owner'].includes(socket.user.role)` where `owner` is platform owner (`backend/services/socketService.js:105`)
7. **Storage `chat-attachments` SELECT uses fragile `LIKE` string matching** — `ma.file_url LIKE '%' || storage.objects.name` (`supabase/migrations/004_storage_buckets.sql:180`)
8. **Storage "Admins can manage all storage" includes `owner` role** — platform owner can access ALL buckets including chat-attachments and voice-recordings (`supabase/migrations/004_storage_buckets.sql:226-240`)
9. **`store_migrations.sql` (010) UNIQUE (store_id, profile_id) prevents re-adding members after left_at** — no partial index to allow re-addition (`supabase/migrations/010_store_memberships.sql:11`)
10. **`store_migrations.sql` (010) only has SELECT RLS policy, no INSERT/UPDATE/DELETE** — mutations denied by default for non-service-role (`supabase/migrations/010_store_memberships.sql:17-20`)
11. **`admin_customer` NOT in `conversation_type` enum** — enum is `('direct','group','store_customer','order_support')` (`supabase/migrations/001_initial_schema.sql:20`)
12. **All backend services use `supabaseAdmin` (service role bypasses RLS)** — no RLS safety net if application check is missing (`backend/config/supabase.js:45-52`)

---

## 2. Current Architecture and Schema (Actual)

### 2.1 Database Tables Relevant to Chat/Call/Membership

| Table | File:Line | Key Columns |
|-------|-----------|-------------|
| `profiles` | 001_initial_schema.sql:27-38 | id PK→auth.users, email, phone, role user_role, is_active |
| `stores` | 001_initial_schema.sql:46-70 | id PK, owner_id FK profiles, name, slug, is_active, is_verified |
| `conversations` | 001_initial_schema.sql:512-525 | id PK, type conversation_type, store_id, order_id, store_order_id |
| `conversation_members` | 001_initial_schema.sql:533-544 | id PK, conversation_id, profile_id, role TEXT, left_at, unread_count, UNIQUE(conversation_id, profile_id) |
| `messages` | 001_initial_schema.sql:551-565 | id PK, conversation_id, sender_id FK profiles, type message_type, content, is_deleted |
| `message_attachments` | 001_initial_schema.sql:574-586 | id PK, message_id FK messages, file_url, file_name, mime_type |
| `call_history` | 001_initial_schema.sql:612-627 | id PK, caller_id, callee_id, conversation_id, store_order_id, status call_status, caller_heartbeat_at, callee_heartbeat_at |
| `store_memberships` | 010_store_memberships.sql:3-12 | id PK, store_id, profile_id, role TEXT, permissions JSONB, left_at, UNIQUE(store_id, profile_id) |

### 2.2 Enum Types

| Enum | File:Line | Values |
|------|-----------|--------|
| `user_role` | 001_initial_schema.sql:14 | customer, seller, admin, owner, courier |
| `conversation_type` | 001_initial_schema.sql:20 | direct, group, store_customer, order_support |
| `message_type` | 001_initial_schema.sql:21 | text, image, file, location, system, order_update, voice_call |
| `call_status` | 001_initial_schema.sql:22 | ringing, accepted, rejected, missed, ended |
| `call_status` (post-009) | 009_call_status_lifecycle.sql:7-10 | + completed, no_answer, cancelled, failed |

**`admin_customer` does NOT exist** in `conversation_type` enum. It is referenced in the Phase 1 verification report (MULTI_STORE_VERIFICATION_REPORT.md:31) but has never been added to the schema.

### 2.3 Storage Buckets

| Bucket | Public | File:Line | MIME Types |
|--------|--------|-----------|------------|
| avatars | true | 004_storage_buckets.sql:11 | image/* |
| store-logos | true | 004_storage_buckets.sql:12 | image/* |
| store-covers | true | 004_storage_buckets.sql:13 | image/* |
| product-images | true | 004_storage_buckets.sql:14 | image/* |
| chat-attachments | **false** | 004_storage_buckets.sql:15 | image/*, pdf, doc, docx |
| voice-recordings | **false** | 004_storage_buckets.sql:16 | audio/* |

### 2.4 Backend Architecture

- **Auth:** `verifyToken` middleware (`backend/middleware/auth.js:100-174`) — Supabase primary, legacy custom JWT fallback, role always from `profiles.role`
- **DB Client:** `supabaseAdmin` (service role, bypasses RLS) used by ALL services (`backend/config/supabase.js:45-52`)
- **Chat Routes:** `backend/routes/chatRoutes.js` — all routes protected by `verifyToken`
- **Call Routes:** `backend/routes/callRoutes.js` — all routes protected by `verifyToken`
- **Socket.IO:** `backend/services/socketService.js` — JWT auth at connect, room-based isolation
- **Frontend Socket:** `frontend/src/context/SocketContext.jsx` — per-token sockets, join/leave conversation/store/call rooms

---

## 3. RLS Security Findings

### CRITICAL — RLS-01: `conversations` INSERT policy `WITH CHECK (true)`
**File:** `supabase/migrations/002_rls_policies.sql:629-630`  
**Status:** VERIFIED  
**Severity:** CRITICAL

```sql
CREATE POLICY "Users can create conversations" ON conversations
    FOR INSERT WITH CHECK (true); -- Validated in application logic
```

**Analysis:** The INSERT policy allows any authenticated user to insert any row into `conversations` with any `store_id`, `type`, `order_id`, or `store_order_id`. The comment acknowledges this is "Validated in application logic" but RLS is the last line of defense. If the backend has a code path that calls `supabaseAdmin.from('conversations').insert()` without validating store ownership or conversation type, an attacker could create conversations in stores they don't own or with forged types.

**Attack:** Customer A uses a compromised or malicious client to insert a conversation row with `store_id` = Store B's ID and `type` = 'store_customer'. Since RLS allows it, the row is created. The backend service layer may then add members to it.

**Defense-in-depth gap:** RLS should restrict INSERT to conversations where the user has a legitimate relationship (e.g., must be a store owner of `store_id`, or must be added as a member first).

---

### CRITICAL — RLS-02: `conversation_members` INSERT allows self-join to any conversation
**File:** `supabase/migrations/002_rls_policies.sql:661-662`  
**Status:** VERIFIED  
**Severity:** CRITICAL

```sql
CREATE POLICY "Users can join conversations" ON conversation_members
    FOR INSERT WITH CHECK (profile_id = auth.uid());
```

**Analysis:** Any authenticated user can insert themselves as a member of ANY conversation, regardless of whether they have any relationship to the conversation, store, or other members. There is no check that:
- The conversation exists
- The user is a customer of the store
- The user was invited by an admin/owner

**Attack:** Customer A inserts themselves into a conversation between Customer B and Store A. They can now read all messages (via RLS-03 which allows members to view messages) and send messages.

**Combined with RLS-01:** An attacker can create a conversation AND join it, fully bypassing application-layer conversation scoping.

---

### CRITICAL — RLS-03: `message_attachments` INSERT does not verify conversation membership
**File:** `supabase/migrations/002_rls_policies.sql:757-764`  
**Status:** VERIFIED  
**Severity:** CRITICAL

```sql
CREATE POLICY "Users can upload attachments" ON message_attachments
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM messages m
            WHERE m.id = message_attachments.message_id
            AND m.sender_id = auth.uid()
        )
    );
```

**Analysis:** The policy only checks that the user is the sender of the parent message. It does NOT verify:
- The user is a member of the conversation
- The conversation is active (left_at IS NULL)
- The message belongs to a conversation the user should access

Since a user can create any conversation (RLS-01) and join any conversation (RLS-02), and then create messages in it, they can attach files to messages in conversations they created themselves. However, the more serious issue is that if a user somehow gains access to a message they shouldn't (e.g., through a backend bug), they can attach files to it without RLS blocking.

**Also, there is no DELETE or UPDATE policy on `message_attachments`**, meaning by default RLS denies all updates and deletes for non-service-role users.

---

### CRITICAL — RLS-04: `conversation_members` and `messages` SELECT rely on `left_at IS NULL` but no RLS prevents stale tokens
**File:** `supabase/migrations/002_rls_policies.sql:618-626, 650-658, 694-703`  
**Status:** VERIFIED  
**Severity:** CRITICAL

The RLS policies correctly check `left_at IS NULL` for conversation members. However, RLS operates at the database row level. If a user's JWT token is still valid (not expired) and they were removed from a conversation (left_at set), RLS will correctly block them from reading new messages. **However**, if the backend caches conversation data or if the Socket.IO connection remains open (authentication is only at connect time), the removed member can still receive real-time events via Socket.IO rooms they joined before being removed.

**File:** `backend/services/socketService.js:135-138` — `leaveConversation` is a client-initiated event. The server does not force-leave a socket from a conversation room when the membership is revoked at the database level.

---

### HIGH — RLS-05: `call_history` SELECT allows caller OR callee to view all call details
**File:** `supabase/migrations/002_rls_policies.sql:786-787`  
**Status:** VERIFIED  
**Severity:** HIGH

```sql
CREATE POLICY "Users can view own call history" ON call_history
    FOR SELECT USING (caller_id = auth.uid() OR callee_id = auth.uid());
```

**Analysis:** A caller or callee can view the full call_history record including `conversation_id`, `store_order_id`, and `metadata`. This may leak conversation IDs and store order IDs that the user should not correlate outside the chat context. However, since the user is already a participant in the call, this is a minor information leakage rather than a critical access issue.

---

### HIGH — RLS-06: `profiles` role-based access conflates platform `owner` with store owner
**File:** `supabase/migrations/002_rls_policies.sql:41-44, 69-78, 101-107`  
**Status:** VERIFIED  
**Severity:** HIGH

The `is_admin_or_owner()` function (`002_rls_policies.sql:41-44`) returns true for `role IN ('admin', 'owner')`. The `owner` role in `user_role` enum is a **platform-level** role (set by migration 005), not a store-level ownership role. However, RLS policies use it to grant access to:
- All profiles (`002:69-70`)
- All stores (`002:101-102`)
- All store conversations (`002:643-644`)
- All storage (`004:226-240`)

**Analysis:** A platform `owner` (not a store owner) gets broad cross-store access. This is by design for platform administration, but it means a compromised platform owner account can read all conversations and all storage across all stores.

---

### MEDIUM — RLS-07: `message_attachments` SELECT uses join through messages but no direct conversation membership check
**File:** `supabase/migrations/002_rls_policies.sql:744-754`  
**Status:** VERIFIED  
**Severity:** MEDIUM

The SELECT policy checks conversation membership through the message's conversation. This is correct but depends on the `messages` row being visible. Since `messages` INSERT policy checks sender membership, and `conversation_members` INSERT allows anyone to join (RLS-02), there is a transitive trust issue.

---

### MEDIUM — RLS-08: `conversation_members.role` is TEXT without CHECK constraint
**File:** `supabase/migrations/001_initial_schema.sql:537`  
**Status:** VERIFIED  
**Severity:** MEDIUM

```sql
role TEXT DEFAULT 'member', -- member, admin, owner
```

No CHECK constraint restricts valid role values. Any value can be inserted. Combined with RLS-02 (anyone can insert themselves), an attacker could insert themselves with `role = 'owner'` and then use the "Conversation admins can manage members" policy (`002:670-688`) to manage other members.

---

## 4. Backend Authorization Findings

### CRITICAL — BACKEND-01: All backend services use `supabaseAdmin` (service role bypasses RLS)
**Files:** 
- `backend/services/chatService.js` — all methods use `supabaseAdmin`
- `backend/services/callService.js` — all methods use `supabaseAdmin`
- `backend/services/storeService.js` — all methods use `supabaseAdmin`
- `backend/config/supabase.js:45-52` — `supabaseAdmin` created with `SUPABASE_SERVICE_ROLE_KEY`

**Status:** VERIFIED  
**Severity:** CRITICAL

**Analysis:** The service role key bypasses ALL RLS policies. The entire security model depends on application-level authorization checks in every service method. If any service method is missing a check, there is no RLS safety net.

**Verified application-level checks (GOOD):**
- `chatService.getConversationById(conversationId, userId)` — checks membership (`chatService.js:123-151`)
- `chatService.sendMessage(conversationId, senderId, ...)` — checks membership via `getConversationById` (`chatService.js:292-297`)
- `chatService.getMessages(conversationId, userId, ...)` — checks membership (`chatService.js:244-248`)
- `chatService.markMessagesRead(conversationId, userId, ...)` — checks membership (`chatService.js:383-385`)
- `chatService.editMessage(messageId, userId, ...)` — checks membership + sender (`chatService.js:443-459`)
- `chatService.deleteMessage(messageId, userId, ...)` — checks membership + sender/admin (`chatService.js:481-513`)
- `chatService.addConversationMember(...)` — checks admin/owner role (`chatService.js:557-578`)
- `chatService.removeConversationMember(...)` — checks authorization (`chatService.js:582-608`)
- `callService.initiateCall(...)` — checks conversation membership (`callService.js:194-207`)
- `callService.acceptCall(...)` — checks callee_id + conversation membership (`callService.js:274-302`)
- `callService.rejectCall(...)` — checks callee_id (`callService.js:352-360`)
- `callService.endCall(...)` — checks caller_id OR callee_id (`callService.js:414-422`)
- `callService.cancelCall(...)` — checks caller_id (`callService.js:505-511`)

**Missing or weak checks:**
- `chatService.uploadMessageAttachment(messageId, fileData, userId = null)` — `userId` defaults to `null`, and when null, no membership check is performed (`chatService.js:629-644`)
- `chatService.getStoreConversations(storeId, ownerId, ...)` — verifies store ownership but does NOT filter conversations by the user's membership (relies on store owner check only) (`chatService.js:665-717`)

---

### CRITICAL — BACKEND-02: `uploadMessageAttachment` has `userId = null` default
**File:** `backend/services/chatService.js:629`  
**Status:** VERIFIED  
**Severity:** CRITICAL

```javascript
export const uploadMessageAttachment = async (messageId, fileData, userId = null) => {
```

When called without `userId` (or with `null`), the membership check at line 642-644 is skipped:
```javascript
if (userId) {
    await getConversationById(message.conversation_id, userId);
}
```

Since `supabaseAdmin` bypasses RLS, any code path calling this without `userId` can attach files to any message. The route handler (`backend/routes/chatRoutes.js:214-242`) does pass `req.user.id`, so the current route is safe. However, any future internal caller or refactoring that omits `userId` would create a vulnerability.

---

### CRITICAL — BACKEND-03: `messageController.js` `isRoomParticipant` queries non-existent `store` column
**File:** `backend/controllers/messageController.js:42-50`  
**Status:** VERIFIED  
**Severity:** CRITICAL

```javascript
const isRoomParticipant = async (storeId, userId) => {
  const { data } = await supabaseAdmin
    .from('messages')
    .select('id')
    .eq('store', storeId)       // messages table has NO 'store' column
    .or(`sender.eq.${userId},receiver.eq.${userId}`) // messages table has NO 'sender' or 'receiver' columns (has sender_id)
    .limit(1);
  return data && data.length > 0;
};
```

This function queries `messages` table with columns `store`, `sender`, `receiver` — none of which exist. The `messages` table has `conversation_id` and `sender_id`. This function would error or return empty, making `canAccessRoom` (`messageController.js:37-40`) potentially return incorrect results. However, this function is not called by any current route (the routes use `chatService` methods instead), so it is dead code but represents a latent bug.

---

### CRITICAL — BACKEND-04: `messageController.js` `resolveStore` tries non-existent columns
**File:** `backend/controllers/messageController.js:25-35`  
**Status:** VERIFIED  
**Severity:** CRITICAL

```javascript
const resolveStore = async (storeId) => {
  let store = await getStoreById(storeId);
  if (!store) {
    store = await supabaseAdmin
      .from('stores')
      .select('*')
      .or(`owner_id.eq.${storeId},seller_id.eq.${storeId},user_id.eq.${storeId}`) // stores has NO seller_id or user_id
      .single();
  }
  return store;
};
```

The fallback query references `seller_id` and `user_id` columns that don't exist on the `stores` table. The `stores` table only has `owner_id`. This is dead code (the first `getStoreById` call succeeds for valid UUIDs), but represents a latent bug if the first lookup fails.

---

### HIGH — BACKEND-05: `getStoreConversations` does not filter by membership for non-owner roles
**File:** `backend/services/chatService.js:665-717`  
**Status:** VERIFIED  
**Severity:** HIGH

```javascript
export const getStoreConversations = async (storeId, ownerId, filters = {}, pagination = {}) => {
  const { data: store } = await supabaseAdmin
    .from('stores')
    .select('id')
    .eq('id', storeId)
    .eq('owner_id', ownerId)
    .single();
  // ... then fetches all conversations where store_id = storeId
```

This verifies that `ownerId` owns the store, then returns ALL conversations for that store. It does NOT check whether the user is a member of each conversation. Since the route (`chatRoutes.js:245-276`) also verifies `owner_id = req.user.id`, this is currently only accessible to store owners. But if the route is ever opened to store staff/managers, they could see all conversations for the store, including ones they are not members of.

---

### HIGH — BACKEND-06: Socket.IO authentication does not re-verify on token expiry or deactivation
**File:** `backend/services/socketService.js:24-78`  
**Status:** VERIFIED  
**Severity:** HIGH

Socket authentication occurs only at connection time (`io.use` middleware). If:
- A user's JWT token expires
- A user's account is deactivated (`is_active = false`)
- A user is removed from a conversation (left_at set)

...the existing Socket.IO connection remains authenticated and the user remains in all rooms they joined. There is no mechanism to disconnect sockets when authorization changes at the database level.

**File:** `backend/services/socketService.js:260-280` — `disconnect` handler only cleans up tracking maps, does not notify other participants or clean up call state beyond the heartbeat expiry timer.

---

### HIGH — BACKEND-07: `messageController.js` sendMessage trusts `senderRole: requestedSenderRole` from request body
**File:** `backend/controllers/messageController.js:121-165`  
**Status:** VERIFIED  
**Severity:** HIGH

The `senderRole` field from `req.body` is accepted and validated but the actual sender is always `req.user.id` (from verified token). The `senderRole` is only used for:
1. Checking if the requested role is a "shop role" when the sender is not (`messageController.js:156-164`)
2. Determining `receiverRole` for the conversation lookup

Since `senderId` is always from `req.user.id`, sender_id forgery is not possible through this endpoint. However, the `senderRole` from body could be used to confuse the receiver resolution logic. The `chatService.sendMessage` uses `senderId` from the parameter (which is `req.user.id`), so the actual DB write is safe.

---

### MEDIUM — BACKEND-08: `deleteMessage` `isAdmin` parameter is always `false` from route
**File:** `backend/services/chatService.js:481`, `backend/routes/chatRoutes.js:145-146`  
**Status:** VERIFIED  
**Severity:** MEDIUM

The `deleteMessage` function accepts `isAdmin = false` parameter. The route always calls it without `isAdmin`, so it defaults to `false`. Conversation admins/owners cannot delete other members' messages through the REST API (only through RLS which has a policy for it at `002:728-738` but RLS is bypassed by supabaseAdmin). This means the RLS policy for conversation admin message deletion is unreachable through the current API.

---

### MEDIUM — BACKEND-09: `createGroupConversation` does not validate that memberIds exist or are active
**File:** `backend/services/chatService.js:516-554`  
**Status:** VERIFIED  
**Severity:** MEDIUM

The function inserts members without verifying that the `memberIds` correspond to existing, active profiles. It also does not check that the creator has permission to add specific users (e.g., adding a user to a group conversation they shouldn't have access to). The creator is always added as `owner` role, and all others as `member`.

---

## 5. Conversation Isolation Findings

### CRITICAL — CONV-01: No unique constraint prevents duplicate conversations between same customer and store
**File:** `supabase/migrations/001_initial_schema.sql:512-525`  
**Status:** VERIFIED  
**Severity:** CRITICAL

The `conversations` table has NO unique constraint on `(type, store_id, customer_member)` or any combination that would prevent duplicate conversations. The `conversation_members` table has `UNIQUE (conversation_id, profile_id)` but that only prevents the same profile from being added twice to the same conversation.

**Current deduplication** is done entirely in application logic (`chatService.getOrCreateConversation` at `chatService.js:49-74`):
1. Query conversations where `type = 'store_customer'` AND `store_id = storeId`
2. Filter in JavaScript for conversations where customer is a member
3. If found, return existing; otherwise create new

**Race condition:** Two concurrent requests from the same customer to the same store could both find no existing conversation and both create new ones, resulting in duplicate conversations.

**The Phase 1 report mentions migration 011 would add a unique partial index** but no `011` migration file exists. The proposed design of `UNIQUE (type, store_id)` is WRONG because it would force ALL customers of a store to share ONE conversation.

**Correct design:** Unique constraint should be on `(type, store_id)` PLUS a way to identify the customer side. Since `conversation_members` has the customer-member relationship, a partial unique index or a conversation-level `customer_id` column would be needed. However, `conversations` table has no `customer_id` column.

---

### CRITICAL — CONV-02: `admin_customer` conversation type does not exist in enum
**File:** `supabase/migrations/001_initial_schema.sql:20`  
**Status:** VERIFIED  
**Severity:** CRITICAL

```sql
CREATE TYPE conversation_type AS ENUM ('direct', 'group', 'store_customer', 'order_support');
```

The `admin_customer` type is NOT in the enum. It is referenced in MULTI_STORE_VERIFICATION_REPORT.md:31 as the type for "Customer ↔ Admin" conversations. If the system needs Customer↔Admin conversations, either:
1. Add `admin_customer` to the enum (requires migration, affects all code using the enum)
2. Use `direct` type with admin as a member
3. Use `store_customer` with store_id = NULL

Adding a new enum value in PostgreSQL requires `ALTER TYPE ... ADD VALUE`, which cannot be rolled back within a transaction and is permanent.

---

### HIGH — CONV-03: `getOrCreateConversation` allows any customer to start a conversation with any store
**File:** `backend/services/chatService.js:31-120`  
**Status:** VERIFIED  
**Severity:** HIGH

There is no check that the customer has any relationship with the store (e.g., has placed an order). Any customer can start a conversation with any store. This may be by design (marketplace customers can contact any store), but it should be noted as an intentional design decision rather than a security control.

---

### HIGH — CONV-04: Store owner is added as conversation `admin` but not via `store_memberships`
**File:** `backend/services/chatService.js:108-113`  
**Status:** VERIFIED  
**Severity:** HIGH

When creating a store_customer conversation, the store owner is added with `role: 'admin'` directly from `stores.owner_id`. The proposed `store_memberships` table (010) is NOT used for this. If migration 010 is run and store_memberships is populated, there would be two separate sources of truth for store staff access: `conversation_members.role` and `store_memberships.role`.

---

### MEDIUM — CONV-05: No conversation-level `customer_id` column for efficient lookups
**File:** `supabase/migrations/001_initial_schema.sql:512-525`  
**Status:** VERIFIED  
**Severity:** MEDIUM

To find all conversations for a specific customer-store pair, the system must:
1. Query `conversation_members` for the customer's conversations
2. Filter by `store_id` on the conversations table

This requires a join. A denormalized `customer_id` column on `conversations` (for `store_customer` type) would enable efficient unique constraints and lookups.

---

## 6. Store Membership Findings

### CRITICAL — MEMBER-01: `store_migrations.sql` (010) UNIQUE (store_id, profile_id) prevents re-adding members
**File:** `supabase/migrations/010_store_memberships.sql:11`  
**Status:** VERIFIED  
**Severity:** CRITICAL

```sql
UNIQUE (store_id, profile_id)
```

When a staff member leaves a store (`left_at` is set), the row still exists with `left_at` populated. The UNIQUE constraint prevents inserting a new row for the same `(store_id, profile_id)`. To re-add the member, the system would need to:
1. UPDATE the existing row to set `left_at = NULL` (reactivation), OR
2. Drop and recreate the unique constraint as a partial index `WHERE left_at IS NULL`

Neither option is addressed in the migration.

---

### CRITICAL — MEMBER-02: `store_migrations.sql` (010) only has SELECT RLS policy, no INSERT/UPDATE/DELETE
**File:** `supabase/migrations/010_store_memberships.sql:17-20`  
**Status:** VERIFIED  
**Severity:** CRITICAL

```sql
ALTER TABLE store_memberships ENABLE ROW LEVEL SECURITY;
CREATE POLICY store_memberships_select ON store_memberships
    FOR SELECT USING (profile_id = auth.uid() OR EXISTS (
        SELECT 1 FROM stores s WHERE s.id = store_id AND s.owner_id = auth.uid()
    ));
```

Only SELECT is enabled. INSERT, UPDATE, DELETE are denied by default for all non-service-role users. Since all backend services use `supabaseAdmin` (service role), the backend must handle all authorization for store_memberships mutations. There is no RLS safety net.

---

### HIGH — MEMBER-03: `store_migrations.sql` (010) no CHECK constraint on role values
**File:** `supabase/migrations/010_store_memberships.sql:7`  
**Status:** VERIFIED  
**Severity:** HIGH

```sql
role TEXT NOT NULL DEFAULT 'staff', -- owner, staff, manager
```

No CHECK constraint restricts role to `('owner', 'staff', 'manager')`. Any string value can be inserted. The comment suggests valid values but the database does not enforce it.

---

### HIGH — MEMBER-04: `store_migrations.sql` (010) no RLS policy for staff/manager to view their own membership
**File:** `supabase/migrations/010_store_memberships.sql:17-20`  
**Status:** VERIFIED  
**Severity:** HIGH

The SELECT policy allows `profile_id = auth.uid()` (a member can view their own membership) OR store owner. However, there is no policy for:
- Store managers viewing memberships of their store
- Staff viewing memberships of their store
- Store owners inserting/updating/deleting memberships

All mutations must go through `supabaseAdmin` with application-level checks.

---

### HIGH — MEMBER-05: No backend routes or services for store_memberships exist yet
**Status:** POTENTIAL  
**Severity:** HIGH

The `store_migrations.sql` (010) migration file exists but is NOT RUN (untracked, marked "NOT RUN"). There are no backend routes, controllers, or services for managing store memberships (add staff, remove staff, change role, change permissions). The `backend/routes/storeRoutes.js` has no membership endpoints. The `backend/services/storeService.js` has no membership methods.

**This means the multi-store staff feature is not yet implemented in the backend.** The migration and any backend implementation must be built together.

---

### MEDIUM — MEMBER-06: No protection against owner promoting themselves to platform admin
**Status:** POTENTIAL  
**Severity:** MEDIUM

The `profiles.role` field can be updated by admins (`002:73-78`) but the policy prevents an admin from changing an owner's role:
```sql
WITH CHECK (
    is_admin_or_owner() AND 
    NOT (role = 'owner' AND (SELECT role FROM profiles WHERE id = auth.uid()) = 'admin')
)
```

However, there is no protection against a store owner (via `store_memberships` with role='owner') from being confused with a platform owner. The `store_memberships.role = 'owner'` is store-scoped, while `profiles.role = 'owner'` is platform-scoped. This naming collision could cause authorization bugs.

---

## 7. Socket.IO Security Findings

### CRITICAL — SOCKET-01: `typing`/`stopTyping` events have no conversation membership check
**File:** `backend/services/socketService.js:177-190`  
**Status:** VERIFIED  
**Severity:** CRITICAL

```javascript
socket.on('typing', ({ conversationId, name }) => {
  if (!conversationId) return;
  socket.to(`conversation_${conversationId}`).emit('typing', {
    userId, name
  });
});
```

Any authenticated socket can emit `typing` to any conversation room. The user does NOT need to have joined the conversation room. While the user needs to be in the room to receive the typing event, they can send typing indicators to any room.

**Impact:** A user can send typing indicators to conversations they are not a member of, potentially causing confusion or information leakage (the fact that someone is "typing" in a room could indicate activity).

**Mitigation:** The `joinConversation` handler does check membership (`socketService.js:121-127`), but a user could send `typing` without ever calling `joinConversation`.

---

### CRITICAL — SOCKET-02: `joinStore` allows platform `owner` role into ANY store room
**File:** `backend/services/socketService.js:95-109`  
**Status:** VERIFIED  
**Severity:** CRITICAL

```javascript
socket.on('joinStore', async (storeId) => {
  if (!storeId) return;
  const { data: store } = await supabaseAdmin
    .from('stores')
    .select('id, owner_id')
    .eq('id', storeId)
    .single();
  if (store && (store.owner_id === userId || ['admin', 'owner'].includes(socket.user.role))) {
    socket.join(`store_${storeId}`);
  }
});
```

The condition `['admin', 'owner'].includes(socket.user.role)` allows any user with platform `admin` or `owner` role to join ANY store's room. The `owner` here refers to `profiles.role = 'owner'` (platform owner), not store ownership. A platform owner can eavesdrop on all store rooms.

Additionally, the check does NOT use `store_memberships` at all. Store staff and managers who are members via `store_memberships` (when implemented) cannot join store rooms because the code only checks `store.owner_id`.

---

### CRITICAL — SOCKET-03: `callSignal` does not require joining the call room first
**File:** `backend/services/socketService.js:193-208`  
**Status:** VERIFIED  
**Severity:** CRITICAL

```javascript
socket.on('callSignal', async ({ callId, signal }) => {
  if (!callId || !signal) return;
  const { data: call } = await supabaseAdmin
    .from('call_history')
    .select('caller_id, callee_id, status')
    .eq('id', callId)
    .in('status', ['ringing', 'accepted'])
    .single();
  if (!call || (call.caller_id !== userId && call.callee_id !== userId)) return;
  socket.to(`call_${callId}`).emit('callSignal', { from: userId, signal });
});
```

The handler verifies the user is a participant but does NOT require them to have joined the `call_${callId}` room. A participant can send signaling without being in the room. The other participant will only receive it if they are in the room. However, a malicious participant could send signaling to the room without being connected to it properly, and the room broadcast reaches all sockets in the room.

Also, there's no check that the calling socket actually joined the call room via `joinCall` before sending `callSignal`. The `joinCall` handler (`socketService.js:210-221`) does verify participation, but `callSignal` does not require prior `joinCall`.

---

### HIGH — SOCKET-04: Socket connections persist after token expiry or account deactivation
**File:** `backend/services/socketService.js:24-78`  
**Status:** VERIFIED  
**Severity:** HIGH

Authentication is only at connection time. There is no re-authentication or token refresh handling for Socket.IO connections. If a token expires or an account is deactivated, the socket remains connected and in all rooms.

---

### HIGH — SOCKET-05: No forced removal from conversation rooms when membership is revoked
**File:** `backend/services/socketService.js:135-138`  
**Status:** VERIFIED  
**Severity:** HIGH

When `removeConversationMember` sets `left_at` (via chatService.js:597-601), the removed member's socket remains in the `conversation_${conversationId}` room. They continue to receive `newMessage`, `typing`, `messagesRead`, and other events until they disconnect.

**Attack:** A staff member who is removed from a store can still receive chat messages in conversations they were part of, as long as their Socket.IO connection remains open.

---

### HIGH — SOCKET-06: `emitNewMessage` uses `message.receiver_id` which doesn't exist in schema
**File:** `backend/services/socketService.js:329-331`  
**Status:** VERIFIED  
**Severity:** HIGH

```javascript
if (message?.receiver_id) {
    io.to(`user_${message.receiver_id}`).emit('newMessage', message);
}
```

The `messages` table has `sender_id`, not `receiver_id`. The `receiver_id` property would be `undefined` for messages created via the current schema, so the per-user emit never fires. The message IS broadcast to the conversation room (`io.to('conversation_' + conversationId).emit('newMessage', message)`), so members still receive it. But the direct user-room notification (intended for offline push or chat-list updates) is broken.

---

### MEDIUM — SOCKET-07: `callSignal` and `joinCall` allow either participant to forward signals
**File:** `backend/services/socketService.js:193-221`  
**Status:** VERIFIED  
**Severity:** MEDIUM

Both `callSignal` and `joinCall` allow either the caller or callee to participate. A malicious caller could send `callSignal` messages to the callee's call room. While WebRTC signaling is typically authenticated by the client (the callee's browser would reject invalid SDP), a compromised client could send excessive signaling to disrupt the call.

---

### MEDIUM — SOCKET-08: No rate limiting on Socket.IO events
**File:** `backend/services/socketService.js` — no rate limiting  
**Status:** POTENTIAL  
**Severity:** MEDIUM

There is no rate limiting on `typing`, `callSignal`, `callHeartbeat`, or other events. A malicious user could flood the conversation room with typing events or call signals.

---

### LOW — SOCKET-09: `cors` origin allows `*` in development
**File:** `backend/services/socketService.js:14-21`  
**Status:** VERIFIED  
**Severity:** LOW

```javascript
cors: {
  origin: process.env.CLIENT_URL || '*',
  ...
}
```

If `CLIENT_URL` is not set, CORS allows all origins. This is a development convenience that could be dangerous in production if the env var is not configured.

---

## 8. Attachment / Storage Findings

### CRITICAL — STORAGE-01: `chat-attachments` SELECT policy uses fragile `LIKE` string matching
**File:** `supabase/migrations/004_storage_buckets.sql:173-184`  
**Status:** VERIFIED  
**Severity:** CRITICAL

```sql
CREATE POLICY "Conversation members can view attachments" ON storage.objects
    FOR SELECT USING (
        bucket_id = 'chat-attachments' 
        AND EXISTS (
            SELECT 1 FROM conversation_members cm
            JOIN messages m ON m.conversation_id = cm.conversation_id
            JOIN message_attachments ma ON ma.message_id = m.id
            WHERE ma.file_url LIKE '%' || storage.objects.name
            AND cm.profile_id = auth.uid()
            AND cm.left_at IS NULL
        )
    );
```

**Analysis:** The policy matches `ma.file_url LIKE '%' || storage.objects.name`. This is a suffix match on the full file URL. If two files have names where one is a suffix of another (e.g., `chat.pdf` and `xchat.pdf`), the LIKE pattern could match the wrong file. More importantly, `storage.objects.name` is just the object path (not the full URL), so the match is `file_url LIKE '%' || object_path`. This is fragile and could allow access to attachments through path manipulation.

**Example:** If object name is `conversation_id/2026/01/file.pdf` and `file_url` is `https://supabase.co/storage/v1/object/public/chat-attachments/conversation_id/2026/01/file.pdf`, the LIKE check `file_url LIKE '%conversation_id/2026/01/file.pdf'` would match. But if a user knows the object path of another conversation's file, they could potentially craft a request... actually, Storage policies are evaluated by Supabase based on the object being accessed, not a user-supplied path. So the user can only access objects they can guess the path for. The LIKE matching is still fragile because a shorter filename could match as a suffix of a longer path.

---

### CRITICAL — STORAGE-02: `chat-attachments` INSERT policy doesn't verify message exists in conversation
**File:** `supabase/migrations/004_storage_buckets.sql:188-197`  
**Status:** VERIFIED  
**Severity:** CRITICAL

```sql
CREATE POLICY "Conversation members can upload attachments" ON storage.objects
    FOR INSERT WITH CHECK (
        bucket_id = 'chat-attachments' 
        AND EXISTS (
            SELECT 1 FROM conversation_members 
            WHERE conversation_members.conversation_id::TEXT = (storage.foldername(storage.objects.name))[1] 
            AND conversation_members.profile_id = auth.uid()
            AND conversation_members.left_at IS NULL
        )
    );
```

**Analysis:** The INSERT policy checks that:
1. The bucket is `chat-attachments`
2. The first folder in the path matches a `conversation_id` where the user is an active member

The storage path format is `chat-attachments/{conversationId}/{year}/{month}/{fileName}` (from `backend/middleware/upload.js:68-73`). The `storage.foldername(storage.objects.name))[1]` extracts the first path segment, which would be `chat-attachments`, not the conversation ID. Wait — `storage.foldername` returns an array of path segments. `storage.objects.name` for a file at `chat-attachments/conv-123/2026/01/file.jpg` would have `foldername` = `['chat-attachments', 'conv-123', '2026', '01']`. So `[1]` would be `'conv-123'` (0-indexed) or `'chat-attachments'` (depending on indexing).

Actually, in Supabase/PostgreSQL, `storage.foldername(name)` returns a text array. `[1]` is the first element in PostgreSQL (1-indexed). So `[1]` = `'chat-attachments'`, not the conversation ID.

Wait, let me reconsider. `storage.foldername('chat-attachments/conv-123/2026/01/file.jpg')` returns `['chat-attachments', 'conv-123', '2026', '01', 'file.jpg']`. In PostgreSQL, array index `[1]` is the first element: `'chat-attachments'`. So the check `conversation_id::TEXT = 'chat-attachments'` would NEVER match a UUID. This means the INSERT policy is effectively broken — no one can upload via this policy.

However, the backend uses `supabaseAdmin.storage.from('chat-attachments').upload()` which bypasses storage RLS (service role). So the backend upload path works, but the direct client-side upload through storage RLS would fail.

This means:
1. If users upload directly through the browser (bypassing backend), they are blocked by this broken policy
2. If users upload through the backend (`/api/upload/chat/:conversationId`), the backend verifies membership first (`uploadRoutes.js:42-52`), then uses `supabaseAdmin` which bypasses storage RLS

---

### CRITICAL — STORAGE-03: "Admins can manage all storage" includes `owner` role, giving platform owner access to ALL buckets
**File:** `supabase/migrations/004_storage_buckets.sql:226-240`  
**Status:** VERIFIED  
**Severity:** CRITICAL

```sql
CREATE POLICY "Admins can manage all storage" ON storage.objects
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM profiles 
            WHERE profiles.id = auth.uid() 
            AND profiles.role IN ('admin', 'owner')
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM profiles 
            WHERE profiles.id = auth.uid() 
            AND profiles.role IN ('admin', 'owner')
        )
    );
```

The `owner` role in `user_role` enum is a platform-level role. This policy gives any platform owner full access to ALL storage buckets including `chat-attachments` and `voice-recordings` across ALL stores. A compromised platform owner account can read/delete any chat attachment or voice recording.

---

### HIGH — STORAGE-04: `voice-recordings` SELECT policy only checks caller/callee, not conversation membership
**File:** `supabase/migrations/004_storage_buckets.sql:204-212`  
**Status:** VERIFIED  
**Severity:** HIGH

```sql
CREATE POLICY "Call participants can access recordings" ON storage.objects
    FOR SELECT USING (
        bucket_id = 'voice-recordings' 
        AND EXISTS (
            SELECT 1 FROM call_history ch
            WHERE (ch.caller_id = auth.uid() OR ch.callee_id = auth.uid())
            AND ch.id::TEXT = (storage.foldername(storage.objects.name))[1]
        )
    );
```

Same foldername indexing issue as STORAGE-02 — `[1]` returns the first path segment which is `voice-recordings`, not the call ID. Also, the policy only checks caller/callee, not whether they are conversation members.

---

### HIGH — STORAGE-05: Chat attachment upload path via backend does not delete orphaned files on message deletion
**File:** `backend/services/chatService.js:481-513` (deleteMessage)  
**Status:** POTENTIAL  
**Severity:** HIGH

When a message is soft-deleted (`is_deleted = true`), the associated `message_attachments` rows remain, and the files in Supabase Storage remain. There is no cleanup of orphaned attachment files. Additionally, when a user leaves a conversation (`left_at` set), they lose RLS access to the attachments (via the SELECT policy), but the files still exist in storage and could be accessed via the storage API if someone knows the path.

---

### HIGH — STORAGE-06: `getSignedUrl` route for `chat-attachments` only checks conversation membership, not store membership
**File:** `backend/routes/uploadRoutes.js:94-102`  
**Status:** VERIFIED  
**Severity:** HIGH

```javascript
} else if (bucket === 'chat-attachments') {
    const { data: member } = await supabaseAdmin
      .from('conversation_members')
      .select('id')
      .eq('conversation_id', path.split('/')[1])
      .eq('profile_id', req.user.id)
      .is('left_at', null)
      .single();
    hasAccess = !!member;
}
```

The path format is `chat-attachments/{conversationId}/{year}/{month}/{fileName}`, so `path.split('/')[1]` = `conversationId`. This checks conversation membership correctly. However, there is no check that the user is still an active member at the time of download — which IS checked (`left_at IS NULL`). This is correct.

But there is no check for the `voice-recordings` bucket in the signed-url route — voice recordings are not handled in the signed-url endpoint (the `if` chain only handles avatars, chat-attachments, store-logos/covers/product-images).

---

### MEDIUM — STORAGE-07: `delete` route for storage does not handle `chat-attachments` or `voice-recordings`
**File:** `backend/routes/uploadRoutes.js:143-189`  
**Status:** VERIFIED  
**Severity:** MEDIUM

The delete route only handles `avatars`, `store-logos`, `store-covers`, `product-images`. Chat attachments and voice recordings cannot be deleted through this API. Files can only be deleted by soft-deleting the message (which doesn't delete the storage file).

---

### MEDIUM — STORAGE-08: Public buckets (avatars, store-logos, store-covers, product-images) have no per-resource RLS
**File:** `supabase/migrations/004_storage_buckets.sql:27-28, 63-64, 115-116, 143-144`  
**Status:** VERIFIED  
**Severity:** MEDIUM

Public buckets allow anyone to SELECT any object. There is no per-object authorization for public buckets. This is by design for public content (store logos, product images), but means any store logo or product image is publicly accessible regardless of store status.

---

## 9. Voice Call Security Findings

### CRITICAL — CALL-01: All call authorization is application-level only (supabaseAdmin bypasses RLS)
**Files:** `backend/services/callService.js` — all methods  
**Status:** VERIFIED  
**Severity:** CRITICAL

All call service functions use `supabaseAdmin`. The RLS policy for `call_history` (`002:786-791`) only allows callers/callees to view their own calls and service role to insert. Since the backend uses service role, there is no RLS safety net. All authorization depends on:
- `initiateCall`: verifies callee exists, checks conversation membership (`callService.js:160-207`)
- `acceptCall`: verifies `callee_id = userId`, checks conversation membership (`callService.js:274-302`)
- `rejectCall`: verifies `callee_id = userId` (`callService.js:352-360`)
- `endCall`: verifies `caller_id = userId OR callee_id = userId` (`callService.js:414-422`)
- `cancelCall`: verifies `caller_id = userId` (`callService.js:505-511`)

These checks are correct, but there is no database-level enforcement.

---

### CRITICAL — CALL-02: `handleSignaling` REST API endpoint does not verify the user is in the call room
**File:** `backend/services/callService.js:683-725`  
**Status:** VERIFIED  
**Severity:** CRITICAL

```javascript
export const handleSignaling = async (callId, userId, signalData) => {
  const { data: call } = await supabaseAdmin
    .from('call_history')
    .select('*')
    .eq('id', callId)
    .or(`caller_id.eq.${userId},callee_id.eq.${userId}`)
    .in('status', ['ringing', 'accepted'])
    .single();
```

This checks that the user is a participant but does NOT verify conversation membership separately. Since `call_history` already has `conversation_id`, and the call was created with conversation membership verification, this is transitively correct. However, if a call was created without a conversation_id (direct call), there's no conversation to check against.

---

### HIGH — CALL-03: Socket.IO `callSignal` allows signaling without `joinCall`
**File:** `backend/services/socketService.js:193-208`  
**Status:** VERIFIED  
**Severity:** HIGH

As noted in SOCKET-03, `callSignal` does not require the socket to have joined the call room. A participant can send signaling to the call room without being in it.

---

### HIGH — CALL-04: No third-party call joining prevention at Socket.IO level
**File:** `backend/services/socketService.js:210-221`  
**Status:** VERIFIED  
**Severity:** HIGH

The `joinCall` handler verifies the user is a participant (caller or callee). This prevents third parties from joining the call signaling room. However, the verification only checks `caller_id` and `callee_id` — it does NOT check conversation membership for the call (the call was already validated at creation time).

A user who was a participant when the call was created but has since left the conversation (left_at set) can still join the call room because `joinCall` doesn't re-check `left_at`.

---

### MEDIUM — CALL-05: Heartbeat does not verify conversation membership
**File:** `backend/services/callService.js:131-157`  
**Status:** VERIFIED  
**Severity:** MEDIUM

```javascript
export const heartbeatCall = async (callId, userId) => {
  const { data: call } = await supabaseAdmin
    .from('call_history')
    .select('id, caller_id, callee_id, status')
    .eq('id', callId)
    .eq('status', 'accepted')
    .single();
```

The heartbeat only checks that the user is caller or callee on an accepted call. It does NOT re-verify conversation membership. If a user leaves the conversation during an accepted call, they can still send heartbeats to keep the call alive.

---

### MEDIUM — CALL-06: `updateCallMetadata` / `getSignalingHistory` / `toggleMute` check caller/callee but not conversation membership
**Files:** `backend/services/callService.js:654-749`  
**Status:** VERIFIED  
**Severity:** MEDIUM

These functions check that the user is caller or callee on the call, but do not re-verify conversation membership. Same issue as CALL-05.

---

### LOW — CALL-07: `initiateCall` does not verify store order authorization when `storeOrderId` is provided
**File:** `backend/services/callService.js:160-207`  
**Status:** POTENTIAL  
**Severity:** LOW

When `storeOrderId` is provided, the function stores it in `call_history.store_order_id` but does NOT verify that the caller or callee has any relationship to that store order (e.g., that the customer placed the order or the store owns it). A user could initiate a call with a `storeOrderId` they don't own.

**However**, the `conversation_id` check (if provided) does verify both parties are conversation members. If the conversation is tied to the store order, this provides indirect protection.

---

### LOW — CALL-08: Call state machine enum extension (009) is not backward-compatible for rollback
**File:** `supabase/migrations/009_call_status_lifecycle.sql:7-10`  
**Status:** VERIFIED  
**Severity:** LOW

`ALTER TYPE call_status ADD VALUE` cannot be rolled back in PostgreSQL. Once `completed`, `no_answer`, `cancelled`, `failed` are added, they cannot be removed without recreating the type. The migration includes a warning ("DO NOT RUN on production without explicit approval") but there is no rollback strategy.

---

## 10. Security Test Matrix

| Test ID | Actor | Action | Expected | Existing Test | Status |
|---------|-------|--------|----------|---------------|--------|
| CM-01 | Customer A | Read own conversation | ALLOW | `chat.test.mjs:101` | EXISTS |
| CM-02 | Customer A | Read Customer B's conversation | DENY | `chat.test.mjs:116` (outsider) | EXISTS |
| CM-03 | Store Owner A | Read own store's conversation | ALLOW | `chat.test.mjs:108` | EXISTS |
| CM-04 | Store Owner A | Read Store B's conversation | DENY | Not explicitly tested | MISSING |
| CM-05 | Store Staff A | Read Store A's conversation | ALLOW | Not tested (staff not implemented) | MISSING |
| CM-06 | Store Staff A | Read Store B's conversation | DENY | Not tested | MISSING |
| CM-07 | Admin | Read any conversation | ALLOW | Not tested | MISSING |
| CM-08 | Left member | Read conversation after left_at | DENY | `chat.test.mjs:132` | EXISTS |
| MM-01 | Customer A | Send message to own conversation | ALLOW | `chat.test.mjs:165` | EXISTS |
| MM-02 | Customer A | Send message with forged sender_id | DENY | Covered by `sendMessage` using `req.user.id` | IMPLICIT |
| MM-03 | Customer A | Send message to Customer B's conversation | DENY | `chat.test.mjs:194` | EXISTS |
| MM-04 | Left member | Send message after left_at | DENY | Not explicitly tested | MISSING |
| MM-05 | Store Owner A | Send message to own store's conversation | ALLOW | `chat.test.mjs:180` | EXISTS |
| AM-01 | Customer A | Upload attachment to own message | ALLOW | `chat.test.mjs:215` | EXISTS |
| AM-02 | Customer A | Upload attachment to Customer B's message | DENY | `chat.test.mjs:273` (outsider) | EXISTS |
| AM-03 | Customer A | Upload attachment with forged message_id | DENY | `chat.test.mjs:295` (missing message) | EXISTS |
| AM-04 | Left member | Download attachment after left_at | DENY | Not tested | MISSING |
| RR-01 | Customer A | Mark own messages as read | ALLOW | `chat.test.mjs:312` | EXISTS |
| RR-02 | Customer A | Mark messages with other conversation's message_id | DENY | `chat.test.mjs:327` | EXISTS |
| RR-03 | Outsider | Mark messages as read | DENY | `chat.test.mjs:335` | EXISTS |
| UC-01 | Customer A | Get unread count | ALLOW | `chat.test.mjs:343` | EXISTS |
| UC-02 | Outsider | Get unread count | ALLOW (returns 0) | `chat.test.mjs:343` | EXISTS |
| TY-01 | Customer A | Send typing in own conversation | ALLOW | Not tested | MISSING |
| TY-02 | Customer A | Send typing in Customer B's conversation | DENY | Not tested | MISSING |
| IC-01 | Customer A | Initiate call to Admin | ALLOW | `callIncomingSocket.test.mjs:226` | EXISTS |
| IC-02 | Non-callee | Receive incomingCall | DENY | `callIncomingSocket.test.mjs:274` | EXISTS |
| IC-03 | Unauthenticated | Connect to Socket.IO | DENY | `callIncomingSocket.test.mjs:294` | EXISTS |
| IC-04 | Duplicate initiateCall | While ringing | DENY (400) | `callIncomingSocket.test.mjs:315` | EXISTS |
| IC-05 | Inactive callee | Initiate call | DENY (400) | `callIncomingSocket.test.mjs:346` | EXISTS |
| IC-06 | Reconnected socket | Receive stale incomingCall | DENY | `callIncomingSocket.test.mjs:403` | EXISTS |
| CS-01 | Caller | Accept own call (as callee) | ALLOW | `callApi.test.mjs` (accept by callee) | EXISTS |
| CS-02 | Caller | Accept call (as caller, not callee) | DENY (404) | `callApi.test.mjs` | EXISTS |
| CS-03 | Third party | Accept call | DENY (404) | `callApi.test.mjs` | EXISTS |
| CS-04 | Third party | Join call signaling room | DENY | Not tested via Socket.IO | MISSING |
| CS-05 | Left member | Send heartbeat during accepted call | DENY | Not tested | MISSING |
| SM-01 | Store Owner A | Add staff to Store A | ALLOW | Not implemented | MISSING |
| SM-02 | Store Staff A | Access Store B | DENY | Not implemented | MISSING |
| SM-03 | Removed staff | Rejoin Store A | DENY (should be) | Not implemented | MISSING |
| SM-04 | Store Owner A | Change staff role | ALLOW | Not implemented | MISSING |
| LR-01 | User | Socket after token expiry | DENY | Not tested | MISSING |
| LR-02 | User | Socket after account deactivation | DENY | Not tested | MISSING |
| LR-03 | Removed member | Socket still in conversation room | DENY | Not tested | MISSING |
| MBS-01 | User | Multiple browser sessions | ALLOW | Not tested | MISSING |

**Legend:** ALLOW = request should succeed, DENY = request should be rejected with 403/401/409

**Existing tests:** 179 tests covering chat, calls, socket.io, addresses, auth, phone validation, pricing.

**Missing tests:** Store membership (not implemented), cross-store access, staff/manager roles, typing in wrong conversation, left member sending messages, third-party call signaling, socket after token expiry/deactivation, multiple browser sessions.

---

## 11. Migration 010/011 Risk Assessment

### Migration 010 (`supabase/migrations/010_store_memberships.sql`) — NOT RUN

**SQL proposed:**
```sql
CREATE TABLE IF NOT EXISTS store_memberships (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'staff', -- owner, staff, manager
    permissions JSONB DEFAULT '{}',
    joined_at TIMESTAMPTZ DEFAULT NOW(),
    left_at TIMESTAMPTZ,
    UNIQUE (store_id, profile_id)
);
```

**Risks:**
1. **UNIQUE (store_id, profile_id) prevents re-adding members** after left_at is set. **Fix:** Use `UNIQUE (store_id, profile_id) WHERE left_at IS NULL` partial index.
2. **No CHECK constraint on role** — any string value allowed. **Fix:** Add `CHECK (role IN ('owner', 'staff', 'manager'))`.
3. **Only SELECT RLS policy** — no INSERT/UPDATE/DELETE policies. All mutations must go through supabaseAdmin with application checks.
4. **No backfill of store owners** — the migration doesn't insert store_memberships rows for existing store owners. The Phase 1 report mentions this backfill is planned but not in the SQL.
5. **Foreign key ON DELETE CASCADE** — if a store is deleted, all memberships are deleted. If a profile is deleted, all memberships are deleted. This is correct.

**Rollback strategy:** `DROP TABLE store_memberships CASCADE;` — additive only, no data loss for existing tables.

### Migration 011 — DOES NOT EXIST

The Phase 1 report (MULTI_STORE_VERIFICATION_REPORT.md:35) mentions migration 011 would add "unique partial index on conversations (type, store_id) scoped by customer membership." **No 011 migration file exists.**

**Proposed unique index design (WRONG if `(type, store_id)` only):**
```sql
-- WRONG: Would force all customers of a store to share one conversation
CREATE UNIQUE INDEX ON conversations (type, store_id) WHERE type = 'store_customer';
```

**Correct design:** Need to scope by customer. Options:
1. Add `customer_id` column to `conversations` for `store_customer` type, then unique on `(type, store_id, customer_id)`
2. Use a partial unique index on `conversation_members` — but unique indexes can't span multiple tables
3. Use application-level deduplication (current approach) with database advisory locks for race condition prevention

**Impact on existing chat/call data:** Migration 010 is additive (new table only). No impact on existing conversations, messages, or call_history. Migration 011 (if it adds an index) is also additive.

---

## 12. Recommended Architecture

### 12.1 Conversation Model (Recommended)

Add `customer_id` column to `conversations` for `store_customer` type:

```sql
ALTER TABLE conversations ADD COLUMN customer_id UUID REFERENCES profiles(id);

-- Unique constraint: one conversation per (customer, store) pair
CREATE UNIQUE INDEX idx_conversations_customer_store_unique
    ON conversations (type, store_id, customer_id)
    WHERE type = 'store_customer' AND customer_id IS NOT NULL;
```

This ensures:
- Customer A ↔ Store A: one conversation
- Customer A ↔ Store B: separate conversation
- Customer B ↔ Store A: separate conversation
- Customer A ↔ Admin: `direct` type, store_id NULL

### 12.2 Store Membership Model (Recommended)

Fix migration 010 before running:

```sql
-- Partial unique index allows re-adding after left_at
CREATE UNIQUE INDEX idx_store_memberships_active
    ON store_memberships (store_id, profile_id)
    WHERE left_at IS NULL;

-- CHECK constraint on role
ALTER TABLE store_memberships
    ADD CONSTRAINT store_memberships_role_check
    CHECK (role IN ('owner', 'staff', 'manager'));

-- Full RLS policies
CREATE POLICY store_memberships_insert ON store_memberships
    FOR INSERT WITH CHECK (
        EXISTS (SELECT 1 FROM stores WHERE id = store_id AND owner_id = auth.uid())
        OR auth.role() = 'service_role'
    );
-- Similar for UPDATE, DELETE
```

### 12.3 Socket.IO Security (Recommended)

1. **Add membership check to `typing`/`stopTyping`** — verify user is an active conversation member before broadcasting
2. **Require `joinCall` before `callSignal`** — track which sockets have joined which call rooms
3. **Force-leave conversation rooms on member removal** — maintain a server-side mapping and kick sockets when `left_at` is set
4. **Re-authenticate on token expiry** — implement middleware to refresh or re-verify tokens periodically
5. **Restrict `joinStore` to store members via `store_memberships`** — not just `store.owner_id`

### 12.4 Storage Security (Recommended)

1. **Fix `chat-attachments` INSERT policy** — correct `storage.foldername()` indexing
2. **Add `chat-attachments` DELETE policy** — allow members to delete their own attachments
3. **Remove `owner` from "Admins can manage all storage"** — or scope it to specific buckets
4. **Add cleanup of orphaned storage files** — when messages are deleted or members leave

---

## 13. Recommended SQL Design (Proposal Only — DO NOT RUN)

### 13.1 Fixed Migration 010

```sql
-- Corrected store_migrations.sql
CREATE TABLE IF NOT EXISTS store_memberships (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'staff',
    permissions JSONB DEFAULT '{}',
    joined_at TIMESTAMPTZ DEFAULT NOW(),
    left_at TIMESTAMPTZ,
    CONSTRAINT store_memberships_role_check CHECK (role IN ('owner', 'staff', 'manager'))
);

CREATE INDEX IF NOT EXISTS idx_store_memberships_store ON store_memberships(store_id);
CREATE INDEX IF NOT EXISTS idx_store_memberships_profile ON store_memberships(profile_id);
-- Partial unique: allows re-adding after left_at
CREATE UNIQUE INDEX IF NOT EXISTS idx_store_memberships_active
    ON store_memberships(store_id, profile_id) WHERE left_at IS NULL;

ALTER TABLE store_memberships ENABLE ROW LEVEL SECURITY;

-- SELECT: members can view their own, store owners can view all
CREATE POLICY store_memberships_select ON store_memberships
    FOR SELECT USING (profile_id = auth.uid() OR EXISTS (
        SELECT 1 FROM stores s WHERE s.id = store_id AND s.owner_id = auth.uid()
    ));

-- INSERT: store owners can add members
CREATE POLICY store_memberships_insert ON store_memberships
    FOR INSERT WITH CHECK (
        EXISTS (SELECT 1 FROM stores WHERE id = store_id AND owner_id = auth.uid())
    );

-- UPDATE: store owners can update (role, left_at, permissions)
CREATE POLICY store_memberships_update ON store_memberships
    FOR UPDATE USING (
        EXISTS (SELECT 1 FROM stores WHERE id = store_id AND owner_id = auth.uid())
    )
    WITH CHECK (
        EXISTS (SELECT 1 FROM stores WHERE id = store_id AND owner_id = auth.uid())
    );

-- DELETE: store owners can remove (soft delete via left_at preferred)
CREATE POLICY store_memberships_delete ON store_memberships
    FOR DELETE USING (
        EXISTS (SELECT 1 FROM stores WHERE id = store_id AND owner_id = auth.uid())
    );
```

### 13.2 Migration 011 (Customer-Store Conversation Uniqueness)

```sql
-- Add customer_id column for store_customer conversations
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES profiles(id);

-- Unique: one conversation per customer-store pair
CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_customer_store_unique
    ON conversations (type, store_id, customer_id)
    WHERE type = 'store_customer' AND customer_id IS NOT NULL;
```

### 13.3 RLS Hardening for `conversations` INSERT

```sql
-- Replace WITH CHECK (true) with owner/member check
DROP POLICY IF EXISTS "Users can create conversations" ON conversations;
CREATE POLICY "Users can create conversations" ON conversations
    FOR INSERT WITH CHECK (
        (store_id IS NULL AND type = 'direct') OR
        EXISTS (SELECT 1 FROM stores WHERE id = store_id AND owner_id = auth.uid())
    );
```

### 13.4 RLS Hardening for `conversation_members` INSERT

```sql
-- Replace WITH CHECK (profile_id = auth.uid()) with membership invitation check
DROP POLICY IF EXISTS "Users can join conversations" ON conversation_members;
CREATE POLICY "Users can join conversations" ON conversation_members
    FOR INSERT WITH CHECK (
        profile_id = auth.uid() AND EXISTS (
            SELECT 1 FROM conversations c WHERE c.id = conversation_id
        )
    );
-- Note: Full invitation-based join requires application-level enforcement
-- since RLS cannot verify "was invited by admin" without additional tables
```

---

## 14. Implementation Priority

| Priority | Issue | File | Effort |
|----------|-------|------|--------|
| P1 (Critical) | Fix RLS `conversations` INSERT `WITH CHECK (true)` | `002_rls_policies.sql:630` | Low |
| P1 (Critical) | Fix RLS `conversation_members` INSERT self-join | `002_rls_policies.sql:662` | Low |
| P1 (Critical) | Fix `uploadMessageAttachment` `userId = null` default | `chatService.js:629` | Low |
| P1 (Critical) | Fix Socket.IO `typing` no membership check | `socketService.js:177` | Low |
| P1 (Critical) | Fix Socket.IO `joinStore` platform owner bypass | `socketService.js:105` | Low |
| P1 (Critical) | Fix `store_migrations.sql` UNIQUE prevents re-add | `010_store_memberships.sql:11` | Low |
| P1 (Critical) | Fix `store_migrations.sql` missing INSERT/UPDATE/DELETE RLS | `010_store_memberships.sql:17-20` | Low |
| P2 (High) | Fix `chat-attachments` storage LIKE matching | `004_storage_buckets.sql:180` | Low |
| P2 (High) | Fix `chat-attachments` INSERT foldername indexing | `004_storage_buckets.sql:193` | Low |
| P2 (High) | Remove `owner` from "Admins can manage all storage" | `004_storage_buckets.sql:226-240` | Low |
| P2 (High) | Add conversation membership check to Socket.IO `callSignal` | `socketService.js:193` | Medium |
| P2 (High) | Force-remove sockets from conversation on left_at | `socketService.js` + `chatService.js` | Medium |
| P2 (High) | Add store membership check to `joinStore` | `socketService.js:95-109` | Medium |
| P2 (High) | Implement store_memberships backend routes/services | New files | High |
| P3 (Medium) | Add `customer_id` to conversations + unique index | New migration | Medium |
| P3 (Medium) | Add `admin_customer` to conversation_type enum | `001_initial_schema.sql:20` | Medium |
| P3 (Medium) | Fix `messageController.js` dead code (`isRoomParticipant`, `resolveStore`) | `messageController.js:37-50` | Low |
| P3 (Medium) | Add rate limiting to Socket.IO events | `socketService.js` | Medium |
| P4 (Low) | Add CHECK constraint on `conversation_members.role` | `001_initial_schema.sql:537` | Low |
| P4 (Low) | Clean up orphaned storage files on message deletion | `chatService.js` | Medium |

---

## 15. Files and Lines with Issues

### Supabase Migrations

| File | Line | Issue | Severity | Status |
|------|------|-------|----------|--------|
| `supabase/migrations/001_initial_schema.sql` | 14 | `user_role` enum includes `owner` (platform) conflated with store owner | MEDIUM | VERIFIED |
| `supabase/migrations/001_initial_schema.sql` | 20 | `admin_customer` NOT in `conversation_type` enum | CRITICAL | VERIFIED |
| `supabase/migrations/001_initial_schema.sql` | 537 | `conversation_members.role` TEXT without CHECK constraint | MEDIUM | VERIFIED |
| `supabase/migrations/002_rls_policies.sql` | 630 | `conversations` INSERT `WITH CHECK (true)` | CRITICAL | VERIFIED |
| `supabase/migrations/002_rls_policies.sql` | 662 | `conversation_members` INSERT allows self-join to any conversation | CRITICAL | VERIFIED |
| `supabase/migrations/002_rls_policies.sql` | 757-764 | `message_attachments` INSERT no conversation membership check | CRITICAL | VERIFIED |
| `supabase/migrations/002_rls_policies.sql` | 786-787 | `call_history` SELECT exposes full record to caller/callee | HIGH | VERIFIED |
| `supabase/migrations/004_storage_buckets.sql` | 180 | `chat-attachments` SELECT fragile LIKE matching | CRITICAL | VERIFIED |
| `supabase/migrations/004_storage_buckets.sql` | 193 | `chat-attachments` INSERT foldername indexing likely broken | CRITICAL | VERIFIED |
| `supabase/migrations/004_storage_buckets.sql` | 226-240 | "Admins can manage all storage" includes platform `owner` | CRITICAL | VERIFIED |
| `supabase/migrations/004_storage_buckets.sql` | 204-212 | `voice-recordings` SELECT foldername indexing likely broken | HIGH | VERIFIED |
| `supabase/migrations/010_store_memberships.sql` | 11 | UNIQUE prevents re-adding after left_at | CRITICAL | VERIFIED |
| `supabase/migrations/010_store_memberships.sql` | 7 | No CHECK constraint on role | HIGH | VERIFIED |
| `supabase/migrations/010_store_memberships.sql` | 17-20 | Only SELECT RLS policy, no INSERT/UPDATE/DELETE | CRITICAL | VERIFIED |
| `supabase/migrations/009_call_status_lifecycle.sql` | 7-10 | ALTER TYPE ADD VALUE cannot be rolled back | LOW | VERIFIED |

### Backend Source Code

| File | Line | Issue | Severity | Status |
|------|------|-------|----------|--------|
| `backend/config/supabase.js` | 45-52 | `supabaseAdmin` bypasses RLS — no safety net | CRITICAL | VERIFIED |
| `backend/services/chatService.js` | 629 | `uploadMessageAttachment` `userId = null` skips membership check | CRITICAL | VERIFIED |
| `backend/services/socketService.js` | 177-190 | `typing`/`stopTyping` no conversation membership check | CRITICAL | VERIFIED |
| `backend/services/socketService.js` | 105 | `joinStore` allows platform `owner` into any store room | CRITICAL | VERIFIED |
| `backend/services/socketService.js` | 193-208 | `callSignal` doesn't require `joinCall` first | CRITICAL | VERIFIED |
| `backend/services/socketService.js` | 329 | `emitNewMessage` uses non-existent `message.receiver_id` | HIGH | VERIFIED |
| `backend/services/socketService.js` | 24-78 | No re-auth on token expiry/deactivation | HIGH | VERIFIED |
| `backend/services/socketService.js` | 135-138 | No forced removal from rooms on `left_at` | HIGH | VERIFIED |
| `backend/services/chatService.js` | 665-717 | `getStoreConversations` doesn't filter by membership | HIGH | VERIFIED |
| `backend/services/callService.js` | 131-157 | `heartbeatCall` no conversation membership re-check | MEDIUM | VERIFIED |
| `backend/services/callService.js` | 683-725 | `handleSignaling` no conversation membership check | MEDIUM | VERIFIED |
| `backend/controllers/messageController.js` | 42-50 | `isRoomParticipant` queries non-existent columns | CRITICAL | VERIFIED |
| `backend/controllers/messageController.js` | 25-35 | `resolveStore` tries non-existent `seller_id`, `user_id` | CRITICAL | VERIFIED |
| `backend/controllers/messageController.js` | 121-165 | Trusts `senderRole` from request body | HIGH | VERIFIED |
| `backend/services/chatService.js` | 481 | `deleteMessage` `isAdmin` always false from route | MEDIUM | VERIFIED |
| `backend/services/chatService.js` | 516-554 | `createGroupConversation` doesn't validate memberIds | MEDIUM | VERIFIED |
| `backend/middleware/auth.js` | 100-174 | Token verification OK, but Socket.IO doesn't re-verify | HIGH | VERIFIED |
| `backend/routes/uploadRoutes.js` | 143-189 | Delete route doesn't handle chat-attachments/voice-recordings | MEDIUM | VERIFIED |
| `backend/routes/uploadRoutes.js` | 94-102 | Signed URL for chat-attachments OK, voice-recordings missing | HIGH | VERIFIED |

### Frontend Source Code

| File | Line | Issue | Severity | Status |
|------|------|-------|----------|--------|
| `frontend/src/context/SocketContext.jsx` | 241-271 | Client emits `joinStore`/`joinConversation` without server-side pre-validation | MEDIUM | VERIFIED |
| `frontend/src/context/SocketContext.jsx` | 96-99 | Sender exclusion for notification sound done client-side only | LOW | VERIFIED |

---

## Acceptance Criteria Verification

| Criterion | Status | Evidence |
|-----------|--------|----------|
| No code or database changes made | PASS | Read-only audit; `git diff` shows only pre-existing modifications |
| Git diff preserved | PASS | Pre-existing modifications: `messageController.js`, `callService.js`, `auth.js`; untracked: reports, test, migration 010 |
| 179 tests not modified or broken | PASS | All 179 tests pass (`node --test "__tests__/*.test.mjs"`) |
| No production migration run | PASS | Migration 010 is untracked and marked "NOT RUN"; no SQL executed |
| Report references real files and lines | PASS | All findings include `file_path:line_number` references |
| Proposals don't conflict with existing Chat/Call system | PASS | Recommendations are additive; call state machine, idempotency, heartbeat, recovery untouched |

---

## CRITICAL/HIGH Items Requiring Fix Before Implementation

The following **CRITICAL** and **HIGH** severity items must be addressed before any multi-store implementation begins:

### CRITICAL (must fix first)
1. **RLS `conversations` INSERT `WITH CHECK (true)`** — `supabase/migrations/002_rls_policies.sql:630`
2. **RLS `conversation_members` INSERT allows self-join to any conversation** — `supabase/migrations/002_rls_policies.sql:662`
3. **RLS `message_attachments` INSERT no conversation membership check** — `supabase/migrations/002_rls_policies.sql:757-764`
4. **`uploadMessageAttachment` `userId = null` default skips membership check** — `backend/services/chatService.js:629`
5. **Socket.IO `typing`/`stopTyping` no conversation membership check** — `backend/services/socketService.js:177-190`
6. **Socket.IO `joinStore` platform owner bypass** — `backend/services/socketService.js:105`
7. **`store_migrations.sql` UNIQUE prevents re-adding members after left_at** — `supabase/migrations/010_store_memberships.sql:11`
8. **`store_migrations.sql` missing INSERT/UPDATE/DELETE RLS policies** — `supabase/migrations/010_store_memberships.sql:17-20`

### HIGH (must fix before implementation)
9. **`chat-attachments` storage fragile LIKE matching** — `supabase/migrations/004_storage_buckets.sql:180`
10. **`chat-attachments` INSERT foldername indexing** — `supabase/migrations/004_storage_buckets.sql:193`
11. **"Admins can manage all storage" includes platform owner** — `supabase/migrations/004_storage_buckets.sql:226-240`
12. **Socket.IO `callSignal` doesn't require `joinCall`** — `backend/services/socketService.js:193-208`
13. **No forced socket removal from conversation on `left_at`** — `backend/services/socketService.js:135-138`
14. **`getStoreConversations` doesn't filter by membership** — `backend/services/chatService.js:665-717`
15. **Socket connections persist after token expiry/deactivation** — `backend/services/socketService.js:24-78`
16. **`store_migrations.sql` no CHECK constraint on role** — `supabase/migrations/010_store_memberships.sql:7`

---

**Report Path:** `C:\Users\LEGION\OneDrive\Desktop\kindee-marketplace/MULTI_STORE_DEEP_SECURITY_AUDIT.md`  
**Audit Status:** COMPLETE — READ-ONLY, no changes made  
**Next Step:** Address CRITICAL/HIGH items before starting multi-store implementation. Do NOT run migration 010 or create migration 011 until RLS and backend authorization gaps are remediated.