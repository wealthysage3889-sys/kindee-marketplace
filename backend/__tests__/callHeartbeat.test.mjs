// Heartbeat and call lifecycle tests.
//
// Run with:  npm --prefix backend test
//
// These tests exercise callService against the in-memory Supabase fake,
// covering heartbeat tracking, stale-accepted-call expiry, atomic state
// transitions, and call-end scenarios.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL ||= 'https://dummy.supabase.co';
process.env.SUPABASE_ANON_KEY ||= 'dummy-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'dummy-service-key';
process.env.JWT_SECRET ||= 'dummy-secret';

// Short stale window for tests so we don't wait real 45 seconds.
process.env.CALL_HEARTBEAT_STALE_MS = '1000';
process.env.CALL_RINGING_TIMEOUT_MS = '5000';

const { supabaseAdmin } = await import('../config/supabase.js');
const { installFakeSupabase } = await import('./helpers/fakeSupabase.mjs');
const callService = await import('../services/callService.js');

const callerId = '11111111-1111-4111-8111-111111111111';
const calleeId = '22222222-2222-4222-8222-222222222222';
const outsiderId = '33333333-3333-4333-8333-333333333333';
const conversationId = '44444444-4444-4444-8444-444444444444';

let currentFake;
let restoreFake;

function seedBase(overrides = {}) {
  const now = new Date().toISOString();
  return {
    profiles: [
      [callerId, { id: callerId, name: 'Caller', avatar_url: null, is_active: true, role: 'customer' }],
      [calleeId, { id: calleeId, name: 'Callee', avatar_url: null, is_active: true, role: 'owner' }],
      [outsiderId, { id: outsiderId, name: 'Outsider', avatar_url: null, is_active: true, role: 'customer' }],
    ],
    conversations: [
      [conversationId, { id: conversationId, type: 'store_customer', store_id: 's1' }],
    ],
    conversation_members: [
      ['m1', { id: 'm1', conversation_id: conversationId, profile_id: callerId, left_at: null }],
      ['m2', { id: 'm2', conversation_id: conversationId, profile_id: calleeId, left_at: null }],
    ],
    call_history: [],
    settings: [],
    notifications: [],
    ...overrides,
  };
}

beforeEach(() => {
  const installed = installFakeSupabase(supabaseAdmin, seedBase());
  currentFake = installed.fake;
  restoreFake = installed.restore;
});

afterEach(() => {
  if (restoreFake) restoreFake();
});

const acceptedCall = (id = 'call-1', overrides = {}) => ({
  id,
  caller_id: callerId,
  callee_id: calleeId,
  conversation_id: conversationId,
  status: 'accepted',
  started_at: new Date().toISOString(),
  answered_at: new Date().toISOString(),
  ended_at: null,
  caller_heartbeat_at: new Date().toISOString(),
  callee_heartbeat_at: new Date().toISOString(),
  metadata: {},
  ...overrides,
});

const oldTimestamp = () => new Date(Date.now() - 10000).toISOString(); // 10s ago, beyond 1s stale window
const freshTimestamp = () => new Date().toISOString();

// ── Heartbeat ──────────────────────────────────────────────────────────

test('heartbeatCall updates caller heartbeat and returns true', async () => {
  restoreFake();
  const installed = installFakeSupabase(supabaseAdmin, seedBase({
    call_history: [[ 'call-1', acceptedCall('call-1') ]],
  }));
  currentFake = installed.fake; restoreFake = installed.restore;

  const ok = await callService.heartbeatCall('call-1', callerId);
  assert.equal(ok, true);

  const row = currentFake.dump('call_history').find((r) => r.id === 'call-1');
  assert.ok(row.caller_heartbeat_at);
  assert.ok(new Date(row.caller_heartbeat_at) > new Date(oldTimestamp()));
});

test('heartbeatCall updates callee heartbeat and returns true', async () => {
  restoreFake();
  const installed = installFakeSupabase(supabaseAdmin, seedBase({
    call_history: [[ 'call-1', acceptedCall('call-1') ]],
  }));
  currentFake = installed.fake; restoreFake = installed.restore;

  const ok = await callService.heartbeatCall('call-1', calleeId);
  assert.equal(ok, true);

  const row = currentFake.dump('call_history').find((r) => r.id === 'call-1');
  assert.ok(row.callee_heartbeat_at);
});

test('heartbeatCall returns false for non-accepted call', async () => {
  restoreFake();
  const installed = installFakeSupabase(supabaseAdmin, seedBase({
    call_history: [[ 'call-1', { ...acceptedCall('call-1'), status: 'ringing' } ]],
  }));
  currentFake = installed.fake; restoreFake = installed.restore;

  const ok = await callService.heartbeatCall('call-1', callerId);
  assert.equal(ok, false);
});

test('heartbeatCall returns false for unknown call', async () => {
  const ok = await callService.heartbeatCall('00000000-0000-0000-0000-000000000000', callerId);
  assert.equal(ok, false);
});

test('heartbeatCall returns false for outsider (not a participant)', async () => {
  restoreFake();
  const installed = installFakeSupabase(supabaseAdmin, seedBase({
    call_history: [[ 'call-1', acceptedCall('call-1') ]],
  }));
  currentFake = installed.fake; restoreFake = installed.restore;

  const ok = await callService.heartbeatCall('call-1', outsiderId);
  assert.equal(ok, false);
});

// ── Accepted call with normal heartbeat must NOT be cut even past 5 minutes ────

test('accepted call past 5 minutes with fresh heartbeat on both sides is NOT ended', async () => {
  restoreFake();
  const longAgo = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(); // 6 hours ago
  const installed = installFakeSupabase(supabaseAdmin, seedBase({
    call_history: [[ 'call-1', {
      ...acceptedCall('call-1'),
      started_at: longAgo,
      answered_at: longAgo,
      caller_heartbeat_at: freshTimestamp(),
      callee_heartbeat_at: freshTimestamp(),
    } ]],
  }));
  currentFake = installed.fake; restoreFake = installed.restore;

  await callService.expireStaleAcceptedCalls();
  const row = currentFake.dump('call_history').find((r) => r.id === 'call-1');
  assert.equal(row.status, 'accepted');
  assert.equal(row.ended_at, null);
});

// ── Both sides silent beyond stale window → call ended ────

test('accepted call with both heartbeats stale is ended with network_error', async () => {
  restoreFake();
  const installed = installFakeSupabase(supabaseAdmin, seedBase({
    call_history: [[ 'call-1', {
      ...acceptedCall('call-1'),
      caller_heartbeat_at: oldTimestamp(),
      callee_heartbeat_at: oldTimestamp(),
    } ]],
  }));
  currentFake = installed.fake; restoreFake = installed.restore;

  const count = await callService.expireStaleAcceptedCalls();
  assert.equal(count, 1);

  const row = currentFake.dump('call_history').find((r) => r.id === 'call-1');
  assert.equal(row.status, 'ended');
  assert.equal(row.end_reason, 'network_error');
  assert.ok(row.ended_at);
});

test('accepted call with only one side stale is NOT ended (grace period)', async () => {
  restoreFake();
  const installed = installFakeSupabase(supabaseAdmin, seedBase({
    call_history: [[ 'call-1', {
      ...acceptedCall('call-1'),
      caller_heartbeat_at: freshTimestamp(),
      callee_heartbeat_at: oldTimestamp(),
    } ]],
  }));
  currentFake = installed.fake; restoreFake = installed.restore;

  const count = await callService.expireStaleAcceptedCalls();
  assert.equal(count, 0);

  const row = currentFake.dump('call_history').find((r) => r.id === 'call-1');
  assert.equal(row.status, 'accepted');
});

// ── Atomic state transitions ───────────────────────────────────────────

test('acceptCall is atomic: second concurrent accept is rejected', async () => {
  const installed = installFakeSupabase(supabaseAdmin, seedBase({
    call_history: [[
      'call-1',
      {
        id: 'call-1',
        caller_id: callerId,
        callee_id: calleeId,
        conversation_id: conversationId,
        status: 'ringing',
        started_at: new Date().toISOString(),
        answered_at: null,
        caller_heartbeat_at: null,
        callee_heartbeat_at: null,
        metadata: {},
      },
    ]],
  }));
  currentFake = installed.fake; restoreFake = installed.restore;

  const first = await callService.acceptCall('call-1', calleeId);
  assert.equal(first.status, 'accepted');

  // Second attempt should fail because status is no longer 'ringing'
  await assert.rejects(
    () => callService.acceptCall('call-1', calleeId),
    (err) => err && err.statusCode === 409
  );
});

test('rejectCall is atomic: second reject is rejected', async () => {
  const installed = installFakeSupabase(supabaseAdmin, seedBase({
    call_history: [[
      'call-1',
      {
        id: 'call-1',
        caller_id: callerId,
        callee_id: calleeId,
        conversation_id: conversationId,
        status: 'ringing',
        started_at: new Date().toISOString(),
        metadata: {},
      },
    ]],
  }));
  currentFake = installed.fake; restoreFake = installed.restore;

  const first = await callService.rejectCall('call-1', calleeId);
  assert.equal(first.status, 'rejected');

  await assert.rejects(
    () => callService.rejectCall('call-1', calleeId),
    (err) => err && err.statusCode === 409
  );
});

test('endCall is atomic: double end is rejected', async () => {
  const installed = installFakeSupabase(supabaseAdmin, seedBase({
    call_history: [[
      'call-1',
      {
        ...acceptedCall('call-1'),
      },
    ]],
  }));
  currentFake = installed.fake; restoreFake = installed.restore;

  const first = await callService.endCall('call-1', callerId);
  assert.equal(first.status, 'completed');

  await assert.rejects(
    () => callService.endCall('call-1', calleeId),
    (err) => err && err.statusCode === 409
  );
});

test('endCall rejects when user is not a participant', async () => {
  restoreFake();
  const installed = installFakeSupabase(supabaseAdmin, seedBase({
    call_history: [[ 'call-1', acceptedCall('call-1') ]],
  }));
  currentFake = installed.fake; restoreFake = installed.restore;

  await assert.rejects(
    () => callService.endCall('call-1', outsiderId),
    (err) => err && err.statusCode === 404
  );
});

// ── Caller / Receiver end call ─────────────────────────────────────────

test('caller ending an accepted call sets ended status', async () => {
  restoreFake();
  const installed = installFakeSupabase(supabaseAdmin, seedBase({
    call_history: [[ 'call-1', acceptedCall('call-1') ]],
  }));
  currentFake = installed.fake; restoreFake = installed.restore;

  const ended = await callService.endCall('call-1', callerId);
  assert.equal(ended.status, 'completed');
  assert.equal(ended.end_reason, 'ended');
  assert.ok(ended.ended_at);
  assert.ok(ended.duration_seconds >= 0);
});

test('receiver ending an accepted call sets completed status', async () => {
  restoreFake();
  const installed = installFakeSupabase(supabaseAdmin, seedBase({
    call_history: [[ 'call-1', acceptedCall('call-1') ]],
  }));
  currentFake = installed.fake; restoreFake = installed.restore;

  const ended = await callService.endCall('call-1', calleeId);
  assert.equal(ended.status, 'completed');
  assert.equal(ended.end_reason, 'ended');
});

// ── Call ended does not block new calls ────────────────────────────────

test('ended call does not block a new call between same users', async () => {
  restoreFake();
  const installed = installFakeSupabase(supabaseAdmin, seedBase({
    call_history: [[ 'call-1', {
      ...acceptedCall('call-1'),
      status: 'ended',
      ended_at: new Date().toISOString(),
    } ]],
  }));
  currentFake = installed.fake; restoreFake = installed.restore;

  const call = await callService.initiateCall(callerId, calleeId, conversationId, null, 'voice');
  assert.equal(call.status, 'ringing');
  const rows = currentFake.dump('call_history');
  assert.equal(rows.length, 2);
});

// ── Customer → Admin and Admin → Customer ─────────────────────────────

test('customer can initiate call to admin (owner)', async () => {
  const call = await callService.initiateCall(callerId, calleeId, conversationId, null, 'voice');
  assert.equal(call.caller_id, callerId);
  assert.equal(call.callee_id, calleeId);
  assert.equal(call.status, 'ringing');
});

test('admin can initiate call to customer', async () => {
  const call = await callService.initiateCall(calleeId, callerId, conversationId, null, 'voice');
  assert.equal(call.caller_id, calleeId);
  assert.equal(call.callee_id, callerId);
  assert.equal(call.status, 'ringing');
});

// ── Overlapping call is rejected ───────────────────────────────────────

test('initiateCall rejects when an accepted call is already in progress', async () => {
  restoreFake();
  const installed = installFakeSupabase(supabaseAdmin, seedBase({
    call_history: [[ 'live-1', {
      ...acceptedCall('live-1'),
      caller_heartbeat_at: freshTimestamp(),
      callee_heartbeat_at: freshTimestamp(),
    } ]],
  }));
  currentFake = installed.fake; restoreFake = installed.restore;

  await assert.rejects(
    () => callService.initiateCall(callerId, calleeId, conversationId, null, 'voice'),
    (err) => err && err.statusCode === 400
  );
  assert.equal(currentFake.dump('call_history').length, 1);
});

test('initiateCall rejects when a ringing call is already in progress', async () => {
  restoreFake();
  const installed = installFakeSupabase(supabaseAdmin, seedBase({
    call_history: [[ 'live-1', {
      id: 'live-1',
      caller_id: callerId,
      callee_id: calleeId,
      conversation_id: conversationId,
      status: 'ringing',
      started_at: new Date().toISOString(),
      metadata: {},
    } ]],
  }));
  currentFake = installed.fake; restoreFake = installed.restore;

  await assert.rejects(
    () => callService.initiateCall(callerId, calleeId, conversationId, null, 'voice'),
    (err) => err && err.statusCode === 400
  );
});

// ── Created_at is NOT used to cut accepted calls ───────────────────────

test('accepted call with old created_at but fresh heartbeat is NOT ended', async () => {
  restoreFake();
  const oldCreated = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(); // 1 day ago
  const installed = installFakeSupabase(supabaseAdmin, seedBase({
    call_history: [[ 'call-1', {
      ...acceptedCall('call-1'),
      created_at: oldCreated,
      caller_heartbeat_at: freshTimestamp(),
      callee_heartbeat_at: freshTimestamp(),
    } ]],
  }));
  currentFake = installed.fake; restoreFake = installed.restore;

  await callService.expireStaleAcceptedCalls();
  const row = currentFake.dump('call_history').find((r) => r.id === 'call-1');
  assert.equal(row.status, 'accepted');
});

// ── NULL heartbeat (pre-migration accepted calls) must be expired ────────

test('accepted call with NULL heartbeat on both sides is expired', async () => {
  restoreFake();
  const installed = installFakeSupabase(supabaseAdmin, seedBase({
    call_history: [[ 'call-1', {
      ...acceptedCall('call-1'),
      caller_heartbeat_at: null,
      callee_heartbeat_at: null,
    } ]],
  }));
  currentFake = installed.fake; restoreFake = installed.restore;

  const count = await callService.expireStaleAcceptedCalls();
  assert.equal(count, 1);

  const row = currentFake.dump('call_history').find((r) => r.id === 'call-1');
  assert.equal(row.status, 'ended');
});
