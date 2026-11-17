// API-level tests for the chat routes.
//
// These exercise the real Express router (auth middleware + validators + error
// handler) against an in-memory Supabase fake, so they prove the token/session
// rules of the chat flow:
//   - the customer session and the store-owner session each read their own room
//   - a token from the wrong session (or a bogus token) is rejected with 401
//   - non-members get 403 and unknown conversations get 404
//   - both roles can send messages and attach files, and each side receives the
//     other side's message through GET /conversations/:id/messages
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
const chatRoutes = (await import('../routes/chatRoutes.js')).default;
const { errorHandler } = await import('../middleware/errorHandler.js');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const customerId = '11111111-1111-4111-8111-111111111111';
const ownerId = '22222222-2222-4222-8222-222222222222';
const outsiderId = '33333333-3333-4333-8333-333333333333';
const storeId = '44444444-4444-4444-8444-444444444444';
const conversationId = '55555555-5555-4555-8555-555555555555';
const otherConversationId = '66666666-6666-4666-8666-666666666666';
const missingConversationId = '00000000-0000-4000-8000-000000000000';

const msg1Id = 'aaaaaaaa-0000-4000-8000-000000000001';
const msg2Id = 'aaaaaaaa-0000-4000-8000-000000000002';
const otherMsgId = 'bbbbbbbb-0000-4000-8000-000000000001';

const TOKENS = {
  [customerId]: 'customer-session-token',
  [ownerId]: 'store-owner-session-token',
  [outsiderId]: 'outsider-session-token',
};

const customerToken = TOKENS[customerId];
const ownerToken = TOKENS[ownerId];
const outsiderToken = TOKENS[outsiderId];

const iso = (offsetMs) => new Date(Date.now() + offsetMs).toISOString();

function makeSeed() {
  return {
    profiles: [
      [customerId, { id: customerId, name: 'ลูกค้า', email: 'customer@example.com', role: 'customer', is_active: true }],
      [ownerId, { id: ownerId, name: 'เจ้าของร้าน', email: 'owner@example.com', role: 'seller', is_active: true }],
      [outsiderId, { id: outsiderId, name: 'คนนอก', email: 'outsider@example.com', role: 'customer', is_active: true }],
    ],
    stores: [
      [storeId, { id: storeId, name: 'ร้านทดสอบ', owner_id: ownerId, is_active: true }],
    ],
    conversations: [
      [conversationId, { id: conversationId, type: 'store_customer', store_id: storeId, store_order_id: null, last_message_at: iso(-50000) }],
      [otherConversationId, { id: otherConversationId, type: 'store_customer', store_id: storeId, store_order_id: null, last_message_at: iso(-10000) }],
    ],
    conversation_members: [
      ['cm-1', { id: 'cm-1', conversation_id: conversationId, profile_id: customerId, role: 'member', left_at: null, unread_count: 0, last_read_at: null }],
      ['cm-2', { id: 'cm-2', conversation_id: conversationId, profile_id: ownerId, role: 'admin', left_at: null, unread_count: 1, last_read_at: null }],
      ['cm-3', { id: 'cm-3', conversation_id: otherConversationId, profile_id: ownerId, role: 'admin', left_at: null, unread_count: 0, last_read_at: null }],
    ],
    messages: [
      [msg1Id, { id: msg1Id, conversation_id: conversationId, sender_id: customerId, type: 'text', content: 'สวัสดีค่ะ', is_deleted: false, created_at: iso(-100000) }],
      [msg2Id, { id: msg2Id, conversation_id: conversationId, sender_id: ownerId, type: 'text', content: 'สวัสดีครับ', is_deleted: false, created_at: iso(-50000) }],
      [otherMsgId, { id: otherMsgId, conversation_id: otherConversationId, sender_id: ownerId, type: 'text', content: 'ห้องอื่น', is_deleted: false, created_at: iso(-20000) }],
    ],
    message_attachments: [],
    notifications: [],
  };
}

// ---------------------------------------------------------------------------
// Harness: real router + stubbed Supabase token verification
// ---------------------------------------------------------------------------

const app = express();
app.use(express.json());
app.use('/api/chat', chatRoutes);
app.use(errorHandler);

let server;
let baseUrl;
let currentFake = null;
let restoreFake = null;

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
  baseUrl = `http://127.0.0.1:${port}/api/chat`;
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

async function api(path, { token, method = 'GET', body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  const response = await fetch(`${baseUrl}${path}`, { method, headers, body: payload });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data };
}

// ---------------------------------------------------------------------------
// Read access per session
// ---------------------------------------------------------------------------

test('customer session can open its own conversation', async () => {
  const { status, data } = await api(`/conversations/${conversationId}`, { token: customerToken });
  assert.equal(status, 200);
  assert.equal(data.data.id, conversationId);
});

test('store-owner session can open the conversation of its own store (no admin token required)', async () => {
  const { status, data } = await api(`/conversations/${conversationId}`, { token: ownerToken });
  assert.equal(status, 200);
  assert.equal(data.data.store.id, storeId);
  assert.equal(data.data.store.owner_id, ownerId);
});

test('a request without a token is rejected with 401', async () => {
  const { status } = await api(`/conversations/${conversationId}`);
  assert.equal(status, 401);
});

test('a token from another session / an invalid token is rejected with 401', async () => {
  const { status } = await api(`/conversations/${conversationId}`, { token: 'not-a-valid-token' });
  assert.equal(status, 401);
});

test('a member of another room gets 403 for this conversation', async () => {
  const { status, data } = await api(`/conversations/${conversationId}`, { token: outsiderToken });
  assert.equal(status, 403);
  assert.match(data.message, /member/i);
});

test('an unknown conversation returns 404', async () => {
  const { status } = await api(`/conversations/${missingConversationId}`, { token: customerToken });
  assert.equal(status, 404);
});

test('non-members cannot read messages and get 403', async () => {
  const { status } = await api(`/conversations/${conversationId}/messages`, { token: outsiderToken });
  assert.equal(status, 403);
});

// ---------------------------------------------------------------------------
// Message flow in both directions
// ---------------------------------------------------------------------------

test('customer sends a message and the store owner receives it', async () => {
  const sent = await api(`/conversations/${conversationId}/messages`, {
    token: customerToken,
    method: 'POST',
    body: { content: 'อยากสอบถามสินค้าค่ะ', type: 'text' },
  });

  assert.equal(sent.status, 201);
  assert.equal(sent.data.data.sender_id, customerId);

  const ownerInbox = await api(`/conversations/${conversationId}/messages`, { token: ownerToken });
  assert.equal(ownerInbox.status, 200);
  assert.ok(ownerInbox.data.data.some((m) => m.id === sent.data.data.id));
});

test('store owner replies and the customer receives it', async () => {
  const sent = await api(`/conversations/${conversationId}/messages`, {
    token: ownerToken,
    method: 'POST',
    body: { content: 'ตอบกลับเร็ว ๆ นี้', type: 'text' },
  });

  assert.equal(sent.status, 201);
  assert.equal(sent.data.data.sender_id, ownerId);

  const customerInbox = await api(`/conversations/${conversationId}/messages`, { token: customerToken });
  assert.equal(customerInbox.status, 200);
  assert.ok(customerInbox.data.data.some((m) => m.id === sent.data.data.id));
});

test('non-members cannot post a message (403) and nothing is written', async () => {
  const { status } = await api(`/conversations/${conversationId}/messages`, {
    token: outsiderToken,
    method: 'POST',
    body: { content: 'ฝ่าฝืน', type: 'text' },
  });
  assert.equal(status, 403);
  assert.ok(!currentFake.calls.some((c) => c.table === 'messages' && c.op === 'insert'));
});

test('both roles can attach files and the attachment reaches the message', async () => {
  const customerFile = await api(`/conversations/${conversationId}/messages`, {
    token: customerToken,
    method: 'POST',
    body: {
      type: 'image',
      attachments: [{
        url: 'https://cdn.example.com/customer.png',
        path: 'chat-attachments/conv/2026/01/customer.png',
        fileName: 'customer.png',
        fileSize: 1234,
        mimeType: 'image/png',
      }],
    },
  });
  assert.equal(customerFile.status, 201);

  const ownerFile = await api(`/conversations/${conversationId}/messages`, {
    token: ownerToken,
    method: 'POST',
    body: {
      type: 'file',
      attachments: [{
        file_url: 'https://cdn.example.com/price.pdf',
        file_name: 'price.pdf',
        file_size: 5678,
        mime_type: 'application/pdf',
      }],
    },
  });
  assert.equal(ownerFile.status, 201);

  const customerInbox = await api(`/conversations/${conversationId}/messages`, { token: customerToken });
  const fromOwner = customerInbox.data.data.find((m) => m.id === ownerFile.data.data.id);
  assert.equal(fromOwner.attachments.length, 1);
  assert.equal(fromOwner.attachments[0].file_url, 'https://cdn.example.com/price.pdf');
  assert.equal(fromOwner.attachments[0].file_name, 'price.pdf');
  assert.equal(fromOwner.attachments[0].file_size, 5678);
  assert.equal(fromOwner.attachments[0].mime_type, 'application/pdf');
});

test('an attachment without a url is rejected with 400', async () => {
  const { status } = await api(`/conversations/${conversationId}/messages`, {
    token: customerToken,
    method: 'POST',
    body: { type: 'file', attachments: [{ file_name: 'broken.pdf' }] },
  });
  assert.equal(status, 400);
});

// ---------------------------------------------------------------------------
// Read markers
// ---------------------------------------------------------------------------

test('marking a room read resets the caller unread count', async () => {
  const { status } = await api(`/conversations/${conversationId}/read`, {
    token: ownerToken,
    method: 'POST',
    body: { lastReadMessageId: msg1Id },
  });
  assert.equal(status, 200);

  const ownerMember = currentFake
    .dump('conversation_members')
    .find((m) => m.conversation_id === conversationId && m.profile_id === ownerId);
  assert.equal(ownerMember.unread_count, 0);
});

test('marking read with a message of another room is rejected with 400', async () => {
  const { status } = await api(`/conversations/${conversationId}/read`, {
    token: ownerToken,
    method: 'POST',
    body: { lastReadMessageId: otherMsgId },
  });
  assert.equal(status, 400);
});

test('marking read requires membership (403)', async () => {
  const { status } = await api(`/conversations/${conversationId}/read`, {
    token: outsiderToken,
    method: 'POST',
    body: { lastReadMessageId: msg1Id },
  });
  assert.equal(status, 403);
});

// ---------------------------------------------------------------------------
// Conversation creation
// ---------------------------------------------------------------------------

test('a customer can create (or reuse) a conversation with a store', async () => {
  const { status, data } = await api('/conversations', {
    token: customerToken,
    method: 'POST',
    body: { storeId },
  });
  assert.equal(status, 200);
  assert.equal(data.data.id, conversationId);

  const members = currentFake
    .dump('conversation_members')
    .filter((m) => m.conversation_id === data.data.id);
  assert.ok(members.some((m) => m.profile_id === customerId));
  assert.ok(members.some((m) => m.profile_id === ownerId && m.role === 'admin'));
});

test('creating a conversation requires a valid store id (400)', async () => {
  const { status } = await api('/conversations', {
    token: customerToken,
    method: 'POST',
    body: { storeId: 'not-a-uuid' },
  });
  assert.equal(status, 400);
});