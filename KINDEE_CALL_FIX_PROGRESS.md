# KINDEE CALL FIX — Progress Report

## Status: Backend fix complete, tests passing, frontend builds

## Root Cause
`expireStaleAcceptedCalls()` used two separate `.lt()` filters chained with AND:
- `caller_heartbeat_at < cutoff` AND `callee_heartbeat_at < cutoff`
- In SQL, `NULL < cutoff` evaluates to NULL (not TRUE), so rows with NULL heartbeats were **never matched**
- This left pre-migration accepted calls (or calls where the client never sent a heartbeat) permanently `accepted`
- The active-call check in `initiateCall()` treats `accepted` the same as `ringing`, so these orphaned records blocked all future calls involving either participant with `400 Call already in progress`

## Fix Applied

### 1. `backend/services/callService.js` — `expireStaleAcceptedCalls()`
- Changed to two separate `.or()` calls:
  - `.or('caller_heartbeat_at.lt.{cutoff},caller_heartbeat_at.is.null')`
  - `.or('callee_heartbeat_at.lt.{cutoff},callee_heartbeat_at.is.null')`
- This expresses: `(caller stale OR NULL) AND (callee stale OR NULL)`
- NULL heartbeats are now correctly treated as stale
- Both sides must be stale/NULL before the call is expired (one side still alive keeps the call active)

### 2. `backend/__tests__/helpers/fakeSupabase.mjs` — test fake
- Added `orClauses` array to builder state (second+ `.or()` calls are AND-ed)
- Added `matchOrClauses()` to apply AND-ed OR clauses
- Added `eq.` prefix handling in `rowMatches` (was missing)
- `state0` now carries `orClauses` through select/update/delete

### 3. `backend/__tests__/callHeartbeat.test.mjs` — new tests
- `accepted call with NULL heartbeat on both sides is expired`

## Test Results
- Backend: **161 passed, 0 failed** (was 161/1 before fix)
- Frontend: **build success** (166 modules transformed, 3.33s)

## Files Modified
- `backend/services/callService.js`
- `backend/__tests__/helpers/fakeSupabase.mjs`
- `backend/__tests__/callHeartbeat.test.mjs`

## Pending User Action
The two orphaned call records mentioned in the task (`de5a8a7a-8328-4324-8c8b-50409715a349` and `a72067e1-b4d4-41bc-ba59-edbbdc97e152`) need manual cleanup. SQL for approval:

```sql
UPDATE call_history
SET status = 'ended',
    ended_at = NOW(),
    end_reason = 'timeout'
WHERE id IN (
  'de5a8a7a-8328-4324-8c8b-50409715a349',
  'a72067e1-b4d4-41bc-ba59-edbbdc97e152'
);
```

After this fix is deployed and the orphaned records are cleaned, the customer should be able to call the admin normally.