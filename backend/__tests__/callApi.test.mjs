// API-level tests for POST /api/calls.
//
// They exercise the real call router (verifyToken + express-validator + error
// handler) against the in-memory Supabase fake, so the 400 that blocked the
// call button is locked down: a store_customer conversation has no order, so
// the client sends storeOrderId: null, which used to fail UUID validation.
//
// Run with:  npm --prefix backend test
import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createServer } from 'node:http';

process.env.SUPABASE_URL ||= 'https://dummy.supabase.co';
process.env.SUPABASE_ANON_KEY ||= 'dummy-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'dummy-service-key';
process.env.JWT_SECRET ||= 'dummy-secret';

const { supabaseAdmin, supabaseAuth } = await import('../config/supabase.js');
const { installFakeSupabase } = await import('./helpers/fakeSupabase.mjs');
const callRoutes = (await import('../routes/callRoutes.js')).default;
const { errorHandler } = await import('../middleware/errorHandler.js');

const callerId = '11111111-1111-4111-8111-111111111111';
const calleeId = '22222222-2222-4222-8222-222222222222';
const outsiderId = '33333333-3333-4333-8333-333333333333';
const conversationId = '44444444-4444-4444-8444-444444444444';
const otherConversationId = '55555555-5555-4555-8555-555555555555';

const TOKENS = {
  [callerId]: 'caller-session-token',
  [calleeId]: 'callee-session-token',
  [outsiderId]: 'outsider-session-token',
};

function makeSeed(overrides = {}) {
  return {
    profiles: [
      [callerId, { id: callerId, name: 'Customer', email: 'customer@example.com', role: 'customer', is_active: true }],
      [calleeId, { id: calleeId, name: 'Store', email: 'owner@example.com', role: 'owner', is_active: true }],
      [outsiderId, { id: outsiderId, name: 'Outsider', email: 'outsider@example.com', role: 'customer', is_active: true }],
    ],
    conversations: [
      [conversationId, { id: conversationId, type: 'store_customer', store_id: 's1', store_order_id: null }],
      [otherConversationId, { id: otherConversationId, type: 'store_customer', store_id: 's1', store_order_id: null }],
    ],
    conversation_members: [
      ['cm-1', { id: 'cm-1', conversation_id: conversationId, profile_id: callerId, role: 'member', left_at: null }],
      ['cm-2', { id: 'cm-2', conversation_id: conversationId, profile_id: calleeId, role: 'admin', left_at: null }],
    ],
    call_history: [],
    settings: [],
    notifications: [],
    ...overrides,
  };
}

const app = express();
app.use(express.json());
app.use('/api/calls', callRoutes);
app.use(errorHandler);

let server;
let baseUrl;
let currentFake;
let restoreFake;

before(async () => {
  supabaseAuth.auth.getUser = async (token) => {
    const id = Object.keys(TOKENS).find((key) => TOKENS[key] === token);
    if (!id) {
      return { data: { user: null }, error: { message: 'Invalid token' } };
    }
    return { data: { user: { id } }, error: null };
  };

  server = createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}/api/calls`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  const installed = installFakeSupabase(supabaseAdmin, makeSeed());
  currentFake = installed.fake;
  restoreFake = installed.restore;
});

afterEach(() => {
  if (restoreFake) {
    restoreFake();
    restoreFake = null;
  }
});

function api(path, { token, method = 'GET', body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  return fetch(`${baseUrl}${path}`, { method, headers, body: payload }).then(async (response) => ({
    status: response.status,
    data: await response.json().catch(() => ({})),
  }));
}

test('POST /calls accepts the payload the call button sends (storeOrderId null) and returns 201', async () => {
  const { status, data } = await api('', {
    token: TOKENS[callerId],
    method: 'POST',
    body: { calleeId, conversationId, storeOrderId: null, callType: 'voice' },
  });

  assert.equal(status, 201);
  assert.equal(data.data.caller_id, callerId);
  assert.equal(data.data.callee_id, calleeId);
  assert.equal(data.data.conversation_id, conversationId);
  assert.equal(data.data.status, 'ringing');
  const rows = currentFake.dump('call_history');
  assert.equal(rows.length, 1);
});

test('POST /calls still works when storeOrderId is omitted entirely', async () => {
  const { status } = await api('', {
    token: TOKENS[callerId],
    method: 'POST',
    body: { calleeId, conversationId, callType: 'voice' },
  });
  assert.equal(status, 201);
});

test('POST /calls accepts a real order id (unchanged behaviour)', async () => {
  const storeOrderId = '66666666-6666-4666-8666-666666666666';
  const { status, data } = await api('', {
    token: TOKENS[callerId],
    method: 'POST',
    body: { calleeId, conversationId, storeOrderId, callType: 'voice' },
  });
  assert.equal(status, 201);
  assert.equal(data.data.store_order_id, storeOrderId);
});

test('POST /calls rejects a non-UUID storeOrderId with 400', async () => {
  const { status } = await api('', {
    token: TOKENS[callerId],
    method: 'POST',
    body: { calleeId, conversationId, storeOrderId: 'not-a-uuid', callType: 'voice' },
  });
  assert.equal(status, 400);
});

test('POST /calls rejects a caller who is not an active member of the conversation (403)', async () => {
  const { status } = await api('', {
    token: TOKENS[outsiderId],
    method: 'POST',
    body: { calleeId, conversationId, storeOrderId: null, callType: 'voice' },
  });
  assert.equal(status, 403);
  assert.equal(currentFake.dump('call_history').length, 0);
});

test('POST /calls rejects when the callee left the conversation (403)', async () => {
  restoreFake();
  const installed = installFakeSupabase(supabaseAdmin, makeSeed({
    conversation_members: [
      ['cm-1', { id: 'cm-1', conversation_id: conversationId, profile_id: callerId, role: 'member', left_at: null }],
      ['cm-2', { id: 'cm-2', conversation_id: conversationId, profile_id: calleeId, role: 'admin', left_at: '2026-01-01T00:00:00.000Z' }],
    ],
  }));
  currentFake = installed.fake;
  restoreFake = installed.restore;

  const { status } = await api('', {
    token: TOKENS[callerId],
    method: 'POST',
    body: { calleeId, conversationId, storeOrderId: null, callType: 'voice' },
  });
  assert.equal(status, 403);
  assert.equal(currentFake.dump('call_history').length, 0);
});

test('POST /calls rejects an inactive callee (400)', async () => {
  restoreFake();
  const installed = installFakeSupabase(supabaseAdmin, makeSeed({
    profiles: [
      [callerId, { id: callerId, name: 'Customer', email: 'customer@example.com', role: 'customer', is_active: true }],
      [calleeId, { id: calleeId, name: 'Store', email: 'owner@example.com', role: 'owner', is_active: false }],
    ],
  }));
  currentFake = installed.fake;
  restoreFake = installed.restore;

  const { status } = await api('', {
    token: TOKENS[callerId],
    method: 'POST',
    body: { calleeId, conversationId, storeOrderId: null, callType: 'voice' },
  });
  assert.equal(status, 400);
});

test('POST /calls rejects a malformed calleeId with 400', async () => {
  const { status } = await api('', {
    token: TOKENS[callerId],
    method: 'POST',
    body: { calleeId: 'not-a-uuid', conversationId },
  });
  assert.equal(status, 400);
});

test('POST /calls without a token is rejected with 401', async () => {
  const { status } = await api('', {
    method: 'POST',
    body: { calleeId, conversationId },
  });
  assert.equal(status, 401);
});