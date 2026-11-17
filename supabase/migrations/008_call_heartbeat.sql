-- Add per-side heartbeat tracking for accepted calls so the backend can
-- detect when both participants have gone silent and safely end the call.
-- Calls with an active heartbeat on at least one side are never cut,
-- regardless of call duration.

ALTER TABLE call_history
  ADD COLUMN IF NOT EXISTS caller_heartbeat_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS callee_heartbeat_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_call_history_heartbeat_stale
  ON call_history (status, caller_heartbeat_at, callee_heartbeat_at)
  WHERE status = 'accepted';
