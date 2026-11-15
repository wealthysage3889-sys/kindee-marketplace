import { supabaseAdmin } from '../config/supabase.js';
import { AppError, NotFoundError, ValidationError } from '../middleware/errorHandler.js';
import { v4 as uuidv4 } from 'uuid';

// Create or get direct conversation between customer and store
export const getOrCreateConversation = async (customerId, storeId, storeOrderId = null) => {
  // Check for existing conversation
  let query = supabaseAdmin
    .from('conversations')
    .select(`
      *,
      members:conversation_members!inner(profile_id)
    `)
    .eq('type', 'store_customer')
    .eq('store_id', storeId);
  
  if (storeOrderId) {
    query = query.eq('store_order_id', storeOrderId);
  }
  
  const { data: conversations } = await query;
  
  // Find conversation where customer is a member
  for (const conv of conversations || []) {
    const isMember = conv.members.some(m => m.profile_id === customerId);
    if (isMember) {
      return await getConversationById(conv.id);
    }
  }
  
  // Create new conversation
  const { data: conversation, error } = await supabaseAdmin
    .from('conversations')
    .insert({
      type: 'store_customer',
      store_id: storeId,
      store_order_id: storeOrderId
    })
    .select()
    .single();
  
  if (error) {
    throw new AppError(`Conversation creation failed: ${error.message}`, 500);
  }
  
  // Add members
  const { data: store } = await supabaseAdmin
    .from('stores')
    .select('owner_id')
    .eq('id', storeId)
    .single();
  
  await supabaseAdmin
    .from('conversation_members')
    .insert([
      { conversation_id: conversation.id, profile_id: customerId, role: 'member' },
      { conversation_id: conversation.id, profile_id: store.owner_id, role: 'admin' }
    ]);
  
  return getConversationById(conversation.id);
};

// Get conversation by ID
export const getConversationById = async (conversationId, userId = null) => {
  let query = supabaseAdmin
    .from('conversations')
    .select(`
      *,
      store:stores(id, name, slug, logo_url),
      store_order:store_orders(id, store_order_number, status),
      members:conversation_members(
        *,
        profile:profiles(id, name, avatar_url, role)
      )
    `)
    .eq('id', conversationId);
  
  const { data: conversation, error } = await query.single();
  
  if (error || !conversation) {
    throw new NotFoundError('Conversation');
  }
  
  // Check membership if userId provided
  if (userId) {
    const isMember = conversation.members.some(m => m.profile_id === userId && !m.left_at);
    if (!isMember) {
      throw new AppError('Not a member of this conversation', 403);
    }
  }
  
  return conversation;
};

// Get conversations for user
export const getUserConversations = async (userId, filters = {}, pagination = {}) => {
  const { type, store_id, page = 1, limit = 20 } = filters;
  
  let query = supabaseAdmin
    .from('conversations')
    .select(`
      *,
      store:stores(id, name, slug, logo_url),
      store_order:store_orders(id, store_order_number, status),
      members:conversation_members!inner(
        profile_id,
        unread_count,
        last_read_at
      ),
      last_message:messages!last_message_at(*)
    `, { count: 'exact' })
    .eq('conversation_members.profile_id', userId)
    .eq('conversation_members.left_at', null);
  
  if (type) query = query.eq('type', type);
  if (store_id) query = query.eq('store_id', store_id);
  
  query = query
    .order('last_message_at', { ascending: false, nullsLast: true })
    .range((page - 1) * limit, page * limit - 1);
  
  const { data, error, count } = await query;
  
  if (error) {
    throw new AppError(`Failed to fetch conversations: ${error.message}`, 500);
  }
  
  return {
    conversations: data,
    pagination: { page, limit, total: count, totalPages: Math.ceil(count / limit) }
  };
};

// Get messages for conversation
export const getMessages = async (conversationId, userId, pagination = {}) => {
  const { page = 1, limit = 50, before_id } = pagination;
  
  // Verify membership
  await getConversationById(conversationId, userId);
  
  let query = supabaseAdmin
    .from('messages')
    .select(`
      *,
      sender:profiles!sender_id(id, name, avatar_url, role),
      attachments:message_attachments(*),
      reply_to:messages!reply_to_id(
        id, content, sender_id,
        sender:profiles!sender_id(id, name, avatar_url)
      )
    `)
    .eq('conversation_id', conversationId)
    .eq('is_deleted', false);
  
  if (before_id) {
    const { data: beforeMsg } = await supabaseAdmin
      .from('messages')
      .select('created_at')
      .eq('id', before_id)
      .single();
    
    if (beforeMsg) {
      query = query.lt('created_at', beforeMsg.created_at);
    }
  }
  
  query = query
    .order('created_at', { ascending: false })
    .range((page - 1) * limit, page * limit - 1);
  
  const { data, error } = await query;
  
  if (error) {
    throw new AppError(`Failed to fetch messages: ${error.message}`, 500);
  }
  
  // Reverse to show oldest first
  return data.reverse();
};

// Send message
export const sendMessage = async (conversationId, senderId, messageData) => {
  const { content, type = 'text', metadata = {}, reply_to_id, attachments = [] } = messageData;
  
  // Verify membership
  const conversation = await getConversationById(conversationId, senderId);
  
  // Create message
  const { data: message, error } = await supabaseAdmin
    .from('messages')
    .insert({
      conversation_id: conversationId,
      sender_id: senderId,
      type,
      content,
      metadata,
      reply_to_id
    })
    .select(`
      *,
      sender:profiles!sender_id(id, name, avatar_url, role)
    `)
    .single();
  
  if (error) {
    throw new AppError(`Message creation failed: ${error.message}`, 500);
  }
  
  // Add attachments if provided
  if (attachments.length > 0) {
    const attachmentData = attachments.map(att => ({
      message_id: message.id,
      file_url: att.file_url,
      file_name: att.file_name,
      file_size: att.file_size,
      mime_type: att.mime_type,
      width: att.width,
      height: att.height,
      duration_seconds: att.duration_seconds,
      thumbnail_url: att.thumbnail_url
    }));
    
    await supabaseAdmin
      .from('message_attachments')
      .insert(attachmentData);
    
    message.attachments = attachmentData;
  }
  
  // Update conversation last_message_at
  await supabaseAdmin
    .from('conversations')
    .update({ last_message_at: new Date().toISOString() })
    .eq('id', conversationId);
  
  // Create notifications for other members
  const otherMembers = conversation.members.filter(m => m.profile_id !== senderId && !m.left_at);
  
  for (const member of otherMembers) {
    await supabaseAdmin.rpc('create_notification', {
      p_recipient_id: member.profile_id,
      p_type: 'new_message',
      p_title: 'New message',
      p_body: content || 'New attachment',
      p_data: { conversation_id: conversationId, message_id: message.id },
      p_related_id: conversationId,
      p_related_type: 'conversation'
    });
  }
  
  return message;
};

// Mark messages as read
export const markMessagesRead = async (conversationId, userId, lastReadMessageId = null) => {
  // Verify membership
  const conversation = await getConversationById(conversationId, userId);
  
  const updateData = { last_read_at: new Date().toISOString() };
  if (lastReadMessageId) {
    updateData.last_read_message_id = lastReadMessageId;
  }
  
  const { error } = await supabaseAdmin
    .from('conversation_members')
    .update(updateData)
    .eq('conversation_id', conversationId)
    .eq('profile_id', userId);
  
  if (error) {
    throw new AppError(`Failed to mark messages as read: ${error.message}`, 500);
  }
  
  // Reset unread count
  await supabaseAdmin
    .from('conversation_members')
    .update({ unread_count: 0 })
    .eq('conversation_id', conversationId)
    .eq('profile_id', userId);
  
  return { success: true };
};

// Get unread count for user
export const getUnreadCount = async (userId) => {
  const { data, error } = await supabaseAdmin
    .from('conversation_members')
    .select('unread_count')
    .eq('profile_id', userId)
    .eq('left_at', null);
  
  if (error) {
    throw new AppError(`Failed to fetch unread count: ${error.message}`, 500);
  }
  
  return data.reduce((sum, m) => sum + (m.unread_count || 0), 0);
};

// Edit message
export const editMessage = async (messageId, userId, newContent) => {
  const { data: message, error } = await supabaseAdmin
    .from('messages')
    .update({ 
      content: newContent, 
      is_edited: true 
    })
    .eq('id', messageId)
    .eq('sender_id', userId)
    .eq('is_deleted', false)
    .select()
    .single();
  
  if (error || !message) {
    throw new AppError('Message not found or not authorized', 404);
  }
  
  return message;
};

// Delete message (soft delete)
export const deleteMessage = async (messageId, userId, isAdmin = false) => {
  let query = supabaseAdmin
    .from('messages')
    .update({ is_deleted: true, deleted_at: new Date().toISOString() })
    .eq('id', messageId);
  
  if (!isAdmin) {
    query = query.eq('sender_id', userId);
  }
  
  const { data: message, error } = await query.select().single();
  
  if (error || !message) {
    throw new AppError('Message not found or not authorized', 404);
  }
  
  return { success: true };
};

// Create group conversation
export const createGroupConversation = async (creatorId, data) => {
  const { name, memberIds, storeId, storeOrderId } = data;
  
  if (!memberIds.includes(creatorId)) {
    memberIds.push(creatorId);
  }
  
  if (memberIds.length < 2) {
    throw new ValidationError('Group must have at least 2 members');
  }
  
  const { data: conversation, error } = await supabaseAdmin
    .from('conversations')
    .insert({
      type: 'group',
      title: name,
      store_id: storeId,
      store_order_id: storeOrderId
    })
    .select()
    .single();
  
  if (error) {
    throw new AppError(`Group creation failed: ${error.message}`, 500);
  }
  
  // Add members
  const members = memberIds.map((id, index) => ({
    conversation_id: conversation.id,
    profile_id: id,
    role: id === creatorId ? 'owner' : 'member'
  }));
  
  await supabaseAdmin
    .from('conversation_members')
    .insert(members);
  
  return getConversationById(conversation.id);
};

// Add member to conversation
export const addConversationMember = async (conversationId, userId, newMemberId, role = 'member') => {
  const conversation = await getConversationById(conversationId, userId);
  
  // Check if user is admin/owner
  const membership = conversation.members.find(m => m.profile_id === userId);
  if (!membership || !['admin', 'owner'].includes(membership.role)) {
    throw new AppError('Not authorized to add members', 403);
  }
  
  const { error } = await supabaseAdmin
    .from('conversation_members')
    .insert({
      conversation_id: conversationId,
      profile_id: newMemberId,
      role
    });
  
  if (error) {
    throw new AppError(`Failed to add member: ${error.message}`, 500);
  }
  
  return { success: true };
};

// Remove member from conversation
export const removeConversationMember = async (conversationId, userId, memberId) => {
  const conversation = await getConversationById(conversationId, userId);
  
  const membership = conversation.members.find(m => m.profile_id === userId);
  const targetMembership = conversation.members.find(m => m.profile_id === memberId);
  
  // Can remove self, or admin/owner can remove others
  const canRemove = userId === memberId || 
    (membership && ['admin', 'owner'].includes(membership.role) && 
     targetMembership && membership.role !== targetMembership.role);
  
  if (!canRemove) {
    throw new AppError('Not authorized to remove this member', 403);
  }
  
  const { error } = await supabaseAdmin
    .from('conversation_members')
    .update({ left_at: new Date().toISOString() })
    .eq('conversation_id', conversationId)
    .eq('profile_id', memberId);
  
  if (error) {
    throw new AppError(`Failed to remove member: ${error.message}`, 500);
  }
  
  return { success: true };
};

// Mute/unmute conversation
export const muteConversation = async (conversationId, userId, muted = true) => {
  const { error } = await supabaseAdmin
    .from('conversation_members')
    .update({ is_muted: muted })
    .eq('conversation_id', conversationId)
    .eq('profile_id', userId);
  
  if (error) {
    throw new AppError(`Failed to mute conversation: ${error.message}`, 500);
  }
  
  return { success: true };
};

// Upload message attachment
export const uploadMessageAttachment = async (messageId, fileData) => {
  const { file_url, file_name, file_size, mime_type, width, height, duration_seconds, thumbnail_url } = fileData;
  
  const { data: attachment, error } = await supabaseAdmin
    .from('message_attachments')
    .insert({
      message_id: messageId,
      file_url,
      file_name,
      file_size,
      mime_type,
      width,
      height,
      duration_seconds,
      thumbnail_url
    })
    .select()
    .single();
  
  if (error) {
    throw new AppError(`Attachment upload failed: ${error.message}`, 500);
  }
  
  return attachment;
};

// Get store conversations for seller
export const getStoreConversations = async (storeId, ownerId, filters = {}, pagination = {}) => {
  // Verify ownership
  const { data: store } = await supabaseAdmin
    .from('stores')
    .select('id')
    .eq('id', storeId)
    .eq('owner_id', ownerId)
    .single();
  
  if (!store) {
    throw new AppError('Store not found or not authorized', 403);
  }
  
  const { status, page = 1, limit = 20 } = filters;
  
  let query = supabaseAdmin
    .from('conversations')
    .select(`
      *,
      members:conversation_members(
        profile_id,
        unread_count,
        last_read_at,
        profile:profiles(id, name, avatar_url)
      ),
      last_message:messages!last_message_at(*)
    `, { count: 'exact' })
    .eq('store_id', storeId);
  
  if (status === 'unread') {
    query = query.gt('conversation_members.unread_count', 0);
  }
  
  query = query
    .order('last_message_at', { ascending: false, nullsLast: true })
    .range((page - 1) * limit, page * limit - 1);
  
  const { data, error, count } = await query;
  
  if (error) {
    throw new AppError(`Failed to fetch conversations: ${error.message}`, 500);
  }
  
  return {
    conversations: data,
    pagination: { page, limit, total: count, totalPages: Math.ceil(count / limit) }
  };
};