import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useSocket } from "../context/SocketContext";
import { chatAPI, callAPI, uploadAPI, normalizeAttachment, adminAPI } from "../api";
import { formatDate } from "../utils/helpers";
import { extractStorageObjectPath } from "../utils/storageUrl";
import VoiceCallUI from "./VoiceCallUI";
import ChatRoutePanel from "./ChatRoutePanel";
import OrderDetailModal from "./OrderDetailModal";
import "./ChatRoom.css";

const MESSAGE_TYPES = {
  text: "text",
  image: "image",
  file: "file",
  location: "location",
  system: "system",
  order_update: "order_update",
  voice_call: "voice_call"
};

// Order status transition constants (mirrors AdminOrders logic)
const FORWARD_CHAIN = [
  "pending",
  "confirmed",
  "preparing",
  "ready_for_pickup",
  "picked_up",
  "in_transit",
  "delivered",
];

const DELIVERABLE_STATUSES = [
  "confirmed",
  "preparing",
  "ready_for_pickup",
  "picked_up",
  "in_transit",
];

const CANCELLABLE_STATUSES = [
  "pending",
  "confirmed",
  "preparing",
  "ready_for_pickup",
  "picked_up",
];

function getOrderCardStatusActions(status) {
  if (status === "pending") {
    return [{ value: "confirmed", label: "รับออเดอร์" }];
  }
  if (DELIVERABLE_STATUSES.includes(status)) {
    return [{ value: "delivered", label: "ส่งเสร็จ" }];
  }
  return [];
}

// The chat room is mounted from two routes:
//   /messages/:conversationId            -> customer session (kindee:customer:token)
//   /selladmin/messages/:conversationId  -> store owner/admin session (kindee:admin:token)
// Every chatAPI/uploadAPI call in this component must use the same mode, otherwise
// the token namespace is mixed inside one conversation (403 / 401).
export function resolveChatMode(mode, pathname = "") {
  if (mode === "admin" || mode === "customer") return mode;
  return pathname.startsWith("/selladmin") ? "admin" : "customer";
}

function attachmentUrl(att) {
  return att?.file_url || att?.fileUrl || att?.url;
}

function attachmentName(att) {
  return att?.file_name || att?.fileName || att?.name || "ไฟล์แนบ";
}

function attachmentMime(att) {
  return att?.mime_type || att?.mimeType || att?.type || "";
}

function attachmentSize(att) {
  const size = att?.file_size ?? att?.fileSize ?? att?.size ?? 0;
  return size > 0 ? `${(size / 1024).toFixed(1)} KB` : "";
}

// Chat attachments live in a private Supabase bucket and are persisted as
// signed URLs that expire (default 1h). A stored URL that has since expired
// returns 400/403 and the image breaks. This component renders the image and,
// on load failure, derives the { bucket, path } from the stored URL and fetches
// a fresh signed URL — so both old and new attachments display without changing
// where or how files are stored.
function AttachmentImage({ src, alt, onOpen, mode = "customer" }) {
  const [resolvedSrc, setResolvedSrc] = useState(src);
  const [error, setError] = useState(false);
  const retriedRef = useRef(false);

  useEffect(() => {
    setResolvedSrc(src);
    setError(false);
    retriedRef.current = false;
  }, [src]);

  const handleError = useCallback(async () => {
    if (retriedRef.current) {
      setError(true);
      return;
    }
    const parsed = extractStorageObjectPath(src);
    if (!parsed) {
      setError(true);
      return;
    }
    retriedRef.current = true;
    try {
      const res = await uploadAPI.getSignedUrl(parsed.bucket, parsed.path, 3600, mode);
      const fresh = res?.data?.signedUrl;
      if (fresh) {
        setResolvedSrc(fresh);
        setError(false);
      } else {
        setError(true);
      }
    } catch {
      setError(true);
    }
  }, [src, mode]);

  if (error) {
    return (
      <div className="attachment-image-error" role="button" tabIndex={0} onClick={() => onOpen?.(src)}>
        <span>โหลดรูปภาพไม่สำเร็จ</span>
      </div>
    );
  }

  return (
    <img
      src={resolvedSrc}
      alt={alt}
      onError={handleError}
      onClick={() => onOpen?.(resolvedSrc)}
    />
  );
}

export default function ChatRoom({ conversationId: conversationIdProp, mode: modeProp, initialMessages }) {
  const routeParams = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const conversationId = conversationIdProp || routeParams.conversationId;

  const { customer, admin } = useAuth();
  const mode = resolveChatMode(modeProp, location.pathname);
  const isAdminMode = mode === "admin";
  // Session that matches the route: seller/owner store owners still hold their
  // token in the customer namespace, admins hold theirs in the admin namespace.
  const session = mode === "admin" ? admin : customer;
  const user = session?.user;
  const currentUserId = user?.id || user?._id;

  const {
    connected,
    joinConversation,
    leaveConversation,
    on,
    off,
    emit
  } = useSocket();

  const [messages, setMessages] = useState(initialMessages || []);
  const [newMessage, setNewMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [conversation, setConversation] = useState(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState("");
  const [activeCall, setActiveCall] = useState(null);
  const [counterpartLastReadId, setCounterpartLastReadId] = useState(null);
  const [routePanelOpen, setRoutePanelOpen] = useState(false);
  const [orderDetailOpen, setOrderDetailOpen] = useState(false);
  const [orderDetailId, setOrderDetailId] = useState(null);
  const [orderActionLoading, setOrderActionLoading] = useState({});
  const [orderActionError, setOrderActionError] = useState({});

  const messagesEndRef = useRef(null);
  const messageInputRef = useRef(null);
  const fileInputRef = useRef(null);
  const typingTimeoutRef = useRef(null);
  const isTypingRef = useRef(false);
  // Last message id already reported as read for this room (prevents duplicate POSTs).
  const lastMarkedReadRef = useRef(null);
  const visibleRef = useRef(true);

  useEffect(() => {
    lastMarkedReadRef.current = null;
    setRoutePanelOpen(false);
  }, [conversationId, mode]);

  // Load conversation info
  useEffect(() => {
    if (!conversationId) return;
    let cancelled = false;
    chatAPI.getConversation(conversationId, mode)
      .then(res => {
        if (!cancelled) setConversation(res?.data || res || null);
      })
      .catch(err => {
        if (!cancelled) setError(err.message || "ไม่สามารถโหลดการสนทนาได้");
      });
    return () => { cancelled = true; };
  }, [conversationId, mode]);

  // Join conversation room once the socket is up (handlers below need `connected`).
  useEffect(() => {
    if (!conversationId || !connected) return;
    joinConversation(conversationId);
    return () => { leaveConversation(conversationId); };
  }, [conversationId, connected, joinConversation, leaveConversation]);

  const loadMessages = useCallback(async (pageNum = 1, append = false) => {
    if (!conversationId) return;
    setLoading(true);
    try {
      const result = await chatAPI.getMessages(conversationId, { page: pageNum, limit: 50 }, mode);
      const newMessages = Array.isArray(result?.data) ? result.data : [];

      if (append) {
        setMessages(prev => [...newMessages, ...prev]);
      } else {
        setMessages(newMessages);
      }

      setHasMore(newMessages.length === 50);
      setPage(pageNum);
    } catch (err) {
      setError(err.message || "ไม่สามารถโหลดข้อความได้");
    } finally {
      setLoading(false);
    }
  }, [conversationId, mode]);

  useEffect(() => {
    loadMessages(1, false);
  }, [conversationId, mode, loadMessages]);

  // Track tab visibility so we only mark messages read when the user can see them.
  useEffect(() => {
    const update = () => { visibleRef.current = document.visibilityState === "visible"; };
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);

  // Mark read: only for this room, only for messages the user did not send,
  // and only once per message id.
  const markAsRead = useCallback(async (lastReadMessageId) => {
    if (!conversationId || !lastReadMessageId) return;
    const id = String(lastReadMessageId);
    if (lastMarkedReadRef.current === id) return;
    lastMarkedReadRef.current = id;
    try {
      await chatAPI.markAsRead(conversationId, id, mode);
    } catch {
      lastMarkedReadRef.current = null;
    }
  }, [conversationId, mode]);

  // Handle order status change from the order card in chat
  // Mirrors AdminOrders logic: for "delivered" walk the forward chain from current status
  const handleOrderStatusChange = useCallback(async (orderId, newStatus, currentStatus) => {
    if (!orderId || !newStatus) return;
    if (!isAdminMode) return; // Only allow in admin/selladmin mode
    // Never re-send a status the order is already in. This prevents a stale
    // order card (whose snapshot status lags the live order) from firing a
    // no-op update such as confirmed -> confirmed. The backend also treats a
    // same-status update as an idempotent no-op as a second line of defence.
    if (currentStatus && newStatus === currentStatus) return;

    const loadingKey = `${orderId}-${newStatus}`;
    setOrderActionLoading((prev) => ({ ...prev, [loadingKey]: true }));
    setOrderActionError((prev) => ({ ...prev, [loadingKey]: "" }));

    try {
      let hops = [];
      if (newStatus === "delivered" && DELIVERABLE_STATUSES.includes(currentStatus)) {
        const currentIndex = FORWARD_CHAIN.indexOf(currentStatus);
        hops = currentIndex >= 0 ? FORWARD_CHAIN.slice(currentIndex + 1) : [];
      } else if (newStatus === "confirmed" && currentStatus === "pending") {
        hops = ["confirmed"];
      } else {
        // Order is not in a state this action applies to; skip without error
        setOrderActionLoading((prev) => ({ ...prev, [loadingKey]: false }));
        return;
      }

       let lastOrder = null;
       for (const hop of hops) {
         // eslint-disable-next-line no-await-in-loop
         const res = await adminAPI.updateOrderStatus(orderId, hop, hop === newStatus ? "" : undefined);
         lastOrder = res?.data || res || lastOrder;
       }
       const finalStatus = lastOrder?.status || newStatus;
       const statusLabels = {
         pending: "รอร้านค้ายืนยัน",
         confirmed: "ร้านค้ายืนยันแล้ว",
         preparing: "กำลังเตรียม",
         ready_for_pickup: "พร้อมรับ",
         picked_up: "รับแล้ว",
         in_transit: "กำลังจัดส่ง",
         delivered: "ส่งสำเร็จ",
         cancelled: "ยกเลิก",
         refunded: "คืนเงิน",
       };
       const finalLabel = statusLabels[finalStatus] || finalStatus;
       // Update the order card in chat from the real backend response
       setMessages((prev) =>
         prev.map((m) => {
           const meta = m.metadata || {};
           if (meta.kind !== "order_chat" || String(meta.order_id) !== String(orderId)) return m;
           return {
             ...m,
             metadata: {
               ...meta,
               order_status: finalStatus,
               order_status_label: finalLabel,
             },
           };
         })
       );
       // Clear error on success
       setOrderActionError((prev) => ({ ...prev, [loadingKey]: "" }));
    } catch (err) {
      setOrderActionError((prev) => ({ ...prev, [loadingKey]: err.message || "เปลี่ยนสถานะไม่สำเร็จ" }));
    } finally {
      setOrderActionLoading((prev) => ({ ...prev, [loadingKey]: false }));
    }
  }, [isAdminMode]);

  // Determine the other party in the conversation (counterpart)
  const currentMember = conversation?.members?.find(
    (m) => String(m.profile_id ?? m.profileId) === String(currentUserId)
  );
  const serverLastReadId = currentMember?.last_read_message_id
    ?? currentMember?.lastReadMessageId
    ?? null;

  // Determine display info (name, avatar, placeholder)
  const counterpart = conversation?.members?.find(
    (m) => String(m.profile_id ?? m.profileId) !== String(currentUserId)
  );
  const counterpartProfile = counterpart?.profile || null;
  const displayName = isAdminMode && conversation?.type === "store_customer"
    ? (counterpartProfile?.name || "ลูกค้า")
    : (conversation?.store?.name || conversation?.title || "การสนทนา");
  const displayAvatar = isAdminMode && conversation?.type === "store_customer"
    ? counterpartProfile?.avatar_url
    : conversation?.store?.logo_url;
  const placeholder = isAdminMode && conversation?.type === "store_customer" ? "ล" : "ร";

  // On open (and on every new message) mark the newest inbound message as read.
  // Marking the newest inbound message (not simply the last message) keeps the
  // unread counter correct when the last message in the room was sent by us.
  useEffect(() => {
    if (!messages.length || !currentUserId) return;
    const lastInbound = [...messages]
      .reverse()
      .find((m) => String(m.sender_id ?? m.senderId) !== String(currentUserId));
    if (!lastInbound) return;
    const lastInboundId = lastInbound.id ?? lastInbound._id;
    if (serverLastReadId && String(serverLastReadId) === String(lastInboundId)) return;
    markAsRead(lastInboundId);
  }, [messages, currentUserId, serverLastReadId, markAsRead]);

  // Scroll to bottom
  const scrollToBottom = useCallback(() => {
    if (messagesEndRef.current?.scrollIntoView) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // Socket event handlers (stable callbacks so on()/off() can match references
  // and never leak duplicate listeners on the socket).
  const handleNewMessage = useCallback((message) => {
    const incomingConversationId = message?.conversation_id ?? message?.conversationId;
    // Never touch another room's state.
    if (incomingConversationId && String(incomingConversationId) !== String(conversationId)) return;

    const senderId = message?.sender_id ?? message?.senderId;
    if (senderId && currentUserId && String(senderId) === String(currentUserId)) return;

    setMessages(prev => {
      const id = message?.id ?? message?._id;
      if (prev.some(m => String(m.id ?? m._id) === String(id))) return prev;
      const incomingMeta = message?.metadata || {};
      const incomingOrderId = incomingMeta.order_id ?? incomingMeta.orderId;
      const incomingStatus = incomingMeta.order_status ?? incomingMeta.orderStatus;
      let next = prev;
      if (incomingMeta.kind === "order_chat" && incomingOrderId && incomingStatus) {
        next = prev.map((m) => {
          const meta = m.metadata || {};
          if (meta.kind !== "order_chat") return m;
          const mid = meta.order_id ?? meta.orderId;
          if (String(mid) !== String(incomingOrderId)) return m;
          return {
            ...m,
            metadata: {
              ...meta,
              order_status: incomingStatus,
              order_status_label: incomingMeta.order_status_label ?? incomingMeta.orderStatusLabel ?? meta.order_status_label,
            },
          };
        });
      }
      return [...next, message];
    });

    // User is in the room and can see the message -> mark read now.
    if (visibleRef.current) {
      markAsRead(message?.id ?? message?._id);
    }
  }, [conversationId, currentUserId, markAsRead]);

  const handleCallStatusUpdate = useCallback((data) => {
    const incomingConvId = data?.conversation_id ?? data?.conversationId;
    if (incomingConvId && String(incomingConvId) !== String(conversationId)) return;

    const status = data?.status;
    const duration = data?.duration_seconds ?? 0;
    const callId = data?.call_id ?? data?.callId;
    if (!status || !callId) return;

    const statusLabels = {
      completed: 'สนทนาสำเร็จ',
      no_answer: 'ไม่ได้รับสาย',
      cancelled: 'ยกเลิกการโทร',
      rejected: 'ปฏิเสธสาย',
      failed: 'โทรไม่สำเร็จ',
      accepted: 'รับสายแล้ว',
    };
    const statusLabel = statusLabels[status] || status;
    const durationText = duration > 0
      ? ` • ${Math.floor(duration / 60)}:${String(duration % 60).padStart(2, '0')} นาที`
      : '';

    // Add as a synthetic system message (voice_call type)
    const callEventMessage = {
      id: `call-event-${callId}-${status}`,
      conversation_id: conversationId,
      type: 'voice_call',
      content: `📞 ${statusLabel}${durationText}`,
      metadata: { call_id: callId, call_status: status, duration_seconds: duration },
      created_at: new Date().toISOString(),
      sender_id: data?.caller_id,
    };

    setMessages(prev => {
      // Avoid duplicate call events
      if (prev.some(m => m.id === callEventMessage.id)) return prev;
      return [...prev, callEventMessage];
    });
  }, [conversationId]);

  useEffect(() => {
    if (!connected) return;

    on("newMessage", handleNewMessage);
    on("callStatusUpdate", handleCallStatusUpdate);

    return () => {
      off("newMessage", handleNewMessage);
      off("callStatusUpdate", handleCallStatusUpdate);
    };
  }, [connected, on, off, handleNewMessage, handleCallStatusUpdate]);

  // Send message
  const handleSendMessage = async (e) => {
    e?.preventDefault?.();

    if ((!newMessage.trim() && selectedFiles.length === 0) || sending) return;

    setSending(true);
    const content = newMessage.trim();
    setNewMessage("");
    const filesToSend = [...selectedFiles];
    setSelectedFiles([]);
    isTypingRef.current = false;
    clearTimeout(typingTimeoutRef.current);
    stopTyping();
    setError("");

    try {
      let attachments = [];
      if (filesToSend.length > 0) {
        const uploadResult = await uploadAPI.uploadChatAttachment(conversationId, filesToSend, mode);
        const uploaded = Array.isArray(uploadResult?.data) ? uploadResult.data : [];
        attachments = uploaded.map(normalizeAttachment);
      }

      const type = filesToSend.length > 0
        ? (filesToSend.every(f => (f.type || "").startsWith("image/")) ? "image" : "file")
        : "text";

      const result = await chatAPI.sendMessage(conversationId, {
        content: content || undefined,
        type,
        attachments,
        metadata: {}
      }, mode);

      const saved = result?.data || result;
      if (saved?.id || saved?._id) {
        setMessages(prev => {
          const id = saved.id ?? saved._id;
          if (prev.some(m => String(m.id ?? m._id) === String(id))) return prev;
          return [...prev, saved];
        });
      }
    } catch (err) {
      setError(err.message || "ไม่สามารถส่งข้อความได้");
      // Restore message on error
      setNewMessage(content);
      setSelectedFiles(filesToSend);
    } finally {
      setSending(false);
    }
  };

  // Typing indicator
  const handleTyping = () => {
    if (!isTypingRef.current) {
      isTypingRef.current = true;
      emit("typing", { conversationId, userId: currentUserId, name: user?.name });
    }

    clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      isTypingRef.current = false;
      stopTyping();
    }, 2000);
  };

  const stopTyping = () => {
    emit("stopTyping", { conversationId, userId: currentUserId });
  };

  // File selection
  const handleFileSelect = (e) => {
    const files = Array.from(e.target.files || []);
    const validFiles = files.filter(f => {
      const maxSize = 20 * 1024 * 1024; // 20MB
      if (f.size > maxSize) {
        setError(`ไฟล์ ${f.name} มีขนาดใหญ่เกินไป (สูงสุด 20MB)`);
        return false;
      }
      return true;
    });

    setSelectedFiles(prev => [...prev, ...validFiles].slice(0, 5));
    e.target.value = "";
  };

  const removeFile = (index) => {
    setSelectedFiles(prev => prev.filter((_, i) => i !== index));
  };

  // Load more messages
  const handleLoadMore = () => {
    if (!loading && hasMore) {
      loadMessages(page + 1, true);
    }
  };

  // Format message time
  const formatMessageTime = (dateStr) => {
    const date = new Date(dateStr);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const msgDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());

    if (msgDate.getTime() === today.getTime()) {
      return date.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });
    } else if (msgDate.getTime() === today.getTime() - 86400000) {
      return "เมื่อวาน " + date.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });
    } else {
      return date.toLocaleDateString("th-TH", { month: "short", day: "numeric" }) + " " +
             date.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });
    }
  };

  // Render the rich order card for order_update messages. Falls back to the
  // plain text body when metadata is missing (legacy/system messages).
  const renderOrderUpdate = (message) => {
    const meta = message.metadata || {};
    const isOrderChat = meta.kind === "order_chat";

    const openOrder = () => {
      const orderId = meta.order_id;
      if (orderId) {
        setOrderDetailId(orderId);
        setOrderDetailOpen(true);
      }
    };

    if (!isOrderChat) {
      return (
        <div className="message-order-update">
          <span className="order-badge">📦 อัปเดตออเดอร์</span>
          <p>{message.content}</p>
        </div>
      );
    }

    const items = Array.isArray(meta.items) ? meta.items : [];
    const formatTHB = (amount) => {
      const n = Number(amount);
      if (!Number.isFinite(n)) return "฿0.00";
      return `฿${n.toFixed(2)}`;
    };

    return (
      <div className="message-order-card">
        <div className="order-card-head">
          <span className="order-card-badge">📦 {meta.headline || "คำสั่งซื้อ"}</span>
          {meta.store_order_number && (
            <span className="order-card-number">#{meta.store_order_number}</span>
          )}
        </div>
        {items.length > 0 && (
          <ul className="order-card-items">
            {items.map((it, i) => (
              <li key={it.product_name ? `${it.product_name}-${i}` : i}>
                <span className="order-card-item-name">{it.product_name}</span>
                <span className="order-card-item-qty">× {it.quantity}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="order-card-totals">
          <div className="order-card-row">
            <span>ยอดรวม</span>
            <span className="order-card-total">{formatTHB(meta.total_amount)}</span>
          </div>
          <div className="order-card-row">
            <span>ค่าจัดส่ง</span>
            <span>{formatTHB(meta.shipping_fee)}</span>
          </div>
        </div>
        <div className="order-card-meta">
          <div className="order-card-row">
            <span>ชำระเงิน</span>
            <span>{meta.payment_method_label || meta.payment_method || "-"}</span>
          </div>
          <div className="order-card-row">
            <span>สถานะคำสั่งซื้อ</span>
            <span className={`order-card-status status-${meta.order_status || ""}`}>
              {meta.order_status_label || meta.order_status || "-"}
            </span>
          </div>
          <div className="order-card-row">
            <span>สถานะชำระเงิน</span>
            <span className={`order-card-status pay-${meta.payment_status || ""}`}>
              {meta.payment_status_label || meta.payment_status || "-"}
            </span>
          </div>
          {meta.ordered_at && (
            <div className="order-card-row">
              <span>วันที่สั่งซื้อ</span>
              <span>{formatDate(meta.ordered_at)}</span>
            </div>
          )}
        </div>
        {(meta.order_url || meta.order_id) && (
          <button type="button" className="order-card-link" onClick={openOrder}>
            ดูรายละเอียดคำสั่งซื้อ →
          </button>
        )}
        {/* Status change buttons for store owners in selladmin chat */}
        {isAdminMode && meta.order_id && (() => {
          const currentStatus = meta.order_status;
          const actions = getOrderCardStatusActions(currentStatus);
          if (actions.length === 0) return null;

          return (
            <div className="order-card-actions">
              {actions.map((action) => {
                const loadingKey = `${meta.order_id}-${action.value}`;
                const isLoading = orderActionLoading[loadingKey];
                const actionError = orderActionError[loadingKey];
                const handleClick = () => handleOrderStatusChange(meta.order_id, action.value, currentStatus);

                return (
                  <button
                    key={action.value}
                    type="button"
                    className={`btn ${action.value === "cancelled" ? "btn-danger" : "btn-primary"}`}
                    onClick={handleClick}
                    disabled={isLoading}
                    style={{ marginTop: 8, marginRight: 8 }}
                  >
                    {isLoading ? "กำลังดำเนินการ..." : action.label}
                  </button>
                );
              })}
              {Object.keys(orderActionError).some(k => k.startsWith(meta.order_id) && orderActionError[k]) && (
                <div className="order-card-action-error" role="alert" style={{ marginTop: 8, color: "var(--color-error)", fontSize: 13 }}>
                  {Object.entries(orderActionError).find(([k, v]) => k.startsWith(meta.order_id) && v)?.[1]}
                </div>
              )}
            </div>
          );
        })()}
      </div>
    );
  };

  // Render message content
  const renderMessageContent = (message) => {
    const attachments = message.attachments || [];
    const firstAttachment = attachments[0];

    switch (message.type) {
      case "image":
        return (
          <div className="message-image">
            <AttachmentImage
              src={attachmentUrl(firstAttachment) || message.content}
              alt={attachmentName(firstAttachment)}
              mode={mode}
              onOpen={(url) => {
                if (url) window.open(url, "_blank");
              }}
            />
          </div>
        );
      case "file":
        return (
          <div className="message-file">
            <a href={attachmentUrl(firstAttachment)} target="_blank" rel="noopener noreferrer">
              <span className="file-icon">📄</span>
              <span className="file-name">{attachmentName(firstAttachment)}</span>
              <span className="file-size">{attachmentSize(firstAttachment)}</span>
            </a>
          </div>
        );
      case "location":
        return (
          <div className="message-location">
            📍 {message.content}
          </div>
        );
      case "system":
        return (
          <div className="message-system">{message.content}</div>
        );
      case "order_update":
        return renderOrderUpdate(message);
      case "voice_call":
        return (
          <div className="message-voice-call">
            <span className="call-badge">📞 การโทร</span>
            <p>{message.content}</p>
          </div>
        );
      default:
        return (
          <>
            {message.content && <div className="message-text">{message.content}</div>}
            {attachments.length > 0 && (
              <div className="message-attachments">
                {attachments.map((att, i) => (
                  <div key={att.id || i} className="attachment">
                    {attachmentMime(att).startsWith("image/") ? (
                      <AttachmentImage
                        src={attachmentUrl(att)}
                        alt={attachmentName(att)}
                        mode={mode}
                        onOpen={(url) => window.open(url, "_blank")}
                      />
                    ) : (
                      <a href={attachmentUrl(att)} target="_blank" rel="noopener noreferrer">
                        <span className="file-icon">📄</span>
                        <span>{attachmentName(att)}</span>
                      </a>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        );
    }
  };

  if (!conversationId) {
    return <div className="chat-empty">เลือกการสนทนาเพื่อเริ่มแชท</div>;
  }

  const handleStartCall = async () => {
    if (!counterpartProfile?.id) {
      setError("ไม่สามารถหาข้อมูลผู้รับได้");
      return;
    }
    try {
      // Send storeOrderId as explicit null when no order exists.
      // The API accepts null for store_customer conversations without an order.
      const storeOrderId = conversation?.store_order?.id ?? conversation?.store_order_id ?? null;
      const result = await callAPI.initiate({
        calleeId: counterpartProfile.id,
        conversationId,
        storeOrderId,
        callType: "voice"
      }, mode);
      setActiveCall({
        callId: result.data.id,
        calleeId: counterpartProfile.id,
        conversationId,
        storeOrderId: conversation?.store_order?.id ?? null,
        callerName: displayName,
        callerAvatar: displayAvatar
      });
    } catch (err) {
      setError(err.message || "ไม่สามารถ initiate สายได้");
    }
  };

  if (activeCall) {
    return (
      <VoiceCallUI
        initialCallId={activeCall.callId}
        calleeId={activeCall.calleeId}
        callMode={mode}
        conversationId={activeCall.conversationId}
        storeOrderId={activeCall.storeOrderId}
        callerName={activeCall.callerName}
        callerAvatar={activeCall.callerAvatar}
        onClose={() => setActiveCall(null)}
        onCallEnded={() => setActiveCall(null)}
      />
    );
  }

  return (
    <div className="chat-room">
      <div className="chat-header">
        <div className="chat-header-left">
          <button type="button" className="chat-back" onClick={() => navigate(isAdminMode ? "/selladmin/messages" : "/messages")} aria-label="ย้อนกลับ">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m15 18-6-6 6-6" />
            </svg>
          </button>
          <div className="chat-avatar">
            {displayAvatar ? (
              <img src={displayAvatar} alt={displayName} />
            ) : (
              <span>{displayName?.charAt(0) || placeholder}</span>
            )}
          </div>
          <div className="chat-title">
            <h3>{displayName}</h3>
            {conversation?.store_order && (
              <span className="chat-order">ออเดอร์ #{conversation.store_order.store_order_number}</span>
            )}
          </div>
        </div>
        <div className="chat-header-right">
          {isAdminMode && conversationId && (
            <button
              className="call-btn map-btn"
              type="button"
              onClick={() => setRoutePanelOpen(true)}
              title="ดูเส้นทาง"
              aria-label="ดูเส้นทาง"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="6" cy="19" r="3" />
                <path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15" />
                <circle cx="18" cy="5" r="3" />
              </svg>
            </button>
          )}
          {conversation?.type === "store_customer" && counterpartProfile?.id && (
            <button className="call-btn" type="button" onClick={handleStartCall} title="打电话">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path>
              </svg>
            </button>
          )}
        </div>
      </div>

      <div className="chat-messages">
        {hasMore && (
          <button className="load-more-btn" type="button" onClick={handleLoadMore} disabled={loading}>
            {loading ? "กำลังโหลด..." : "โหลดข้อความก่อนหน้า"}
          </button>
        )}

        {messages.map((message, index) => {
          const messageId = message.id ?? message._id;
          const senderId = message.sender_id ?? message.senderId;
          const isOwn = currentUserId && String(senderId) === String(currentUserId);
          const createdAt = message.created_at ?? message.createdAt;
          const showTime = index === 0 ||
            new Date(createdAt).getTime() - new Date(messages[index - 1]?.created_at ?? messages[index - 1]?.createdAt).getTime() > 5 * 60 * 1000;

          return (
            <div key={messageId} className={`message ${isOwn ? "own" : ""}`}>
              {!isOwn && (
                <div className="message-sender">
                  {message.sender?.avatar_url && (
                    <img src={message.sender.avatar_url} alt={message.sender?.name} />
                  )}
                  <span>{message.sender?.name}</span>
                </div>
              )}

              <div className="message-bubble">
                {renderMessageContent(message)}

                <div className="message-time">
                  {formatMessageTime(createdAt)}
                  {isOwn && message.is_read && <span className="read-receipt">✓✓</span>}
                </div>
              </div>

              {showTime && (
                <div className="message-date-separator">{formatDate(createdAt)}</div>
              )}
            </div>
          );
        })}

        <div ref={messagesEndRef} />
      </div>

      {error && <div className="chat-error">{error}</div>}

      <form onSubmit={handleSendMessage} className="chat-input-area">
        {selectedFiles.length > 0 && (
          <div className="selected-files">
            {selectedFiles.map((file, index) => (
              <span className="selected-file" key={`${file.name}-${index}`}>
                {file.name} ({(file.size / 1024).toFixed(1)} KB)
                <button type="button" onClick={() => removeFile(index)}>×</button>
              </span>
            ))}
          </div>
        )}

        <div className="input-row">
          <button
            type="button"
            className="attach-btn"
            onClick={() => fileInputRef.current?.click()}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.49"></path>
            </svg>
          </button>

          <input
            type="file"
            multiple
            accept="image/*,application/pdf,.doc,.docx"
            onChange={handleFileSelect}
            className="file-input"
            style={{ display: "none" }}
            ref={fileInputRef}
          />

          <input
            ref={messageInputRef}
            type="text"
            value={newMessage}
            onChange={(e) => {
              setNewMessage(e.target.value);
              handleTyping();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSendMessage(e);
              }
            }}
            placeholder="พิมพ์ข้อความ..."
            className="message-input"
            disabled={sending}
          />

          <button
            type="submit"
            className="send-btn"
            disabled={(!newMessage.trim() && selectedFiles.length === 0) || sending}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="22" y1="2" x2="11" y2="13"></line>
              <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
            </svg>
          </button>
        </div>
      </form>

      {routePanelOpen && isAdminMode && (
        <ChatRoutePanel
          conversationId={conversationId}
          mode={mode}
          messages={messages}
          currentUserId={currentUserId}
          onClose={() => setRoutePanelOpen(false)}
        />
      )}

      <OrderDetailModal
        isOpen={orderDetailOpen}
        onClose={() => {
          setOrderDetailOpen(false);
          setOrderDetailId(null);
        }}
        orderId={orderDetailId}
        mode={mode}
      />
    </div>
  );
}




