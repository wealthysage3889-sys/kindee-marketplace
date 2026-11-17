import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { storeAPI } from "../api/product";
import { chatAPI } from "../api";
import { useAuth } from "../context/AuthContext";
import { useSocket } from "../context/SocketContext";
import {
  applyIncomingMessage,
  applyReadReceipt,
  getMessageConversationId,
  getMessageId,
} from "../utils/chatList";

const ChevronLeftIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m15 18-6-6 6-6" />
  </svg>
);

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

const SEEN_LIMIT = 1000;

export default function Messages() {
  const [stores, setStores] = useState([]);
  const [conversations, setConversations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [openingId, setOpeningId] = useState("");
  const location = useLocation();
  const navigate = useNavigate();
  const { customer } = useAuth();
  const { connected, on, off } = useSocket();
  const currentUserId = customer?.user?.id || customer?.user?._id || null;

  const chatsRef = useRef([]);
  const mountedRef = useRef(true);
  const seenMessageIdsRef = useRef(new Set());

  const rememberSeen = useCallback((id) => {
    if (id == null) return;
    const seen = seenMessageIdsRef.current;
    const key = String(id);
    if (seen.has(key)) return;
    seen.add(key);
    if (seen.size > SEEN_LIMIT) {
      const oldest = seen.values().next().value;
      if (oldest !== undefined) seen.delete(oldest);
    }
  }, []);

  const mapConversation = useCallback(
    (c) => {
      const members = Array.isArray(c.members) ? c.members : [];
      const currentMember = members.find((m) => String(m.profile_id) === String(currentUserId));
      const counterpart = members.find((m) => String(m.profile_id) !== String(currentUserId));
      const storeProfile = counterpart?.profile || null;
      const storeName = c.store?.name || storeProfile?.name || "ร้านค้า";
      const storeAvatar = c.store?.logo_url || storeProfile?.avatar_url || null;
      return {
        id: c.id,
        storeId: c.store_id,
        store: c.store || null,
        customerId: counterpart?.profile_id || null,
        customer: {
          id: storeProfile?.id || null,
          name: storeName,
          avatar_url: storeAvatar,
          role: storeProfile?.role || null,
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

  const loadConversations = useCallback(async () => {
    try {
      setError("");
      const data = await chatAPI.getConversations({}, "customer");
      const list = Array.isArray(data?.data?.conversations)
        ? data.data.conversations
        : Array.isArray(data?.data)
          ? data.data
          : [];
      if (!mountedRef.current) return;
      const mapped = list.map(mapConversation);
      seedSeenFromList(mapped);
      chatsRef.current = mapped;
      setConversations(mapped);
    } catch (err) {
      if (mountedRef.current) setError(err.message || "ไม่สามารถโหลดรายการแชทได้");
    }
  }, [mapConversation, seedSeenFromList]);

  useEffect(() => {
    mountedRef.current = true;
    loadConversations();
    return () => { mountedRef.current = false; };
  }, [loadConversations]);

  useEffect(() => {
    chatsRef.current = conversations;
  }, [conversations]);

  // Realtime: update chat list on new messages
  useEffect(() => {
    if (!connected) return;

    const handleNewMessage = (message) => {
      const conversationId = getMessageConversationId(message);
      const messageId = getMessageId(message);
      if (!conversationId || messageId == null) return;

      const key = String(messageId);
      if (seenMessageIdsRef.current.has(key)) return;

      const prev = chatsRef.current;
      const result = applyIncomingMessage(prev, message, currentUserId);

      if (!result.found) {
        loadConversations();
        return;
      }

      rememberSeen(messageId);
      chatsRef.current = result.chats;
      setConversations(result.chats);
    };

    const handleMessagesRead = (payload) => {
      const conversationId = payload?.conversationId ?? payload?.conversation_id ?? null;
      const readBy = payload?.userId ?? payload?.user_id ?? null;
      const count = payload?.count ?? 0;

      const prev = chatsRef.current;
      const next = applyReadReceipt(prev, conversationId, readBy, currentUserId, count);
      if (next === prev) return;
      chatsRef.current = next;
      setConversations(next);
    };

    on("newMessage", handleNewMessage);
    on("messagesRead", handleMessagesRead);

    return () => {
      off("newMessage", handleNewMessage);
      off("messagesRead", handleMessagesRead);
    };
  }, [connected, currentUserId, on, off, loadConversations, rememberSeen]);

  const fromStore = new URLSearchParams(location.search).get("fromStore");
  const openStore = new URLSearchParams(location.search).get("openStore");
  const storeId = fromStore || openStore;

  const visibleStores = useMemo(
    () =>
      stores.filter(
        (store) =>
          !currentUserId ||
          String(store.owner_id || store.ownerId || "") !== String(currentUserId)
      ),
    [stores, currentUserId]
  );

  const openRequestedRef = useRef("");

  const openConversation = async (id, { replaceListRoute = false } = {}) => {
    if (!id || openingId) return;
    const requestKey = `${id}|${currentUserId || ""}`;
    if (openRequestedRef.current === requestKey) return;
    openRequestedRef.current = requestKey;
    setOpeningId(id);
    setError("");
    try {
      const result = await chatAPI.getOrCreateConversation(id);
      const conversation = result?.data || result;
      if (conversation?.id) {
        openRequestedRef.current = "";
        navigate(`/messages/${conversation.id}`, { replace: replaceListRoute });
      } else {
        setError("ไม่สามารถเปิดการสนทนาได้");
        openRequestedRef.current = "";
      }
    } catch (err) {
      setError(err.message || "ไม่สามารถเปิดการสนทนาได้");
      openRequestedRef.current = "";
    } finally {
      setOpeningId("");
    }
  };

  useEffect(() => {
    if (!openStore) return;
    let cancelled = false;
    const initOpen = async () => {
      setError("");
      try {
        const res = await storeAPI.getStoreById(openStore);
        const storeData = (res && res.data) || res || null;
        if (
          storeData &&
          currentUserId &&
          String(storeData.owner_id || storeData.ownerId) === String(currentUserId)
        ) {
          if (!cancelled) {
            setError("ไม่สามารถเริ่มแชทกับร้านของตัวเองได้");
            setOpeningId("");
            navigate("/messages", { replace: true });
          }
          return;
        }
      } catch {}
      if (!cancelled) await openConversation(openStore, { replaceListRoute: true });
    };
    initOpen();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openStore, currentUserId]);

  useEffect(() => {
    let cancelled = false;
    const loadStores = async () => {
      try {
        const data = await storeAPI.getStores({ limit: 50 });
        if (!cancelled) {
          const storesList =
            Array.isArray(data?.data?.stores)
              ? data.data.stores
              : Array.isArray(data?.stores)
                ? data.stores
                : [];
          setStores(storesList);
        }
      } catch (err) {
        if (!cancelled) setError(err.message || "ไม่สามารถโหลดรายชื่อร้านค้าได้");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    loadStores();
    return () => { cancelled = true; };
  }, []);

  const handleChatClick = (conversationId) => {
    navigate(`/messages/${conversationId}`);
  };

  return (
    <div className="page customer-page messages-page">
      <div className="customer-page-header">
        <Link
          to={storeId ? `/stores/${storeId}` : "/stores"}
          className="chat-back"
          aria-label="กลับหน้าร้านค้า"
        >
          <ChevronLeftIcon />
        </Link>
        <h1>ข้อความ</h1>
        <p>เลือกแชทเพื่อสอบถามสินค้า</p>
      </div>

      {error && <div className="home-error">{error}</div>}
      {loading && <div className="home-loading">กำลังโหลด...</div>}

      {!loading && !error && (
        <>
          {/* Existing conversations with unread badges */}
          {conversations.length > 0 && (
            <div className="chat-list">
              {conversations.map((chat) => {
                const store = chat.store || chat.customer;
                const storeName = store?.name || "ร้านค้า";
                const storeAvatar = store?.logo_url || store?.avatar_url;
                const lastMsg = chat.lastMessage;
                const unreadCount = chat.unreadCount || 0;

                return (
                  <div
                    key={chat.id}
                    className="chat-card"
                    onClick={() => handleChatClick(chat.id)}
                    style={{ cursor: "pointer" }}
                  >
                    <span className="chat-avatar">
                      {storeAvatar ? (
                        <img src={storeAvatar} alt={storeName} />
                      ) : (
                        storeName.charAt(0)
                      )}
                    </span>
                    <div className="chat-info">
                      <div className="chat-info-top">
                        <strong className="chat-name">{storeName}</strong>
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
                          <span className="chat-badge">
                            {unreadCount > 99 ? "99+" : unreadCount}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Store grid for starting new conversations */}
          {visibleStores.length > 0 && (
            <div className="store-grid">
              {visibleStores.map((store) => (
                <Link
                  to={`/messages/${store._id}`}
                  className="chat-card"
                  key={store._id}
                  onClick={(event) => {
                    event.preventDefault();
                    openConversation(store._id);
                  }}
                >
                  <span className="chat-avatar">
                    {store.logo || store.logo_url ? (
                      <img src={store.logo || store.logo_url} alt={store.name} />
                    ) : (
                      (store.name || "ร้านค้า").charAt(0)
                    )}
                  </span>
                  <div className="chat-info">
                    <strong className="chat-name">{store.name || "ร้านค้า"}</strong>
                    <span className="chat-status">
                      {openingId === store._id
                        ? "กำลังเปิดแชท..."
                        : store.isActive === false || store.is_active === false
                          ? "ร้านค้าปิดทำการ"
                          : "เปิดร้าน"}
                    </span>
                  </div>
                  <span className="chat-time">แชท</span>
                </Link>
              ))}
            </div>
          )}

          {conversations.length === 0 && visibleStores.length === 0 && (
            <p className="product-empty">ยังไม่มีร้านค้าให้ส่งข้อความ</p>
          )}
        </>
      )}
    </div>
  );
}