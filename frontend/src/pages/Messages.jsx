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

const MoreIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="1" />
    <circle cx="19" cy="12" r="1" />
    <circle cx="5" cy="12" r="1" />
  </svg>
);

const EditIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
  </svg>
);

const EyeOffIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
    <line x1="1" y1="1" x2="23" y2="23" />
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
  // Three-dot menu state
  const [menuOpenFor, setMenuOpenFor] = useState(null);
  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState("");
  
  const location = useLocation();
  const navigate = useNavigate();
  const { customer } = useAuth();
  const { connected, on, off } = useSocket();
  const currentUserId = customer?.user?.id || customer?.user?._id || null;

  const chatsRef = useRef([]);
  const mountedRef = useRef(true);
  const seenMessageIdsRef = useRef(new Set());
  const menuRef = useRef(null);

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
        alias: currentMember?.alias || null,
        isHidden: currentMember?.is_hidden || false,
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

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setMenuOpenFor(null);
        setRenamingId(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

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

  // Three-dot menu handlers
  const toggleMenu = (conversationId) => {
    setMenuOpenFor(menuOpenFor === conversationId ? null : conversationId);
    setRenamingId(null);
  };

  const handleRename = async (conversationId, currentAlias) => {
    setRenamingId(conversationId);
    setRenameValue(currentAlias || "");
    setMenuOpenFor(null);
  };

  const saveRename = async (conversationId) => {
    try {
      await chatAPI.updateAlias(conversationId, renameValue.trim(), "customer");
      loadConversations();
    } catch (err) {
      setError(err.message || "ไม่สามารถเปลี่ยนชื่อได้");
    }
    setRenamingId(null);
    setRenameValue("");
  };

  const cancelRename = () => {
    setRenamingId(null);
    setRenameValue("");
  };

  const handleHide = async (conversationId) => {
    try {
      await chatAPI.updateHidden(conversationId, true, "customer");
      loadConversations();
    } catch (err) {
      setError(err.message || "ไม่สามารถซ่อนแชทได้");
    }
    setMenuOpenFor(null);
  };

  const handleKeyDownRename = (e, conversationId) => {
    if (e.key === "Enter") {
      saveRename(conversationId);
    } else if (e.key === "Escape") {
      cancelRename();
    }
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
                const storeName = chat.alias || store?.name || "ร้านค้า";
                const storeAvatar = store?.logo_url || store?.avatar_url;
                const lastMsg = chat.lastMessage;
                const unreadCount = chat.unreadCount || 0;
                const isMenuOpen = menuOpenFor === chat.id;
                const isRenaming = renamingId === chat.id;

                return (
                  <div
                    key={chat.id}
                    className="chat-card"
                    onClick={() => !isRenaming && handleChatClick(chat.id)}
                    style={{ cursor: isRenaming ? "default" : "pointer", position: "relative" }}
                    ref={isMenuOpen ? menuRef : null}
                  >
                    <span className="chat-avatar">
                      {storeAvatar ? (
                        <img src={storeAvatar} alt={storeName} />
                      ) : (
                        storeName.charAt(0)
                      )}
                    </span>
                    <div className="chat-info" style={{ flex: 1, minWidth: 0 }}>
                      {isRenaming ? (
                        <input
                          type="text"
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onKeyDown={(e) => handleKeyDownRename(e, chat.id)}
                          onBlur={() => saveRename(chat.id)}
                          autoFocus
                          className="chat-rename-input"
                          style={{ width: "100%", fontSize: "inherit", fontWeight: "bold" }}
                        />
                      ) : (
                        <>
                          <div className="chat-info-top">
                            <strong className="chat-name" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{storeName}</strong>
                            {lastMsg?.created_at && (
                              <span className="chat-time">
                                {formatDate(lastMsg.created_at)} {formatTime(lastMsg.created_at)}
                              </span>
                            )}
                          </div>
                          <div className="chat-info-bottom">
                            <span className="chat-preview" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                              {lastMsg?.sender_id === currentUserId ? "คุณ: " : ""}
                              {lastMsg?.content || "ไม่มีข้อความ"}
                            </span>
                            {unreadCount > 0 && (
                              <span className="chat-badge">
                                {unreadCount > 99 ? "99+" : unreadCount}
                              </span>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                    {/* Three-dot menu */}
                    <div className="chat-menu-wrapper">
                      <button
                        type="button"
                        className="chat-menu-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleMenu(chat.id);
                        }}
                        aria-label="เมนูเพิ่มเติม"
                      >
                        <MoreIcon />
                      </button>
                      {isMenuOpen && (
                        <div className="chat-menu-dropdown">
                          <button
                            type="button"
                            className="chat-menu-item"
                            onClick={() => handleRename(chat.id, chat.alias)}
                          >
                            <EditIcon /> เปลี่ยนชื่อ
                          </button>
                          <button
                            type="button"
                            className="chat-menu-item"
                            onClick={() => handleHide(chat.id)}
                          >
                            <EyeOffIcon /> ซ่อนแชทนี้
                          </button>
                        </div>
                      )}
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