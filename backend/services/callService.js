import { supabaseAdmin } from '../config/supabase.js';
import { AppError, NotFoundError, ValidationError } from '../middleware/errorHandler.js';
import { v4 as uuidv4 } from 'uuid';
import { emitIncomingCall, emitCallEnded, emitToUser } from './socketService.js';

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

// Close abandoned ringing calls and return how many were closed.
export const expireStaleCalls = async () => {
  const cutoff = new Date(Date.now() - RINGING_TIMEOUT_MS).toISOString();
  const { data: stale } = await supabaseAdmin
    .from('call_history')
    .select('id, caller_id, callee_id')
    .eq('status', 'ringing')
    .lt('created_at', cutoff)
    .limit(100);
  if (!stale || stale.length === 0) return 0;

  await supabaseAdmin
    .from('call_history')
    .update({ status: 'missed', ended_at: new Date().toISOString(), end_reason: 'missed' })
    .eq('status', 'ringing')
    .lt('created_at', cutoff);

  for (const call of stale) {
    emitToUser(call.caller_id, 'callEnded', { call_id: call.id, status: 'missed' });
    emitToUser(call.callee_id, 'callEnded', { call_id: call.id, status: 'missed' });
  }
  return stale.length;
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

  // Check for existing active call between these users
  const { data: existingCall } = await supabaseAdmin
    .from('call_history')
    .select('id')
    .eq('caller_id', callerId)
    .eq('callee_id', calleeId)
    .in('status', ['ringing', 'accepted'])
    .limit(1)
    .maybeSingle();
  
  if (existingCall) {
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
  const { data: call } = await supabaseAdmin
    .from('call_history')
    .select('*')
    .eq('id', callId)
    .eq('callee_id', userId)
    .eq('status', 'ringing')
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
  const ageMs = Date.now() - new Date(call.created_at || call.started_at || 0).getTime();
  if (ageMs > RINGING_TIMEOUT_MS) {
    await supabaseAdmin
      .from('call_history')
      .update({ status: 'missed', ended_at: new Date().toISOString(), end_reason: 'missed' })
      .eq('id', callId);
    throw new AppError('สายนี้หมดอายุแล้ว', 410);
  }
  
  const { data: updatedCall, error } = await supabaseAdmin
    .from('call_history')
    .update({ 
      status: 'accepted', 
      answered_at: new Date().toISOString() 
    })
    .eq('id', callId)
    .select()
    .single();
  
if (error) {
    throw new AppError(`Call acceptance failed: ${error.message}`, 500);
  }

  // Tell the caller that the callee picked up. Do NOT emit callEnded here:
  // callEnded(accepted) previously tore down the WebRTC peer connection on
  // both sides right when the call should be connecting.
  emitToUser(call.caller_id, 'callAccepted', { call_id: callId, accepted_by: userId });

  return updatedCall;
};

// Reject call
export const rejectCall = async (callId, userId) => {
  const { data: call } = await supabaseAdmin
    .from('call_history')
    .select('*')
    .eq('id', callId)
    .eq('callee_id', userId)
    .eq('status', 'ringing')
    .single();
  
  if (!call) {
    throw new NotFoundError('Call');
  }
  
  const { data: updatedCall, error } = await supabaseAdmin
    .from('call_history')
    .update({ 
      status: 'rejected', 
      ended_at: new Date().toISOString(),
      end_reason: 'rejected'
    })
    .eq('id', callId)
    .select()
    .single();
  
if (error) {
    throw new AppError(`Call rejection failed: ${error.message}`, 500);
  }

  // Notify the caller that the callee declined.
  emitCallEnded(callId, { status: 'rejected', rejected_by: userId });
  emitToUser(call.caller_id, 'callRejected', { call_id: callId, rejected_by: userId });

  // Create missed call notification for caller
  await supabaseAdmin.rpc('create_notification', {
    p_recipient_id: call.caller_id,
    p_type: 'missed_call',
    p_title: 'Call rejected',
    p_body: 'Your call was rejected',
    p_data: { call_id: callId, rejected_by: userId },
    p_related_id: callId,
    p_related_type: 'call'
  });

  return updatedCall;
};

// End call
export const endCall = async (callId, userId) => {
  const { data: call } = await supabaseAdmin
    .from('call_history')
    .select('*')
    .eq('id', callId)
    .or(`caller_id.eq.${userId},callee_id.eq.${userId}`)
    .in('status', ['ringing', 'accepted'])
    .single();
  
  if (!call) {
    throw new NotFoundError('Call');
  }
  
  const endedAt = new Date();
  const startedAt = new Date(call.started_at || call.answered_at || endedAt);
  const duration = Math.floor((endedAt - startedAt) / 1000);
  
  const endReason = call.status === 'ringing' ? 'missed' : 'ended';
  
  const { data: updatedCall, error } = await supabaseAdmin
    .from('call_history')
    .update({ 
      status: endReason === 'missed' ? 'missed' : 'ended', 
      ended_at: endedAt.toISOString(),
      duration_seconds: duration,
      end_reason: endReason
    })
    .eq('id', callId)
    .select()
    .single();
  
if (error) {
    throw new AppError(`Call end failed: ${error.message}`, 500);
  }

  // Broadcast end to everyone in the call room and to each participant's user room.
  emitCallEnded(callId, { status: endReason, ended_by: userId, duration_seconds: duration });
  emitToUser(call.caller_id, 'callEnded', { call_id: callId, status: endReason });
  emitToUser(call.callee_id, 'callEnded', { call_id: callId, status: endReason });

  // Create missed call notification if missed
  if (endReason === 'missed') {
    const otherUserId = call.caller_id === userId ? call.callee_id : call.caller_id;
    
    await supabaseAdmin.rpc('create_notification', {
      p_recipient_id: otherUserId,
      p_type: 'missed_call',
      p_title: 'Missed call',
      p_body: 'You missed a call',
      p_data: { call_id: callId, missed_by: userId },
      p_related_id: callId,
      p_related_type: 'call'
    });
  }

  return updatedCall;
};

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