import { supabaseAdmin } from '../config/supabase.js';
import { AppError, NotFoundError, ValidationError } from '../middleware/errorHandler.js';
import { v4 as uuidv4 } from 'uuid';

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

// Initiate call
export const initiateCall = async (callerId, calleeId, conversationId = null, storeOrderId = null, callType = 'voice') => {
  // Check if callee exists and is active
  const { data: callee } = await supabaseAdmin
    .from('profiles')
    .select('id, name, avatar_url, is_active')
    .eq('id', calleeId)
    .single();
  
  if (!callee || !callee.is_active) {
    throw new ValidationError('Callee not available');
  }
  
  // Check for existing active call between these users
  const { data: existingCall } = await supabaseAdmin
    .from('call_history')
    .select('id')
    .eq('caller_id', callerId)
    .eq('callee_id', calleeId)
    .in('status', ['ringing', 'accepted'])
    .single();
  
  if (existingCall) {
    throw new ValidationError('Call already in progress');
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