// Integration test: incomingCall delivery path Customer -> Admin over real Socket.IO.
//
// Proves, over a real WebSocket transport, the exact end-to-end path:
//
//   Customer calls POST /api/calls (initiateCall)
//   -> verifyToken authenticates, callService validates callee + conversation
//   -> callService inserts a ringing Call Session into call_history
//   -> callService emits incomingCall over the REAL socket.io server
//   -> Admin socket (authenticated, auto-joined user_<adminId>) receives incomingCall
//
// Uses the REAL socketService (JWT auth + user_<id> rooms + emitIncomingCall),
// the REAL callRoutes/callService, and a real socket.io client/server pair.
// Supabase is replaced by the in-memory fake (no network/DB). No production
// URL or credentials are used.
//
// Run with:  npm --prefix backend test
import test, { before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
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
const { installFakeSupabase } = await import('./helpers/fakeSupabase.mjs');
const callRoutes = (await import('../routes/callRoutes.js')).default;
const { errorHandler } = await import('../middleware/errorHandler.js');
const socketService = await import('../services/socketService.js');

const CUSTOMER = '11111111-1111-4111-8111-111111111111';
const ADMIN = '22222222-2222-4222-8222-222222222222';
const OUTSIDER = '33333333-3333-4333-8333-333333333333';
const CONV = '44444444-4444-4444-8444-444444444444';

const TOKENS = {
  [CUSTOMER]: 'customer-token',
  [ADMIN]: 'admin-token',
  [OUTSIDER]: 'outsider-token',
};

function seed(overrides = {}) {
  return {
    profiles: [
      [CUSTOMER, { id: CUSTOMER, name: 'ลูกค้า A', email: 'c@example.com', role: 'customer', is_active: true, avatar_url: null }],
      [ADMIN, { id: ADMIN, name: 'แอดมิน B', email: 'a@example.com', role: 'owner', is_active: true, avatar_url: null }],
      [OUTSIDER, { id: OUTSIDER, name: 'บุคคลภายนอก', email: 'o@example.com', role: 'customer', is_active: true, avatar_url: null }],
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
    ...overrides,
  };
}

// Map opaque bearer tokens -> user id for BOTH the HTTP verifyToken path
// (supabaseAuth) and the Socket.IO auth path (supabaseAdmin). This lets the
// real middleware run without hitting a real Supabase Auth endpoint.
const getUserStub = async (token) => {
  const id = Object.keys(TOKENS).find((key) => TOKENS[key] === token);
  if (!id) {
    return { data: { user: null }, error: { message: 'Invalid token' } };
  }
  return { data: { user: { id } }, error: null };
};

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

async function waitFor(fn, { timeout = 5000, interval = 20 } = {}) {
  const deadline = Date.now() + timeout;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > deadline) return null;
    await new Promise((r) => setTimeout(r, interval));
  }
}

async function api(path, { token, method = 'GET', body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  return fetch(`http://127.0.0.1:${PORT}/api/calls${path}`, {
    method,
    headers,
    body: payload,
  }).then(async (response) => ({
    status: response.status,
    data: await response.json().catch(() => ({})),
  }));
}

let server;
let io;
let PORT;
let currentFake;
let restoreFake;
let sockets = [];

let origAuthGetUser;
let origAdminAuthGetUser;

before(async () => {
  if (!ioClient) {
    // No socket.io-client available; all tests in this file skip.
    return;
  }

  // Stub auth for both the HTTP (verifyToken) and Socket.IO paths.
  origAuthGetUser = supabaseAuth.auth.getUser;
  origAdminAuthGetUser = supabaseAdmin.auth.getUser;
  supabaseAuth.auth.getUser = getUserStub;
  supabaseAdmin.auth.getUser = getUserStub;

  const app = express();
  app.use(express.json());
  app.use('/api/calls', callRoutes);
  app.use(errorHandler);

  server = createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();
  PORT = port;
  io = socketService.initialize(server);
});

after(async () => {
  for (const s of sockets) s.disconnect();
  sockets = [];
  if (io) io.close();
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  supabaseAuth.auth.getUser = origAuthGetUser;
  supabaseAdmin.auth.getUser = origAdminAuthGetUser;
});

beforeEach(async () => {
  if (!ioClient) return;
  const installed = installFakeSupabase(supabaseAdmin, seed());
  currentFake = installed.fake;
  restoreFake = installed.restore;
  sockets = [];
});

afterEach(async () => {
  for (const s of sockets) s.disconnect();
  sockets = [];
  if (restoreFake) {
    restoreFake();
    restoreFake = null;
  }
});

async function connectBoth() {
  const [customerSock, adminSock] = await Promise.all([
    connectClient(`http://127.0.0.1:${PORT}`, TOKENS[CUSTOMER]),
    connectClient(`http://127.0.0.1:${PORT}`, TOKENS[ADMIN]),
  ]);
  sockets.push(customerSock, adminSock);
  return { customerSock, adminSock };
}

async function connectOutsider() {
  const sock = await connectClient(`http://127.0.0.1:${PORT}`, TOKENS[OUTSIDER]);
  sockets.push(sock);
  return sock;
}

test('incomingCall: customer initiates call -> admin receives incomingCall with full payload', { timeout: 15000 }, async (t) => {
  if (!ioClient) return t.skip('socket.io-client is not installed');

  const { adminSock, customerSock } = await connectBoth();
  const adminIncoming = collect(adminSock, 'incomingCall');

  // Admin is auto-joined to user_<adminId> on connect (socketService).
  const adminUserRoom = io.sockets.adapter.rooms.get(`user_${ADMIN}`);
  assert.ok(adminUserRoom && adminUserRoom.has(adminSock.id), 'admin socket joined user_<adminId> room');

  const { status, data } = await api('', {
    token: TOKENS[CUSTOMER],
    method: 'POST',
    body: { calleeId: ADMIN, conversationId: CONV, storeOrderId: null, callType: 'voice' },
  });

  assert.equal(status, 201, 'initiateCall should return 201');
  assert.equal(data.data.status, 'ringing', 'call session must be ringing');
  const callId = data.data.id;

  const evt = await waitFor(() => adminIncoming.find((e) => e.call_id === callId));
  assert.ok(evt, 'admin should receive incomingCall for the initiated call');

  // Payload must carry all required fields and match the DB record.
  assert.equal(evt.call_id, callId, 'payload.call_id must match the created call id');
  assert.equal(evt.caller_id, CUSTOMER, 'payload.caller_id must be the customer');
  assert.equal(evt.callee_id, ADMIN, 'payload.callee_id must be the admin');
  assert.equal(evt.conversation_id, CONV);
  assert.equal(evt.call_type, 'voice');
  assert.equal(evt.store_order_id, null);

  // The DB record must match the event (call state machine: ringing).
  const rows = currentFake.dump('call_history');
  assert.equal(rows.length, 1, 'exactly one call session must exist');
  const row = rows.find((r) => r.id === callId);
  assert.ok(row, 'call session must be persisted');
  assert.equal(row.status, 'ringing', 'call state machine must be ringing');
  assert.equal(row.caller_id, CUSTOMER);
  assert.equal(row.callee_id, ADMIN);

  console.log('[incoming-call-test] customer -> admin incomingCall delivered', {
    callId,
    callerId: CUSTOMER,
    calleeId: ADMIN,
    transport: adminSock.io.engine.transport.name,
  });
});

test('incomingCall: admin who is not the callee does not receive the event', { timeout: 15000 }, async (t) => {
  if (!ioClient) return t.skip('socket.io-client is not installed');

  await connectBoth();
  // Outsider is a different authenticated user, NOT the callee.
  const outsiderSock = await connectOutsider();
  const outsiderIncoming = collect(outsiderSock, 'incomingCall');

  const { status } = await api('', {
    token: TOKENS[CUSTOMER],
    method: 'POST',
    body: { calleeId: ADMIN, conversationId: CONV, storeOrderId: null, callType: 'voice' },
  });
  assert.equal(status, 201);

  // Give the transport a window to deliver; outsider must receive nothing.
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(outsiderIncoming.length, 0, 'non-callee user must not receive incomingCall');
});

test('incomingCall: unauthenticated socket cannot connect and receives nothing', { timeout: 15000 }, async (t) => {
  if (!ioClient) return t.skip('socket.io-client is not installed');

  const { adminSock } = await connectBoth();
  const adminIncoming = collect(adminSock, 'incomingCall');

  // Attempt to connect with no token -> must be rejected by socket middleware.
  let connectErr = null;
  const noToken = ioClient.io(`http://127.0.0.1:${PORT}`, {
    path: '/socket.io',
    transports: ['websocket'],
    auth: { },
    reconnection: false,
  });
  sockets.push(noToken);
  noToken.on('connect_error', (err) => { connectErr = err; });
  await new Promise((r) => setTimeout(r, 800)); // allow connect_error to fire
  assert.ok(connectErr, 'unauthenticated socket must be rejected');
  assert.equal(adminIncoming.length, 0);
});

test('incomingCall: idempotency - duplicate initiateCall while ringing creates no duplicate call/event', { timeout: 15000 }, async (t) => {
  if (!ioClient) return t.skip('socket.io-client is not installed');

  const { adminSock } = await connectBoth();
  const adminIncoming = collect(adminSock, 'incomingCall');

  const first = await api('', {
    token: TOKENS[CUSTOMER],
    method: 'POST',
    body: { calleeId: ADMIN, conversationId: CONV, storeOrderId: null, callType: 'voice' },
  });
  assert.equal(first.status, 201);
  const callId = first.data.data.id;
  await waitFor(() => adminIncoming.find((e) => e.call_id === callId));

  // Duplicate request while the call is still ringing must be rejected.
  const second = await api('', {
    token: TOKENS[CUSTOMER],
    method: 'POST',
    body: { calleeId: ADMIN, conversationId: CONV, storeOrderId: null, callType: 'voice' },
  });
  assert.equal(second.status, 400, 'duplicate initiateCall while ringing must return 400');

  // No duplicate call and no duplicate incomingCall event.
  await new Promise((r) => setTimeout(r, 300));
  const rows = currentFake.dump('call_history');
  assert.equal(rows.length, 1, 'exactly one call session must exist after duplicate');
  const mine = adminIncoming.filter((e) => e.call_id === callId);
  assert.equal(mine.length, 1, `expected exactly 1 incomingCall event, got ${mine.length}`);
});

test('incomingCall: failed initiation (inactive callee) must not emit any incomingCall', { timeout: 15000 }, async (t) => {
  if (!ioClient) return t.skip('socket.io-client is not installed');

  const { adminSock } = await connectBoth();
  const adminIncoming = collect(adminSock, 'incomingCall');

  // Install a seed where the admin callee is inactive.
  restoreFake();
  const installed = installFakeSupabase(supabaseAdmin, seed({
    profiles: [
      [CUSTOMER, { id: CUSTOMER, name: 'ลูกค้า A', email: 'c@example.com', role: 'customer', is_active: true, avatar_url: null }],
      [ADMIN, { id: ADMIN, name: 'แอดมิน B', email: 'a@example.com', role: 'owner', is_active: false, avatar_url: null }],
    ],
  }));
  currentFake = installed.fake;
  restoreFake = installed.restore;

  const { status } = await api('', {
    token: TOKENS[CUSTOMER],
    method: 'POST',
    body: { calleeId: ADMIN, conversationId: CONV, storeOrderId: null, callType: 'voice' },
  });

  assert.equal(status, 400, 'calling an inactive callee must return 400');
  // No call persisted and no incomingCall emitted.
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(currentFake.dump('call_history').length, 0, 'no call session must be persisted on failure');
  assert.equal(adminIncoming.length, 0, 'no incomingCall must be emitted on failure');
});

test('incomingCall: event matches the call state machine and the DB-recorded call id', { timeout: 15000 }, async (t) => {
  if (!ioClient) return t.skip('socket.io-client is not installed');

  const { adminSock } = await connectBoth();
  const adminIncoming = collect(adminSock, 'incomingCall');

  const { status, data } = await api('', {
    token: TOKENS[CUSTOMER],
    method: 'POST',
    body: { calleeId: ADMIN, conversationId: CONV, storeOrderId: null, callType: 'video' },
  });
  assert.equal(status, 201);
  const callId = data.data.id;

  const evt = await waitFor(() => adminIncoming.find((e) => e.call_id === callId));
  assert.ok(evt);

  // The event's call_id must equal the id stored in call_history.
  const row = currentFake.dump('call_history').find((r) => r.id === callId);
  assert.ok(row, 'call session persisted');
  assert.equal(evt.call_id, row.id, 'event call_id must equal DB call id');
  assert.equal(row.status, 'ringing', 'call state machine must be ringing at emit time');
  assert.equal(evt.call_type, 'video');

  console.log('[incoming-call-test] event consistent with DB record', { callId, status: row.status });
});

test('incomingCall: socket reconnect + rejoin user_<adminId> room does not duplicate incomingCall', { timeout: 15000 }, async (t) => {
  if (!ioClient) return t.skip('socket.io-client is not installed');

  const { adminSock } = await connectBoth();
  const adminIncoming = collect(adminSock, 'incomingCall');

  const { status, data } = await api('', {
    token: TOKENS[CUSTOMER],
    method: 'POST',
    body: { calleeId: ADMIN, conversationId: CONV, storeOrderId: null, callType: 'voice' },
  });
  assert.equal(status, 201);
  const callId = data.data.id;
  await waitFor(() => adminIncoming.find((e) => e.call_id === callId));

  // Disconnect and reconnect the admin socket; it must re-authenticate and
  // re-join user_<adminId>, but must NOT receive the earlier incomingCall again.
  adminSock.disconnect();
  sockets = sockets.filter((s) => s !== adminSock);

  const reconnected = await connectClient(`http://127.0.0.1:${PORT}`, TOKENS[ADMIN]);
  sockets.push(reconnected);
  const reconnectedIncoming = collect(reconnected, 'incomingCall');

  const adminUserRoom = io.sockets.adapter.rooms.get(`user_${ADMIN}`);
  assert.ok(adminUserRoom && adminUserRoom.has(reconnected.id), 'reconnected admin socket rejoined user_<adminId> room');

  // Wait a window to confirm no replayed/duplicate event arrives.
  await new Promise((r) => setTimeout(r, 600));
  const mine = reconnectedIncoming.filter((e) => e.call_id === callId);
  assert.equal(mine.length, 0, 'reconnected socket must not receive a stale incomingCall');
});
