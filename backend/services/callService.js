import { supabaseAdmin } from '../config/supabase.js';
import { AppError, NotFoundError, ValidationError } from '../middleware/errorHandler.js';
import { v4 as uuidv4 } from 'uuid';
import { emitIncomingCall, emitCallEnded, emitToUser, emitToConversation } from './socketService.js';

// Get WebRTC configuration
export const getWebRTCConfig = async () => {
  const { data: settings } = await supabaseAdmin
    .from('settings')
    .select('value')
    .in('key', ['stun_server_urls', 'turn_server_urls', 'turn_username', 'turn_credential']);
  
  const config = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' }
    ]
  };
  
  for (const setting of settings || []) {
    if (setting.key === 'stun_server_urls') {
      config.iceServers = setting.value.map(url => ({ urls: url }));
    } else if (setting.key === 'turn_server_urls') {
      config.iceServers.push(...setting.value.map(url => ({
        urls: url,
        username: settings.find(s => s.key === 'turn_username')?.value,
        credential: settings.find(s => s.key === 'turn_credential')?.value
      })));
    }
  }
  
  return config;
};

// An absent/null id means the call is not bound to a conversation or order.
const optionalId = (value) => (value === undefined || value === null ? null : value);

// A ringing call that nobody answered/ended (tab closed, socket dropped, device
// offline) would otherwise block every later call between the same two users
// with "Call already in progress" forever, because no code path closes it.
// Once it is this old it is considered abandoned.
const RINGING_TIMEOUT_MS = Number(process.env.CALL_RINGING_TIMEOUT_MS) > 0
  ? Number(process.env.CALL_RINGING_TIMEOUT_MS)
  : 60 * 1000;

// Heartbeat window for accepted calls. Each participant must refresh their
// side's heartbeat within this window, otherwise their side is considered
// silent. A call is only auto-ended when BOTH sides are silent beyond the
// grace period — a temporary network blip on one side never cuts the call.
const HEARTBEAT_INTERVAL_MS = Number(process.env.CALL_HEARTBEAT_INTERVAL_MS) > 0
  ? Number(process.env.CALL_HEARTBEAT_INTERVAL_MS)
  : 15 * 1000;

// How long a single side may stay silent before being marked stale.
const HEARTBEAT_STALE_MS = Number(process.env.CALL_HEARTBEAT_STALE_MS) > 0
  ? Number(process.env.CALL_HEARTBEAT_STALE_MS)
  : 45 * 1000;

// Close abandoned ringing calls and return how many were closed.
export const expireStaleCalls = async () => {
  const cutoff = new Date(Date.now() - RINGING_TIMEOUT_MS).toISOString();
  const { data: stale } = await supabaseAdmin
    .from('call_history')
    .select('id, caller_id, callee_id, conversation_id')
    .eq('status', 'ringing')
    .lt('created_at', cutoff)
    .limit(100);
  if (!stale || stale.length === 0) return 0;

  await supabaseAdmin
    .from('call_history')
    .update({ status: 'no_answer', ended_at: new Date().toISOString(), end_reason: 'no_answer' })
    .eq('status', 'ringing')
    .lt('created_at', cutoff);

  for (const call of stale) {
    emitToUser(call.caller_id, 'callEnded', { call_id: call.id, status: 'no_answer' });
    emitToUser(call.callee_id, 'callEnded', { call_id: call.id, status: 'no_answer' });
    // Notify conversation room so chat history updates in real-time
    if (call.conversation_id) {
      emitCallStatusUpdate(call.conversation_id, call.caller_id, call.callee_id, 'no_answer', call.id);
    }
  }
  return stale.length;
};

// Close accepted calls where BOTH participants have been silent beyond the
// stale window. A call with at least one side sending heartbeat is kept alive
// regardless of how long the conversation has lasted (even past 5 minutes).
//
// NULL heartbeats are treated as stale: a call accepted before the heartbeat
// columns existed (or where the client never sent a heartbeat) must not block
// new calls forever. PostgREST chains `.or()` filters with AND, so two
// separate `.or()` calls express "(caller stale OR NULL) AND (callee stale OR NULL)".
export const expireStaleAcceptedCalls = async () => {
  const now = new Date().toISOString();
  const cutoff = new Date(Date.now() - HEARTBEAT_STALE_MS).toISOString();
  const { data: stale } = await supabaseAdmin
    .from('call_history')
    .select('id, caller_id, callee_id, started_at, answered_at')
    .eq('status', 'accepted')
    .or(`caller_heartbeat_at.lt.${cutoff},caller_heartbeat_at.is.null`)
    .or(`callee_heartbeat_at.lt.${cutoff},callee_heartbeat_at.is.null`)
    .limit(100);
  if (!stale || stale.length === 0) return 0;

  await supabaseAdmin
    .from('call_history')
    .update({
      status: 'ended',
      ended_at: now,
      end_reason: 'network_error',
      duration_seconds: stale.map(c => {
        const started = new Date(c.answered_at || c.started_at || now).getTime();
        return Math.floor((Date.now() - started) / 1000);
      })[0]
    })
    .eq('status', 'accepted')
    .or(`caller_heartbeat_at.lt.${cutoff},caller_heartbeat_at.is.null`)
    .or(`callee_heartbeat_at.lt.${cutoff},callee_heartbeat_at.is.null`);

  for (const call of stale) {
    emitToUser(call.caller_id, 'callEnded', { call_id: call.id, status: 'ended', end_reason: 'network_error' });
    emitToUser(call.callee_id, 'callEnded', { call_id: call.id, status: 'ended', end_reason: 'network_error' });
  }
  return stale.length;
};

// Refresh the heartbeat timestamp for one side of an accepted call.
// Returns true if the heartbeat was recorded, false if the call is no longer
// accepted or the user is not a participant.
export const heartbeatCall = async (callId, userId) => {
  const { data: call } = await supabaseAdmin
    .from('call_history')
    .select('id, caller_id, callee_id, status, conversation_id')
    .eq('id', callId)
    .eq('status', 'accepted')
    .single();

  if (!call) {
    return false;
  }

  // Revalidate conversation membership for linked conversations.
  if (call.conversation_id) {
    const { data: member } = await supabaseAdmin
      .from('conversation_members')
      .select('id')
      .eq('conversation_id', call.conversation_id)
      .eq('profile_id', userId)
      .is('left_at', null)
      .maybeSingle();
    if (!member) return false;
  }
  
  const heartbeatColumn = userId === call.caller_id ? 'caller_heartbeat_at'
    : userId === call.callee_id ? 'callee_heartbeat_at'
    : null;
  if (!heartbeatColumn) {
    return false;
  }
  
  const { error } = await supabaseAdmin
    .from('call_history')
    .update({ [heartbeatColumn]: new Date().toISOString() })
    .eq('id', callId)
    .eq('status', 'accepted');
  
  return !error;
};

// Initiate call
export const initiateCall = async (callerId, calleeId, conversationId = null, storeOrderId = null, callType = 'voice') => {
  conversationId = optionalId(conversationId);
  storeOrderId = optionalId(storeOrderId);
  // Check if callee exists and is active
  const { data: callee } = await supabaseAdmin
    .from('profiles')
    .select('id, name, avatar_url, is_active')
    .eq('id', calleeId)
    .single();
  
  if (!callee || !callee.is_active) {
    throw new ValidationError('Callee not available');
  }
  
  // Expire abandoned calls first so they cannot block a new call indefinitely.
  await expireStaleCalls();
  await expireStaleAcceptedCalls();

  // Check for existing active call between these users (either direction), or any
  // active call either participant is already involved in, so a user already on a
  // call cannot start/accept a second overlapping call.
  const { data: existingCalls } = await supabaseAdmin
    .from('call_history')
    .select('id')
    .in('status', ['ringing', 'accepted'])
    .or(`caller_id.eq.${callerId},callee_id.eq.${callerId},caller_id.eq.${calleeId},callee_id.eq.${calleeId}`)
    .limit(1);
  
  if (existingCalls && existingCalls.length > 0) {
    throw new ValidationError('Call already in progress');
  }
  
  // Verify both parties are active members of the bound conversation (if any)
  // so a user who is not a conversation participant cannot start a call.
  if (conversationId) {
    for (const memberId of [callerId, calleeId]) {
      const { data: member } = await supabaseAdmin
        .from('conversation_members')
        .select('id')
        .eq('conversation_id', conversationId)
        .eq('profile_id', memberId)
        .is('left_at', null)
        .single();
      if (!member) {
        throw new AppError('ผู้ใช้ไม่ใช่สมาชิกในการสนทนานี้', 403);
      }
    }
  }
  
  // Create call record
  const callId = uuidv4();
  const { data: call, error } = await supabaseAdmin
    .from('call_history')
    .insert({
      id: callId,
      caller_id: callerId,
      callee_id: calleeId,
      conversation_id: conversationId,
      store_order_id: storeOrderId,
      status: 'ringing',
      started_at: new Date().toISOString(),
      metadata: { call_type: callType }
    })
    .select()
    .single();
  
  if (error) {
    throw new AppError(`Call creation failed: ${error.message}`, 500);
  }
  
  // Get caller info for notification
  const { data: caller } = await supabaseAdmin
    .from('profiles')
    .select('name, avatar_url')
    .eq('id', callerId)
    .single();
  
// Create notification for callee
  await supabaseAdmin.rpc('create_notification', {
    p_recipient_id: calleeId,
    p_type: 'incoming_call',
    p_title: 'Incoming call',
    p_body: `${caller?.name || 'Someone'} is calling you`,
    p_data: { 
      call_id: callId, 
      caller_id: callerId, 
      caller_name: caller?.name,
      caller_avatar: caller?.avatar_url,
      conversation_id: conversationId,
      store_order_id: storeOrderId,
      call_type: callType
    },
    p_related_id: callId,
    p_related_type: 'call'
  });

  // Push the incoming-call event over Socket.IO so the callee's IncomingCallHandler
  // rings immediately. Without this the notification only lands in the DB and the
  // callee would need to poll /notifications to see it.
  emitIncomingCall(calleeId, {
    call_id: callId,
    caller_id: callerId,
    callee_id: calleeId,
    caller_name: caller?.name,
    caller_avatar: caller?.avatar_url,
    conversation_id: conversationId,
    store_order_id: storeOrderId,
    call_type: callType
  });

  return call;
};

// Accept call
export const acceptCall = async (callId, userId) => {
  // Look up the call regardless of current status so we can report the right
  // error (404 unknown vs 409 already-handled) instead of conflating them.
  const { data: call } = await supabaseAdmin
    .from('call_history')
    .select('*')
    .eq('id', callId)
    .eq('callee_id', userId)
    .single();
  
  if (!call) {
    throw new NotFoundError('Call');
  }

  // Verify conversation membership so only participants can accept.
  if (call.conversation_id) {
    for (const memberId of [call.caller_id, call.callee_id]) {
      const { data: member } = await supabaseAdmin
        .from('conversation_members')
        .select('id')
        .eq('conversation_id', call.conversation_id)
        .eq('profile_id', memberId)
        .is('left_at', null)
        .single();
      if (!member) {
        throw new AppError('ผู้ใช้ไม่ใช่สมาชิกในการสนทนานี้', 403);
      }
    }
  }

  // An abandoned ringing call must not be answerable later.
  if (call.status === 'ringing') {
    const ageMs = Date.now() - new Date(call.created_at || call.started_at || 0).getTime();
    if (ageMs > RINGING_TIMEOUT_MS) {
      await supabaseAdmin
        .from('call_history')
        .update({ status: 'no_answer', ended_at: new Date().toISOString(), end_reason: 'no_answer' })
        .eq('id', callId);
      throw new AppError('สายนี้หมดอายุแล้ว', 410);
    }
  }
  
  const now = new Date().toISOString();

  // Atomic transition: only succeeds if the call is still ringing. Prevents
  // two concurrent accept/reject/end requests from double-transitioning.
  const { data: updatedCall, error } = await supabaseAdmin
    .from('call_history')
    .update({ 
      status: 'accepted', 
      answered_at: now,
      caller_heartbeat_at: now,
      callee_heartbeat_at: now,
    })
    .eq('id', callId)
    .eq('callee_id', userId)
    .eq('status', 'ringing')
    .select()
    .single();
  
  if (error || !updatedCall) {
    throw new AppError('สายนี้ถูกรับหรือจบไปแล้วโดยผู้ใช้อื่น', 409);
  }

  // Tell the caller that the callee picked up. Do NOT emit callEnded here:
  // callEnded(accepted) previously tore down the WebRTC peer connection on
  // both sides right when the call should be connecting.
  emitToUser(call.caller_id, 'callAccepted', { call_id: callId, accepted_by: userId });

  // Emit to conversation room so chat shows "accepted" status in real-time
  if (call.conversation_id) {
    emitCallStatusUpdate(call.conversation_id, call.caller_id, call.callee_id, 'accepted', callId);
  }

  return updatedCall;
};

// Reject call
export const rejectCall = async (callId, userId) => {
  // Look up the call regardless of current status so we can report 409
  // (already handled) instead of 404 when a concurrent request changed it.
  const { data: call } = await supabaseAdmin
    .from('call_history')
    .select('*')
    .eq('id', callId)
    .eq('callee_id', userId)
    .single();
  
  if (!call) {
    throw new NotFoundError('Call');
  }
  
  const now = new Date().toISOString();

  // Atomic transition: only succeeds if the call is still ringing and belongs to
  // this callee. Prevents double-reject and reject-after-accept races.
  const { data: updatedCall, error } = await supabaseAdmin
    .from('call_history')
    .update({ 
      status: 'rejected', 
      ended_at: now,
      end_reason: 'rejected'
    })
    .eq('id', callId)
    .eq('callee_id', userId)
    .eq('status', 'ringing')
    .select()
    .single();
  
  if (error || !updatedCall) {
    throw new AppError('สายนี้ถูกดำเนินการไปแล้ว', 409);
  }

  // Notify the caller that the callee declined.
  // `call_id` is included so the client can match the event to its active call
  // and ignore stale events from a previous call (multi-tab / reconnect).
  emitCallEnded(callId, { call_id: callId, status: 'rejected', rejected_by: userId });
  emitToUser(call.caller_id, 'callRejected', { call_id: callId, rejected_by: userId });

  // Emit to conversation room for call history display
  if (call.conversation_id) {
    emitCallStatusUpdate(call.conversation_id, call.caller_id, call.callee_id, 'rejected', callId);
    await createCallSystemMessage(call, 'rejected', 0);
  }

  // Create missed call notification for caller
  await supabaseAdmin.rpc('create_notification', {
    p_recipient_id: call.caller_id,
    p_type: 'missed_call',
    p_title: 'สายถูกปฏิเสธ',
    p_body: 'ปลายทางปฏิเสธสาย',
    p_data: { call_id: callId, rejected_by: userId },
    p_related_id: callId,
    p_related_type: 'call'
  });

  return updatedCall;
};

// End call (caller or callee hangs up)
export const endCall = async (callId, userId) => {
  // Look up the call regardless of current status so we can report 409
  // (already ended) instead of 404 when a concurrent request changed it.
  const { data: call } = await supabaseAdmin
    .from('call_history')
    .select('*')
    .eq('id', callId)
    .or(`caller_id.eq.${userId},callee_id.eq.${userId}`)
    .single();

  if (!call) {
    throw new NotFoundError('Call');
  }

  const endedAt = new Date();

  // Duration: only count talk time (answered_at → ended_at).
  // Never count ringing time. If never accepted, duration = 0.
  let duration = 0;
  if (call.status === 'accepted' && call.answered_at) {
    duration = Math.floor((endedAt - new Date(call.answered_at)) / 1000);
  }

  // Determine end status:
  // - ringing + caller ends → cancelled (caller cancelled before answer)
  // - ringing + callee ends → no_answer (callee didn't answer)
  // - accepted → completed (normal hang-up)
  let endStatus;
  let endReason;
  if (call.status === 'ringing') {
    const isCaller = call.caller_id === userId;
    endStatus = isCaller ? 'cancelled' : 'no_answer';
    endReason = isCaller ? 'cancelled' : 'no_answer';
  } else {
    endStatus = 'completed';
    endReason = 'ended';
  }

  // Atomic transition: only succeeds if the call is still ringing/accepted and
  // the requesting user is a participant. Prevents double-end and end-by-other-user.
  const { data: updatedCall, error } = await supabaseAdmin
    .from('call_history')
    .update({
      status: endStatus,
      ended_at: endedAt.toISOString(),
      duration_seconds: duration,
      end_reason: endReason
    })
    .eq('id', callId)
    .or(`caller_id.eq.${userId},callee_id.eq.${userId}`)
    .in('status', ['ringing', 'accepted'])
    .select()
    .single();

  if (error || !updatedCall) {
    throw new AppError('สายนี้ถูกจบไปแล้วหรือไม่ใช่สายของคุณ', 409);
  }

  // Broadcast end to everyone in the call room and to each participant's user room.
  // `call_id` is included in every payload so the client can confirm the event
  // belongs to its active call before tearing down (guards against stale events).
  emitCallEnded(callId, { call_id: callId, status: endStatus, ended_by: userId, duration_seconds: duration, end_reason: endReason });
  emitToUser(call.caller_id, 'callEnded', { call_id: callId, status: endStatus, ended_by: userId, duration_seconds: duration, end_reason: endReason });
  emitToUser(call.callee_id, 'callEnded', { call_id: callId, status: endStatus, ended_by: userId, duration_seconds: duration, end_reason: endReason });

  // Emit to conversation room so call history updates in chat in real-time
  if (call.conversation_id) {
    emitCallStatusUpdate(call.conversation_id, call.caller_id, call.callee_id, endStatus, callId, duration);
    // Create a system message in the conversation for call history
    await createCallSystemMessage(call, endStatus, duration);
  }

  // Create notification for missed/no_answer/cancelled calls
  if (endStatus === 'no_answer' || endStatus === 'cancelled') {
    const otherUserId = call.caller_id === userId ? call.callee_id : call.caller_id;
    const notifTitle = endStatus === 'no_answer' ? 'ไม่ได้รับสาย' : 'สายถูกยกเลิก';
    await supabaseAdmin.rpc('create_notification', {
      p_recipient_id: otherUserId,
      p_type: 'missed_call',
      p_title: notifTitle,
      p_body: endStatus === 'no_answer' ? 'คุณไม่ได้รับสาย' : 'สายถูก�กเลิก',
      p_data: { call_id: callId, status: endStatus },
      p_related_id: callId,
      p_related_type: 'call'
    });
  }

  return updatedCall;
};

// Cancel call (caller cancels before callee answers)
export const cancelCall = async (callId, userId) => {
  const { data: call } = await supabaseAdmin
    .from('call_history')
    .select('*')
    .eq('id', callId)
    .eq('caller_id', userId)
    .single();

  if (!call) {
    throw new NotFoundError('Call');
  }

  if (call.status !== 'ringing') {
    throw new AppError('ไม่สามารถยกเลิกสายได้ เนื่องจากสายนี้ถูกรับหรือจบไปแล้ว', 409);
  }

  const now = new Date().toISOString();

  const { data: updatedCall, error } = await supabaseAdmin
    .from('call_history')
    .update({
      status: 'cancelled',
      ended_at: now,
      end_reason: 'cancelled'
    })
    .eq('id', callId)
    .eq('caller_id', userId)
    .eq('status', 'ringing')
    .select()
    .single();

  if (error || !updatedCall) {
    throw new AppError('สายนี้ถูกดำเนินการไปแล้ว', 409);
  }

  emitCallEnded(callId, { call_id: callId, status: 'cancelled', cancelled_by: userId });
  emitToUser(call.callee_id, 'callEnded', { call_id: callId, status: 'cancelled', cancelled_by: userId });

  if (call.conversation_id) {
    emitCallStatusUpdate(call.conversation_id, call.caller_id, call.callee_id, 'cancelled', callId);
    await createCallSystemMessage(call, 'cancelled', 0);
  }

  return updatedCall;
};

// Create a system message in the conversation for call history display
async function createCallSystemMessage(call, status, duration = 0) {
  const statusLabels = {
    completed: 'สนทนาสำเร็จ',
    no_answer: 'ไม่ได้รับสาย',
    cancelled: 'ยกเลิกการโทร',
    rejected: 'ปฏิเสธสาย',
    missed: 'สายที่ไม่ได้รับ',
    failed: 'โทรไม่สำเร็จ'
  };
  const statusLabel = statusLabels[status] || status;
  const durationText = duration > 0 ? ` • ${Math.floor(duration / 60)}:${String(duration % 60).padStart(2, '0')} นาที` : '';

  const { data: message } = await supabaseAdmin
    .from('messages')
    .insert({
      conversation_id: call.conversation_id,
      sender_id: call.caller_id,
      type: 'voice_call',
      content: `📞 ${statusLabel}${durationText}`,
      metadata: {
        call_id: call.id,
        call_status: status,
        duration_seconds: duration,
        call_type: call.metadata?.call_type || 'voice'
      }
    })
    .select()
    .single();

  // Emit the system message to conversation room
  if (message) {
    emitToConversation(call.conversation_id, 'newMessage', message);
  }

  return message;
}

// Emit call status update to conversation participants
function emitCallStatusUpdate(conversationId, callerId, calleeId, status, callId, duration = 0) {
  emitToConversation(conversationId, 'callStatusUpdate', {
    conversation_id: conversationId,
    call_id: callId,
    caller_id: callerId,
    callee_id: calleeId,
    status,
    duration_seconds: duration
  });
}

// Get call history for user
export const getCallHistory = async (userId, filters = {}, pagination = {}) => {
  const { status, type, page = 1, limit = 20 } = filters;
  
  let query = supabaseAdmin
    .from('call_history')
    .select(`
      *,
      caller:profiles!caller_id(id, name, avatar_url),
      callee:profiles!callee_id(id, name, avatar_url),
      conversation:conversations!conversation_id(id, type, store_id),
      store_order:store_orders!store_order_id(id, store_order_number)
    `, { count: 'exact' })
    .or(`caller_id.eq.${userId},callee_id.eq.${userId}`);
  
  if (status) query = query.eq('status', status);
  if (type) query = query.eq('metadata->>call_type', type);
  
  query = query
    .order('created_at', { ascending: false })
    .range((page - 1) * limit, page * limit - 1);
  
  const { data, error, count } = await query;
  
  if (error) {
    throw new AppError(`Failed to fetch call history: ${error.message}`, 500);
  }
  
  return {
    calls: data,
    pagination: { page, limit, total: count, totalPages: Math.ceil(count / limit) }
  };
};

// Get active call for user
export const getActiveCall = async (userId) => {
  const { data: call } = await supabaseAdmin
    .from('call_history')
    .select(`
      *,
      caller:profiles!caller_id(id, name, avatar_url),
      callee:profiles!callee_id(id, name, avatar_url)
    `)
    .or(`caller_id.eq.${userId},callee_id.eq.${userId}`)
    .in('status', ['ringing', 'accepted'])
    .order('created_at', { ascending: false })
    .limit(1)
    .single();
  
  return call;
};

// Update call metadata (for WebRTC signaling)
export const updateCallMetadata = async (callId, userId, metadata) => {
  const { data: call } = await supabaseAdmin
    .from('call_history')
    .select('*')
    .eq('id', callId)
    .or(`caller_id.eq.${userId},callee_id.eq.${userId}`)
    .single();
  
  if (!call) {
    throw new NotFoundError('Call');
  }
  
  const { data: updatedCall, error } = await supabaseAdmin
    .from('call_history')
    .update({ 
      metadata: { ...call.metadata, ...metadata }
    })
    .eq('id', callId)
    .select()
    .single();
  
  if (error) {
    throw new AppError(`Call metadata update failed: ${error.message}`, 500);
  }
  
  return updatedCall;
};

// Handle WebRTC signaling (offer/answer/ice-candidate)
export const handleSignaling = async (callId, userId, signalData) => {
  const { type, sdp, candidate } = signalData;
  
  const { data: call } = await supabaseAdmin
    .from('call_history')
    .select('*')
    .eq('id', callId)
    .or(`caller_id.eq.${userId},callee_id.eq.${userId}`)
    .in('status', ['ringing', 'accepted'])
    .single();
  
  if (!call) {
    throw new NotFoundError('Active call');
  }
  
  // Store signaling data in metadata
  const signalingKey = userId === call.caller_id ? 'caller_signaling' : 'callee_signaling';
  const currentSignaling = call.metadata[signalingKey] || [];
  
  currentSignaling.push({
    type,
    sdp,
    candidate,
    timestamp: new Date().toISOString()
  });
  
  // Keep only last 50 signaling messages
  if (currentSignaling.length > 50) {
    currentSignaling.shift();
  }
  
  await supabaseAdmin
    .from('call_history')
    .update({ 
      metadata: { 
        ...call.metadata, 
        [signalingKey]: currentSignaling 
      }
    })
    .eq('id', callId);
  
  return { success: true };
};

// Get signaling history for call
export const getSignalingHistory = async (callId, userId) => {
  const { data: call } = await supabaseAdmin
    .from('call_history')
    .select('metadata, caller_id, callee_id')
    .eq('id', callId)
    .or(`caller_id.eq.${userId},callee_id.eq.${userId}`)
    .single();
  
  if (!call) {
    throw new NotFoundError('Call');
  }
  
  const signalingKey = userId === call.caller_id ? 'callee_signaling' : 'caller_signaling';
  
  return call.metadata[signalingKey] || [];
};

// Mute/unmute local audio
export const toggleMute = async (callId, userId, muted) => {
  return updateCallMetadata(callId, userId, { 
    [`${userId === (await supabaseAdmin.from('call_history').select('caller_id').eq('id', callId).single()).data?.caller_id ? 'caller' : 'callee'}_muted`]: muted 
  });
};