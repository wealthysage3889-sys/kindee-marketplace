# Kindee Multi-Store Security Fix Plan (Final Validation)

**Project Root:** `C:\Users\LEGION\OneDrive\Desktop\kindee-marketplace`  
**Git Remote:** `wealthysage3889-sys/kindee-marketplace`  
**Branch:** `main`  
**Status:** READ-ONLY validation/plan revision complete — no code, SQL, Supabase, production, migration, commit, push, or deploy changes made.  
**Baseline:** 179 tests (prior verified baseline; not rerun in this pass).  
**Preserved:** existing uncommitted changes and untracked files; Chat/Voice Call behavior and Call subsystem invariants unchanged in this plan.

## 1) Pre-checks (executed)
- Root/remote/branch verified: `origin https://github.com/wealthysage3889-sys/kindee-marketplace.git`, branch `main`.
- `git status --short` at validation time:
  - ` M backend/controllers/messageController.js`
  - ` M backend/services/callService.js`
  - ` M frontend/src/api/auth.js`
  - `?? MULTI_CONVERSATION_AUDIT.md`
  - `?? MULTI_STORE_DEEP_SECURITY_AUDIT.md`
  - `?? MULTI_STORE_SECURITY_FIX_PLAN.md`
  - `?? MULTI_STORE_VERIFICATION_REPORT.md`
  - `?? backend/__tests__/callIncomingSocket.test.mjs`
  - `?? supabase/migrations/010_store_memberships.sql`

## 2) Storage path validation (from actual upload code)

### Actual path construction
- `backend/middleware/upload.js:68-73` `generateStoragePath(bucket, ownerId, fileName)` returns: `${bucket}/${ownerId}/${YYYY}/${MM}/${fileName}` (e.g. `chat-attachments/{conversationId}/2026/11/chat-...ext`).
- Uploads call `supabaseAdmin.storage.from(bucket).upload(filePath, ...)` with that same `filePath`.
  - `backend/routes/chatRoutes.js:223-225` (message attachment route): `ownerId = req.params.id` (messageId context used in that route path helper) -> stored as `chat-attachments/{id}/YYYY/MM/file`.
  - `backend/routes/uploadRoutes.js:58-60` (chat upload by conversation): `ownerId = req.params.conversationId` -> `chat-attachments/{conversationId}/YYYY/MM/file`.
  - `backend/routes/productRoutes.js:137,487`, `storeRoutes.js:182,203`, `uploadRoutes.js:18` follow same pattern for other buckets.
- Therefore for bucket-scoped uploads, `storage.objects.bucket_id` = bucket name, and `storage.objects.name` (object key inside bucket API context as stored by current code) **includes the bucket segment as first path segment** (`bucket/ownerId/year/month/file`).

### `storage.foldername(name)` implications (real shape)
- For `name = 'chat-attachments/<convId>/2026/11/file.ext'`, `storage.foldername(name)` yields `['chat-attachments','<convId>','2026','11']`.
  - `[1]` = `'chat-attachments'` (bucket segment, **not** conversation/store/call id)
  - `[2]` = `<convId>` (actual owner/resource segment for this pattern)

### Storage policy assessment (all ops)

| Bucket/Policy | Op | Evidence | Assessment |
|---|---|---|---|
| `avatars` public SELECT | SELECT | `004_storage_buckets.sql` | Intended public read; path check uses `[1]` as user id — **likely misaligned** if avatar objects also stored with bucket-prefixed name; requires verification against actual stored keys. |
| `avatars` owner INSERT/UPDATE/DELETE | write | `004:36-73` compares `[1]` to `auth.uid()` | **Likely broken for direct client writes** under current path shape (`[1]` becomes bucket segment). Backend uses service role today (defense-in-depth gap, not active exploit). |
| `store-logos` public SELECT + owner write | all | `004:79-122` | SELECT public by bucket ok; owner checks compare `[1]` to store id — **index likely off-by-one** for direct client access with current path shape. |
| `store-covers` public SELECT + owner ALL | all | `004:129-152` | Same indexing concern as store-logos. |
| `product-images` public SELECT + owner ALL | all | `004:159-189` | Owner check joins product/store using `[1]` as product id — **index likely off-by-one**; direct client writes would fail/mismatch. |
| `chat-attachments` member SELECT | SELECT | `004:194-207` joins `conversation_members/messages/message_attachments` via `ma.file_url LIKE '%' || storage.objects.name` | **Fragile/brittle** (depends on URL/path representation), but attempts membership scoping; not a simple path-prefix leak. |
| `chat-attachments` member INSERT | INSERT | `004:209-219` checks membership by `conversation_id::TEXT = foldername(name)[1]` | **Broken for intended resource binding** (`[1]` resolves to bucket segment). Direct client upload would not authorize as intended; backend currently uploads via service role. |
| `chat-attachments` UPDATE/DELETE | - | none defined | No explicit policies (default deny under RLS for client). |
| `voice-recordings` participant SELECT | SELECT | `004:224-234` checks call participant with `ch.id::TEXT = foldername(name)[1]` | **Likely broken/off-by-one** for current path shape if recordings use bucket-prefixed keys; service-role insert only. |
| `voice-recordings` INSERT | INSERT | `004:236-241` `auth.role() = 'service_role'` only | Correctly restricted to server/service role. No UPDATE/DELETE policies. |
| `Admins can manage all storage` | ALL | `004:246-261` profiles.role in `('admin','owner')` | **Excessive privilege / defense-in-depth risk**: platform-level roles can manage all buckets including private chat/voice objects. |

**Conclusion:** Current backend mostly bypasses storage RLS via `supabaseAdmin` (service role) and enforces app-level checks; many storage RLS policies are **misaligned/broken for direct client access** under actual path shape, so they must be treated as defense-in-depth gaps to fix, not assumed effective protections.

## 3) `supabaseAdmin` (service-role) authorization assessment

`backend/config/supabase.js` exposes `supabaseAdmin` (bypasses RLS). Service-role usage is acceptable **only** when each operation enforces authentication, authorization, and resource/membership checks in application code.

| Area | Key APIs/files | App-level authorization | Classification |
|---|---|---|---|
| Auth/profile bootstrap | `backend/middleware/auth.js`, `controllers/authController.js` | Token verified; profile loaded/checked active | Defense-in-depth (expected server-side privileged reads) |
| Chat service (core) | `chatService.getConversationById/getMessages/sendMessage/editMessage/deleteMessage/markMessagesRead/muteConversation/add/remove member` | Membership/role checks enforced in service (`getConversationById(..., userId)` / sender checks) | Generally acceptable; **authorization gap**: `removeConversationMember` can-remove logic allows admins to remove others but target-role comparison is restrictive/incomplete vs intended model (needs review), not direct exploit by itself |
| Chat attachments (service) | `chatService.uploadMessageAttachment` (`chatService.js:629+`) | Verifies message exists; **checks membership only when `userId` is provided** | **Authorization Gap (API contract)** — unsafe if reused without userId. Current route `chatRoutes.js:227` passes `req.user.id` (mitigated in current call path). Not "vulnerable because service role"; vulnerable if contract misused. |
| Chat routes upload paths | `routes/chatRoutes.js` upload, `routes/uploadRoutes.js` chat upload | Route-level auth + membership checks present before storage/service calls | Acceptable with service role; depends on correct path/resource parsing |
| `getStoreConversations` | `chatService.js:665-717`, `routes/chatRoutes.js:250-275` | Store ownership verified (`owner_id == ownerId`); route requires role and owner match | **Authorization Gap (future/multi-staff)** — no membership-based filtering for store staff; current access constrained to owner in route |
| Conversation creation | `chatService.getOrCreateConversation` | Store exists/owner resolved; prevents self-chat; membership added; **check-then-insert race** (no uniqueness guard) | **Integrity/Authorization-adjacent gap** (duplicate store-customer conversations possible under concurrency), not direct cross-tenant read |
| Legacy message controller | `backend/controllers/messageController.js` | Dead/wrong-column helpers, trusts `senderRole` from body in send path; **no route mounts it** (`routes/index.js` has no message routes) | **No active exploit path** (dead code). Defense-in-depth/cleanup item only |
| Call service/routes | `backend/services/callService.js`, `routes/callRoutes.js`, socket call handlers | Caller/callee participant checks on initiate/accept/reject/end/cancel/heartbeat/signal/history/toggle; conversation membership checked on initiate/accept; heartbeat/signaling do not revalidate conversation `left_at`/active membership | **Authorization Gaps (defense-in-depth)**: rely on call record participation; removed members not rechecked on some live operations. `initiateCall` does not verify `storeOrderId` belongs to store/conversation context. |
| Socket service | `backend/services/socketService.js` | `joinConversation`/`joinDelivery`/`joinCall` verify access; `joinStore` allows platform `admin` or `owner` role to join any store; `typing`/`stopTyping` do not verify membership and broadcast to room; token validated at connect only | **Exploitable Authorization Gap:** `joinStore` platform-owner/admin bypass to arbitrary store rooms (event visibility). **Gaps:** typing spoof/no membership check, no forced removal on `left_at`, no token revalidation/expiry kick |
| Upload signed-url/delete API | `backend/routes/uploadRoutes.js` | Bucket-specific checks for avatars/chat-attachments/store/product images; `voice-recordings` accepted in validator but no access branch (falls through to deny except broad admin/owner bypass logic context differs); delete lacks chat-attachments/voice-recordings handling | **Authorization/Functionality Gaps** (private media access flows incomplete/inconsistent) |
| Admin/store/product/order/delivery routes & services | various | Mostly behind route-level role/auth middleware and/or ownership checks | Service role acceptable when checks remain correct; must be revalidated when multi-staff membership is introduced |
| Scripts | `backend/scripts/*` | Operational/admin scripts using service role | Out of runtime request surface; not app exploit path |

## 4) `admin_customer` usage and severity
- Schema enum: `conversation_type` in `001_initial_schema.sql` is `('direct','group','store_customer','order_support')` — **`admin_customer` not present**.
- Codebase search: no runtime/backend/frontend implementation references found; only planning/audit docs mention it.
- **Assessment:** design/planning gap, **not an exploitable vulnerability** and not currently reachable. Severity adjusted to **Low (Design Gap / Future Compatibility)** pending explicit product decision.

## 5) Severity reclassification (evidence-based)

### Exploitable Vulnerabilities (current reachable risk)
1. **Socket `joinStore` platform role bypass** — `backend/services/socketService.js:105` allows `['admin','owner']` (platform roles) to join any `store_*` room after store existence check. **Impact:** unauthorized subscription to store-room events. **Severity: High** (exploitable with privileged/mis-scoped role; scope-limited to emitted events, but cross-store).
2. **Socket typing events lack membership verification** — `socketService.js:177-190` emits to `conversation_${id}` without checking sender membership/current access. **Impact:** unauthorized signaling/noise/event injection to rooms if socket can emit (and room targeting relies on room semantics); practical exploitability depends on join state, but missing auth check on sensitive action. **Severity: Medium-High (Authorization Gap with exploit potential)**.
3. **RLS policies overly permissive/broken for direct client access** — `002_rls_policies.sql:630` (`conversations` INSERT `WITH CHECK (true)`), `662` (`conversation_members` self-join by `profile_id = auth.uid()` only), storage policies with wrong `foldername` indexing and broad admin storage policy. **Impact:** exploitable **if/when** client-side anon/auth Supabase access is used against these tables/buckets; current app path mostly server-mediated via service role. **Severity: High (Latent Direct-Access Vulnerability / Defense-in-depth failure)**.

### Authorization Gaps (missing/incomplete checks, not confirmed active cross-tenant exploit in current mediated paths)
- `chatService.uploadMessageAttachment` contract allows skipped membership check when `userId` omitted (`chatService.js:629+`) though current route passes userId.
- Call live operations (`heartbeatCall`, signaling, toggle/mute metadata paths) do not revalidate conversation membership/`left_at`; `initiateCall` does not validate `store_order_id` ownership linkage.
- `getStoreConversations` owner-only filtering; no staff membership model in access path.
- `joinCall`/call participation relies on call row participants/status, not fresh conversation membership state.
- Socket auth not revalidated after connect; removed/deactivated users not force-disconnected from rooms.
- `uploadRoutes` signed-url/delete do not implement `voice-recordings` and do not handle delete for private chat/voice buckets consistently.
- `messageController.js` contains unsafe/dead logic but is not routed (no active path).

### Defense-in-Depth / Integrity / Design Gaps
- `supabaseAdmin` broad usage (required pattern here) — safe only with per-operation checks; continue auditing on every new/changed endpoint.
- `getOrCreateConversation` race condition; no unique constraint for one active store-customer conversation per customer/store context.
- `store_memberships` migration draft (`010`, untracked, not run): unique constraint blocks re-add, missing role CHECK, missing write RLS policies, no backfill/service integration.
- `admin_customer` enum absent (unused).
- `conversation_members.role` is unconstrained TEXT.
- `message_attachments` INSERT RLS only checks sender owns message, not active membership.
- Duplicate message emit in `sendMessage` (`emitNewMessage` + per-user emits) is reliability/noise concern, not a security vulnerability.
- No socket event rate limiting; socket CORS wildcard fallback in non-prod-configured environments.

## 6) Corrected fix plan (phased, dependency-aware)

### Phase 0 — Preconditions & design decisions (must settle before schema/policy edits)
- **D0.1 Storage key canonicalization (decision):** choose one canonical object key format and make code + policies + signed-url/delete parsing agree.
  - Option A (recommended): store object key **without** leading bucket segment inside bucket (`{resourceId}/YYYY/MM/file`) and keep `bucket_id` authoritative.
  - Option B: keep current bucket-prefixed key but update every policy/parser to use `[2]`/correct offsets consistently.
- **D0.2 `admin_customer` decision:** keep `store_customer`/`order_support` semantics, or introduce enum/value + migration strategy (Postgres enum alter constraints) and update all type checks.
- **D0.3 Multi-store membership semantics:** define `store_memberships` roles/permissions and naming vs platform `profiles.role` to avoid owner/admin collision; decide staff access rules for store rooms/conversations.
- **D0.4 Conversation uniqueness model:** decide canonical customer identity for `store_customer` conversations (add `customer_id` column or equivalent) before adding unique index/dedup logic.

### Phase 1 — High-value auth hardening with minimal behavior risk (app layer, no schema dependency)
- **S1.1 `joinStore` authorization:** remove platform `owner/admin` blanket bypass; allow join only if store owner or verified active store member (once membership model exists). *Dependency:* D0.3 for staff; owner-only fix can land immediately.
- **S1.2 Socket room/event guards:** require membership checks in `typing`/`stopTyping`; track/require call-room join state for `callSignal` where appropriate; recheck `left_at`/active membership in `joinCall` and relevant call actions.
- **S1.3 Socket session hygiene:** periodic token/profile revalidation or disconnect-on-deactivate/expiry strategy; on membership removal (`left_at`), force-leave/kick affected sockets.
- **S1.4 `uploadMessageAttachment` contract hardening:** require non-null `userId` and always verify conversation membership/message ownership linkage; keep route behavior unchanged.
- **S1.5 Upload API completeness:** implement `voice-recordings` access checks in signed-url/delete (and chat-attachments delete if intended) consistent with conversation/call participation; reject unsupported private-bucket operations explicitly.
- **S1.6 Call authorization tightening:** revalidate conversation membership/`left_at` on heartbeat/signaling-sensitive paths as defense-in-depth; validate `storeOrderId` association in `initiateCall`.
- **S1.7 Dead/unsafe code cleanup:** remove or quarantine unrouted `messageController.js` legacy path to prevent accidental future exposure.
- **S1.8 Preserve invariants:** no changes to call state machine semantics, idempotency/heartbeat/recovery/media cleanup behavior except stricter authorization checks that do not alter valid flows.

### Phase 2 — Schema/data fixes (migration design; not run now)
- **S2.1 `store_memberships` (revise `010_store_memberships.sql` before run):** partial unique index for active members (e.g. unique on `(store_id, profile_id)` where `left_at IS NULL`), role constraint, timestamps/indexes as needed, complete RLS (SELECT/INSERT/UPDATE/DELETE) aligned with owner/admin/staff model, and backfill owner memberships.
- **S2.2 Conversation dedup support:** add `customer_id` (or equivalent) to `conversations` for `store_customer`, backfill from existing `conversation_members` data deterministically, add partial unique index for active store-customer conversation uniqueness.
- **S2.3 Membership/role constraints:** add CHECK/enum strategy for `conversation_members.role` (and align with any store membership roles) without breaking existing rows.
- **S2.4 `getOrCreateConversation` concurrency fix:** after uniqueness exists, use conflict-safe create/retry logic (app change paired with S2.2).
- **S2.5 Optional enum evolution:** apply `admin_customer` only if D0.2 approves it.

### Phase 3 — RLS & storage policy corrections (after D0.1/D0.4/S2 where referenced)
- **S3.1 Conversations/conversation_members/messages/message_attachments RLS:** replace permissive inserts/self-join rules with membership- and relationship-validating policies; ensure attachments require active conversation membership and valid message linkage.
- **S3.2 Storage policies (all buckets, all relevant ops):** align `foldername` index usage with canonical key format; enforce membership/ownership for private buckets (`chat-attachments`, `voice-recordings`) on SELECT and any allowed client write/delete paths.
- **S3.3 Admin storage policy scope:** remove or narrowly scope blanket `"Admins can manage all storage"` to avoid unrestricted access to private user media; prefer explicit audited cases.
- **S3.4 Call history exposure:** review `call_history` SELECT columns/policy scope for least privilege (if client access is used).

### Phase 4 — Multi-store membership integration
- **S4.1 Backend membership APIs/services:** add/list/update/remove store members and permissions with strict owner/admin authorization.
- **S4.2 Store-scoped chat/store-room access:** include active `store_memberships` in `joinStore`, store conversation listing, and any store management paths that should allow staff.
- **S4.3 Data isolation regression checks:** verify store A staff/owner cannot access store B conversations/messages/attachments/calls except explicitly authorized platform-admin cases.

### Phase 5 — Validation & regression coverage (implement alongside phases)
- **S5.1 Security regression tests (new):** CM-04/05/06/07, MM-04, AM-04, TY-01/02, CS-04/05, SM-01..04, LR-01..03, MBS-01, and concurrent `getOrCreateConversation` uniqueness/race case.
- **S5.2 Baseline protection:** rerun existing 179 tests; confirm no behavior regression in chat/call flows and call subsystem invariants.
- **S5.3 Negative-path verification:** direct-access/RLS-policy tests (where test harness permits) for conversations, members, attachments, and storage private buckets.

## 7) Recommended implementation order & dependencies
1. **Decisions first (Phase 0):** D0.1 canonical storage key format, D0.2 `admin_customer`, D0.3 membership model, D0.4 conversation uniqueness key. *(Blocks correct policy/schema work.)*
2. **Immediate app hardening (Phase 1, low coupling):** S1.1 owner-only `joinStore` restriction, S1.2 typing/call join guards, S1.4 attachment userId contract, S1.5 upload signed-url/delete handling, S1.7 dead controller cleanup. *(Can proceed without DB changes; preserve behavior.)*
3. **Session/lifecycle hardening (Phase 1 continued):** S1.3 token revalidation + forced socket removal hooks, S1.6 call rechecks/storeOrder validation. *(Depends partly on D0.3/S2 for staff membership signals.)*
4. **Schema/migration prep (Phase 2, design before run):** revise `010_store_memberships.sql` (S2.1), add conversation `customer_id` + unique index/backfill (S2.2, S2.4), role constraints (S2.3). *(Do not run migrations in this task.)*
5. **Policy corrections (Phase 3):** update RLS/storage policies to match canonical paths and membership model (S3.1-S3.4). *(Depends on D0.1, D0.4, and finalized schema.)*
6. **Membership feature integration (Phase 4):** implement membership APIs and propagate staff-aware authorization to store/chat/socket flows (S4.1-S4.3). *(Depends on S2.1 and D0.3.)*
7. **Regression tests and verification throughout (Phase 5):** add security tests per phase, then full 179-test baseline and negative authorization/storage tests. *(Continuous; final gate before rollout.)*

## 8) Explicit non-actions (this task)
- No source code or SQL migration edits applied.
- No Supabase/production changes; no migrations run.
- No commit/push/deploy.
- Implementation not started.
