import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useSocket } from "../context/SocketContext";
import { messageAPI } from "../api/message";

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

export default function SellAdminMessages() {
  const { admin } = useAuth();
  const user = admin?.user;
  const { joinStore, leaveStore, on, off, connected } = useSocket();
  const [chats, setChats] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const navigate = useNavigate();

  const currentUserId = user?._id || user?.id;

  useEffect(() => {
    let cancelled = false;
    const loadChats = async () => {
      try {
        setError("");
        const data = await messageAPI.getChatList("admin");
        if (!cancelled) {
          setChats(Array.isArray(data?.data) ? data.data : []);
        }
      } catch (err) {
        if (!cancelled) setError(err.message || "ไม่สามารถโหลดรายการแชทได้");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    loadChats();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!connected) return;
    const storeIds = chats.map((c) => c.storeId || c.store?._id).filter(Boolean);
    storeIds.forEach((id) => joinStore(id));
    return () => {
      storeIds.forEach((id) => leaveStore(id));
    };
  }, [connected, chats, joinStore, leaveStore]);

  useEffect(() => {
    const handleNewMessage = (msg) => {
      const storeId = msg.store?._id || msg.store;
      if (!storeId) return;
      const receiverId = msg.receiver?._id || msg.receiver;
      const storeObj = msg.store && typeof msg.store === "object" ? msg.store : null;

      setChats((prev) => {
        const idx = prev.findIndex((c) => (c.storeId || c.store?._id) === storeId);
        if (idx !== -1) {
          const existing = prev[idx];
          const isIncomingUnread = receiverId && receiverId === currentUserId && !msg.isRead;
          const updated = {
            ...existing,
            storeId,
            store: storeObj || existing.store,
            lastMessage: msg,
            unreadCount: isIncomingUnread ? (existing.unreadCount || 0) + 1 : existing.unreadCount || 0,
          };
          const next = [...prev];
          next[idx] = updated;
          next.sort((a, b) => new Date(b.lastMessage?.createdAt || 0) - new Date(a.lastMessage?.createdAt || 0));
          return next;
        }

        const isIncomingUnread = receiverId && receiverId === currentUserId && !msg.isRead;
        const newChat = {
          storeId,
          store: storeObj || undefined,
          lastMessage: msg,
          unreadCount: isIncomingUnread ? 1 : 0,
        };
        return [newChat, ...prev];
      });

      if (connected) joinStore(storeId);
    };

    on("newMessage", handleNewMessage);
    return () => off("newMessage", handleNewMessage);
  }, [on, off, currentUserId, connected, joinStore]);

  const handleChatClick = (storeId) => {
    navigate(`/selladmin/messages/${storeId}`);
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
              const store = chat.store;
              const lastMsg = chat.lastMessage;
              const unreadCount = chat.unreadCount || 0;
              const storeName = store?.name || "ร้านค้า";
              const storeLogo = store?.logo;

              return (
                <div
                  key={chat.storeId}
                  className="chat-card"
                  onClick={() => handleChatClick(chat.storeId)}
                  style={{ cursor: "pointer" }}
                >
                  <span className="chat-avatar">
                    {storeLogo ? (
                      <img src={storeLogo} alt={storeName} />
                    ) : (
                      storeName.charAt(0)
                    )}
                  </span>
                  <div className="chat-info">
                    <div className="chat-info-top">
                      <strong className="chat-name">{storeName}</strong>
                      {lastMsg?.createdAt && (
                        <span className="chat-time">
                          {formatDate(lastMsg.createdAt)} {formatTime(lastMsg.createdAt)}
                        </span>
                      )}
                    </div>
                    <div className="chat-info-bottom">
                      <span className="chat-preview">
                        {lastMsg?.senderRole === "seller" || lastMsg?.senderRole === "admin" ? "คุณ: " : ""}
                        {lastMsg?.text || "ไม่มีข้อความ"}
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
