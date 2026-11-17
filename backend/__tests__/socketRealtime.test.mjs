// Socket.IO integration test.
//
// Proves, over a real WebSocket transport, the exact delivery path the store
// owner's chat list depends on:
//
//   socket connected  ->  both parties joined conversation_<id>  ->
//   backend emitNewMessage  ->  the other side receives "newMessage"
//
// It uses the REAL socketService (JWT auth + joinConversation membership check +
// emitNewMessage) and a real socket.io server/client. Supabase is replaced by the
// same in-memory fake the chat unit tests use, so no network/DB is touched.
//
// socket.io-client is a frontend dependency; it is resolved from
// ../frontend/node_modules when present. When it is not installed the test is
// skipped (not failed) so `npm --prefix backend test` stays green everywhere.
//
// Run with:  npm --prefix backend test
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';

process.env.SUPABASE_URL ||= 'https://dummy.supabase.co';
process.env.SUPABASE_ANON_KEY ||= 'dummy-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'dummy-service-key';
process.env.JWT_SECRET ||= 'dummy-secret';

const require = createRequire(import.meta.url);
let ioClient = null;
try {
  // socket.io-client lives in the frontend workspace; fall back to a normal
  // backend install if someone adds it there later.
  ioClient = require('../../frontend/node_modules/socket.io-client');
} catch {
  try {
    ioClient = require('socket.io-client');
  } catch {
    ioClient = null;
  }
}

const { supabaseAdmin } = await import('../config/supabase.js');
const socketService = await import('../services/socketService.js');
const chatService = await import('../services/chatService.js');
const { installFakeSupabase } = await import('./helpers/fakeSupabase.mjs');
const jwt = (await import('jsonwebtoken')).default;

const CUSTOMER = 'cust-11111111-1111-1111-1111-111111111111';
const OWNER = 'own-22222222-2222-2222-2222-222222222222';
const STORE = 'store-44444444-4444-4444-4444-444444444444';
const CONV = 'conv-55555555-5555-5555-5555-555555555555';

function seed() {
  return {
    profiles: [
      [CUSTOMER, { id: CUSTOMER, name: 'ลูกค้า A', role: 'customer', is_active: true }],
      [OWNER, { id: OWNER, name: 'เจ้าของร้าน', role: 'seller', is_active: true }],
    ],
    stores: [[STORE, { id: STORE, name: 'ร้านทดสอบ', owner_id: OWNER, is_active: true }]],
    conversations: [
      [CONV, { id: CONV, type: 'store_customer', store_id: STORE, store_order_id: null, last_message_at: null }],
    ],
    conversation_members: [
      ['cm-cust', { id: 'cm-cust', conversation_id: CONV, profile_id: CUSTOMER, role: 'member', left_at: null, unread_count: 0 }],
      ['cm-own', { id: 'cm-own', conversation_id: CONV, profile_id: OWNER, role: 'admin', left_at: null, unread_count: 0 }],
    ],
    messages: [],
    message_attachments: [],
    notifications: [],
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

async function waitFor(fn, { timeout = 3000, interval = 25 } = {}) {
  const deadline = Date.now() + timeout;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > deadline) return null;
    await new Promise((r) => setTimeout(r, interval));
  }
}

test('realtime: connected -> room joined -> backend emit -> other side receives newMessage', { timeout: 15000 }, async (t) => {
  if (!ioClient) {
    t.skip('socket.io-client is not installed (frontend/node_modules missing)');
    return;
  }

  const { fake, restore } = installFakeSupabase(supabaseAdmin, seed());
  const server = createServer();
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();
  const url = `http://127.0.0.1:${port}`;

  const io = socketService.initialize(server);
  const sockets = [];

  try {
    // --- 1. Both sockets connect (real JWT auth via socketService) ----------
    const [customerSock, ownerSock] = await Promise.all([
      connectClient(url, tokenFor(CUSTOMER)),
      connectClient(url, tokenFor(OWNER)),
    ]);
    sockets.push(customerSock, ownerSock);

    assert.equal(customerSock.connected, true, 'customer socket connected');
    assert.equal(ownerSock.connected, true, 'owner socket connected');

    const customerTransport = customerSock.io.engine.transport.name;
    const ownerTransport = ownerSock.io.engine.transport.name;
    console.log('[socket-test] connected', {
      customerId: customerSock.id,
      ownerId: ownerSock.id,
      customerTransport,
      ownerTransport,
    });
    // --- 2. Transport must be websocket (not long-polling) ------------------
    assert.equal(ownerTransport, 'websocket');
    assert.equal(customerTransport, 'websocket');

    // --- 3. Both join the SAME conversation room ---------------------------
    customerSock.emit('joinConversation', CONV);
    ownerSock.emit('joinConversation', CONV);

    const roomKey = `conversation_${CONV}`;
    const joined = await waitFor(() => {
      const room = io.sockets.adapter.rooms.get(roomKey);
      if (room && room.has(customerSock.id) && room.has(ownerSock.id)) return room;
      return null;
    });
    assert.ok(joined, 'both sockets joined the conversation room');
    const userRoom = io.sockets.adapter.rooms.get(`user_${OWNER}`);
    assert.ok(userRoom && userRoom.has(ownerSock.id), 'owner socket joined user_<id> room (chat-list channel)');
    console.log('[socket-test] room joined', {
      room: roomKey,
      members: [...joined],
      ownerUserRoom: [...userRoom],
    });

    // --- 4. Listen on the OWNER (store owner / other side) -----------------
    const received = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('owner did not receive newMessage')), 4000);
      ownerSock.on('newMessage', (message) => {
        clearTimeout(timer);
        resolve(message);
      });
    });

    // --- 5. Backend path: customer sends -> chatService -> emitNewMessage --
    const saved = await chatService.sendMessage(CONV, CUSTOMER, {
      content: 'สวัสดีจากลูกค้า',
      type: 'text',
      metadata: {},
    });
    assert.ok(saved?.id, 'message persisted');

    const event = await received;
    assert.equal(event.id, saved.id, 'owner received the persisted message id');
    assert.equal(String(event.conversation_id), String(CONV));
    assert.equal(String(event.sender_id), String(CUSTOMER));

    console.log('[socket-test] client received newMessage', {
      messageId: event.id,
      conversationId: event.conversation_id,
      senderId: event.sender_id,
      transport: ownerTransport,
      dbUnreadForOwner: fake
        .dump('conversation_members')
        .find((m) => m.profile_id === OWNER && m.conversation_id === CONV)?.unread_count,
    });
  } finally {
    for (const s of sockets) s.disconnect();
    io.close();
    await new Promise((resolve) => server.close(resolve));
    restore();
  }
});