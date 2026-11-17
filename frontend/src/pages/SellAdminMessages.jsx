import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useSocket } from "../context/SocketContext";
import { chatAPI } from "../api";
import {
  applyIncomingMessage,
  applyReadReceipt,
  getMessageConversationId,
  getMessageId,
} from "../utils/chatList";

const formatTime = (iso) => {
  try {
    return new Date(iso).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
};

const formatDate = (iso) => {
  try {
    return new Date(iso).toLocaleDateString("th-TH", { day: "numeric", month: "short" });
  } catch {
    return "";
  }
};

// Cap the de-dupe set so a long-lived tab does not grow it without bound.
const SEEN_LIMIT = 1000;

export default function SellAdminMessages() {
  const { admin } = useAuth();
  const user = admin?.user;
  const [chats, setChats] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const navigate = useNavigate();

  const { connected, on, off } = useSocket();

  const currentUserId = user?.id || user?._id || null;

  // Log authenticated user ID when it changes
  useEffect(() => {
    if (currentUserId) {
      console.log("[ChatList] authenticated user ID", { currentUserId });
    }
  }, [currentUserId]);

  // Log socket connection status
  useEffect(() => {
    console.log("[ChatList] socket connected", { connected });
  }, [connected]);

  // Mirror of `chats` so socket handlers can compute the next state and log
  // before/after values synchronously, without side effects inside a state
  // updater (which React may invoke twice in StrictMode).
  const chatsRef = useRef([]);
  const mountedRef = useRef(true);
  // Message ids already reflected in the list (or already counted). A message
  // delivered twice (socket + a later refetch, or a reconnect replay) must never
  // bump the unread badge twice or duplicate a preview.
  const seenMessageIdsRef = useRef(new Set());

  const rememberSeen = useCallback((id) => {
    if (id == null) return;
    const seen = seenMessageIdsRef.current;
    const key = String(id);
    if (seen.has(key)) return;
    seen.add(key);
    if (seen.size > SEEN_LIMIT) {
      // Drop the oldest inserted id (Set preserves insertion order).
      const oldest = seen.values().next().value;
      if (oldest !== undefined) seen.delete(oldest);
    }
  }, []);

  const mapConversation = useCallback(
    (c) => {
      const members = Array.isArray(c.members) ? c.members : [];
      // คู่สนทนาของ Admin/Owner คือสมาชิกที่ไม่ใช่ตัวเอง (ลูกค้า)
      // ไม่ให้นำ Profile ของ Admin/Owner ที่ล็อกอินอยู่มาแสดงเป็นคู่สนทนา
      const currentMember = members.find((m) => String(m.profile_id) === String(currentUserId));
      const counterpart = members.find((m) => String(m.profile_id) !== String(currentUserId));
      const customerProfile = counterpart?.profile || null;
      const customerName =
        customerProfile?.name ||
        customerProfile?.display_name ||
        customerProfile?.full_name ||
        "ลูกค้า";
      const customerAvatar =
        customerProfile?.avatar_url ||
        customerProfile?.avatarUrl ||
        customerProfile?.profile_image_url ||
        null;

      return {
        id: c.id,
        storeId: c.store_id,
        store: c.store || null,
        customerId: counterpart?.profile_id || null,
        customer: {
          id: customerProfile?.id || null,
          name: customerName,
          avatar_url: customerAvatar,
          role: customerProfile?.role || null,
        },
        lastMessage: c.last_message || null,
        unreadCount: currentMember?.unread_count || 0,
      };
    },
    [currentUserId]
  );

  const seedSeenFromList = useCallback(
    (list) => {
      list.forEach((c) => rememberSeen(getMessageId(c.lastMessage)));
    },
    [rememberSeen]
  );

  const loadChats = useCallback(async () => {
    try {
      setError("");
      // GET /api/chat/conversations  (with admin token) -> all conversations
      // the admin/seller is a member of.
      const data = await chatAPI.getConversations({}, "admin");
      const list = Array.isArray(data?.data?.conversations)
        ? data.data.conversations
        : Array.isArray(data?.data)
          ? data.data
          : [];
      if (!mountedRef.current) return;
      const mapped = list.map(mapConversation);
      seedSeenFromList(mapped);
      chatsRef.current = mapped;
      setChats(mapped);
      console.log("[ChatList] loaded", {
        conversations: mapped.length,
        totalUnread: mapped.reduce((sum, c) => sum + (c.unreadCount || 0), 0),
      });
    } catch (err) {
      if (mountedRef.current) setError(err.message || "ไม่สามารถโหลดรายการแชทได้");
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [mapConversation, seedSeenFromList]);

  useEffect(() => {
    mountedRef.current = true;
    setLoading(true);
    loadChats();
    return () => {
      mountedRef.current = false;
    };
  }, [loadChats]);

  // Keep the ref in sync if state is ever changed outside the socket handlers.
  useEffect(() => {
    chatsRef.current = chats;
  }, [chats]);

  // Realtime: update the chat list the moment the backend emits a new message,
  // so the unread badge, preview, timestamp and ordering change without a
  // manual refresh. Events arrive on the socket's user_<id> room (joined on
  // connect) and/or the conversation_<id> room (joined while reading).
  useEffect(() => {
    if (!connected) return;

    const handleNewMessage = (message) => {
      console.log("[ChatList] received newMessage", {
        messageId: getMessageId(message),
        conversationId: getMessageConversationId(message),
        senderId: message?.sender_id ?? message?.senderId,
      });
      const conversationId = getMessageConversationId(message);
      const messageId = getMessageId(message);
      if (!conversationId || messageId == null) return;

      const key = String(messageId);
      if (seenMessageIdsRef.current.has(key)) return; // already reflected

      const prev = chatsRef.current;
      const target = prev.find((c) => String(c.id) === String(conversationId));
      const unreadBefore = Number(target?.unreadCount) || 0;
      const result = applyIncomingMessage(prev, message, currentUserId);

      if (!result.found) {
        // A brand-new customer thread (or a room not in the first page): refetch
        // so the conversation shows up instead of silently dropping the event.
        console.log("[ChatList] newMessage for unknown conversation; refetching", { conversationId });
        loadChats();
        return;
      }

      rememberSeen(messageId);
      chatsRef.current = result.chats;
      setChats(result.chats);

      const unreadAfter =
        Number(result.chats.find((c) => String(c.id) === String(conversationId))?.unreadCount) || 0;
      console.log("[ChatList] newMessage processed", {
        conversationId,
        messageId: key,
        fromSelf: !result.incremented,
        unreadBefore,
        unreadAfter,
        stateUpdated: true,
      });
    };

    const handleMessagesRead = (payload) => {
      const conversationId = payload?.conversationId ?? payload?.conversation_id ?? null;
      const readBy = payload?.userId ?? payload?.user_id ?? null;
      const count = payload?.count ?? 0;

      const prev = chatsRef.current;
      const next = applyReadReceipt(prev, conversationId, readBy, currentUserId, count);
      if (next === prev) return;
      chatsRef.current = next;
      setChats(next);
      console.log("[ChatList] messagesRead", {
        conversationId,
        readBySelf: Boolean(currentUserId && String(readBy) === String(currentUserId)),
        count,
      });
    };

    console.log("[ChatList] registered newMessage listener");
    on("newMessage", handleNewMessage);
    on("messagesRead", handleMessagesRead);

    return () => {
      console.log("[ChatList] cleanup: removing newMessage listener");
      off("newMessage", handleNewMessage);
      off("messagesRead", handleMessagesRead);
    };
  }, [connected, currentUserId, on, off, loadChats, rememberSeen]);

  const handleChatClick = (conversationId) => {
    navigate(`/selladmin/messages/${conversationId}`);
  };

  if (loading) {
    return (
      <div className="page customer-page messages-page">
        <div className="customer-page-header">
          <h1>ข้อความ</h1>
          <p>กำลังโหลด...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="page customer-page messages-page">
      <div className="customer-page-header">
        <h1>ข้อความ</h1>
        <p>ลูกค้าทักเข้ามา สามารถตอบกลับได้ทันที</p>
      </div>
      {error && <div className="home-error">{error}</div>}
      {!loading && !error && (
        <div className="chat-list">
          {chats.length === 0 ? (
            <div className="chat-empty-state">
              <div className="chat-empty-icon">
                <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
              </div>
              <p>ยังไม่มีข้อความจากลูกค้า</p>
              <p style={{ fontSize: 13, color: "var(--text-muted)" }}>เมื่อลูกค้าส่งข้อความเข้ามา จะปรากฏที่นี่</p>
            </div>
          ) : (
            chats.map((chat) => {
              const customer = chat.customer;
              const lastMsg = chat.lastMessage;
              const unreadCount = chat.unreadCount || 0;
              const customerName = customer?.name || customer?.display_name || customer?.full_name || "ลูกค้า";
              const customerAvatar = customer?.avatar_url;

              return (
                <div
                  key={chat.id}
                  className="chat-card"
                  onClick={() => handleChatClick(chat.id)}
                  style={{ cursor: "pointer" }}
                >
                  <span className="chat-avatar">
                    {customerAvatar ? (
                      <img src={customerAvatar} alt={customerName} />
                    ) : (
                      customerName.charAt(0)
                    )}
                  </span>
                  <div className="chat-info">
                    <div className="chat-info-top">
                      <strong className="chat-name">{customerName}</strong>
                      {lastMsg?.created_at && (
                        <span className="chat-time">
                          {formatDate(lastMsg.created_at)} {formatTime(lastMsg.created_at)}
                        </span>
                      )}
                    </div>
                    <div className="chat-info-bottom">
                      <span className="chat-preview">
                        {lastMsg?.sender_id === currentUserId ? "คุณ: " : ""}
                        {lastMsg?.content || "ไม่มีข้อความ"}
                      </span>
                      {unreadCount > 0 && (
                        <span className="chat-badge">{unreadCount}</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}