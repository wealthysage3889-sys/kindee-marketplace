import asyncHandler from "express-async-handler";
import * as chatService from "../services/chatService.js";
import { AppError, NotFoundError } from "../middleware/errorHandler.js";
import { emitNewMessage, emitMessageRead } from "../services/socketService.js";
import { supabaseAdmin } from "../config/supabase.js";

const normalizeRole = (role) => (role === "owner" ? "admin" : role);

const isShopRole = (role) => role === "admin" || role === "seller";

const isPlatformAdmin = (user) => ["admin", "owner"].includes(user?.role);

const isStoreOwner = (store, userId) =>
  Boolean(store?.owner_id) && String(store.owner_id) === String(userId);

const getStoreById = async (storeId) => {
  const { data } = await supabaseAdmin
    .from('stores')
    .select('*')
    .eq('id', storeId)
    .single();
  return data;
};

const resolveStore = async (storeId) => {
  let store = await getStoreById(storeId);
  if (!store) {
    store = await supabaseAdmin
      .from('stores')
      .select('*')
      .or(`owner_id.eq.${storeId},seller_id.eq.${storeId},user_id.eq.${storeId}`)
      .single();
  }
  return store;
};

const canAccessRoom = async (store, user) =>
  isPlatformAdmin(user) ||
  isStoreOwner(store, user?.id) ||
  (await isRoomParticipant(store.id, user?.id));

const isRoomParticipant = async (storeId, userId) => {
  const { data } = await supabaseAdmin
    .from('messages')
    .select('id')
    .eq('store', storeId)
    .or(`sender.eq.${userId},receiver.eq.${userId}`)
    .limit(1);
  return data && data.length > 0;
};

// @desc    Get messages for a store (paginated)
// @route   GET /api/messages/:storeId
// @access  Private
const getMessages = asyncHandler(async (req, res) => {
  const { storeId } = req.params;
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 50;
  const startIndex = (page - 1) * limit;

  const store = await resolveStore(storeId);
  if (!store) {
    res.status(404).json({ success: false, message: "ไม่พบร้านค้า" });
    return;
  }

  if (!(await canAccessRoom(store, req.user))) {
    res.status(403).json({
      success: false,
      message: "คุณไม่มีสิทธิ์เข้าถึงห้องแชทนี้",
    });
    return;
  }

  const conversation = await chatService.getOrCreateConversation(req.user.id, store.id);
  
  const messages = await chatService.getMessages(conversation.id, req.user.id, {
    page,
    limit
  });

  const total = messages.length;

  res.json({
    success: true,
    count: messages.length,
    total,
    page,
    pages: Math.ceil(total / limit) || 1,
    data: messages,
  });
});

// @desc    Get chat list for the logged-in seller/admin
// @route   GET /api/messages
// @access  Private (seller, admin)
const getChatList = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const role = normalizeRole(req.user.role);

  let conversations;
  if (isShopRole(role)) {
    conversations = await chatService.getStoreConversations(userId, userId, {}, { page: 1, limit: 50 });
  } else {
    conversations = await chatService.getUserConversations(userId, {}, { page: 1, limit: 50 });
  }

  res.json({ success: true, data: conversations.conversations });
});

// @desc    Send a message
// @route   POST /api/messages/:storeId
// @access  Private
const sendMessage = asyncHandler(async (req, res) => {
  const { storeId } = req.params;
  const {
    text,
    content,
    receiverId,
    receiver,
    senderRole: requestedSenderRole,
  } = req.body;

  const rawText = text !== undefined && text !== null ? text : content;
  const messageText = typeof rawText === "string" ? rawText.trim() : "";

  if (!messageText) {
    res.status(400).json({ success: false, message: "กรุณากรอกข้อความ" });
    return;
  }

  if (!req.user || !req.user.id) {
    res.status(401).json({ success: false, message: "ไม่ได้รับอนุญาต กรุณาเข้าสู่ระบบ" });
    return;
  }

  const store = await resolveStore(storeId);
  if (!store) {
    res.status(404).json({ success: false, message: "ไม่พบร้านค้า" });
    return;
  }
  const resolvedStoreId = store.id;
  const storeOwnerId = store.owner_id;

  const senderId = req.user.id;
  const senderRole = normalizeRole(req.user.role);

  if (isShopRole(senderRole) && !isStoreOwner(store, senderId) && !isPlatformAdmin(req.user)) {
    res.status(403).json({
      success: false,
      message: "คุณไม่มีสิทธิ์ส่งข้อความในร้านค้านี้",
    });
    return;
  }

  if (requestedSenderRole) {
    const requested = normalizeRole(requestedSenderRole);
    if (isShopRole(requested) && !isShopRole(senderRole)) {
      res.status(403).json({
        success: false,
        message: "คุณไม่มีสิทธิ์ส่งข้อความในชื่อของร้านค้า",
      });
      return;
    }
  }

  const rawReceiverInput =
    receiverId !== undefined && receiverId !== null && receiverId !== ""
      ? receiverId
      : receiver !== undefined && receiver !== null && receiver !== ""
        ? receiver
        : undefined;

  let receiverIdFinal;
  let receiverRole;

  const findReceiver = async (id) => {
    if (!id) return null;
    const { data } = await supabaseAdmin
      .from('profiles')
      .select('role')
      .eq('id', id)
      .single();
    return data;
  };

  if (senderRole === "customer") {
    receiverIdFinal = storeOwnerId;
    const owner = await findReceiver(storeOwnerId);
    receiverRole = owner ? normalizeRole(owner.role) : "seller";
  } else {
    let receiverUser = rawReceiverInput ? await findReceiver(rawReceiverInput) : null;

    if (!receiverUser) {
      const latestCustomerMessage = await supabaseAdmin
        .from('messages')
        .select('sender, sender_role')
        .eq('store', resolvedStoreId)
        .eq('sender_role', 'customer')
        .neq('sender', senderId)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (latestCustomerMessage?.sender) {
        receiverUser = {
          _id: latestCustomerMessage.sender,
          role: latestCustomerMessage.sender_role,
        };
      } else {
        const latestOtherMessage = await supabaseAdmin
          .from('messages')
          .select('sender, sender_role')
          .eq('store', resolvedStoreId)
          .neq('sender', senderId)
          .order('created_at', { ascending: false })
          .limit(1)
          .single();

        if (latestOtherMessage?.sender) {
          receiverUser = {
            _id: latestOtherMessage.sender,
            role: latestOtherMessage.sender_role,
          };
        }
      }
    }

    if (!receiverUser || !receiverUser._id) {
      res.status(400).json({
        success: false,
        message: "ไม่พบแอดมินในห้องแชท",
      });
      return;
    }

    if (String(receiverUser._id) === String(senderId)) {
      const fallback = await supabaseAdmin
        .from('messages')
        .select('sender, sender_role')
        .eq('store', resolvedStoreId)
        .neq('sender', senderId)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (!fallback?.sender) {
        res.status(400).json({
          success: false,
          message: "ไม่พบแอดมินในห้องแชท",
        });
        return;
      }
      receiverUser = { _id: fallback.sender, role: fallback.sender_role };
    }

    receiverIdFinal = receiverUser._id;
    receiverRole = normalizeRole(receiverUser.role) || "customer";
  }

  if (!receiverIdFinal) {
    res.status(400).json({ success: false, message: "ไม่พบผู้รับข้อความ" });
    return;
  }

  const conversation = await chatService.getOrCreateConversation(
    senderRole === "customer" ? senderId : receiverIdFinal,
    resolvedStoreId
  );

  const message = await chatService.sendMessage(conversation.id, senderId, {
    content: messageText,
    type: 'text'
  });

  const populated = await chatService.getMessages(conversation.id, senderId, { page: 1, limit: 1 });
  const sentMessage = populated[0];

  emitNewMessage(sentMessage);

  res.status(201).json({ success: true, data: sentMessage });
});

// @desc    Mark messages as read
// @route   PUT /api/messages/:storeId/read
// @access  Private (seller, admin)
const markAsRead = asyncHandler(async (req, res) => {
  const { storeId } = req.params;
  const userId = req.user.id;

  const store = await resolveStore(storeId);
  if (!store) {
    res.status(404).json({ success: false, message: "ไม่พบร้านค้า" });
    return;
  }

  if (!(await canAccessRoom(store, req.user))) {
    res.status(403).json({
      success: false,
      message: "คุณไม่มีสิทธิ์เข้าถึงห้องแชทนี้",
    });
    return;
  }

  const conversation = await chatService.getOrCreateConversation(userId, store.id);
  
  await chatService.markMessagesRead(conversation.id, userId);

  emitMessageRead(store.id, userId, 1);

  res.json({ success: true, message: "marked as read" });
});

export {
  getMessages,
  getChatList,
  sendMessage,
  markAsRead,
};