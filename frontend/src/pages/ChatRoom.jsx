import { useEffect, useRef, useState } from "react";
import { Link, useParams, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { storeAPI } from "../api/product";
import { messageAPI } from "../api/message";

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

export default function ChatRoom() {
  const { storeId } = useParams();
  const navigate = useNavigate();
  const { customer } = useAuth();
  const user = customer?.user;

  const [store, setStore] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef(null);

  const currentUserId = user?._id || user?.id;

  const location = useLocation();
  const fromStore = new URLSearchParams(location.search).get("fromStore");

  // The backend decides the real senderRole from the token; sending the account's
  // own role keeps the optimistic bubble consistent and avoids a role mismatch.
  const currentSenderRole = user?.role === "owner" ? "admin" : user?.role || "customer";

  // ข้อความของลูกค้าเอง (senderRole = "customer") คือข้อความส่งออก (ขวา, .me)
  // ข้อความจากร้านค้า (admin/seller/shop) คือข้อความเข้า (ซ้าย, .them)
  const isOutgoing = (message) => {
    const senderId = message?.sender?._id || message?.sender;
    if (senderId && currentUserId && String(senderId) === String(currentUserId)) {
      return true;
    }
    return message?.senderRole === "customer";
  };

  useEffect(() => {
    let cancelled = false;
    const loadRoom = async () => {
      try {
        const response = await storeAPI.getStoreById(storeId);
        const storeData = response?.data || response || null;
        if (!cancelled) setStore(storeData);
      } catch (err) {
        if (!cancelled) setError(err.message || "ไม่สามารถโหลดร้านค้าได้");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    if (storeId) loadRoom();
    return () => { cancelled = true; };
  }, [storeId]);

  useEffect(() => {
    let cancelled = false;
    const loadMessages = async () => {
      try {
        const data = await messageAPI.getMessages(storeId);
        const list = Array.isArray(data?.data)
          ? data.data
          : Array.isArray(data)
            ? data
            : [];
        if (!cancelled) setMessages(list);
      } catch {
        if (!cancelled) setMessages([]);
      }
    };
    loadMessages();
    return () => { cancelled = true; };
  }, [storeId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async (event) => {
    event.preventDefault();
    const text = input.trim();
    if (!text || sending) return;

    const optimistic = {
      _id: `temp-${Date.now()}`,
      text,
      sender: { _id: currentUserId },
      senderRole: currentSenderRole,
      receiver: store?.owner?._id || store?.owner || undefined,
      createdAt: new Date().toISOString(),
      status: "sending",
    };

    setMessages((prev) => [...prev, optimistic]);
    setInput("");
    setSending(true);

    try {
      // Address the store owner explicitly when known; the backend falls back to
      // the store owner otherwise.
      const receiverId = store?.owner?._id || store?.owner || undefined;
      const payload = {
        content: text,
        text,
        senderRole: currentSenderRole,
      };
      if (receiverId) {
        payload.receiver = receiverId;
        payload.receiverId = receiverId;
      }
      const result = await messageAPI.sendMessage(storeId, payload);
      setMessages((prev) =>
        prev.map((m) =>
          m._id === optimistic._id ? { ...result.data, status: "sent" } : m
        )
      );
      setError("");
    } catch (err) {
      setMessages((prev) =>
        prev.map((m) => (m._id === optimistic._id ? { ...m, status: "error" } : m))
      );
      setError(err?.message || "ส่งข้อความไม่สำเร็จ");
    } finally {
      setSending(false);
    }
  };

  const handleBack = () => {
    if (fromStore) {
      navigate(`/stores/${fromStore}`);
    } else {
      navigate(-1);
    }
  };

  if (loading) {
    return (
      <div className="page customer-page chat-room-page">
        <div className="customer-page-header"><h1>กำลัง加载ห้องแชท...</h1></div>
      </div>
    );
  }

  const storeName = store?.name || "ร้านค้า";
  const storeLogo = store?.logo;
  const isOpen = store?.isActive !== false;

  return (
    <div className="page customer-page chat-room-page">
      {error && <div className="home-error">{error}</div>}
      <header className="chat-header">
        {fromStore && (
          <button
            type="button"
            className="chat-back-to-store"
            onClick={() => navigate(`/stores/${fromStore}`)}
            aria-label="กลับหน้าร้าน"
          >
            <ChevronLeftIcon /> กลับหน้าร้าน
          </button>
        )}
        <button type="button" className="chat-back" onClick={handleBack} aria-label="ย้อนกลับ">
          <ChevronLeftIcon />
        </button>
        <span className="chat-store-avatar">
          {storeLogo ? <img src={storeLogo} alt={storeName} /> : storeName.charAt(0)}
        </span>
        <div className="chat-store-info">
          <strong className="chat-store-name">{storeName}</strong>
          <span className="chat-store-status">{isOpen ? "เปิดร้าน" : "ร้านค้าปิดทำการ"}</span>
        </div>
      </header>

      <div className="chat-messages">
        {messages.length === 0 && (
          <div className="chat-empty">
            <p>ยังไม่มีข้อความในห้องแชท</p>
            <p style={{ fontSize: 13, color: "var(--text-muted)" }}>เริ่มต้นด้วยการทักทายร้านค้า</p>
          </div>
        )}
        {messages.map((message) => {
          const isMe = isOutgoing(message);
          return (
            <div
              key={message._id}
              className={`chat-message ${isMe ? "me" : "them"} ${message.status === "error" ? "status-error" : ""}`}
            >
              <span>{message.text}</span>
              <span className="chat-message-time">{message.createdAt ? formatTime(message.createdAt) : ""}</span>
              {message.status === "sending" && <span className="chat-message-time">กำลังส่ง...</span>}
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      <form className="chat-input" onSubmit={handleSend}>
        <input
          type="text"
          placeholder="พิมพ์ข้อความถึงร้านค้า..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={sending}
          aria-label="พิมพ์ข้อความ"
        />
        <button type="submit" disabled={sending || !input.trim()} aria-label="ส่งข้อความ">
          ส่ง
        </button>
      </form>
    </div>
  );
}