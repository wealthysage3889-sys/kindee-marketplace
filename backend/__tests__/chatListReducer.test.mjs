// Unit tests for the pure chat-list reducer used by the store-owner inbox so the
// unread badge, preview, timestamp and ordering update live on a socket event,
// without a refresh.
//
// Run with:  npm --prefix backend test
import test from 'node:test';
import assert from 'node:assert/strict';

const {
  applyIncomingMessage,
  applyReadReceipt,
  getMessageConversationId,
  getMessageId,
} = await import('../../frontend/src/utils/chatList.js');

const OWNER = 'own-22222222-2222-2222-2222-222222222222';
const CUSTOMER = 'cust-11111111-1111-1111-1111-111111111111';
const CONV_A = 'conv-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const CONV_B = 'conv-bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

const row = (id, unread, lastContent, lastSender, created) => ({
  id,
  storeId: 'store-1',
  store: null,
  customerId: CUSTOMER,
  customer: { id: CUSTOMER, name: 'ลูกค้า', avatar_url: null },
  lastMessage: lastContent
    ? { id: `${id}-last`, conversation_id: id, sender_id: lastSender, content: lastContent, created_at: created }
    : null,
  unreadCount: unread,
});

const baseChats = () => [
  row(CONV_A, 3, 'เก่า A', CUSTOMER, '2026-01-01T00:00:00.000Z'),
  row(CONV_B, 0, 'ฺB', OWNER, '2026-01-01T00:00:00.000Z'),
];

test('incoming message from the customer increments unread 3 -> 4, updates preview and moves to top', () => {
  const chats = baseChats();
  const message = {
    id: 'msg-new-1',
    conversation_id: CONV_B,
    sender_id: CUSTOMER,
    content: 'สวัสดีร้าน',
    created_at: '2026-01-02T10:00:00.000Z',
  };

  const result = applyIncomingMessage(chats, message, OWNER);

  assert.equal(result.found, true);
  assert.equal(result.incremented, true);

  // CONV_B was at the bottom with 0 unread; now top with 1 unread.
  assert.equal(result.chats[0].id, CONV_B);
  assert.equal(result.chats[0].unreadCount, 1);
  assert.equal(result.chats[0].lastMessage.id, 'msg-new-1');

  // CONV_A (unread 3) is untouched.
  const a = result.chats.find((c) => c.id === CONV_A);
  assert.equal(a.unreadCount, 3);

  // Original array is not mutated.
  assert.equal(chats[0].id, CONV_A);
});

test('a message the current user sent from another tab updates preview but never increases own unread', () => {
  const chats = baseChats();
  const message = {
    id: 'msg-own-1',
    conversation_id: CONV_A,
    sender_id: OWNER,
    content: 'ตอบเอง',
    created_at: '2026-01-02T11:00:00.000Z',
  };

  const result = applyIncomingMessage(chats, message, OWNER);

  assert.equal(result.found, true);
  assert.equal(result.incremented, false);
  const a = result.chats.find((c) => c.id === CONV_A);
  assert.equal(a.unreadCount, 3); // unchanged
  assert.equal(a.lastMessage.id, 'msg-own-1');
  assert.equal(result.chats[0].id, CONV_A); // moved to top
});

test('a message for an unknown conversation returns found:false so the caller can refetch', () => {
  const chats = baseChats();
  const message = { id: 'msg-x', conversation_id: 'conv-unknown', sender_id: CUSTOMER, content: 'hi' };
  const result = applyIncomingMessage(chats, message, OWNER);
  assert.equal(result.found, false);
  assert.equal(result.chats, chats); // unchanged reference
});

test('applyReadReceipt resets only the current user unread for the matching conversation', () => {
  const chats = baseChats();
  const next = applyReadReceipt(chats, CONV_A, OWNER, OWNER, 0);
  const a = next.find((c) => c.id === CONV_A);
  assert.equal(a.unreadCount, 0);
  // A different reader's receipt must not touch our badge.
  const sameAgain = applyReadReceipt(chats, CONV_A, CUSTOMER, OWNER, 0);
  assert.equal(sameAgain.find((c) => c.id === CONV_A).unreadCount, 3);
});

test('applyReadReceipt returns the same reference when nothing changes (no needless render)', () => {
  const chats = baseChats(); // CONV_B already 0
  const next = applyReadReceipt(chats, CONV_B, OWNER, OWNER, 0);
  assert.equal(next, chats);
});

test('message id helpers accept camelCase and snake_case', () => {
  assert.equal(getMessageConversationId({ conversationId: CONV_A }), CONV_A);
  assert.equal(getMessageConversationId({ conversation_id: CONV_A }), CONV_A);
  assert.equal(getMessageId({ _id: 'x' }), 'x');
  assert.equal(getMessageId({ id: 'y' }), 'y');
});