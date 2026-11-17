import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL ||= 'https://dummy.supabase.co';
process.env.SUPABASE_ANON_KEY ||= 'dummy-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'dummy-service-key';
process.env.JWT_SECRET ||= 'dummy-secret';

const { supabaseAdmin } = await import('../config/supabase.js');
const { installFakeSupabase } = await import('./helpers/fakeSupabase.mjs');
const callService = await import('../services/callService.js');
const chatService = await import('../services/chatService.js');

const callerId = '11111111-1111-4111-8111-111111111111';
const calleeId = '22222222-2222-4222-8222-222222222222';
const conversationId = '44444444-4444-4444-8444-444444444444';

let currentFake;
let restoreFake;

function seedBase(overrides = {}) {
  return {
    profiles: [
      [callerId, { id: callerId, name: 'Caller', email: 'caller@test.com', avatar_url: null, role: 'customer', is_active: true }],
      [calleeId, { id: calleeId, name: 'Callee', email: 'callee@test.com', avatar_url: null, role: 'owner', is_active: true }],
    ],
    conversations: [
      [conversationId, { id: conversationId, type: 'store_customer', store_id: 's1', store_order_id: null }],
    ],
    conversation_members: [
      ['m1', { id: 'm1', conversation_id: conversationId, profile_id: callerId, role: 'member', left_at: null, unread_count: 0 }],
      ['m2', { id: 'm2', conversation_id: conversationId, profile_id: calleeId, role: 'admin', left_at: null, unread_count: 0 }],
    ],
    messages: [],
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

// ============================================================
// CALL LIFECYCLE TESTS
// ============================================================

test('acceptCall transitions ringing -> accepted with answered_at', async () => {
  const { data: call } = await supabaseAdmin
    .from('call_history')
    .insert({
      id: 'call-1',
      caller_id: callerId,
      callee_id: calleeId,
      conversation_id: conversationId,
      status: 'ringing',
      started_at: new Date().toISOString(),
    })
    .select()
    .single();

  const updated = await callService.acceptCall('call-1', calleeId);
  assert.equal(updated.status, 'accepted');
  assert.ok(updated.answered_at, 'answered_at must be set');
  assert.ok(updated.caller_heartbeat_at, 'caller heartbeat must be set');
  assert.ok(updated.callee_heartbeat_at, 'callee heartbeat must be set');
});

test('endCall computes duration from answered_at not started_at', async () => {
  const answeredAt = new Date(Date.now() - 120000).toISOString(); // 2 min ago
  const startedAt = new Date(Date.now() - 180000).toISOString(); // 3 min ago

  await supabaseAdmin.from('call_history').insert({
    id: 'call-2',
    caller_id: callerId,
    callee_id: calleeId,
    conversation_id: conversationId,
    status: 'accepted',
    started_at: startedAt,
    answered_at: answeredAt,
  });

  const result = await callService.endCall('call-2', callerId);
  // Duration should be ~120 seconds (from answered_at to now), NOT ~180 (from started_at)
  assert.ok(result.duration_seconds >= 115 && result.duration_seconds <= 125,
    `Expected ~120s duration from answered_at, got ${result.duration_seconds}s`);
  assert.equal(result.status, 'completed');
  assert.equal(result.end_reason, 'ended');
});

test('endCall on ringing call marks as cancelled', async () => {
  await supabaseAdmin.from('call_history').insert({
    id: 'call-3',
    caller_id: callerId,
    callee_id: calleeId,
    conversation_id: conversationId,
    status: 'ringing',
    started_at: new Date().toISOString(),
  });

  const result = await callService.endCall('call-3', callerId);
  assert.equal(result.status, 'cancelled');
  assert.equal(result.end_reason, 'cancelled');
  assert.equal(result.duration_seconds, 0);
});

test('cancelCall transitions ringing -> cancelled', async () => {
  await supabaseAdmin.from('call_history').insert({
    id: 'call-4',
    caller_id: callerId,
    callee_id: calleeId,
    conversation_id: conversationId,
    status: 'ringing',
    started_at: new Date().toISOString(),
  });

  const result = await callService.cancelCall('call-4', callerId);
  assert.equal(result.status, 'cancelled');
  assert.equal(result.end_reason, 'cancelled');
  assert.ok(result.ended_at);
});

test('cancelCall fails when callee tries to cancel', async () => {
  await supabaseAdmin.from('call_history').insert({
    id: 'call-5',
    caller_id: callerId,
    callee_id: calleeId,
    conversation_id: conversationId,
    status: 'ringing',
    started_at: new Date().toISOString(),
  });

  await assert.rejects(
    () => callService.cancelCall('call-5', calleeId),
    { statusCode: 404 }
  );
});

test('cancelCall fails when call is already accepted', async () => {
  await supabaseAdmin.from('call_history').insert({
    id: 'call-6',
    caller_id: callerId,
    callee_id: calleeId,
    conversation_id: conversationId,
    status: 'accepted',
    started_at: new Date().toISOString(),
    answered_at: new Date().toISOString(),
  });

  await assert.rejects(
    () => callService.cancelCall('call-6', callerId),
    { statusCode: 409 }
  );
});

test('rejectCall transitions ringing -> rejected', async () => {
  await supabaseAdmin.from('call_history').insert({
    id: 'call-7',
    caller_id: callerId,
    callee_id: calleeId,
    conversation_id: conversationId,
    status: 'ringing',
    started_at: new Date().toISOString(),
  });

  const result = await callService.rejectCall('call-7', calleeId);
  assert.equal(result.status, 'rejected');
  assert.equal(result.end_reason, 'rejected');
  assert.ok(result.ended_at);
});

test('endCall creates system message in conversation', async () => {
  await supabaseAdmin.from('call_history').insert({
    id: 'call-8',
    caller_id: callerId,
    callee_id: calleeId,
    conversation_id: conversationId,
    status: 'accepted',
    started_at: new Date(Date.now() - 60000).toISOString(),
    answered_at: new Date(Date.now() - 55000).toISOString(),
  });

  await callService.endCall('call-8', callerId);

  const messages = currentFake.dump('messages');
  const callMsg = messages.find(m => m.type === 'voice_call');
  assert.ok(callMsg, 'A voice_call system message should be created');
  assert.ok(callMsg.content.includes('สนทนาสำเร็จ'), 'Message should include Thai status label');
});

test('expireStaleCalls marks ringing calls as no_answer', async () => {
  const staleTime = new Date(Date.now() - 120000).toISOString(); // 2 min ago

  await supabaseAdmin.from('call_history').insert({
    id: 'call-stale-1',
    caller_id: callerId,
    callee_id: calleeId,
    conversation_id: conversationId,
    status: 'ringing',
    started_at: staleTime,
    created_at: staleTime,
  });

  const expired = await callService.expireStaleCalls();
  assert.ok(expired >= 1, 'At least one stale call should be expired');

  const rows = currentFake.dump('call_history');
  const stale = rows.find(r => r.id === 'call-stale-1');
  assert.equal(stale.status, 'no_answer');
  assert.equal(stale.end_reason, 'no_answer');
});

test('endCall prevents double-ending', async () => {
  await supabaseAdmin.from('call_history').insert({
    id: 'call-9',
    caller_id: callerId,
    callee_id: calleeId,
    conversation_id: conversationId,
    status: 'accepted',
    started_at: new Date().toISOString(),
    answered_at: new Date().toISOString(),
  });

  await callService.endCall('call-9', callerId);

  await assert.rejects(
    () => callService.endCall('call-9', callerId),
    { statusCode: 409 }
  );
});

test('after endCall user can initiate a new call', async () => {
  // Create and end a call
  await supabaseAdmin.from('call_history').insert({
    id: 'call-old',
    caller_id: callerId,
    callee_id: calleeId,
    conversation_id: conversationId,
    status: 'accepted',
    started_at: new Date().toISOString(),
    answered_at: new Date().toISOString(),
  });
  await callService.endCall('call-old', callerId);

  // Now initiate a new call - should succeed
  const newCall = await callService.initiateCall(callerId, calleeId, conversationId);
  assert.equal(newCall.status, 'ringing');
  assert.notEqual(newCall.id, 'call-old');
});

// ============================================================
// CHAT UNREAD BADGE TESTS
// ============================================================

test('sendMessage increments unread for other conversation members', async () => {
  await chatService.sendMessage(conversationId, callerId, { content: 'สวัสดี' });

  // Callee should have unread_count = 1
  const members = currentFake.dump('conversation_members');
  const calleeMember = members.find(m => m.profile_id === calleeId);
  assert.equal(calleeMember.unread_count, 1, 'Callee should have 1 unread message');
});

test('sendMessage does NOT increment unread for sender', async () => {
  await chatService.sendMessage(conversationId, callerId, { content: 'สวัสดี' });

  const members = currentFake.dump('conversation_members');
  const callerMember = members.find(m => m.profile_id === callerId);
  assert.equal(callerMember.unread_count, 0, 'Sender should have 0 unread');
});

test('multiple messages increment unread correctly', async () => {
  await chatService.sendMessage(conversationId, callerId, { content: 'ข้อความ 1' });
  await chatService.sendMessage(conversationId, callerId, { content: 'ข้อความ 2' });
  await chatService.sendMessage(conversationId, callerId, { content: 'ข้อความ 3' });

  const members = currentFake.dump('conversation_members');
  const calleeMember = members.find(m => m.profile_id === calleeId);
  assert.equal(calleeMember.unread_count, 3, 'Callee should have 3 unread messages');
});

test('markMessagesRead resets unread for that conversation only', async () => {
  // Create two conversations with unread messages
  const conv2 = '55555555-5555-4555-8555-555555555555';
  await supabaseAdmin.from('conversations').insert({
    id: conv2, type: 'store_customer', store_id: 's2', store_order_id: null,
  });
  await supabaseAdmin.from('conversation_members').insert([
    { conversation_id: conv2, profile_id: callerId, role: 'member', unread_count: 5 },
    { conversation_id: conv2, profile_id: calleeId, role: 'admin', unread_count: 3 },
  ]);

  // Send messages to both conversations
  await chatService.sendMessage(conversationId, callerId, { content: 'hello' });
  await chatService.sendMessage(conv2, callerId, { content: 'hello 2' });

  // Mark conversation 1 as read for callee
  const msgs = await chatService.getMessages(conversationId, calleeId, { page: 1, limit: 50 });
  const lastMsg = msgs[msgs.length - 1];
  await chatService.markMessagesRead(conversationId, calleeId, lastMsg.id);

  // Check: conv1 callee unread = 0, conv2 callee unread still > 0
  const members = currentFake.dump('conversation_members');
  const conv1Callee = members.find(m => m.conversation_id === conversationId && m.profile_id === calleeId);
  const conv2Callee = members.find(m => m.conversation_id === conv2 && m.profile_id === calleeId);
  assert.equal(conv1Callee.unread_count, 0, 'Conv 1 callee unread should be 0 after read');
  assert.ok(conv2Callee.unread_count > 0, 'Conv 2 callee unread should NOT be reset');
});

test('getUnreadCount sums unread across all conversations for user', async () => {
  const conv2 = '55555555-5555-4555-8555-555555555555';
  await supabaseAdmin.from('conversations').insert({
    id: conv2, type: 'store_customer', store_id: 's2', store_order_id: null,
  });
  await supabaseAdmin.from('conversation_members').insert([
    { conversation_id: conv2, profile_id: callerId, role: 'member', unread_count: 4 },
    { conversation_id: conv2, profile_id: calleeId, role: 'admin', unread_count: 0 },
  ]);

  await chatService.sendMessage(conversationId, callerId, { content: 'test' });
  await chatService.sendMessage(conv2, callerId, { content: 'test 2' });

  const unread = await chatService.getUnreadCount(calleeId);
  assert.ok(unread >= 2, `Expected at least 2 unread for callee, got ${unread}`);
});

test('getUnreadCount returns 0 when all messages are read', async () => {
  await chatService.sendMessage(conversationId, callerId, { content: 'test' });

  const msgs = await chatService.getMessages(conversationId, calleeId, { page: 1, limit: 50 });
  const lastMsg = msgs[msgs.length - 1];
  await chatService.markMessagesRead(conversationId, calleeId, lastMsg.id);

  const unread = await chatService.getUnreadCount(calleeId);
  assert.equal(unread, 0);
});

test('sendMessage updates last_message_at on conversation', async () => {
  await chatService.sendMessage(conversationId, callerId, { content: 'test' });

  const convs = currentFake.dump('conversations');
  const conv = convs.find(c => c.id === conversationId);
  assert.ok(conv.last_message_at, 'last_message_at should be updated');
});

test('sendMessage validates conversation membership', async () => {
  const outsiderId = '99999999-9999-4999-8999-999999999999';

  await assert.rejects(
    () => chatService.sendMessage(conversationId, outsiderId, { content: 'test' }),
    { statusCode: 403 }
  );
});