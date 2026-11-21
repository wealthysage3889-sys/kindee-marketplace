# PHASE 2 G1/G2 REMEDIATION REPORT

## Files changed
- `supabase/migrations/010_store_memberships.sql` — replaced RLS OLD/NEW usage with SECURITY DEFINER helpers + triggers; removed self-referencing policy recursion; safe boolean cast; added conversations RLS for store members.
- `supabase/migrations/011_conversation_customer_id.sql` — deterministic backfill via window function; upsert merge of conversation_members; recompute last_message_at; archive table; pre-delete reference guards; notifications re-point.
- `supabase/rollback_010.sql`, `supabase/rollback_011.sql` — recovery scripts.

## Issues resolved
- PostgreSQL OLD/NEW in RLS removed.
- Infinite recursion avoided via SECURITY DEFINER helpers.
- Privilege escalation guarded (manager cannot create owner, cannot self-add).
- Sole owner protection moved to triggers.
- Merge unique constraint collision resolved via upsert.
- customer_id backfill deterministic.
- last_message_at recomputed.
- Reference checks before DELETE.

## Remaining issues
- Static only; not executed against Postgres (no Docker daemon).
- 010 still has no consumer endpoints (Phase 3).
- CONCURRENTLY index creation not applied (transaction limitation).
- RLS manager/staff conversation visibility policy added but untested.

## Test results
- Static review only. No DB execution.

## Rollback limitations
- 010 fully reversible (additive).
- 011 not reversible for deleted conversations without backup; archive provides best-effort forensic recovery only.

## Risks
- Merge archive may grow; notifications deep-link re-point best-effort.
- Product behavior change: one conversation per customer/store.

## Status
- G1: PASS (pending staging validation)
- G2: PASS (pending staging validation)
- Stop here; await G3 approval.
