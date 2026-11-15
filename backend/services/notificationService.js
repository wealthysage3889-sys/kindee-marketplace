import { supabaseAdmin } from '../config/supabase.js';
import { AppError, NotFoundError } from '../middleware/errorHandler.js';

// Create notification
export const createNotification = async (data) => {
  const { 
    recipient_id, 
    type, 
    title, 
    body, 
    data: notificationData = {}, 
    related_id, 
    related_type 
  } = data;
  
  const { data: notification, error } = await supabaseAdmin
    .from('notifications')
    .insert({
      recipient_id,
      type,
      title,
      body,
      data: notificationData,
      related_id,
      related_type
    })
    .select()
    .single();
  
  if (error) {
    throw new AppError(`Notification creation failed: ${error.message}`, 500);
  }
  
  return notification;
};

// Get notifications for user
export const getNotifications = async (userId, filters = {}, pagination = {}) => {
  const { is_read, type, page = 1, limit = 20 } = filters;
  
  let query = supabaseAdmin
    .from('notifications')
    .select('*', { count: 'exact' })
    .eq('recipient_id', userId);
  
  if (is_read !== undefined) query = query.eq('is_read', is_read);
  if (type) query = query.eq('type', type);
  
  query = query
    .order('created_at', { ascending: false })
    .range((page - 1) * limit, page * limit - 1);
  
  const { data, error, count } = await query;
  
  if (error) {
    throw new AppError(`Failed to fetch notifications: ${error.message}`, 500);
  }
  
  return {
    notifications: data,
    pagination: { page, limit, total: count, totalPages: Math.ceil(count / limit) }
  };
};

// Get unread notification count
export const getUnreadCount = async (userId) => {
  const { count, error } = await supabaseAdmin
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('recipient_id', userId)
    .eq('is_read', false);
  
  if (error) {
    throw new AppError(`Failed to fetch unread count: ${error.message}`, 500);
  }
  
  return count || 0;
};

// Mark notification as read
export const markAsRead = async (notificationId, userId) => {
  const { data: notification, error } = await supabaseAdmin
    .from('notifications')
    .update({ 
      is_read: true, 
      read_at: new Date().toISOString() 
    })
    .eq('id', notificationId)
    .eq('recipient_id', userId)
    .select()
    .single();
  
  if (error || !notification) {
    throw new NotFoundError('Notification');
  }
  
  return notification;
};

// Mark all notifications as read
export const markAllAsRead = async (userId) => {
  const { error } = await supabaseAdmin
    .from('notifications')
    .update({ 
      is_read: true, 
      read_at: new Date().toISOString() 
    })
    .eq('recipient_id', userId)
    .eq('is_read', false);
  
  if (error) {
    throw new AppError(`Failed to mark all as read: ${error.message}`, 500);
  }
  
  return { success: true };
};

// Delete notification
export const deleteNotification = async (notificationId, userId) => {
  const { error } = await supabaseAdmin
    .from('notifications')
    .delete()
    .eq('id', notificationId)
    .eq('recipient_id', userId);
  
  if (error) {
    throw new AppError(`Failed to delete notification: ${error.message}`, 500);
  }
  
  return { success: true };
};

// Create system notification (for order updates, delivery updates, etc.)
export const createSystemNotification = async (recipientId, type, title, body, relatedId, relatedType, extraData = {}) => {
  return createNotification({
    recipient_id: recipientId,
    type,
    title,
    body,
    data: extraData,
    related_id: relatedId,
    related_type: relatedType
  });
};

// Notify order status change
export const notifyOrderStatusChange = async (orderId, storeOrderId, newStatus, customerId, storeOwnerId) => {
  const statusMessages = {
    confirmed: 'Your order has been confirmed',
    preparing: 'Your order is being prepared',
    ready_for_pickup: 'Your order is ready for pickup',
    picked_up: 'Your order has been picked up',
    in_transit: 'Your order is on the way',
    delivered: 'Your order has been delivered',
    cancelled: 'Your order has been cancelled',
    refunded: 'Your order has been refunded'
  };
  
  // Notify customer
  await createSystemNotification(
    customerId,
    'order_status',
    'Order Update',
    statusMessages[newStatus] || `Order status updated to ${newStatus}`,
    orderId,
    'order',
    { store_order_id: storeOrderId, status: newStatus }
  );
  
  // Notify store owner if different status
  if (storeOwnerId && storeOwnerId !== customerId) {
    await createSystemNotification(
      storeOwnerId,
      'order_status',
      'Store Order Update',
      `Store order status updated to ${newStatus}`,
      storeOrderId,
      'store_order',
      { status: newStatus }
    );
  }
};

// Notify delivery update
export const notifyDeliveryUpdate = async (deliveryId, newStatus, customerId, storeOwnerId, courierId) => {
  const statusMessages = {
    assigned: 'A courier has been assigned to your delivery',
    picked_up: 'Your order has been picked up',
    in_transit: 'Your order is on the way',
    delivered: 'Your order has been delivered',
    failed: 'Delivery failed'
  };
  
  // Notify customer
  await createSystemNotification(
    customerId,
    'delivery_update',
    'Delivery Update',
    statusMessages[newStatus] || `Delivery status updated to ${newStatus}`,
    deliveryId,
    'delivery',
    { status: newStatus }
  );
  
  // Notify store owner
  if (storeOwnerId) {
    await createSystemNotification(
      storeOwnerId,
      'delivery_update',
      'Delivery Update',
      `Delivery status updated to ${newStatus}`,
      deliveryId,
      'delivery',
      { status: newStatus }
    );
  }
  
  // Notify courier
  if (courierId && newStatus === 'assigned') {
    await createSystemNotification(
      courierId,
      'delivery_update',
      'New Delivery Assignment',
      'You have a new delivery assignment',
      deliveryId,
      'delivery',
      { status: newStatus }
    );
  }
};

// Notify new message
export const notifyNewMessage = async (conversationId, senderId, recipientIds, messagePreview) => {
  for (const recipientId of recipientIds) {
    if (recipientId === senderId) continue;
    
    await createSystemNotification(
      recipientId,
      'new_message',
      'New Message',
      messagePreview,
      conversationId,
      'conversation',
      { sender_id: senderId }
    );
  }
};

// Notify incoming call
export const notifyIncomingCall = async (calleeId, callerId, callerName, callId, conversationId, storeOrderId) => {
  await createSystemNotification(
    calleeId,
    'incoming_call',
    'Incoming Call',
    `${callerName} is calling you`,
    callId,
    'call',
    { 
      caller_id: callerId, 
      caller_name: callerName,
      conversation_id: conversationId,
      store_order_id: storeOrderId
    }
  );
};

// Notify missed call
export const notifyMissedCall = async (userId, callId, otherUserName) => {
  await createSystemNotification(
    userId,
    'missed_call',
    'Missed Call',
    `You missed a call from ${otherUserName}`,
    callId,
    'call'
  );
};

// Notify payment received
export const notifyPayment = async (userId, orderId, amount, method) => {
  await createSystemNotification(
    userId,
    'payment',
    'Payment Received',
    `Payment of ${amount} received via ${method}`,
    orderId,
    'order',
    { amount, method }
  );
};

// Notify refund
export const notifyRefund = async (userId, orderId, amount, reason) => {
  await createSystemNotification(
    userId,
    'refund',
    'Refund Processed',
    `Refund of ${amount} processed: ${reason}`,
    orderId,
    'order',
    { amount, reason }
  );
};

// Send push notification (via Firebase/Expo)
export const sendPushNotification = async (userId, title, body, data = {}) => {
  // Get user's push tokens
  const { data: tokens } = await supabaseAdmin
    .from('user_push_tokens')
    .select('token')
    .eq('user_id', userId);
  
  if (!tokens || tokens.length === 0) {
    return { success: false, message: 'No push tokens' };
  }
  
  // TODO: Implement actual push notification sending
  // This would use Firebase Admin SDK or Expo Push API
  
  return { success: true, sent: tokens.length };
};

// Cleanup old notifications (run via cron)
export const cleanupOldNotifications = async (daysOld = 90) => {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysOld);
  
  const { error } = await supabaseAdmin
    .from('notifications')
    .delete()
    .lt('created_at', cutoffDate.toISOString());
  
  if (error) {
    throw new AppError(`Notification cleanup failed: ${error.message}`, 500);
  }
  
  return { success: true };
};