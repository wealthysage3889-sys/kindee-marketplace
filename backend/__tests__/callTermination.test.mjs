// Real-time call termination tests (two real WebSocket sessions).
//
// Proves, over a real socket.io transport, that when one party ends / rejects /
// cancels a call, the OTHER party actually receives the socket event the
// frontend listens to (callEnded / callRejected) with the correct payload
// (call_id + status). This is the signal the customer and admin UIs rely on to
// stop the ringtone / ringback, close the WebRTC peer connection and tear down
// the call screen — in BOTH directions (customer -> admin and admin -> customer).
//
// Uses the REAL socketService (JWT auth + user_<id> rooms) and the REAL
// callService, against the same in-memory Supabase fake the other tests use.
// socket.io-client is resolved from the frontend workspace (skipped if absent).
//
// Run with:  npm --prefix backend test
import test, { before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';

process.env.SUPABASE_URL ||= 'https://dummy.supabase.co';
process.env.SUPABASE_ANON_KEY ||= 'dummy-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'dummy-service-key';
process.env.JWT_SECRET ||= 'dummy-secret';
// Keep the socket disconnect grace-period timer short so disconnecting the test
// clients does not keep the test process alive for the default 45s.
process.env.CALL_HEARTBEAT_STALE_MS ||= '300';

const require = createRequire(import.meta.url);
let ioClient = null;
try {
  ioClient = require('../../frontend/node_modules/socket.io-client');
} catch {
  try {
    ioClient = require('socket.io-client');
  } catch {
    ioClient = null;
  }
}

const { supabaseAdmin, supabaseAuth } = await import('../config/supabase.js');
const socketService = await import('../services/socketService.js');
const callService = await import('../services/callService.js');
const { installFakeSupabase } = await import('./helpers/fakeSupabase.mjs');
const jwt = (await import('jsonwebtoken')).default;

const CUSTOMER = 'cust-11111111-1111-4111-8111-111111111111';
const ADMIN = 'own-22222222-2222-4222-8222-222222222222';
const CONV = 'conv-44444444-4444-4444-8444-444444444444';

const TOKENS = {
  [CUSTOMER]: 'customer-call-token',
  [ADMIN]: 'admin-call-token',
};

function seed() {
  return {
    profiles: [
      [CUSTOMER, { id: CUSTOMER, name: 'ลูกค้า A', email: 'c@example.com', role: 'customer', is_active: true, avatar_url: null }],
      [ADMIN, { id: ADMIN, name: 'แอดมิน B', email: 'a@example.com', role: 'owner', is_active: true, avatar_url: null }],
    ],
    conversations: [
      [CONV, { id: CONV, type: 'store_customer', store_id: 'store-1', store_order_id: null, last_message_at: null }],
    ],
    conversation_members: [
      ['cm-c', { id: 'cm-c', conversation_id: CONV, profile_id: CUSTOMER, role: 'member', left_at: null, unread_count: 0 }],
      ['cm-a', { id: 'cm-a', conversation_id: CONV, profile_id: ADMIN, role: 'admin', left_at: null, unread_count: 0 }],
    ],
    messages: [],
    message_attachments: [],
    notifications: [],
    call_history: [],
    settings: [],
  };
}

const tokenFor = (id) => jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '1h' });

function connectClient(url, token) {
  return new Promise((resolve, reject) => {
    const socket = ioClient.io(url, {
      path: '/socket.io',
      transports: ['websocket'],
      auth: { token },
      reconnection: false,
    });
    const timer = setTimeout(() => reject(new Error('connect timeout')), 5000);
    socket.on('connect', () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.on('connect_error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

function collect(socket, event) {
  const events = [];
  socket.on(event, (payload) => events.push(payload));
  return events;
}

async function waitFor(fn, { timeout = 3000, interval = 20 } = {}) {
  const deadline = Date.now() + timeout;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > deadline) return null;
    await new Promise((r) => setTimeout(r, interval));
  }
}

let server;
let io;
let baseUrl;
let currentFake;
let restoreFake;
let sockets;

before(async () => {
  // Map socket auth tokens to the two participants.
  supabaseAuth.auth.getUser = async (token) => {
    const id = Object.keys(TOKENS).find((key) => TOKENS[key] === token);
    if (!id) return { data: { user: null }, error: { message: 'Invalid token' } };
    return { data: { user: { id } }, error: null };
  };

  server = createServer();
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;
  io = socketService.initialize(server);
});

after(async () => {
  for (const s of sockets || []) s.disconnect();
  if (io) io.close();
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  const installed = installFakeSupabase(supabaseAdmin, seed());
  currentFake = installed.fake;
  restoreFake = installed.restore;
  sockets = [];
});

afterEach(() => {
  for (const s of sockets) s.disconnect();
  sockets = [];
  if (restoreFake) {
    restoreFake();
    restoreFake = null;
  }
});

async function connectBoth() {
  const [customerSock, adminSock] = await Promise.all([
    connectClient(baseUrl, tokenFor(CUSTOMER)),
    connectClient(baseUrl, tokenFor(ADMIN)),
  ]);
  sockets.push(customerSock, adminSock);
  return { customerSock, adminSock };
}

// Join the call signaling room like the real client (VoiceCallUI /
// IncomingCallHandler call joinCall) and wait until the server has added the
// socket, so call-room broadcasts (emitCallEnded) are received.
async function joinCallAndWait(sock, callId) {
  const room = `call_${callId}`;
  sock.emit('joinCall', callId);
  await waitFor(
    () => (io.sockets.adapter.rooms.get(room)?.has(sock.id) ? true : null),
    { timeout: 2000 }
  );
}

// Create a fresh ringing call in the DB (bypassing initiateCall's notifications)
// so each test starts from a known state.
async function insertCall(id, overrides = {}) {
  const now = new Date().toISOString();
  await supabaseAdmin.from('call_history').insert({
    id,
    caller_id: CUSTOMER,
    callee_id: ADMIN,
    conversation_id: CONV,
    status: 'ringing',
    started_at: now,
    metadata: { call_type: 'voice' },
    ...overrides,
  });
  return id;
}

test('customer cancels a ringing call -> admin receives callEnded(cancelled) with call_id', { timeout: 15000 }, async (t) => {
  if (!ioClient) return t.skip('socket.io-client not installed');
  const { adminSock } = await connectBoth();
  const adminEnded = collect(adminSock, 'callEnded');

  const callId = await insertCall('call-cancel-1');
  await callService.cancelCall(callId, CUSTOMER);

  const evt = await waitFor(() => adminEnded.find((e) => e.call_id === callId));
  assert.ok(evt, 'admin should receive callEnded for the cancelled call');
  assert.equal(evt.status, 'cancelled');
  const row = currentFake.dump('call_history').find((r) => r.id === callId);
  assert.equal(row.status, 'cancelled');
});

test('admin rejects an incoming call -> customer receives callRejected + callEnded(rejected)', { timeout: 15000 }, async (t) => {
  if (!ioClient) return t.skip('socket.io-client not installed');
  const { customerSock } = await connectBoth();
  const custRejected = collect(customerSock, 'callRejected');
  const custEnded = collect(customerSock, 'callEnded');

  const callId = await insertCall('call-reject-1');
  // The caller joins the call room in VoiceCallUI, so it also gets the
  // call-room callEnded(rejected) broadcast (emitCallEnded).
  await joinCallAndWait(customerSock, callId);
  await callService.rejectCall(callId, ADMIN);

  const rejected = await waitFor(() => custRejected.find((e) => e.call_id === callId));
  assert.ok(rejected, 'customer should receive callRejected');
  assert.equal(rejected.rejected_by, ADMIN);

  const ended = await waitFor(() => custEnded.find((e) => e.call_id === callId));
  assert.ok(ended, 'customer should receive callEnded(rejected)');
  assert.equal(ended.status, 'rejected');
});

test('customer ends an accepted call -> admin receives callEnded(completed)', { timeout: 15000 }, async (t) => {
  if (!ioClient) return t.skip('socket.io-client not installed');
  const { adminSock } = await connectBoth();
  const adminEnded = collect(adminSock, 'callEnded');

  const callId = await insertCall('call-end-c', { status: 'accepted', answered_at: new Date().toISOString() });
  await callService.endCall(callId, CUSTOMER);

  const evt = await waitFor(() => adminEnded.find((e) => e.call_id === callId));
  assert.ok(evt, 'admin should receive callEnded when customer hangs up');
  assert.equal(evt.status, 'completed');
  assert.ok(typeof evt.duration_seconds === 'number');
});

test('admin ends an accepted call -> customer receives callEnded(completed)', { timeout: 15000 }, async (t) => {
  if (!ioClient) return t.skip('socket.io-client not installed');
  const { customerSock } = await connectBoth();
  const custEnded = collect(customerSock, 'callEnded');

  const callId = await insertCall('call-end-a', { status: 'accepted', answered_at: new Date().toISOString() });
  await callService.endCall(callId, ADMIN);

  const evt = await waitFor(() => custEnded.find((e) => e.call_id === callId));
  assert.ok(evt, 'customer should receive callEnded when admin hangs up');
  assert.equal(evt.status, 'completed');
});

test('admin -> customer call: customer (callee) rejects -> admin (caller) is notified', { timeout: 15000 }, async (t) => {
  if (!ioClient) return t.skip('socket.io-client not installed');
  const { customerSock, adminSock } = await connectBoth();
  const adminRejected = collect(adminSock, 'callRejected');

  // Admin initiates, customer is the callee.
  const callId = await insertCall('call-rev-1', { caller_id: ADMIN, callee_id: CUSTOMER });
  await callService.rejectCall(callId, CUSTOMER);

  const evt = await waitFor(() => adminRejected.find((e) => e.call_id === callId));
  assert.ok(evt, 'admin (caller) should receive callRejected when customer rejects');
  assert.equal(evt.rejected_by, CUSTOMER);
});

test('double end: the second end is rejected (409) and no duplicate event is emitted', { timeout: 15000 }, async (t) => {
  if (!ioClient) return t.skip('socket.io-client not installed');
  const { customerSock } = await connectBoth();
  const custEnded = collect(customerSock, 'callEnded');

  const callId = await insertCall('call-double-1', { status: 'accepted', answered_at: new Date().toISOString() });
  await callService.endCall(callId, CUSTOMER);
  await assert.rejects(() => callService.endCall(callId, ADMIN), (err) => err && err.statusCode === 409);

  // Wait for the single callEnded(customer leg) event to arrive, then give the
  // transport a short window to prove the rejected second end emitted nothing.
  await waitFor(() => custEnded.some((e) => e.call_id === callId));
  await new Promise((r) => setTimeout(r, 250));

  const mine = custEnded.filter((e) => e.call_id === callId);
  assert.equal(mine.length, 1, `expected exactly 1 callEnded event, got ${mine.length}`);
});

test('ended call cannot transition back to accepted/ringing (atomic guard)', { timeout: 15000 }, async (t) => {
  if (!ioClient) return t.skip('socket.io-client not installed');
  await connectBoth();

  const callId = await insertCall('call-no-resurrect-1', { status: 'accepted', answered_at: new Date().toISOString() });
  await callService.endCall(callId, CUSTOMER);

  await assert.rejects(() => callService.acceptCall(callId, ADMIN), (err) => err && err.statusCode === 409);
  await assert.rejects(() => callService.cancelCall(callId, CUSTOMER), (err) => err && err.statusCode === 409);

  const row = currentFake.dump('call_history').find((r) => r.id === callId);
  assert.equal(row.status, 'completed');
  assert.equal(row.end_reason, 'ended');
});