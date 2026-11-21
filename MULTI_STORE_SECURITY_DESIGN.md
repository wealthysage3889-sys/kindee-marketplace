# Kindee Multi-Store Security Design

**Project Root:** `C:\Users\LEGION\OneDrive\Desktop\kindee-marketplace`  
**Git Remote:** `wealthysage3889-sys/kindee-marketplace`  
**Branch:** `main`  
**Status:** DESIGN ONLY — no source code, SQL, Supabase, production, migration, commit, push, or deploy changes made.  
**Baseline:** 179 tests preserved; Chat/Voice Call behavior and Call subsystem invariants unchanged.  
**Related:** `MULTI_STORE_SECURITY_FIX_PLAN.md` (Phase 0 decisions D0.1–D0.4), `MULTI_STORE_VERIFICATION_REPORT.md`, `supabase/migrations/010_store_memberships.sql` (draft, not run).

---

## 1. Architecture Decisions

### D0.1 — Canonical Storage Key Format (Selected: Option A)

Object keys inside a bucket are stored **without** the leading bucket segment. `bucket_id` remains the authoritative bucket discriminator.

| Bucket | Canonical object key (inside bucket) | Stored as in Supabase (object.name) |
|--------|--------------------------------------|-------------------------------------|
| `avatars` | `avatars/{profileId}/{YYYY}/{MM}/{file}` | `avatars/{profileId}/{YYYY}/{MM}/{file}` |
| `store-logos` | `stores/{storeId}/logo/{YYYY}/{MM}/{file}` | `stores/{storeId}/logo/{YYYY}/{MM}/{file}` |
| `store-covers` | `stores/{storeId}/cover/{YYYY}/{MM}/{file}` | `stores/{storeId}/cover/{YYYY}/{MM}/{file}` |
| `product-images` | `products/{productId}/{YYYY}/{MM}/{file}` | `products/{productId}/{YYYY}/{MM}/{file}` |
| `chat-attachments` | `chat-attachments/{conversationId}/{YYYY}/{MM}/{file}` | `chat-attachments/{conversationId}/{YYYY}/{MM}/{file}` |
| `voice-recordings` | `voice-recordings/{callHistoryId}/{YYYY}/{MM}/{file}` | `voice-recordings/{callHistoryId}/{YYYY}/{MM}/{file}` |

- `storage.objects.name` = canonical key (no duplicate bucket prefix).
- `storage.objects.bucket_id` = bucket name (source of truth for bucket scoping).
- `storage.foldername(name)[0]` = resource-type segment (`chat-attachments`, `products`, etc.); `[1]` = owner/resource UUID; `[2]` = year; `[3]` = month.
- All policy `foldername` indexing, signed-url generation, delete parsing, and app-level path construction must use this single convention.
- Migration path: existing bucket-prefixed keys (`bucket/ownerId/...`) are NOT rewritten in this phase; policies treat both shapes defensively during transition, new uploads use canonical shape only.

### D0.2 — `admin_customer` Decision (Selected: keep existing, do NOT add enum)

- `conversation_type` enum remains `('direct','group','store_customer','order_support')`. `admin_customer` is NOT added.
- Customer ↔ Platform Admin conversations use type `direct` (store_id NULL).
- Rationale: minimal blast radius; no enum migration, no type-check churn, no risk to existing `direct` conversations. Revisit only if product explicitly requires a distinct admin-customer conversation type later.

### D0.3 — Multi-Store Membership Semantics

- Platform role (`profiles.role` ∈ customer/seller/admin/owner/courier) is **independent** of Store Membership role (`store_memberships.role` ∈ owner/staff/manager).
- `profiles.role = 'owner'` = platform-level store owner flag (existing, tied to `stores.owner_id`).
- `store_memberships` is the source of truth for per-store staff/manager membership and permissions.
- A store owner is implicitly a member of their own store (backfilled into `store_memberships` with role `owner` during migration); staff/manager roles are explicit rows.
- Platform `admin`/`owner` are **platform-level** roles; they do NOT implicitly grant access to arbitrary store rooms except via explicit audited escalation (see Socket `joinStore` restriction in Plan S1.1).
- Store staff access to store conversations/rooms requires an active `store_memberships` row (`left_at IS NULL`) for that store.

### D0.4 — Conversation Uniqueness Model

- Add `customer_id` (UUID → profiles.id, nullable) to `conversations` for `store_customer` type; NULL for `direct`/`group`/`order_support`.
- Uniqueness rule: one **active** `store_customer` conversation per (`customer_id`, `store_id`) pair → partial unique index `(customer_id, store_id)` WHERE `type = 'store_customer'` AND no left-at members... (enforced at app level via `getOrCreateConversation` upsert/retry after index exists).
- Customer ↔ Admin: type `direct`, `store_id` NULL, `customer_id` NULL; two members (customer + admin).
- Customer ↔ Store A / Customer ↔ Store B: separate conversations, distinct `store_id`, same `customer_id`.
- Same customer + same store: exactly one conversation (dedup via index + upsert).
- Concurrent `getOrCreateConversation` requests resolve via DB unique conflict → one winner, others return the existing row.

---

## 2. Role & Permission Matrix

### 2.1 Roles

| Role | Scope | Source | Notes |
|------|-------|--------|-------|
| Platform Admin | Platform-wide | `profiles.role = 'admin'` | Full platform ops; scoped storage/admin actions |
| Platform Owner | Platform-wide | `profiles.role = 'owner'` | Store ownership + platform admin-adjacent |
| Customer | Platform-wide | `profiles.role = 'customer'` | Buyer; own conversations/attachments/calls |
| Store Owner | Per-store | `stores.owner_id` + `store_memberships.role='owner'` | Full control of own store |
| Store Manager | Per-store | `store_memberships.role='manager'`, active | Store ops; staff management (except owner demotion/removal) |
| Store Staff | Per-store | `store_memberships.role='staff'`, active | Limited store ops per `permissions` JSONB |

Platform Role ≠ Store Membership Role. `profiles.role` never authorizes cross-store data; `store_memberships` does.

### 2.2 Permission Matrix

| Permission | Platform Admin | Platform Owner | Customer | Store Owner | Store Manager | Store Staff |
|------------|----------------|----------------|----------|-------------|---------------|-------------|
| Read own profile | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Write own profile | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Read any store | ✅ | ✅ | ❌ (public fields only) | own store | own store | own store |
| Write own store | ✅ | ✅ | ❌ | ✅ | ✅ (perms) | ❌ |
| Add store member | ✅ | ✅ | ❌ | ✅ | ✅ (perms) | ❌ |
| Change member role/perms | ✅ | ✅ | ❌ | ✅ | ✅ (not owner demotion) | ❌ |
| Suspend member | ✅ | ✅ | ❌ | ✅ | ✅ | ❌ |
| Remove member | ✅ | ✅ | ❌ | ✅ | ✅ (not owner) | ❌ |
| Re-add removed member | ✅ | ✅ | ❌ | ✅ | ✅ | ❌ |
| Read own conversation | ✅ | ✅ | ✅ (member only) | member/owner | active member | active member |
| Write own conversation | ✅ | ✅ | ✅ (member only) | member/owner | active member | active member |
| Upload chat attachment | ✅ | ✅ | ✅ (member only) | member/owner | active member | active member |
| Download chat attachment | ✅ | ✅ | ✅ (member only) | member/owner | active member | active member |
| Delete chat attachment | ✅ | ✅ | ✅ (own, in own msg) | owner/store | owner/store | ❌ |
| Read voice recording | ✅ | ✅ | ✅ (call participant) | participant | participant | participant |
| Upload voice recording | ✅ (service) | ✅ (service) | ❌ client | ❌ client | ❌ client | ❌ client |
| Delete voice recording | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Join store room (socket) | ✅ (owner only) | ✅ (own store) | ❌ | own store | active member | active member |
| Join conversation room | ✅ | ✅ | member | member | active member | active member |
| Typing event | ✅ | ✅ | member | member | active member | active member |
| Call initiate | ✅ | ✅ | ✅ (participant) | participant | participant | participant |
| Call join/accept | ✅ | ✅ | ✅ (participant) | participant | participant | participant |
| Call signal/heartbeat | ✅ | ✅ | ✅ (active call) | participant | participant | participant |
| Read call history | ✅ | ✅ | own calls | own store calls | own store calls | own store calls |

✅ = Allow, ❌ = Deny, (member only) = requires active `conversation_members.left_at IS NULL`, (perms) = subject to `store_memberships.permissions` JSONB.

### 2.3 Allow / Deny Principles

- **Allow:** subject is an active member of the target conversation OR owns the target store OR holds platform admin/owner with explicit scoped justification.
- **Deny:** any `left_at IS NOT NULL` membership; any cross-store access without platform escalation; any client direct write to `voice-recordings`; any `store_memberships` mutation by non-owner/non-manager without `permissions` grant.
- **Implicit deny:** everything not explicitly allowed.

---

## 3. Storage Key Specification

### 3.1 Canonical format

```
{bucket-scoped-resource}/{resourceId}/{YYYY}/{MM}/{fileName}
```

- No leading bucket segment in `storage.objects.name`.
- `bucket_id` column is authoritative for bucket; policies prefix-check `bucket_id = '<bucket>'` first, then parse `storage.foldername(name)`.
- `fileName` uses `generateFileName` convention: `{timestamp}-{uuid}{ext}`.

### 3.2 Path rules per bucket

| Bucket | Public read? | Client write? | Path owner | Authz basis |
|--------|--------------|---------------|------------|-------------|
| `avatars` | ✅ | ✅ (own) | profileId | `auth.uid()` == `[1]` |
| `store-logos` | ✅ | ✅ (owner) | storeId | store.owner_id == auth.uid() |
| `store-covers` | ✅ | ✅ (owner) | storeId | store.owner_id == auth.uid() |
| `product-images` | ✅ | ✅ (owner) | productId | product.store owner == auth.uid() |
| `chat-attachments` | ❌ | ✅ (member) | conversationId | active conversation_members |
| `voice-recordings` | ❌ | ❌ (service only) | callHistoryId | call participant |

### 3.3 Read / Download / Delete authorization

- **Read (SELECT / signed URL):** `bucket_id` match + resource ownership/membership via `storage.foldername(name)` join to the authoritative table (`conversation_members`, `call_history`, `stores`, `products`, `profiles`). `left_at IS NULL` required for chat; participant required for voice.
- **Download:** same as Read; signed URL generated server-side after app-level authz; never return raw public URL for private buckets.
- **Delete:** same as Read + write intent; `chat-attachments` delete allowed only by attachment owner/message sender or store owner; `voice-recordings` delete NOT exposed to clients (service/admin only); `avatars`/`store-logos`/`store-covers`/`product-images` delete by resource owner.

---

## 4. Store Membership Lifecycle

### 4.1 States

| State | Meaning | Access |
|-------|---------|--------|
| active | `left_at IS NULL` | Full perms per role |
| suspended | `left_at` set + `suspended_at`/`suspended_reason` | No store access; row retained |
| removed | `left_at` set | No store access; row retained (audit) |

### 4.2 Transitions

1. **Add member:** insert `store_memberships(store_id, profile_id, role, permissions, joined_at)`. Requires actor = store owner or manager with `permissions.member_write`. Reject if active row exists for (`store_id`,`profile_id`).
2. **Change role/permissions:** update `role`/`permissions`. Requires actor authorization; manager cannot demote/remove owner; owner cannot demote self to below owner if sole owner.
3. **Suspend member:** set `left_at = now()`, `suspended_at`, `suspended_by`, `suspended_reason`. Row retained. Actor = owner/manager-with-perms. Cannot suspend self if sole owner.
4. **Remove member:** set `left_at = now()`, `removed_by`, `removed_reason`. Row retained (audit trail). Cannot remove sole owner.
5. **Re-add former member:** if row exists with `left_at IS NOT NULL`, reactivate (set `left_at = NULL`, clear suspension fields, update `joined_at`/`rejoined_at`). If no row, insert new. Requires owner/manager-with-perms.
6. **Force access cutoff:** on any suspension/removal, broadcast socket `member:removed` + force-leave affected store/conversation rooms; invalidate cached session tokens at next revalidation.

### 4.3 Anti-re-access guarantees

- Removed/suspended members (`left_at IS NOT NULL`) are excluded from all store-scoped authorization: `joinStore`, store conversation listing, store room membership, attachment download for store-scoped convos.
- `conversation_members.left_at` is independently checked per conversation (leaving a conversation ≠ leaving store membership, and vice versa); both must be active for full access.
- No auto-regrant: re-add requires explicit owner/manager action; permissions default to staff-level unless explicitly upgraded.

---

## 5. Conversation Identity & Uniqueness

### 5.1 Identity model

| Scenario | Type | store_id | customer_id | Members |
|----------|------|----------|-------------|---------|
| Customer ↔ Platform Admin | `direct` | NULL | NULL | customer + admin |
| Customer ↔ Store A | `store_customer` | A | customer | customer + store owner/staff |
| Customer ↔ Store B | `store_customer` | B | customer | customer + store owner/staff |
| Customer ↔ Store A (2nd) | same as row 2 | A | customer | same conversation (dedup) |

### 5.2 Uniqueness rules

- One active `store_customer` conversation per (`customer_id`, `store_id`).
- Partial unique index on `conversations(customer_id, store_id)` WHERE `type = 'store_customer'`.
- `getOrCreateConversation` uses insert-on-conflict (or retry) so concurrent requests converge to one row.
- Customer ↔ Admin `direct` conversations are not store-scoped; no uniqueness constraint beyond existing `UNIQUE(conversation_id, profile_id)` on members.

### 5.3 Concurrency guard

- Duplicate conversations from concurrent `getOrCreateConversation` are prevented at the DB layer (partial unique index) + app-level conflict retry. No application-level "check-then-insert" without the index.

---

## 6. Authorization Rules

### 6.1 Storage (all ops)

```
ALLOW(bucket, op, user, objectName) :=
  bucket_id == bucket
  AND resourceId == foldername(objectName)[resourceIndex]
  AND resourceOwnerOrMember(user, resourceId, op)
  AND (op == SELECT ? activeMembershipOrPublic : activeMembership)
```

- `chat-attachments` SELECT/INSERT: caller must be `conversation_members` with `left_at IS NULL` for `conversationId == foldername(name)[1]`.
- `voice-recordings` SELECT: caller must be `call_history.caller_id` or `callee_id` for `callHistoryId == foldername(name)[1]`. INSERT restricted to `service_role`. No client DELETE.

### 6.2 Conversations / Members / Messages

- Read conversation: caller is active `conversation_members` for that conversation, or platform admin/owner with explicit justification.
- Write message: caller is active member; sender_id == caller id.
- Add/remove conversation member: conversation owner/store owner or platform admin; removed member gets `left_at` set.
- `message_attachments`: INSERT requires sender owns message AND caller is active conversation member.

### 6.3 Calls

- Initiate: caller and caltee are active members of the linked conversation; `store_order_id` (if present) must belong to the store/conversation context.
- Join/accept/signal/heartbeat: caller must be a call participant; revalidate conversation membership/`left_at` on sensitive live paths (defense-in-depth).
- History: caller is caller/callee, or store owner for own-store calls, or platform admin.

### 6.4 Socket rooms

- `joinStore`: platform `admin`/`owner` blanket bypass REMOVED; join allowed only if store owner or active `store_memberships` member (`left_at IS NULL`).
- `joinConversation`/`joinCall`/`joinDelivery`: verify active membership before admitting.
- `typing`/`stopTyping`: verify sender membership in target conversation room before broadcast.
- Session hygiene: revalidate token/profile periodically; on `left_at` or deactivation, force-kick sockets from affected rooms.

### 6.5 Deny-by-default

- Any request lacking an explicit allow rule is denied.
- Cross-store access by store staff/owner of another store: denied unless platform admin escalation.
- Deleted/suspended users: denied all new operations; existing sessions kicked.

---

## 7. Migration Dependencies

| Migration | Purpose | Depends on | Blocked by | Status |
|-----------|---------|------------|------------|--------|
| `010_store_memberships.sql` (revise) | store_memberships table + RLS + unique active index + role CHECK | D0.3 | S2.1 redesign (role constraint, write RLS, backfill) | Draft exists, NOT RUN |
| `011` (planned) | `conversations.customer_id` + partial unique index + backfill | D0.4, S2.1 backfill | 010 run first | Not created |
| RLS/storage policy corrections | align `foldername` indexing to canonical key | D0.1 | schema finalized | Not applied |

Order: D0.1–D0.4 decisions → S2.1/S2.2 schema → S3 policy corrections → S4 membership APIs → S5 tests. **No migrations are run in this task.**

---

## 8. Security Test Requirements

| ID | Area | Scenario | Expectation |
|----|------|----------|-------------|
| CM-04 | Conversation | Cross-account read of another customer's store conversation | 403 |
| CM-05 | Conversation | Cross-store message delivery (Store A staff reads Store B convo) | 403 |
| CM-06 | Conversation | Concurrent `getOrCreateConversation` → one row | exactly 1 conversation |
| CM-07 | Conversation | Removed member attempts read after `left_at` | 403 |
| MM-04 | Membership | Staff of Store A accesses Store B store room | 403 |
| AM-04 | Admin | Platform admin scoped storage (not blanket private media) | allowed only audited cases |
| TY-01 | Socket | `typing` from non-member | rejected |
| TY-02 | Socket | `typing` after `left_at` | rejected / kick |
| CS-04 | Storage | `chat-attachments` download by non-member | 403 |
| CS-05 | Storage | `voice-recordings` client upload | rejected |
| SM-01..04 | Membership | add/change/suspend/remove/re-add lifecycle | correct state transitions |
| LR-01..03 | Lifecycle | re-add former member / suspend sole-owner block / remove sole-owner block | enforced |
| MBS-01 | Multi-store | same customer + two stores = two distinct conversations | 2 rows |
| Race | Concurrency | parallel attachment upload + delete consistency | no orphaned objects |

- Baseline: rerun all 179 existing tests; zero regressions in chat/call flows and call subsystem invariants.
- Negative-path RLS/direct-access tests where the harness permits (conversations, members, attachments, private storage buckets).

---

## 9. Explicit Non-actions (this task)

- No source code edits.
- No SQL migration edits or runs.
- No Supabase/production changes.
- No commit/push/deploy.
- Preserve existing uncommitted changes (`messageController.js`, `callService.js`, `frontend/src/api/auth.js`) and untracked files.
- Do not delete or overwrite anything.

**Ready for Phase 1 approval.** Implementation begins only after this design is approved.
