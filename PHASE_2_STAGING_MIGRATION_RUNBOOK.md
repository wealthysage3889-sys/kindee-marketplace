# PHASE 2 STAGING MIGRATION RUNBOOK

Project: kindee-marketplace | Branch: main | Date: 2026-11-18
Scope: Run migration 010 then 011 on STAGING Supabase only. Never production.

## Pre-migration Checklist
- [ ] Confirm project root, remote `wealthysage3889-sys/kindee-marketplace`, branch `main`.
- [ ] `git status` clean of unintended changes; preserve uncommitted/untracked.
- [ ] Staging Supabase project identified and isolated from production.
- [ ] Full backup taken (see PHASE_2_BACKUP_RESTORE_PLAN.md) and verified (counts + FK integrity).
- [ ] Pre-migration row-count checkpoint recorded.
- [ ] Migration files reviewed: 010_store_memberships.sql, 011_conversation_customer_id.sql.
- [ ] Rollback/forward recovery plan reviewed by human.

## Backup Verification
- Run count checkpoint SQL; compare backup counts.
- Run FK integrity SQL; expect 0 violations.
- Restore backup into throwaway staging DB; re-run checks.

## Migration Order & Dependencies
1. 010_store_memberships.sql (additive; owner backfill; RLS)
2. 011_conversation_customer_id.sql (add column; backfill; merge duplicates; unique index; role check; RLS ensure)
011 does not depend on 010. Both idempotent. Run via Supabase SQL Editor or migration runner on staging only.

## RLS Verification (post-migration, staging, real DB)
- Enable RLS confirmed on: store_memberships, conversations, conversation_members.
- Test as Platform Admin, Customer A/B, Store Owner A/B, Store Manager, Store Staff:
  - Cross-account access denied.
  - Cross-store access denied.
  - Unauthorized membership mutation denied.
  - Role escalation denied.
  - Conversation isolation.
  - Message & attachment access.
  - Read state isolation.
  - Call history isolation.

## Data Verification (pre vs post)
- members/messages/attachments/calls counts invariant.
- conversations count decreased only by merged duplicates.
- No orphaned FKs.
- Duplicate `(customer_id, store_id)` groups = 0 where customer_id IS NOT NULL.

## Success Criteria
- All migrations apply without error.
- All RLS tests pass on real DB.
- Count invariants hold.
- No data loss beyond intended merge.
- App smoke tests pass.

## Stop Conditions
- Any migration error.
- Any RLS policy allows cross-account/cross-store access.
- Count invariants violated.
- Backup verification fails.
- Unexpected data deletion.

## Recovery on Failure
- Stop traffic.
- Follow PHASE_2_FORWARD_RECOVERY_PLAN.md.
- Restore from backup if needed; re-verify.
- Do not re-run until root cause fixed and documented.