import { supabaseAdmin } from '../config/supabase.js';
import { AppError, NotFoundError, ValidationError } from '../middleware/errorHandler.js';
import { emitNewMessage, emitToUser, emitMessageRead, emitToConversation } from './socketService.js';
import { parseCoordinates } from './routeService.js';

// Attachments may arrive as the message_attachments column names (file_url, ...)
// or as the upload endpoint's response shape (url, fileName, ...). Normalise both
// so an attachment can always be linked to the message it was uploaded for.
const normalizeAttachment = (attachment = {}) => {
  const fileUrl = attachment.file_url || attachment.fileUrl || attachment.url;
  const fileName = attachment.file_name || attachment.fileName || attachment.name;
  const fileSize = attachment.file_size ?? attachment.fileSize ?? attachment.size ?? 0;
  const mimeType = attachment.mime_type || attachment.mimeType || attachment.type || 'application/octet-stream';

  if (!fileUrl || !fileName) {
    throw new ValidationError('Attachment requires file_url and file_name');
  }

  return {
    file_url: fileUrl,
    file_name: fileName,
    file_size: Number(fileSize) || 0,
    mime_type: mimeType,
    width: attachment.width ?? null,
    height: attachment.height ?? null,
    duration_seconds: attachment.duration_seconds ?? attachment.durationSeconds ?? null,
    thumbnail_url: attachment.thumbnail_url ?? attachment.thumbnailUrl ?? null
  };
};

// Create or get direct conversation between customer and store
// customer_id is derived from authenticated identity server-side; never trust client input.
// Uses unique index (customer_id, store_id) WHERE type='store_customer' AND customer_id IS NOT NULL
// with conflict retry to guarantee exactly one conversation under concurrency.
export const getOrCreateConversation = async (customerId, storeId, storeOrderId = null, context = {}) => {
  // The store must exist, otherwise a conversation would be created against
  // nothing and the owner member insert would fail silently.
  const { data: store, error: storeError } = await supabaseAdmin
    .from('stores')
    .select('id, owner_id')
    .eq('id', storeId)
    .single();

  if (storeError || !store) {
    throw new NotFoundError('Store');
  }

  if (!store.owner_id) {
    throw new AppError('Store owner is not configured', 500);
  }

  // A store owner is already a member (as admin) of every room of that store,
  // so there is no customer-side conversation to create for them.
  const sameUser = String(store.owner_id) === String(customerId);
  console.info('[chat.getOrCreateConversation]', {
    storeId,
    reqUserId: customerId,
    storeOwnerId: store.owner_id,
    role: context.role ?? null,
    sameUser
  });
  if (sameUser) {
    throw new ValidationError('Cannot start a conversation with your own store');
  }

  // Fast path: try to find existing conversation by customer_id + store_id (uses partial unique index)
  const { data: existingByCustomer } = await supabaseAdmin
    .from('conversations')
    .select('id')
    .eq('type', 'store_customer')
    .eq('store_id', storeId)
    .eq('customer_id', customerId)
    .maybeSingle();

  if (existingByCustomer) {
    // Verify membership before returning
    const { data: member } = await supabaseAdmin
      .from('conversation_members')
      .select('id')
      .eq('conversation_id', existingByCustomer.id)
      .eq('profile_id', customerId)
      .is('left_at', null)
      .maybeSingle();
    if (member) {
      return await getConversationById(existingByCustomer.id);
    }
    // If membership missing (edge case), fall through to create/repair
  }

  // Fallback: search by membership (handles legacy NULL customer_id rows).
  // Deterministic order (oldest first, then id) so when multiple legacy
  // conversations match the same customer we always pick the same one.
  let query = supabaseAdmin
    .from('conversations')
    .select(`
      *,
      members:conversation_members!inner(profile_id)
    `)
    .eq('type', 'store_customer')
    .eq('store_id', storeId)
    .order('created_at', { ascending: true, nullsFirst: true })
    .order('id', { ascending: true });

  if (storeOrderId) {
    query = query.eq('store_order_id', storeOrderId);
  }

  const { data: conversations, error: conversationError } = await query;

  if (conversationError) {
    throw new AppError(`Failed to fetch conversations: ${conversationError.message}`, 500);
  }

  // Find conversation where customer is a member
  for (const conv of conversations || []) {
    const isMember = (conv.members || []).some(m => m.profile_id === customerId);
    if (isMember) {
      // Backfill customer_id if NULL (idempotent)
      if (conv.customer_id === null) {
        await supabaseAdmin
          .from('conversations')
          .update({ customer_id: customerId })
          .eq('id', conv.id)
          .is('customer_id', null);
      }
      return await getConversationById(conv.id);
    }
  }

  // Create new conversation with customer_id; retry on unique conflict
  const maxRetries = 3;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const { data: conversation, error } = await supabaseAdmin
      .from('conversations')
      .insert({
        type: 'store_customer',
        store_id: storeId,
        store_order_id: storeOrderId,
        customer_id: customerId
      })
      .select()
      .single();

    if (!error) {
      // Add members: the customer is a plain member, the store owner is the
      // conversation admin. The owner always comes from stores.owner_id.
      const { error: memberError } = await supabaseAdmin
        .from('conversation_members')
        .insert([
          { conversation_id: conversation.id, profile_id: customerId, role: 'member' },
          { conversation_id: conversation.id, profile_id: store.owner_id, role: 'admin' }
        ]);

      if (memberError) {
        // If member insert fails, clean up conversation and retry
        await supabaseAdmin.from('conversations').delete().eq('id', conversation.id);
        if (attempt === maxRetries - 1) {
          throw new AppError(`Failed to add conversation members: ${memberError.message}`, 500);
        }
        continue;
      }

      return getConversationById(conversation.id);
    }

    // Unique conflict on (customer_id, store_id) - another request won the race.
    // Match the constraint name via error.constraint (PostgREST/pg 12+) instead
    // of substring-matching the error message, which varies by Postgres
    // version and locale. Fall back to the legacy message check only when the
    // driver did not surface the constraint field.
    const isStoreCustomerUniqueConflict =
      error.code === '23505' &&
      (error.constraint === 'ux_conversations_store_customer' ||
        (!error.constraint && typeof error.message === 'string' &&
          error.message.includes('ux_conversations_store_customer')));

    if (isStoreCustomerUniqueConflict) {
      // Fetch the winning conversation and return it
      const { data: winner } = await supabaseAdmin
        .from('conversations')
        .select('id')
        .eq('type', 'store_customer')
        .eq('store_id', storeId)
        .eq('customer_id', customerId)
        .maybeSingle();
      if (winner) {
        return await getConversationById(winner.id);
      }
      // If not found (should not happen), retry
      continue;
    }

    // Other error - throw
    throw new AppError(`Conversation creation failed: ${error.message}`, 500);
  }

  throw new AppError('Conversation creation failed after retries', 500);
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

const getLatestMessagesByConversation = async (conversationIds) => {
  const ids = [...new Set((conversationIds || []).filter(Boolean))];
  if (ids.length === 0) return new Map();

  const { data, error } = await supabaseAdmin
    .from('messages')
    .select('*')
    .in('conversation_id', ids)
    .eq('is_deleted', false)
    .order('created_at', { ascending: false });

  if (error) {
    throw new AppError(`Failed to fetch latest messages: ${error.message}`, 500);
  }

  const latest = new Map();
  for (const message of data || []) {
    if (!latest.has(message.conversation_id)) {
      latest.set(message.conversation_id, message);
    }
  }
  return latest;
};

// Get conversations for user
export const getUserConversations = async (userId, filters = {}, pagination = {}) => {
  const { type, store_id, page = 1, limit = 20, include_hidden = false } = filters;

  // First, get conversation IDs where the user is an active member.
  // Hidden chats are excluded from the list but stay readable by id and keep
  // every message/order record intact.
  const { data: memberConversations, error: memberError } = await supabaseAdmin
    .from('conversation_members')
    .select('conversation_id, is_hidden')
    .eq('profile_id', userId)
    .is('left_at', null);

  if (memberError) {
    throw new AppError(`Failed to fetch user conversations: ${memberError.message}`, 500);
  }

  const conversationIds = (memberConversations || [])
    .filter((m) => include_hidden === true || m.is_hidden !== true)
    .map((m) => m.conversation_id);

  if (conversationIds.length === 0) {
    return {
      conversations: [],
      pagination: { page, limit, total: 0, totalPages: 0 }
    };
  }

  // Then fetch those conversations with all members and their profiles
  let query = supabaseAdmin
    .from('conversations')
    .select(`
      *,
      store:stores(id, name, slug, logo_url),
      store_order:store_orders(id, store_order_number, status),
      members:conversation_members!inner(
        profile_id,
        unread_count,
        last_read_at,
        last_read_message_id,
        alias,
        is_hidden,
        profile:profiles(id, name, avatar_url, role)
      )
    `, { count: 'exact' })
    .in('id', conversationIds);

  if (type) query = query.eq('type', type);
  if (store_id) query = query.eq('store_id', store_id);

  query = query
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .range((page - 1) * limit, page * limit - 1);

  const { data, error, count } = await query;

  if (error) {
    throw new AppError(`Failed to fetch conversations: ${error.message}`, 500);
  }

  const latestMessages = await getLatestMessagesByConversation((data || []).map((c) => c.id));
  const conversations = (data || []).map((conversation) => ({
    ...conversation,
    last_message: latestMessages.get(conversation.id) || null,
  }));

  return {
    conversations,
    pagination: { page, limit, total: count, totalPages: Math.ceil((count || 0) / limit) }
  };
};

// Get messages for conversation
export const getMessages = async (conversationId, userId, pagination = {}) => {
  const { page = 1, limit = 50, before_id, after_id } = pagination;
  
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
      .eq('conversation_id', conversationId)
      .single();
    
    if (beforeMsg) {
      query = query.lt('created_at', beforeMsg.created_at);
    }
  }

  // Reconnect catch-up: return everything after the newest message the client
  // already has. `gte` (not `gt`) is used so messages sharing the exact same
  // timestamp are not dropped; the client de-duplicates by message id.
  if (after_id) {
    const { data: afterMsg } = await supabaseAdmin
      .from('messages')
      .select('created_at')
      .eq('id', after_id)
      .eq('conversation_id', conversationId)
      .single();

    if (afterMsg) {
      query = query.gte('created_at', afterMsg.created_at);
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
export const sendMessage = async (conversationId, senderId, messageData = {}) => {
  const { content, type = 'text', metadata = {}, reply_to_id, attachments = [] } = messageData;

  // Verify membership: only a member of this conversation may post in it.
  // senderId always comes from the verified token (req.user.id).
  const conversation = await getConversationById(conversationId, senderId);

  const normalizedAttachments = (Array.isArray(attachments) ? attachments : []).map(normalizeAttachment);

  if (!content && normalizedAttachments.length === 0) {
    throw new ValidationError('Message content or attachment required');
  }

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
  if (normalizedAttachments.length > 0) {
    const attachmentData = normalizedAttachments.map(att => ({
      message_id: message.id,
      ...att
    }));

    const { error: attachmentError } = await supabaseAdmin
      .from('message_attachments')
      .insert(attachmentData);

    if (attachmentError) {
      throw new AppError(`Attachment creation failed: ${attachmentError.message}`, 500);
    }

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

  // Realtime delivery: the conversation room plus every other member's user room
  // (so the store owner also sees it on the conversation list).
  // Non-sensitive diagnostic: ids/counts only, never message content or tokens.
  console.log('[chat] message saved', {
    conversationId,
    messageId: message?.id ?? null,
    senderId,
    otherMembers: otherMembers.length,
  });
  emitNewMessage(message);
  for (const member of otherMembers) {
    emitToUser(member.profile_id, 'newMessage', message);
  }

  return message;
};

// Mark messages as read
export const markMessagesRead = async (conversationId, userId, lastReadMessageId = null) => {
  // Verify membership
  await getConversationById(conversationId, userId);

  // A read marker may only point at a message of this conversation, otherwise
  // one room could mark another room's message as read.
  if (lastReadMessageId) {
    const { data: readMessage, error: readError } = await supabaseAdmin
      .from('messages')
      .select('id')
      .eq('id', lastReadMessageId)
      .eq('conversation_id', conversationId)
      .single();

    if (readError || !readMessage) {
      throw new ValidationError('Message does not belong to this conversation');
    }
  }

  const updateData = { last_read_at: new Date().toISOString() };

  const { error } = await supabaseAdmin
    .from('conversation_members')
    .update(updateData)
    .eq('conversation_id', conversationId)
    .eq('profile_id', userId);

  if (error) {
    throw new AppError(`Failed to mark messages as read: ${error.message}`, 500);
  }

  // Reset unread count (the DB trigger also resets it when last_read_at changes,
  // keep it explicit so the count is correct without the trigger too).
  await supabaseAdmin
    .from('conversation_members')
    .update({ unread_count: 0 })
    .eq('conversation_id', conversationId)
    .eq('profile_id', userId);

  emitMessageRead(conversationId, userId, 0);

  return { success: true };
};

// Get unread count for user
export const getUnreadCount = async (userId) => {
  const { data, error } = await supabaseAdmin
    .from('conversation_members')
    .select('unread_count')
    .eq('profile_id', userId)
    .is('left_at', null);
  
  if (error) {
    throw new AppError(`Failed to fetch unread count: ${error.message}`, 500);
  }
  
  return data.reduce((sum, m) => sum + (m.unread_count || 0), 0);
};

// Edit message
export const editMessage = async (messageId, userId, newContent) => {
  const { data: message, error } = await supabaseAdmin
    .from('messages')
    .select('id, conversation_id, sender_id, is_deleted')
    .eq('id', messageId)
    .single();

  if (error || !message || message.is_deleted) {
    throw new NotFoundError('Message');
  }

  // Membership is required before touching a message (service role bypasses RLS).
  await getConversationById(message.conversation_id, userId);

  if (String(message.sender_id) !== String(userId)) {
    throw new AppError('Not authorized to edit this message', 403);
  }

  const { data: updated, error: updateError } = await supabaseAdmin
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

  if (updateError || !updated) {
    throw new AppError('Message not found or not authorized', 404);
  }

  return updated;
};

// Delete message (soft delete)
export const deleteMessage = async (messageId, userId, isAdmin = false) => {
  const { data: message, error } = await supabaseAdmin
    .from('messages')
    .select('id, conversation_id, sender_id, is_deleted')
    .eq('id', messageId)
    .single();

  if (error || !message || message.is_deleted) {
    throw new NotFoundError('Message');
  }

  // Membership is required before touching a message (service role bypasses RLS).
  const conversation = await getConversationById(message.conversation_id, userId);
  const membership = conversation.members.find(m => String(m.profile_id) === String(userId));

  const isSender = String(message.sender_id) === String(userId);
  const isConversationAdmin = Boolean(isAdmin && membership && ['admin', 'owner'].includes(membership.role));

  if (!isSender && !isConversationAdmin) {
    throw new AppError('Not authorized to delete this message', 403);
  }

  const { error: updateError } = await supabaseAdmin
    .from('messages')
    .update({ is_deleted: true, deleted_at: new Date().toISOString() })
    .eq('id', messageId);

  if (updateError) {
    throw new AppError(`Failed to delete message: ${updateError.message}`, 500);
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
  // Only a member may change their own mute setting for this conversation.
  await getConversationById(conversationId, userId);

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
export const uploadMessageAttachment = async (messageId, fileData, userId) => {
  if (!userId) {
    throw new AppError('Authenticated userId is required for attachment upload', 401);
  }

  const { data: message, error } = await supabaseAdmin
    .from('messages')
    .select('id, conversation_id, is_deleted, sender_id')
    .eq('id', messageId)
    .single();

  if (error || !message || message.is_deleted) {
    throw new NotFoundError('Message');
  }

  // Membership is required: the service role key bypasses RLS, so without this
  // check any authenticated user could attach files to someone else's message.
  await getConversationById(message.conversation_id, userId);

  const attachment = normalizeAttachment(fileData);

  const { data: created, error: insertError } = await supabaseAdmin
    .from('message_attachments')
    .insert({
      message_id: messageId,
      ...attachment
    })
    .select()
    .single();

  if (insertError) {
    throw new AppError(`Attachment upload failed: ${insertError.message}`, 500);
  }

  return created;
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

  const { status, page = 1, limit = 20, include_spam = false } = filters;

  let query = supabaseAdmin
    .from('conversations')
    .select(`
      *,
      members:conversation_members(
        profile_id,
        unread_count,
        last_read_at,
        last_read_message_id,
        alias,
        is_hidden,
        profile:profiles(id, name, avatar_url, role)
      )
    `, { count: 'exact' })
    .eq('store_id', storeId);

  if (status === 'unread') {
    query = query.gt('conversation_members.unread_count', 0);
  }

  if (!include_spam) {
    query = query.neq('is_spam', true);
  }

  query = query
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .range((page - 1) * limit, page * limit - 1);

  const { data, error, count } = await query;

  if (error) {
    throw new AppError(`Failed to fetch conversations: ${error.message}`, 500);
  }

  const latestMessages = await getLatestMessagesByConversation((data || []).map((c) => c.id));
  const conversations = (data || []).map((conversation) => ({
    ...conversation,
    last_message: latestMessages.get(conversation.id) || null,
  }));

  return {
    conversations,
    pagination: { page, limit, total: count, totalPages: Math.ceil((count || 0) / limit) }
  };
};

// Mark conversation as spam (store owner only)
export const markConversationSpam = async (conversationId, userId) => {
  const conversation = await getConversationById(conversationId, userId);
  
  // Verify user is store owner/admin
  const membership = conversation.members.find(m => String(m.profile_id) === String(userId));
  if (!membership || !['admin', 'owner'].includes(membership.role)) {
    throw new AppError('Not authorized to mark spam', 403);
  }
  
  if (conversation.is_spam) {
    return conversation;
  }
  
  const { data: updated, error } = await supabaseAdmin
    .from('conversations')
    .update({ 
      is_spam: true,
      spam_marked_at: new Date().toISOString(),
      spam_marked_by: userId
    })
    .eq('id', conversationId)
    .select()
    .single();
  
  if (error) {
    throw new AppError(`Failed to mark spam: ${error.message}`, 500);
  }
  
  return updated;
};

// Restore conversation from spam (store owner only)
export const restoreConversationFromSpam = async (conversationId, userId) => {
  const conversation = await getConversationById(conversationId, userId);
  
  // Verify user is store owner/admin
  const membership = conversation.members.find(m => String(m.profile_id) === String(userId));
  if (!membership || !['admin', 'owner'].includes(membership.role)) {
    throw new AppError('Not authorized to restore from spam', 403);
  }
  
  if (!conversation.is_spam) {
    return conversation;
  }
  
  const { data: updated, error } = await supabaseAdmin
    .from('conversations')
    .update({ 
      is_spam: false,
      spam_marked_at: null,
      spam_marked_by: null
    })
    .eq('id', conversationId)
    .select()
    .single();
  
  if (error) {
    throw new AppError(`Failed to restore from spam: ${error.message}`, 500);
  }
  
  return updated;
};

// Get spam conversations for store
export const getSpamConversations = async (storeId, ownerId, pagination = {}) => {
  const { page = 1, limit = 20 } = pagination;
  
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
  
  let query = supabaseAdmin
    .from('conversations')
    .select(`
      *,
      store:stores(id, name, slug, logo_url),
      store_order:store_orders(id, store_order_number, status),
      members:conversation_members!inner(
        profile_id,
        unread_count,
        last_read_at,
        last_read_message_id,
        alias,
        is_hidden,
        profile:profiles(id, name, avatar_url, role)
      )
    `, { count: 'exact' })
    .eq('store_id', storeId)
    .eq('is_spam', true)
    .order('spam_marked_at', { ascending: false })
    .range((page - 1) * limit, page * limit - 1);
  
  const { data, error, count } = await query;
  
  if (error) {
    throw new AppError(`Failed to fetch spam conversations: ${error.message}`, 500);
  }
  
  const latestMessages = await getLatestMessagesByConversation((data || []).map((c) => c.id));
  const conversations = (data || []).map((conversation) => ({
    ...conversation,
    last_message: latestMessages.get(conversation.id) || null,
  }));
  
  return {
    conversations,
    pagination: { page, limit, total: count, totalPages: Math.ceil((count || 0) / limit) }
  };
};

// Update conversation member alias (rename chat for user)
export const updateConversationAlias = async (conversationId, userId, alias) => {
  await getConversationById(conversationId, userId);
  
  const { data: updated, error } = await supabaseAdmin
    .from('conversation_members')
    .update({ alias: alias?.trim() || null })
    .eq('conversation_id', conversationId)
    .eq('profile_id', userId)
    .select()
    .single();
  
  if (error) {
    throw new AppError(`Failed to update alias: ${error.message}`, 500);
  }
  
  return updated;
};

// Update conversation member hidden state (hide chat for user)
export const updateConversationHidden = async (conversationId, userId, isHidden) => {
  await getConversationById(conversationId, userId);
  
  const { data: updated, error } = await supabaseAdmin
    .from('conversation_members')
    .update({ is_hidden: Boolean(isHidden) })
    .eq('conversation_id', conversationId)
    .eq('profile_id', userId)
    .select()
    .single();
  
  if (error) {
    throw new AppError(`Failed to update hidden state: ${error.message}`, 500);
  }
  
  return updated;
};