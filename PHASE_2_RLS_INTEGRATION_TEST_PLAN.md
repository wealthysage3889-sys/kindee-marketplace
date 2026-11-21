# PHASE 2 RLS INTEGRATION TEST PLAN

Project: kindee-marketplace | Date: 2026-11-18
Separation: Unit tests (fake Supabase, in-repo, 206 passing) vs Real-DB Integration tests (staging Postgres, RLS enforced).

## Test Users (staging fixtures)
- Platform Admin (admin role, cross-tenant read only where policy allows)
- Customer A, Customer B
- Store Owner A, Store Owner B
- Store Manager (store A, member_write)
- Store Staff (store A, no member_write)

## Test Categories
1. Cross-account access: Customer A cannot read Customer B conversations/messages/calls.
2. Cross-store access: Store Owner A cannot read Store Owner B store_memberships/conversations.
3. Unauthorized membership mutation: Staff cannot insert/update/delete memberships; Manager without member_write cannot.
4. Role escalation: Manager cannot promote to owner or modify owner rows; cannot self-add.
5. Conversation isolation: Customer A cannot access store_customer conversation of Customer B.
6. Message & attachment access: only conversation members read messages/attachments.
7. Read state isolation: unread counts scoped per user.
8. Call history isolation: only caller/callee see call_history.

## Real-DB Integration Test Scripts (to create when staging available)
- `backend/__tests__/rls_integration/*.test.mjs` against staging Supabase with service-role setup + anon/user JWT clients.
- Each test authenticates as a specific role via Supabase Auth and asserts RLS denies/permits.
- Must NOT run against production.

## Unit vs Integration Boundary
- Unit tests: fakeSupabase, logic, chatService, socket, controllers. (206 passing)
- Integration tests: real Postgres RLS, concurrency, unique violations. Not yet runnable (no staging access in this phase).