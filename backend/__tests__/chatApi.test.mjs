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
// Order-chat messages whose metadata holds a STALE snapshot (payment pending)
// while the order row in the DB has already advanced to delivered / paid.
const codOrderId = 'aaaaaaaa-0000-4000-8000-000000000101';
const kbzOrderId = 'aaaaaaaa-0000-4000-8000-000000000102';
const codMsgId = 'aaaaaaaa-0000-4000-8000-000000000201';
const kbzMsgId = 'aaaaaaaa-0000-4000-8000-000000000202';

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
    orders: [
      [codOrderId, { id: codOrderId, order_number: 'ORD-TEST-COD', status: 'delivered', payment_status: 'paid', payment_method: 'cod', customer_id: customerId }],
      [kbzOrderId, { id: kbzOrderId, order_number: 'ORD-TEST-KBZ', status: 'delivered', payment_status: 'awaiting_review', payment_method: 'kbzpay', customer_id: customerId }],
    ],
    conversation_members: [
      ['cm-1', { id: 'cm-1', conversation_id: conversationId, profile_id: customerId, role: 'member', left_at: null, unread_count: 0, last_read_at: null }],
      ['cm-2', { id: 'cm-2', conversation_id: conversationId, profile_id: ownerId, role: 'admin', left_at: null, unread_count: 1, last_read_at: null }],
      ['cm-3', { id: 'cm-3', conversation_id: otherConversationId, profile_id: ownerId, role: 'admin', left_at: null, unread_count: 0, last_read_at: null }],
    ],
    messages: [
      [msg1Id, { id: msg1Id, conversation_id: conversationId, sender_id: customerId, type: 'text', content: 'สวัสดีค่ะ', is_deleted: false, created_at: iso(-100000) }],
      [msg2Id, { id: msg2Id, conversation_id: conversationId, sender_id: ownerId, type: 'text', content: 'สวัสดีครับ', is_deleted: false, created_at: iso(-50000) }],
      [codMsgId, { id: codMsgId, conversation_id: conversationId, sender_id: customerId, type: 'order_update', content: 'คำสั่งซื้อ #ORD-TEST-COD ... สถานะ: รอร้านค้ายืนยัน • รอชำระเงิน', is_deleted: false, created_at: iso(-30000), metadata: { kind: 'order_chat', order_id: codOrderId, order_number: 'ORD-TEST-COD', order_status: 'pending', order_status_label: 'รอร้านค้ายืนยัน', payment_status: 'pending', payment_status_label: 'รอชำระเงิน', payment_method: 'cod', payment_method_label: 'เก็บเงินปลายทาง (COD)' } }],
      [kbzMsgId, { id: kbzMsgId, conversation_id: conversationId, sender_id: customerId, type: 'order_update', content: 'คำสั่งซื้อ #ORD-TEST-KBZ ... สถานะ: รอร้านค้ายืนยัน • รอตรวจสอบสลิป', is_deleted: false, created_at: iso(-25000), metadata: { kind: 'order_chat', order_id: kbzOrderId, order_number: 'ORD-TEST-KBZ', order_status: 'pending', order_status_label: 'รอร้านค้ายืนยัน', payment_status: 'awaiting_review', payment_status_label: 'รอตรวจสอบสลิป', payment_method: 'kbzpay', payment_method_label: 'KBZPay' } }],
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

// ---------------------------------------------------------------------------
// Order-chat enrichment: stale chat snapshots are overwritten by the latest
// order data (orders table is the source of truth for payment status too).
// ---------------------------------------------------------------------------

test('GET messages refreshes order_chat payment_status from the orders table', async () => {
  const { status, data } = await api(`/conversations/${conversationId}/messages`, { token: customerToken });
  assert.equal(status, 200);

  const codMsg = data.data.find((m) => m.metadata?.order_id === codOrderId);
  assert.ok(codMsg, 'COD order-chat message should be returned');
  assert.equal(codMsg.metadata.order_status, 'delivered', 'order_status refreshed from orders table');
  assert.equal(codMsg.metadata.payment_status, 'paid', 'COD payment_status refreshed to paid');
  assert.equal(codMsg.metadata.payment_method, 'cod');
  assert.equal(codMsg.metadata.payment_status_label, 'ชำระแล้ว');
  assert.equal(codMsg.metadata.payment_method_label, 'เก็บเงินปลายทาง (COD)');

  const kbzMsg = data.data.find((m) => m.metadata?.order_id === kbzOrderId);
  assert.ok(kbzMsg, 'KBZPay order-chat message should be returned');
  assert.equal(kbzMsg.metadata.payment_status, 'awaiting_review', 'KBZPay payment_status kept as awaiting_review');
  assert.equal(kbzMsg.metadata.payment_method, 'kbzpay');
  assert.equal(kbzMsg.metadata.payment_status_label, 'รอตรวจสอบสลิป');
  assert.equal(kbzMsg.metadata.payment_method_label, 'KBZPay');

  // Non-order messages are untouched.
  const textMsg = data.data.find((m) => m.id === msg1Id);
  assert.equal(textMsg.metadata?.order_id, undefined);
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