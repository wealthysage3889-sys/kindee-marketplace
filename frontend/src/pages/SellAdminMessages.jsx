import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useSocket } from "../context/SocketContext";
import { chatAPI } from "../api";
import { storeAPI } from "../api/product";
import {
  applyIncomingMessage,
  applyReadReceipt,
  getMessageConversationId,
  getMessageId,
} from "../utils/chatList";

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

const TrashIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 6h18" />
    <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    <line x1="10" y1="11" x2="10" y2="17" />
    <line x1="14" y1="11" x2="14" y2="17" />
  </svg>
);

const BlockIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="10" />
    <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
  </svg>
);

const RestoreIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 2v6h6" />
    <path d="M3 13a9 9 0 1 0 3-7.7L3 8" />
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

// Cap the de-dupe set so a long-lived tab does not grow it without bound.
const SEEN_LIMIT = 1000;

const chatDisplayName = (chat) =>
  chat?.alias ||
  chat?.customer?.name ||
  chat?.customer?.display_name ||
  chat?.customer?.full_name ||
  "ลูกค้า";

export default function SellAdminMessages() {
  const { admin } = useAuth();
  const user = admin?.user;
  const [chats, setChats] = useState([]);
  const [spamChats, setSpamChats] = useState([]);
  const [activeTab, setActiveTab] = useState("inbox");
  const [spamLoading, setSpamLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [menuOpenFor, setMenuOpenFor] = useState(null);
  const [renameTarget, setRenameTarget] = useState(null);
  const [renameValue, setRenameValue] = useState("");
  const [confirmTarget, setConfirmTarget] = useState(null);
  const [actionBusy, setActionBusy] = useState(false);
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
  // Wrapper of the currently open per-chat menu, used for outside clicks.
  const menuRef = useRef(null);
  // Previous socket connection state, to detect reconnect (false -> true).
  const wasConnectedRef = useRef(false);

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
        alias: currentMember?.alias || null,
        isHidden: currentMember?.is_hidden === true,
        isSpam: c.is_spam === true,
        spamMarkedAt: c.spam_marked_at || null,
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

  // Spam conversations live outside the normal inbox query (hidden or flagged),
  // so they are fetched per owned store through the dedicated endpoint.
  const loadSpam = useCallback(async () => {
    if (!currentUserId) return;
    setSpamLoading(true);
    try {
      let storeIds = [];
      try {
        const res = await storeAPI.getStoresByOwner(currentUserId, "admin");
        const stores = Array.isArray(res?.data) ? res.data : Array.isArray(res) ? res : [];
        storeIds = stores.map((s) => s.id || s._id).filter(Boolean);
      } catch (err) {
        console.log("[ChatList] could not load owned stores for spam list", err?.message);
      }
      storeIds = [...new Set([...storeIds, ...chatsRef.current.map((c) => c.storeId).filter(Boolean)])];
      if (storeIds.length === 0) {
        if (mountedRef.current) setSpamChats([]);
        return;
      }

      const results = await Promise.allSettled(
        storeIds.map((storeId) => chatAPI.getSpamConversations(storeId, {}, "admin"))
      );
      if (!mountedRef.current) return;

      const merged = [];
      let firstError = null;
      results.forEach((result) => {
        if (result.status === "fulfilled") {
          const payload = result.value?.data;
          const list = Array.isArray(payload?.conversations)
            ? payload.conversations
            : Array.isArray(payload)
              ? payload
              : [];
          merged.push(...list.map(mapConversation));
        } else if (!firstError) {
          firstError = result.reason;
        }
      });

      const unique = [...new Map(merged.map((c) => [String(c.id), c])).values()];
      setSpamChats(unique);
      if (results.length > 0 && results.every((r) => r.status === "rejected")) {
        setError(firstError?.message || "ไม่สามารถโหลดรายการสแปมได้");
      }
    } catch (err) {
      if (mountedRef.current) setError(err.message || "ไม่สามารถโหลดรายการสแปมได้");
    } finally {
      if (mountedRef.current) setSpamLoading(false);
    }
  }, [currentUserId, mapConversation]);

  useEffect(() => {
    mountedRef.current = true;
    setLoading(true);
    loadChats();
    return () => {
      mountedRef.current = false;
    };
  }, [loadChats]);

  useEffect(() => {
    loadSpam();
  }, [loadSpam]);

  // Keep the ref in sync if state is ever changed outside the socket handlers.
  useEffect(() => {
    chatsRef.current = chats;
  }, [chats]);

  // Close the per-chat menu on an outside click or Escape.
  useEffect(() => {
    const handleOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setMenuOpenFor(null);
      }
    };
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, []);

  useEffect(() => {
    if (!menuOpenFor && !renameTarget && !confirmTarget) return undefined;
    const handleKey = (event) => {
      if (event.key === "Escape") {
        setMenuOpenFor(null);
        setRenameTarget(null);
        setConfirmTarget(null);
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [menuOpenFor, renameTarget, confirmTarget]);

  useEffect(() => {
    if (!notice) return undefined;
    const timer = setTimeout(() => setNotice(""), 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  // Handle backend conversationUpdated events (spam / restore / hide) by
  // refreshing the list so visibility and ordering stay in sync.
  const handleConversationUpdated = useCallback(() => {
    loadChats();
    loadSpam();
  }, [loadChats, loadSpam]);

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
    on("conversationUpdated", handleConversationUpdated);

    return () => {
      console.log("[ChatList] cleanup: removing newMessage listener");
      off("newMessage", handleNewMessage);
      off("messagesRead", handleMessagesRead);
      off("conversationUpdated", handleConversationUpdated);
    };
  }, [connected, currentUserId, on, off, loadChats, loadSpam, rememberSeen, handleConversationUpdated]);

  // Reconnect refetch: when the socket re-establishes (connected false -> true),
  // refresh the chat list so unread badges and previews caught up while offline.
  useEffect(() => {
    const wasConnected = wasConnectedRef.current;
    wasConnectedRef.current = connected;
    if (!wasConnected && connected) {
      loadChats();
      loadSpam();
    }
  }, [connected, loadChats, loadSpam]);

  const handleChatClick = (conversationId) => {
    navigate(`/selladmin/messages/${conversationId}`);
  };

  const toggleMenu = (event, conversationId) => {
    event.stopPropagation();
    setMenuOpenFor((current) => (current === conversationId ? null : conversationId));
  };

  const replaceChat = (collection, updated) =>
    collection.map((c) => (String(c.id) === String(updated.id) ? { ...c, ...updated } : c));

  const removeChat = (collection, id) => collection.filter((c) => String(c.id) !== String(id));

  const openRename = (chat) => {
    setMenuOpenFor(null);
    setRenameTarget(chat);
    setRenameValue(chat.alias || "");
  };

  const submitRename = async (event) => {
    event.preventDefault();
    if (!renameTarget) return;
    setActionBusy(true);
    try {
      const trimmed = renameValue.trim();
      // PATCH /api/chat/conversations/:id/alias (per-member display name)
      await chatAPI.updateAlias(renameTarget.id, trimmed, "admin");
      const updated = { alias: trimmed || null };
      setChats((prev) => replaceChat(prev, { id: renameTarget.id, ...updated }));
      setSpamChats((prev) => replaceChat(prev, { id: renameTarget.id, ...updated }));
      setNotice(trimmed ? "แก้ไขชื่อแชทแล้ว" : "รีเซ็ตชื่อแชทเป็นชื่อลูกค้าแล้ว");
      setRenameTarget(null);
      setRenameValue("");
    } catch (err) {
      setError(err.message || "ไม่สามารถแก้ไขชื่อแชทได้");
    } finally {
      setActionBusy(false);
    }
  };

  const runConfirmedAction = async () => {
    if (!confirmTarget) return;
    const { type, chat } = confirmTarget;
    setActionBusy(true);
    try {
      if (type === "delete") {
        // ซ่อนแชทสำหรับเจ้าของร้านเท่านั้น ข้อความและประวัติยังอยู่ครบ
        await chatAPI.updateHidden(chat.id, true, "admin");
        setChats((prev) => removeChat(prev, chat.id));
        setNotice(`ลบแชทของ ${chatDisplayName(chat)} ออกจากรายการแล้ว`);
      } else if (type === "spam") {
        await chatAPI.markSpam(chat.id, "admin");
        setChats((prev) => removeChat(prev, chat.id));
        setSpamChats((prev) => [
          { ...chat, isSpam: true },
          ...removeChat(prev, chat.id),
        ]);
        setNotice(`บล็อก ${chatDisplayName(chat)} เป็นสแปมแล้ว`);
      } else if (type === "restore") {
        await chatAPI.restoreFromSpam(chat.id, "admin");
        setSpamChats((prev) => removeChat(prev, chat.id));
        setChats((prev) => [
          { ...chat, isSpam: false },
          ...removeChat(prev, chat.id),
        ]);
        setNotice(`เลิกบล็อก ${chatDisplayName(chat)} แล้ว`);
        loadChats();
      }
      setConfirmTarget(null);
    } catch (err) {
      setError(err.message || "ไม่สามารถดำเนินการได้");
      setConfirmTarget(null);
    } finally {
      setActionBusy(false);
    }
  };

  const confirmContent = (() => {
    if (!confirmTarget) return null;
    const name = chatDisplayName(confirmTarget.chat);
    if (confirmTarget.type === "delete") {
      return {
        title: "ลบแชทนี้?",
        message: `แชทของ ${name} จะถูกซ่อนออกจากรายการ ข้อความและประวัติการสนทนายังคงอยู่ครบ และเปิดกลับได้จากข้อความใหม่ของลูกค้า`,
        confirmLabel: "ลบแชท",
        danger: false,
      };
    }
    if (confirmTarget.type === "spam") {
      return {
        title: "บล็อกเป็นสแปม?",
        message: `แชทของ ${name} จะถูกย้ายไปที่รายการสแปม และสามารถกู้คืนได้ภายหลัง`,
        confirmLabel: "บล็อก (Spam)",
        danger: true,
      };
    }
    return {
      title: "เลิกบล็อกแชทนี้?",
      message: `แชทของ ${name} จะถูกย้ายกลับไปที่รายการแชทปกติ`,
      confirmLabel: "เลิกบล็อก",
      danger: false,
    };
  })();

  const displayedChats = activeTab === "spam" ? spamChats : chats.filter((c) => !c.isSpam);
  const inboxCount = chats.filter((c) => !c.isSpam).length;

  const renderChatRow = (chat) => {
    const customer = chat.customer;
    const lastMsg = chat.lastMessage;
    const unreadCount = chat.unreadCount || 0;
    const name = chatDisplayName(chat);
    const customerAvatar = customer?.avatar_url;
    const isMenuOpen = menuOpenFor === chat.id;

    return (
      <div
        key={chat.id}
        className={`chat-card${chat.isSpam ? " chat-card-spam" : ""}`}
        onClick={() => handleChatClick(chat.id)}
        style={{ cursor: "pointer" }}
      >
        <span className="chat-avatar">
          {customerAvatar ? (
            <img src={customerAvatar} alt={name} />
          ) : (
            name.charAt(0)
          )}
        </span>
        <div className="chat-info">
          <div className="chat-info-top">
            <strong className="chat-name">{name}</strong>
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
            <span className="chat-info-meta">
              {chat.isSpam && <span className="chat-spam-tag">สแปม</span>}
              {unreadCount > 0 && (
                <span className="chat-badge">{unreadCount > 99 ? "99+" : unreadCount}</span>
              )}
            </span>
          </div>
        </div>
        <div
          className="chat-menu-wrapper"
          ref={isMenuOpen ? menuRef : null}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            className="chat-menu-btn"
            aria-label="ตัวเลือกแชท"
            aria-haspopup="menu"
            aria-expanded={isMenuOpen}
            onClick={(event) => toggleMenu(event, chat.id)}
          >
            <MoreIcon />
          </button>
          {isMenuOpen && (
            <div className="chat-menu-dropdown" role="menu">
              <button
                type="button"
                role="menuitem"
                className="chat-menu-item"
                onClick={() => {
                  setMenuOpenFor(null);
                  setConfirmTarget({ type: "delete", chat });
                }}
              >
                <TrashIcon /> ลบแชท
              </button>
              <button
                type="button"
                role="menuitem"
                className="chat-menu-item"
                onClick={() => openRename(chat)}
              >
                <EditIcon /> แก้ไขชื่อ
              </button>
              {!chat.isSpam && (
                <button
                  type="button"
                  role="menuitem"
                  className="chat-menu-item chat-menu-item-danger"
                  onClick={() => {
                    setMenuOpenFor(null);
                    setConfirmTarget({ type: "spam", chat });
                  }}
                >
                  <BlockIcon /> บล็อก (Spam)
                </button>
              )}
              {chat.isSpam && (
                <button
                  type="button"
                  role="menuitem"
                  className="chat-menu-item"
                  onClick={() => {
                    setMenuOpenFor(null);
                    setConfirmTarget({ type: "restore", chat });
                  }}
                >
                  <RestoreIcon /> เลิกบล็อก
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    );
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
      {error && (
        <div className="home-error" role="alert">
          {error}
          <button type="button" className="home-error-dismiss" onClick={() => setError("")} aria-label="ปิด">
            ×
          </button>
        </div>
      )}
      {notice && (
        <div className="chat-notice" role="status">
          {notice}
        </div>
      )}

      <div className="chat-tabs" role="tablist" aria-label="ประเภทรายการแชท">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "inbox"}
          className={`chat-tab${activeTab === "inbox" ? " chat-tab-active" : ""}`}
          onClick={() => {
            setActiveTab("inbox");
            setMenuOpenFor(null);
          }}
        >
          แชท
          <span className="chat-tab-count">{inboxCount}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "spam"}
          className={`chat-tab${activeTab === "spam" ? " chat-tab-active" : ""}`}
          onClick={() => {
            setActiveTab("spam");
            setMenuOpenFor(null);
          }}
        >
          สแปม
          <span className="chat-tab-count">{spamChats.length}</span>
        </button>
      </div>

      {!loading && !error && (
        <div className="chat-list">
          {activeTab === "spam" && spamLoading && spamChats.length === 0 ? (
            <div className="chat-empty-state">
              <p>กำลังโหลดรายการสแปม...</p>
            </div>
          ) : displayedChats.length === 0 ? (
            <div className="chat-empty-state">
              <div className="chat-empty-icon">
                <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
              </div>
              <p>{activeTab === "spam" ? "ยังไม่มีแชทที่ถูกบล็อก" : "ยังไม่มีข้อความจากลูกค้า"}</p>
              <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
                {activeTab === "spam"
                  ? "แชทที่ถูกบล็อกจะแสดงที่นี่ และสามารถเลิกบล็อกได้"
                  : "เมื่อลูกค้าส่งข้อความเข้ามา จะปรากฏที่นี่"}
              </p>
            </div>
          ) : (
            displayedChats.map(renderChatRow)
          )}
        </div>
      )}

      {renameTarget &&
        createPortal(
          <div
            className="chat-modal-backdrop"
            role="presentation"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget && !actionBusy) setRenameTarget(null);
            }}
          >
            <div className="chat-modal" role="dialog" aria-modal="true" aria-labelledby="chat-rename-title">
              <h2 id="chat-rename-title" className="chat-modal-title">
                แก้ไขชื่อแชท
              </h2>
              <p className="chat-modal-text">
                ตั้งชื่อที่แสดงเฉพาะคุณสำหรับแชทของ {chatDisplayName(renameTarget)}
              </p>
              <form onSubmit={submitRename}>
                <label className="chat-modal-label" htmlFor="chat-rename-input">
                  ชื่อที่แสดง
                </label>
                <input
                  id="chat-rename-input"
                  className="chat-modal-input"
                  type="text"
                  maxLength={100}
                  value={renameValue}
                  onChange={(event) => setRenameValue(event.target.value)}
                  placeholder={chatDisplayName(renameTarget)}
                  autoFocus
                />
                <div className="chat-modal-actions">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => setRenameTarget(null)}
                    disabled={actionBusy}
                  >
                    ยกเลิก
                  </button>
                  <button type="submit" className="btn btn-primary" disabled={actionBusy}>
                    {actionBusy ? "กำลังบันทึก..." : "บันทึก"}
                  </button>
                </div>
              </form>
            </div>
          </div>,
          document.body
        )}

      {confirmTarget &&
        confirmContent &&
        createPortal(
          <div
            className="chat-modal-backdrop"
            role="presentation"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget && !actionBusy) setConfirmTarget(null);
            }}
          >
            <div
              className="chat-modal"
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="chat-confirm-title"
            >
              <h2 id="chat-confirm-title" className="chat-modal-title">
                {confirmContent.title}
              </h2>
              <p className="chat-modal-text">{confirmContent.message}</p>
              <div className="chat-modal-actions">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setConfirmTarget(null)}
                  disabled={actionBusy}
                >
                  ยกเลิก
                </button>
                <button
                  type="button"
                  className={`btn ${confirmContent.danger ? "btn-danger" : "btn-primary"}`}
                  onClick={runConfirmedAction}
                  disabled={actionBusy}
                >
                  {actionBusy ? "กำลังดำเนินการ..." : confirmContent.confirmLabel}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
