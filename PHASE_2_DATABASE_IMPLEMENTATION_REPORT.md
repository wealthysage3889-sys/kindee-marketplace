# PHASE_2_DATABASE_IMPLEMENTATION_REPORT.md

## 1. Migration Files Created/Modified
- `supabase/migrations/010_store_memberships.sql` (modified)
- `supabase/migrations/011_conversation_customer_id.sql` (new)

## 2. Schema & Constraints Added
- store_memberships: suspended/removed/rejoined audit columns; role CHECK; partial unique index ux_store_memberships_active on (store_id, profile_id) WHERE left_at IS NULL; legacy full UNIQUE dropped.
- conversations: customer_id UUID FK profiles; partial unique index ux_conversations_store_customer on (customer_id, store_id) WHERE type='store_customer'.
- conversation_members: role CHECK (member/admin/owner).

## 3. Backfill & Duplicate Handling
- Owner backfill idempotent (NOT EXISTS active).
- customer_id backfill from conversation_members (non-owner member, unambiguous).
- Duplicate store_customer conversations deduplicated by created_at.

## 4. RLS
- store_memberships: SELECT/INSERT/UPDATE/DELETE policies.

## 5. Tests
- Backend tests: 179 pass, 0 fail (no regression).

## 6. Rollback/Recovery
- Drop new indexes/constraints/columns; restore legacy UNIQUE if needed; migrations not run.

## 7. Phase 3 Dependencies
- App-level getOrCreateConversation conflict retry; store membership enforcement in sockets/services.

## 8. Confirmation
- No migration run, no production DB changes, no env/secrets changes, no commit/push/deploy.