import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { chatAPI } from "../api";

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
  const [chats, setChats] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const navigate = useNavigate();

  const currentUserId = user?.id;

  useEffect(() => {
    let cancelled = false;
    const loadChats = async () => {
      try {
        setError("");
        // GET /api/chat/conversations  (with admin token) -> all conversations
        // the admin/seller is a member of.
        const data = await chatAPI.getConversations({}, "admin");
        const list = Array.isArray(data?.data) ? data.data : [];
        if (!cancelled) {
          setChats(list.map((c) => ({
            id: c.id,
            storeId: c.store_id,
            store: c.store || null,
            lastMessage: c.last_message || null,
            unreadCount: c.members?.find((m) => String(m.profile_id) === String(currentUserId))?.unread_count || 0,
          })));
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
              const store = chat.store;
              const lastMsg = chat.lastMessage;
              const unreadCount = chat.unreadCount || 0;
              const storeName = store?.name || "ร้านค้า";
              const storeLogo = store?.logo_url;

              return (
                <div
                  key={chat.id}
                  className="chat-card"
                  onClick={() => handleChatClick(chat.id)}
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
