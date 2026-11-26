// Unit tests for the chat service membership / message rules.
//
// These tests never touch Supabase: the client is replaced with an in-memory
// fake (see ./helpers/fakeSupabase.mjs) that records every write. They prove
// that only real conversation members can read, send, edit, delete or attach
// files to a conversation (the fix for the "Chat 403" and "Chat API 404" class
// of bugs), without weakening authorization.
//
// Run with:  npm --prefix backend test
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL ||= 'https://dummy.supabase.co';
process.env.SUPABASE_ANON_KEY ||= 'dummy-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'dummy-service-key';
process.env.JWT_SECRET ||= 'dummy-secret';

const { supabaseAdmin } = await import('../config/supabase.js');
const chatService = await import('../services/chatService.js');
const { AppError } = await import('../middleware/errorHandler.js');
const { installFakeSupabase } = await import('./helpers/fakeSupabase.mjs');

const {
  getConversationById,
  getMessages,
  sendMessage,
  markMessagesRead,
  editMessage,
  deleteMessage,
  uploadMessageAttachment,
  getOrCreateConversation,
  muteConversation,
  getUnreadCount,
  getUserConversations,
  getStoreConversations,
} = chatService;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const customerId = 'cust-11111111-1111-1111-1111-111111111111';
const ownerId = 'own-22222222-2222-2222-2222-222222222222';
const outsiderId = 'out-33333333-3333-3333-3333-333333333333';
const newCustomerId = 'new-77777777-7777-7777-7777-777777777777';
const storeId = 'store-44444444-4444-4444-4444-444444444444';
const emptyStoreId = 'store-99999999-9999-4999-8999-999999999999';
const conversationId = 'conv-55555555-5555-5555-5555-555555555555';
const otherConversationId = 'conv-66666666-6666-6666-6666-666666666666';

const iso = (offsetMs) => new Date(Date.now() + offsetMs).toISOString();

function makeSeed(overrides = {}) {
  return {
    profiles: [
      [customerId, { id: customerId, name: 'เธฅเธนเธเธเนเธฒ', role: 'customer', is_active: true }],
      [ownerId, { id: ownerId, name: 'เน€เธเนเธฒเธเธญเธเธฃเนเธฒเธ', role: 'seller', is_active: true }],
      [outsiderId, { id: outsiderId, name: 'เธเธเธเธญเธ', role: 'customer', is_active: true }],
      [newCustomerId, { id: newCustomerId, name: 'เธฅเธนเธเธเนเธฒเนเธซเธกเน', role: 'customer', is_active: true }],
    ],
    stores: [
      [storeId, { id: storeId, name: 'เธฃเนเธฒเธเธ—เธ”เธชเธญเธ', owner_id: ownerId, is_active: true }],
      [emptyStoreId, { id: emptyStoreId, name: 'เธฃเนเธฒเธเนเธกเนเธกเธตเธซเนเธญเธเนเธเธ—', owner_id: ownerId, is_active: true }],
    ],
    conversations: [
      [conversationId, { id: conversationId, type: 'store_customer', store_id: storeId, store_order_id: null, last_message_at: iso(-50000) }],
      [otherConversationId, { id: otherConversationId, type: 'store_customer', store_id: storeId, store_order_id: null, last_message_at: iso(-10000) }],
    ],
    conversation_members: [
      ['cm-1', { id: 'cm-1', conversation_id: conversationId, profile_id: customerId, role: 'member', left_at: null, unread_count: 0, last_read_at: null }],
      ['cm-2', { id: 'cm-2', conversation_id: conversationId, profile_id: ownerId, role: 'admin', left_at: null, unread_count: 2, last_read_at: null }],
      ['cm-3', { id: 'cm-3', conversation_id: otherConversationId, profile_id: ownerId, role: 'admin', left_at: null, unread_count: 0, last_read_at: null }],
    ],
    messages: [
      ['msg-1', { id: 'msg-1', conversation_id: conversationId, sender_id: customerId, type: 'text', content: 'เธชเธงเธฑเธชเธ”เธตเธเนเธฐ', is_deleted: false, created_at: iso(-100000) }],
      ['msg-2', { id: 'msg-2', conversation_id: conversationId, sender_id: ownerId, type: 'text', content: 'เธชเธงเธฑเธชเธ”เธตเธเธฃเธฑเธ เธกเธตเธญเธฐเนเธฃเนเธซเนเธเนเธงเธขเนเธซเธก', is_deleted: false, created_at: iso(-50000) }],
      ['msg-other-1', { id: 'msg-other-1', conversation_id: otherConversationId, sender_id: ownerId, type: 'text', content: 'เธเนเธญเธเธงเธฒเธกเนเธเธซเนเธญเธเธญเธทเนเธ', is_deleted: false, created_at: iso(-20000) }],
    ],
    message_attachments: [],
    notifications: [],
    ...overrides,
  };
}

function withFake(seed, fn) {
  const { fake, restore } = installFakeSupabase(supabaseAdmin, seed);
  return Promise.resolve()
    .then(() => fn(fake))
    .finally(() => restore());
}

const memberRow = (fake, conversation, profile) =>
  fake.dump('conversation_members').find(
    (m) => m.conversation_id === conversation && m.profile_id === profile
  );

// ---------------------------------------------------------------------------
// Read access
// ---------------------------------------------------------------------------

test('customer member can read their own conversation', () =>
  withFake(makeSeed(), async () => {
    const conv = await getConversationById(conversationId, customerId);
    assert.equal(conv.id, conversationId);
    assert.ok(conv.members.some((m) => m.profile_id === customerId && !m.left_at));
  }));

test('store owner (stores.owner_id) can read the conversation of their store', () =>
  withFake(makeSeed(), async () => {
    const conv = await getConversationById(conversationId, ownerId);
    assert.equal(conv.id, conversationId);
    assert.ok(conv.members.some((m) => m.profile_id === ownerId && !m.left_at));
    assert.equal(conv.store.owner_id, ownerId);
  }));

test('outsider who is not a member is rejected with 403', () =>
  withFake(makeSeed(), async () => {
    await assert.rejects(
      () => getConversationById(conversationId, outsiderId),
      (err) => err.statusCode === 403 && err.message === 'Not a member of this conversation'
    );
  }));

test('non-existent conversation returns 404, not 403', () =>
  withFake(makeSeed(), async () => {
    await assert.rejects(
      () => getConversationById('conv-00000000-0000-0000-0000-000000000000', customerId),
      (err) => err.statusCode === 404
    );
  }));

test('a member who left the conversation is no longer a member', () =>
  withFake(makeSeed({
    conversation_members: [
      ['cm-1', { id: 'cm-1', conversation_id: conversationId, profile_id: customerId, role: 'member', left_at: iso(0), unread_count: 0 }],
      ['cm-2', { id: 'cm-2', conversation_id: conversationId, profile_id: ownerId, role: 'admin', left_at: null, unread_count: 0 }],
    ],
  }), async () => {
    await assert.rejects(
      () => getConversationById(conversationId, customerId),
      (err) => err.statusCode === 403
    );
  }));

test('getMessages requires membership; outsider is rejected', () =>
  withFake(makeSeed(), async () => {
    await assert.rejects(
      () => getMessages(conversationId, outsiderId, { page: 1, limit: 50 }),
      (err) => err.statusCode === 403
    );
  }));

test('getMessages returns the conversation oldest message first', () =>
  withFake(makeSeed(), async () => {
    const list = await getMessages(conversationId, ownerId, { page: 1, limit: 50 });
    assert.equal(list.length, 2);
    assert.equal(list[0].content, 'เธชเธงเธฑเธชเธ”เธตเธเนเธฐ');
    assert.equal(list[1].content, 'เธชเธงเธฑเธชเธ”เธตเธเธฃเธฑเธ เธกเธตเธญเธฐเนเธฃเนเธซเนเธเนเธงเธขเนเธซเธก');
  }));

// ---------------------------------------------------------------------------
// Write access (customer -> store owner and back)
// ---------------------------------------------------------------------------

test('customer can send a message and the store owner receives it', () =>
  withFake(makeSeed(), async (fake) => {
    const message = await sendMessage(conversationId, customerId, {
      content: 'เธเนเธญเธเธงเธฒเธกเนเธซเธกเนเธเธฒเธเธฅเธนเธเธเนเธฒ',
      type: 'text',
      metadata: {},
    });

    assert.equal(message.sender_id, customerId);
    assert.ok(fake.calls.some((c) => c.table === 'messages' && c.op === 'insert'));

    const ownerView = await getMessages(conversationId, ownerId, { page: 1, limit: 50 });
    assert.ok(ownerView.some((m) => m.id === message.id && m.content === 'เธเนเธญเธเธงเธฒเธกเนเธซเธกเนเธเธฒเธเธฅเธนเธเธเนเธฒ'));
  }));

test('store owner can reply and the customer receives it', () =>
  withFake(makeSeed(), async () => {
    const message = await sendMessage(conversationId, ownerId, {
      content: 'เธ•เธญเธเธเธฅเธฑเธเธเธฒเธเน€เธเนเธฒเธเธญเธเธฃเนเธฒเธ',
      type: 'text',
      metadata: {},
    });

    assert.equal(message.sender_id, ownerId);

    const customerView = await getMessages(conversationId, customerId, { page: 1, limit: 50 });
    assert.ok(customerView.some((m) => m.id === message.id));
  }));

test('sendMessage with the same client_message_id is idempotent (no duplicate message)', () =>
  withFake(makeSeed(), async (fake) => {
    const clientMessageId = 'client-msg-123';
    const first = await sendMessage(conversationId, customerId, {
      content: 'ส่งครั้งแรก',
      type: 'text',
      metadata: {},
      client_message_id: clientMessageId,
    });
    const second = await sendMessage(conversationId, customerId, {
      content: 'ส่งครั้งที่สอง (client_message_id ซ้ำ)',
      type: 'text',
      metadata: {},
      client_message_id: clientMessageId,
    });

    assert.equal(second.id, first.id, 'retry returns the already-stored message');
    assert.equal(second.content, 'ส่งครั้งแรก', 'content is not overwritten by the retry');
    const inserts = fake.calls.filter((c) => c.table === 'messages' && c.op === 'insert');
    assert.equal(inserts.length, 1, 'only one message row is inserted');
  }));

test('sendMessage rejects outsider with 403 and writes nothing', () =>
  withFake(makeSeed(), async (fake) => {
    await assert.rejects(
      () => sendMessage(conversationId, outsiderId, { content: 'เธเนเธฒเธเธทเธ', type: 'text' }),
      (err) => err.statusCode === 403
    );
    assert.ok(!fake.calls.some((c) => c.table === 'messages' && c.op === 'insert'));
  }));

test('sendMessage rejects an empty message without attachments', () =>
  withFake(makeSeed(), async () => {
    await assert.rejects(
      () => sendMessage(conversationId, customerId, { content: '', type: 'text' }),
      (err) => err instanceof AppError && err.statusCode === 400
    );
  }));

// ---------------------------------------------------------------------------
// Attachments (both roles)
// ---------------------------------------------------------------------------

test('customer attachment is stored with canonical column names (upload response shape)', () =>
  withFake(makeSeed(), async (fake) => {
    const message = await sendMessage(conversationId, customerId, {
      type: 'image',
      content: undefined,
      attachments: [{
        url: 'https://cdn.example.com/chat.png',
        path: 'chat-attachments/conv/2026/01/chat.png',
        fileName: 'chat.png',
        fileSize: 2048,
        mimeType: 'image/png',
      }],
    });

    assert.equal(message.attachments.length, 1);
    assert.equal(message.attachments[0].file_url, 'https://cdn.example.com/chat.png');
    assert.equal(message.attachments[0].file_name, 'chat.png');
    assert.equal(message.attachments[0].file_size, 2048);
    assert.equal(message.attachments[0].mime_type, 'image/png');

    const stored = fake.dump('message_attachments');
    assert.equal(stored.length, 1);
    assert.equal(stored[0].message_id, message.id);
    assert.equal(stored[0].file_url, 'https://cdn.example.com/chat.png');
    assert.equal(stored[0].mime_type, 'image/png');
  }));

test('store owner attachment is stored with canonical column names', () =>
  withFake(makeSeed(), async (fake) => {
    const message = await sendMessage(conversationId, ownerId, {
      type: 'file',
      attachments: [{
        file_url: 'https://cdn.example.com/price.pdf',
        file_name: 'price.pdf',
        file_size: 4096,
        mime_type: 'application/pdf',
      }],
    });

    assert.equal(message.attachments[0].file_url, 'https://cdn.example.com/price.pdf');
    assert.equal(fake.dump('message_attachments').length, 1);

    const customerView = await getMessages(conversationId, customerId, { page: 1, limit: 50 });
    const received = customerView.find((m) => m.id === message.id);
    assert.equal(received.attachments[0].file_name, 'price.pdf');
  }));

test('an attachment without a file url is rejected', () =>
  withFake(makeSeed(), async () => {
    await assert.rejects(
      () => sendMessage(conversationId, customerId, {
        type: 'file',
        attachments: [{ file_name: 'broken.pdf' }],
      }),
      (err) => err instanceof AppError && err.statusCode === 400
    );
  }));

test('uploading an attachment to a message requires conversation membership', () =>
  withFake(makeSeed(), async () => {
    await assert.rejects(
      () => uploadMessageAttachment('msg-1', {
        file_url: 'https://cdn.example.com/x.png',
        file_name: 'x.png',
        file_size: 10,
        mime_type: 'image/png',
      }, outsiderId),
      (err) => err.statusCode === 403
    );

    const created = await uploadMessageAttachment('msg-1', {
      file_url: 'https://cdn.example.com/x.png',
      file_name: 'x.png',
      file_size: 10,
      mime_type: 'image/png',
    }, ownerId);
    assert.equal(created.file_name, 'x.png');
    assert.equal(created.message_id, 'msg-1');
  }));

test('uploading to a message that does not exist returns 404', () =>
  withFake(makeSeed(), async () => {
    await assert.rejects(
      () => uploadMessageAttachment('msg-missing', {
        file_url: 'https://cdn.example.com/x.png',
        file_name: 'x.png',
        file_size: 10,
        mime_type: 'image/png',
      }, ownerId),
      (err) => err.statusCode === 404
    );
  }));

// ---------------------------------------------------------------------------
// Read markers / unread counts
// ---------------------------------------------------------------------------

test('opening a room marks messages read and only resets the caller unread count', () =>
  withFake(makeSeed(), async (fake) => {
    await markMessagesRead(conversationId, ownerId, 'msg-1');

    const ownerMember = memberRow(fake, conversationId, ownerId);
    const customerMember = memberRow(fake, conversationId, customerId);

    assert.equal(ownerMember.unread_count, 0);
    // last_read_message_id is not a persisted column in the current schema

    assert.ok(ownerMember.last_read_at);
    assert.equal(customerMember.unread_count, 0);
    assert.equal(customerMember.last_read_at ?? null, null);
  }));

test('marking read with a message id from another conversation is rejected', () =>
  withFake(makeSeed(), async () => {
    await assert.rejects(
      () => markMessagesRead(conversationId, ownerId, 'msg-other-1'),
      (err) => err instanceof AppError && err.statusCode === 400
    );
  }));

test('marking read requires membership', () =>
  withFake(makeSeed(), async () => {
    await assert.rejects(
      () => markMessagesRead(conversationId, outsiderId, 'msg-1'),
      (err) => err.statusCode === 403
    );
  }));

test('unread count only adds up the caller own membership rows', () =>
  withFake(makeSeed(), async () => {
    assert.equal(await getUnreadCount(ownerId), 2);
    assert.equal(await getUnreadCount(customerId), 0);
    assert.equal(await getUnreadCount(outsiderId), 0);
  }));

test('muting requires membership', () =>
  withFake(makeSeed(), async () => {
    await assert.rejects(
      () => muteConversation(conversationId, outsiderId, true),
      (err) => err.statusCode === 403
    );

    await muteConversation(conversationId, customerId, true);
  }));

// ---------------------------------------------------------------------------
// Edit / delete
// ---------------------------------------------------------------------------

test('sender can edit their own message', () =>
  withFake(makeSeed(), async () => {
    const updated = await editMessage('msg-1', customerId, 'เนเธเนเนเธเนเธฅเนเธง');
    assert.equal(updated.content, 'เนเธเนเนเธเนเธฅเนเธง');
    assert.equal(updated.is_edited, true);
  }));

test('editing requires membership even for the sender of another room', () =>
  withFake(makeSeed(), async () => {
    await assert.rejects(
      () => editMessage('msg-1', outsiderId, 'hack'),
      (err) => err.statusCode === 403
    );
  }));

test('a member cannot edit a message written by another member', () =>
  withFake(makeSeed(), async () => {
    await assert.rejects(
      () => editMessage('msg-1', ownerId, 'เธเธฅเธญเธกเนเธเธฅเธ'),
      (err) => err.statusCode === 403
    );
  }));

test('sender can delete their own message', () =>
  withFake(makeSeed(), async (fake) => {
    await deleteMessage('msg-1', customerId);
    const messages = fake.dump('messages');
    assert.equal(messages.find((m) => m.id === 'msg-1').is_deleted, true);
  }));

test('a member cannot delete a message written by another member', () =>
  withFake(makeSeed(), async (fake) => {
    await assert.rejects(
      () => deleteMessage('msg-1', ownerId),
      (err) => err.statusCode === 403
    );
    assert.equal(fake.dump('messages').find((m) => m.id === 'msg-1').is_deleted, false);
  }));

test('deleting requires membership', () =>
  withFake(makeSeed(), async () => {
    await assert.rejects(
      () => deleteMessage('msg-1', outsiderId),
      (err) => err.statusCode === 403
    );
  }));

test('deleting an unknown message returns 404', () =>
  withFake(makeSeed(), async () => {
    await assert.rejects(
      () => deleteMessage('msg-missing', customerId),
      (err) => err.statusCode === 404
    );
  }));

// ---------------------------------------------------------------------------
// Conversation creation
// ---------------------------------------------------------------------------

test('getOrCreateConversation creates a room with the customer and the stores.owner_id as admin', () =>
  withFake(makeSeed(), async (fake) => {
    const conversation = await getOrCreateConversation(newCustomerId, storeId);

    assert.equal(conversation.type, 'store_customer');
    assert.equal(conversation.store_id, storeId);
    assert.equal(fake.dump('conversations').length, 3);

    const members = fake.dump('conversation_members').filter(
      (m) => m.conversation_id === conversation.id
    );
    assert.equal(members.length, 2);

    const customerMember = members.find((m) => m.profile_id === newCustomerId);
    const ownerMember = members.find((m) => m.profile_id === ownerId);
    assert.equal(customerMember.role, 'member');
    assert.equal(ownerMember.role, 'admin');
  }));

test('getOrCreateConversation reuses the existing conversation for the same customer', () =>
  withFake(makeSeed(), async (fake) => {
    const conversation = await getOrCreateConversation(customerId, storeId);
    assert.equal(conversation.id, conversationId);
    assert.equal(fake.dump('conversations').length, 2);
  }));

test('getOrCreateConversation returns 404 when the store does not exist', () =>
  withFake(makeSeed(), async () => {
    await assert.rejects(
      () => getOrCreateConversation(customerId, 'store-00000000-0000-0000-0000-000000000000'),
      (err) => err.statusCode === 404
    );
  }));

test('a store owner cannot create a customer conversation with their own store', () =>
  withFake(makeSeed(), async () => {
    await assert.rejects(
      () => getOrCreateConversation(ownerId, emptyStoreId),
      (err) => err instanceof AppError && err.statusCode === 400
    );
  }));
test('getUserConversations returns member conversations with latest message and unread_count', () =>
  withFake(makeSeed(), async () => {
    const result = await getUserConversations(ownerId, { page: 1, limit: 20 }, {});
    assert.equal(result.conversations.length, 2);
    const withLatest = result.conversations.find((c) => c.id === conversationId);
    const other = result.conversations.find((c) => c.id === otherConversationId);
    assert.ok(withLatest);
    assert.equal(withLatest.last_message.id, 'msg-2');
    assert.ok(withLatest.members.some((m) => m.profile_id === ownerId && m.unread_count === 2));
    assert.ok(other);
    assert.equal(other.last_message.id, 'msg-other-1');
    assert.equal(result.pagination.total, 2);
  }));

test('getUserConversations returns null last_message for empty rooms', () =>
  withFake(makeSeed({
    conversations: [
      [conversationId, { id: conversationId, type: 'store_customer', store_id: storeId, store_order_id: null, last_message_at: null }],
    ],
    messages: [],
  }), async () => {
    const result = await getUserConversations(customerId, { page: 1, limit: 20 }, {});
    assert.equal(result.conversations.length, 1);
    assert.equal(result.conversations[0].id, conversationId);
    assert.equal(result.conversations[0].last_message, null);
  }));

test('getUserConversations only returns conversations where user is an active member', () =>
  withFake(makeSeed(), async () => {
    const customerResult = await getUserConversations(customerId, { page: 1, limit: 20 }, {});
    assert.deepEqual(customerResult.conversations.map((c) => c.id), [conversationId]);
    const outsiderResult = await getUserConversations(outsiderId, { page: 1, limit: 20 }, {});
    assert.equal(outsiderResult.conversations.length, 0);
  }));

test('getStoreConversations returns conversations for owned store with latest messages', () =>
  withFake(makeSeed(), async () => {
    const result = await getStoreConversations(storeId, ownerId, { page: 1, limit: 20 }, {});
    assert.equal(result.conversations.length, 2);
    const conv = result.conversations.find((c) => c.id === conversationId);
    assert.equal(conv.last_message.id, 'msg-2');
    assert.ok(conv.members.some((m) => m.profile_id === ownerId));
  }));

test('getStoreConversations rejects non-owner', () =>
  withFake(makeSeed(), async () => {
    await assert.rejects(
      () => getStoreConversations(storeId, customerId, { page: 1, limit: 20 }, {}),
      (err) => err.statusCode === 403
    );
  }));
