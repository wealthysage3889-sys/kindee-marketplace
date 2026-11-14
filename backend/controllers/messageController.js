const asyncHandler = require("express-async-handler");
const mongoose = require("mongoose");
const Message = require("../models/Message");
const Store = require("../models/Store");
const User = require("../models/User");
const { emitNewMessage, emitMessageRead } = require("../services/socketService");

const normalizeRole = (role) => (role === "owner" ? "admin" : role);

const isShopRole = (role) => role === "admin" || role === "seller";

const isPlatformAdmin = (user) => ["admin", "owner"].includes(user?.role);

const isStoreOwner = (store, userId) =>
  Boolean(store?.owner) && String(store.owner) === String(userId);

// A user may read/write a room when they own the store, are a platform admin, or
// already take part in that room's conversation.
const isRoomParticipant = (storeId, userId) =>
  Message.exists({
    store: storeId,
    $or: [{ sender: userId }, { receiver: userId }],
  });

const canAccessRoom = async (store, user) =>
  isPlatformAdmin(user) ||
  isStoreOwner(store, user?.id) ||
  Boolean(await isRoomParticipant(store._id, user?.id));

// Resolve a store by its id, falling back to owner/seller/user id (temporary stores
// created by the public store listing are not persisted, so their id equals the
// owner user id).
const resolveStore = async (storeId) => {
  if (!mongoose.Types.ObjectId.isValid(storeId)) return null;
  let store = await Store.findById(storeId);
  if (!store) {
    store = await Store.findOne({
      $or: [{ owner: storeId }, { seller: storeId }, { user: storeId }],
    });
  }
  return store;
};

// @desc    Get messages for a store (paginated)
// @route   GET /api/messages/:storeId
// @access  Private
const getMessages = asyncHandler(async (req, res) => {
  const { storeId } = req.params;
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 50);
  const startIndex = (page - 1) * limit;

  const store = await resolveStore(storeId);
  if (!store) {
    res.status(404).json({ success: false, message: "ไม่พบร้านค้า" });
    return;
  }

  // Only the store owner, a platform admin, or a participant of this room may
  // read its messages.
  if (!(await canAccessRoom(store, req.user))) {
    res.status(403).json({
      success: false,
      message: "คุณไม่มีสิทธิ์เข้าถึงห้องแชทนี้",
    });
    return;
  }

  const total = await Message.countDocuments({ store: store._id });
  const messages = await Message.find({ store: store._id })
    .sort("createdAt")
    .skip(startIndex)
    .limit(limit)
    .populate("sender", "name role avatar")
    .populate("receiver", "name role avatar");

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

  // Stores owned/managed by this user (seller/admin/owner).
  const ownedStores = await Store.find({ owner: userId }).select("_id");
  const ownedStoreIds = ownedStores.map((s) => s._id);

  // Match messages that belong to the user's stores OR where the user is a direct
  // participant (sender/receiver). This makes the chat list work for sellers who
  // own a store as well as platform admins who are participants in a conversation.
  const orConditions = [{ sender: userId }, { receiver: userId }];
  if (ownedStoreIds.length > 0) {
    orConditions.push({ store: { $in: ownedStoreIds } });
  }

  const messages = await Message.find({ $or: orConditions })
    .sort("-createdAt")
    .populate("store", "name logo")
    .populate("sender", "name role avatar")
    .populate("receiver", "name role avatar");

  // Group by store
  const chatMap = new Map();
  for (const msg of messages) {
    const storeId = (msg.store?._id || msg.store).toString();
    if (!chatMap.has(storeId)) {
      chatMap.set(storeId, {
        storeId,
        store: msg.store,
        lastMessage: msg,
        unreadCount: 0,
      });
    }
    const entry = chatMap.get(storeId);
    const receiverId = (msg.receiver?._id || msg.receiver)?.toString?.() || String(msg.receiver);
    if (receiverId === userId && !msg.isRead) {
      entry.unreadCount += 1;
    }
    if (new Date(msg.createdAt) > new Date(entry.lastMessage.createdAt)) {
      entry.lastMessage = msg;
    }
  }

  const chats = Array.from(chatMap.values()).sort(
    (a, b) => new Date(b.lastMessage.createdAt) - new Date(a.lastMessage.createdAt)
  );

  res.json({ success: true, data: chats });
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

    // Accept either `text` (legacy/customer client) or `content` (admin client).
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
    const resolvedStoreId = store._id;
    const storeOwnerId = store.owner;

    const senderId = req.user.id;
    const senderRole = normalizeRole(req.user.role);

    // A customer may always write to a store. A shop-side account (seller/admin)
    // must pass a store-ownership check before sending to prevent 403/unauthorized access.
    if (isShopRole(senderRole) && !isStoreOwner(store, senderId) && !isPlatformAdmin(req.user)) {
      res.status(403).json({
        success: false,
        message: "คุณไม่มีสิทธิ์ส่งข้อความในร้านค้านี้",
      });
      return;
    }

    // Client-provided senderRole is used for UI hints only and must not escalate privileges.
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

    // Accept both `receiverId` and `receiver` from the client.
    // Treat empty string as missing so the fallback logic can run.
    const rawReceiverInput =
      receiverId !== undefined && receiverId !== null && receiverId !== ""
        ? receiverId
        : receiver !== undefined && receiver !== null && receiver !== ""
          ? receiver
          : undefined;

    let receiverIdFinal;
    let receiverRole;

    const findReceiver = async (id) => {
      if (!id || !mongoose.Types.ObjectId.isValid(String(id))) return null;
      return User.findById(id).select("role");
    };

    if (senderRole === "customer") {
      // Customer → store: send to the store owner (the seller/admin).
      receiverIdFinal = storeOwnerId;
      const owner = await findReceiver(storeOwnerId);
      receiverRole = owner ? normalizeRole(owner.role) : "seller";
    } else {
      // Shop → customer: prefer an explicit receiver, then the latest customer
      // message in the room, then any other participant of the room. An explicit
      // receiver that cannot be resolved falls back to auto-detection instead of
      // failing the request (the admin UI is store-scoped and may not know the id).
      let receiverUser = rawReceiverInput ? await findReceiver(rawReceiverInput) : null;

      if (!receiverUser) {
        const latestCustomerMessage = await Message.findOne({
          store: resolvedStoreId,
          senderRole: "customer",
          sender: { $ne: senderId },
        })
          .sort("-createdAt")
          .populate("sender", "role");

        if (latestCustomerMessage?.sender?._id) {
          receiverUser = {
            _id: latestCustomerMessage.sender._id,
            role: latestCustomerMessage.sender.role,
          };
        } else {
          const latestOtherMessage = await Message.findOne({
            store: resolvedStoreId,
            sender: { $ne: senderId },
          })
            .sort("-createdAt")
            .populate("sender", "role");

          if (latestOtherMessage?.sender?._id) {
            receiverUser = {
              _id: latestOtherMessage.sender._id,
              role: latestOtherMessage.sender.role,
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

      // Never allow a message to be addressed to its own sender.
      if (String(receiverUser._id) === String(senderId)) {
        const fallback = await Message.findOne({
          store: resolvedStoreId,
          sender: { $ne: senderId },
        })
          .sort("-createdAt")
          .populate("sender", "role");

        if (!fallback?.sender?._id) {
          res.status(400).json({
            success: false,
            message: "ไม่พบแอดมินในห้องแชท",
          });
          return;
        }
        receiverUser = { _id: fallback.sender._id, role: fallback.sender.role };
      }

      receiverIdFinal = receiverUser._id;
      receiverRole = normalizeRole(receiverUser.role) || "customer";
    }

    if (!receiverIdFinal) {
      res.status(400).json({ success: false, message: "ไม่พบผู้รับข้อความ" });
      return;
    }

    const message = await Message.create({
      store: resolvedStoreId,
      sender: senderId,
      senderRole,
      receiver: receiverIdFinal,
      receiverRole: receiverRole || "customer",
      text: messageText,
    });

    const populated = await Message.findById(message._id)
      .populate("sender", "name role avatar")
      .populate("receiver", "name role avatar")
      .populate("store", "name logo");

    // Emit real-time update
    emitNewMessage(populated);

    res.status(201).json({ success: true, data: populated });
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

  // Only the store owner, a platform admin, or a participant of this room may
  // update read receipts.
  if (!(await canAccessRoom(store, req.user))) {
    res.status(403).json({
      success: false,
      message: "คุณไม่มีสิทธิ์เข้าถึงห้องแชทนี้",
    });
    return;
  }

  const result = await Message.updateMany(
    { store: store._id, receiver: userId, isRead: false },
    { $set: { isRead: true } }
  );

  emitMessageRead(store._id, userId, result.modifiedCount);

  res.json({ success: true, message: "marked as read" });
});

module.exports = {
  getMessages,
  getChatList,
  sendMessage,
  markAsRead,
};