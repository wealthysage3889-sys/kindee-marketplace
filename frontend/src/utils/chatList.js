// Pure helpers that update a conversation-list (inbox) in response to realtime
// socket events. They are deliberately free of React and I/O so the live-update
// rules (unread count, last-message preview, timestamp, ordering, de-duplication)
// can be unit tested directly.
//
// A chat row has the shape produced by SellAdminMessages' mapping:
//   { id, storeId, store, customerId, customer, lastMessage, unreadCount }

export function getMessageConversationId(message) {
  return message?.conversation_id ?? message?.conversationId ?? null;
}

export function getMessageSenderId(message) {
  return message?.sender_id ?? message?.senderId ?? null;
}

export function getMessageId(message) {
  return message?.id ?? message?._id ?? null;
}

// Apply an incoming "newMessage" event to the chat list.
//   - Message sent by the current user (another tab): refresh preview + order,
//     but never increase our own unread badge.
//   - Message from someone else in a known conversation: update preview +
//     timestamp, unread + 1, and move that conversation to the top.
//   - Unknown conversation: return found:false so the caller can refetch.
// Returns { chats, found, incremented, conversationId }.
export function applyIncomingMessage(chats, message, currentUserId) {
  const list = Array.isArray(chats) ? chats : [];
  const conversationId = getMessageConversationId(message);
  if (!conversationId) {
    return { chats: list, found: false, incremented: false, conversationId: null };
  }

  const index = list.findIndex((c) => String(c.id) === String(conversationId));
  if (index === -1) {
    return { chats: list, found: false, incremented: false, conversationId };
  }

  const senderId = getMessageSenderId(message);
  const isOwn = Boolean(senderId && currentUserId && String(senderId) === String(currentUserId));

  const target = list[index];
  const previousUnread = Number(target.unreadCount) || 0;
  const updated = {
    ...target,
    lastMessage: message,
    unreadCount: isOwn ? previousUnread : previousUnread + 1,
  };

  const next = list.slice();
  next.splice(index, 1);
  next.unshift(updated);

  return { chats: next, found: true, incremented: !isOwn, conversationId };
}

// Apply a "messagesRead" event. When the reader is the current user, reset that
// conversation's unread badge to the server-provided count (normally 0).
// Returns the same array reference when nothing changed.
export function applyReadReceipt(chats, conversationId, readByUserId, currentUserId, count = 0) {
  const list = Array.isArray(chats) ? chats : [];
  if (!conversationId) return list;
  if (currentUserId && String(readByUserId) !== String(currentUserId)) return list;

  const unreadCount = Number(count) || 0;
  let changed = false;
  const next = list.map((c) => {
    if (String(c.id) !== String(conversationId)) return c;
    if ((Number(c.unreadCount) || 0) === unreadCount) return c;
    changed = true;
    return { ...c, unreadCount };
  });

  return changed ? next : list;
}