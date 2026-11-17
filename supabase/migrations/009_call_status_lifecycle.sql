-- Migration: Extend call_status enum with additional lifecycle states
-- DO NOT RUN on production without explicit approval
-- This migration adds: completed, no_answer, cancelled, failed
-- Existing statuses remain compatible: ringing, accepted, rejected, missed, ended

-- Add new enum values to call_status
ALTER TYPE call_status ADD VALUE IF NOT EXISTS 'completed';   -- Call finished normally (accepted then ended)
ALTER TYPE call_status ADD VALUE IF NOT EXISTS 'no_answer';   -- Callee did not answer within timeout
ALTER TYPE call_status ADD VALUE IF NOT EXISTS 'cancelled';   -- Caller cancelled before callee answered
ALTER TYPE call_status ADD VALUE IF NOT EXISTS 'failed';      -- Call failed to connect (WebRTC/network error)

-- Verify current statuses
-- SELECT enumlabel FROM pg_enum WHERE enumtypid = 'call_status'::regtype ORDER BY enumsortorder;

-- Verify table structure
-- SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'call_history';