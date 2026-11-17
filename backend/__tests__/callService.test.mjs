import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL ||= 'https://dummy.supabase.co';
process.env.SUPABASE_ANON_KEY ||= 'dummy-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'dummy-service-key';
process.env.JWT_SECRET ||= 'dummy-secret';

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
  return {
    profiles: [
      [callerId, { id: callerId, name: 'Caller', avatar_url: null, is_active: true }],
      [calleeId, { id: calleeId, name: 'Callee', avatar_url: null, is_active: true }],
      [outsiderId, { id: outsiderId, name: 'Outsider', avatar_url: null, is_active: true }],
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

test('initiateCall creates ringing call for conversation members', async () => {
  const call = await callService.initiateCall(callerId, calleeId, conversationId, null, 'voice');
  assert.ok(call.id);
  assert.equal(call.caller_id, callerId);
  assert.equal(call.callee_id, calleeId);
  assert.equal(call.conversation_id, conversationId);
  assert.equal(call.status, 'ringing');
  const rows = currentFake.dump('call_history');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, 'ringing');
});

test('initiateCall rejects when caller is not an active conversation member', async () => {
  restoreFake();
  const installed = installFakeSupabase(supabaseAdmin, seedBase({
    conversation_members: [
      ['m2', { id: 'm2', conversation_id: conversationId, profile_id: calleeId, left_at: null }],
    ],
  }));
  currentFake = installed.fake; restoreFake = installed.restore;

  await assert.rejects(
    () => callService.initiateCall(callerId, calleeId, conversationId),
    (err) => err && err.statusCode === 403
  );
  assert.equal(currentFake.dump('call_history').length, 0);
});

test('initiateCall rejects when callee is not an active conversation member', async () => {
  restoreFake();
  const installed = installFakeSupabase(supabaseAdmin, seedBase({
    conversation_members: [
      ['m1', { id: 'm1', conversation_id: conversationId, profile_id: callerId, left_at: null }],
    ],
  }));
  currentFake = installed.fake; restoreFake = installed.restore;

  await assert.rejects(
    () => callService.initiateCall(callerId, calleeId, conversationId),
    (err) => err && err.statusCode === 403
  );
});

test('acceptCall updates ringing call to accepted for callee member', async () => {
  restoreFake();
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

  const updated = await callService.acceptCall('call-1', calleeId);
  assert.equal(updated.status, 'accepted');
  assert.ok(updated.answered_at);
  const row = currentFake.dump('call_history').find((r) => r.id === 'call-1');
  assert.equal(row.status, 'accepted');
});

test('acceptCall rejects when participant is not an active conversation member', async () => {
  restoreFake();
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
    conversation_members: [
      ['m1', { id: 'm1', conversation_id: conversationId, profile_id: callerId, left_at: null }],
    ],
  }));
  currentFake = installed.fake; restoreFake = installed.restore;

  await assert.rejects(
    () => callService.acceptCall('call-1', calleeId),
    (err) => err && err.statusCode === 403
  );
  const row = currentFake.dump('call_history').find((r) => r.id === 'call-1');
  assert.equal(row.status, 'ringing');
});

test('initiateCall expires an abandoned ringing call and allows a new one', async () => {
  restoreFake();
  const staleCreatedAt = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const installed = installFakeSupabase(supabaseAdmin, seedBase({
    call_history: [[
      'stale-1',
      {
        id: 'stale-1',
        caller_id: callerId,
        callee_id: calleeId,
        conversation_id: conversationId,
        status: 'ringing',
        created_at: staleCreatedAt,
        started_at: staleCreatedAt,
        metadata: {},
      },
    ]],
  }));
  currentFake = installed.fake; restoreFake = installed.restore;

  const call = await callService.initiateCall(callerId, calleeId, conversationId, null, 'voice');
  assert.ok(call.id);
  const rows = currentFake.dump('call_history');
  const stale = rows.find((r) => r.id === 'stale-1');
  assert.equal(stale.status, 'no_answer');
  assert.equal(stale.end_reason, 'no_answer');
  assert.ok(rows.some((r) => r.id !== 'stale-1' && r.status === 'ringing'));
});

test('initiateCall still refuses while a fresh call is in progress', async () => {
  restoreFake();
  const installed = installFakeSupabase(supabaseAdmin, seedBase({
    call_history: [[
      'live-1',
      {
        id: 'live-1',
        caller_id: callerId,
        callee_id: calleeId,
        conversation_id: conversationId,
        status: 'ringing',
        created_at: new Date().toISOString(),
        started_at: new Date().toISOString(),
        metadata: {},
      },
    ]],
  }));
  currentFake = installed.fake; restoreFake = installed.restore;

  await assert.rejects(
    () => callService.initiateCall(callerId, calleeId, conversationId),
    (err) => err && err.statusCode === 400
  );
  assert.equal(currentFake.dump('call_history').length, 1);
});

test('acceptCall refuses an abandoned ringing call (410) and marks it missed', async () => {
  restoreFake();
  const staleCreatedAt = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const installed = installFakeSupabase(supabaseAdmin, seedBase({
    call_history: [[
      'call-stale',
      {
        id: 'call-stale',
        caller_id: callerId,
        callee_id: calleeId,
        conversation_id: conversationId,
        status: 'ringing',
        created_at: staleCreatedAt,
        started_at: staleCreatedAt,
        metadata: {},
      },
    ]],
  }));
  currentFake = installed.fake; restoreFake = installed.restore;

  await assert.rejects(
    () => callService.acceptCall('call-stale', calleeId),
    (err) => err && err.statusCode === 410
  );
  const row = currentFake.dump('call_history').find((r) => r.id === 'call-stale');
  assert.equal(row.status, 'no_answer');
});
