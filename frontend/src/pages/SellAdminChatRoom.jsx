import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useSocket } from "../context/SocketContext";
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

const formatDate = (iso) => {
  try {
    return new Date(iso).toLocaleDateString("th-TH", { day: "numeric", month: "short" });
  } catch {
    return "";
  }
};

export default function SellAdminChatRoom() {
  const { storeId, customerId: customerIdParam } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { admin } = useAuth();
  const user = admin?.user;
  const { joinStore, leaveStore, on, off, connected } = useSocket();

  const [store, setStore] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sendError, setSendError] = useState("");
  const [sending, setSending] = useState(false);
  const [typingUsers, setTypingUsers] = useState({});
  const messagesEndRef = useRef(null);

  const currentUserId = user?._id || user?.id;
  // Every message sent from this page is on the shop side, so it is always
  // posted with the shop ("admin") senderRole.
  const currentSenderRole = "admin";

  // The admin room is scoped to a store (/selladmin/messages/:storeId), so the
  // customer is not part of the route by default. Support an explicit
  // ?customerId=... (or :customerId) when the room is opened for one customer.
  const queryCustomerId = useMemo(() => {
    try {
      return new URLSearchParams(location.search).get("customerId") || "";
    } catch {
      return "";
    }
  }, [location.search]);
  const explicitCustomerId = customerIdParam || queryCustomerId;

  const getMessageSenderId = (message) => {
    const sender = message?.sender;
    if (!sender) return undefined;
    return typeof sender === "string" ? sender : sender._id;
  };

  // Resolve the customer currently in this room. Priority:
  //   1. explicit :customerId / ?customerId=...
  //   2. the most recent customer message in the room
  //   3. the most recent message authored by anyone other than this admin
  const resolveReceiverId = () => {
    if (explicitCustomerId) return explicitCustomerId;

    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const message = messages[i];
      if (message?.senderRole === "customer") {
        const id = getMessageSenderId(message);
        if (id) return id;
      }
    }

    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const id = getMessageSenderId(messages[i]);
      if (id && String(id) !== String(currentUserId)) return id;
    }

    return undefined;
  };

  // Shop-side messages are outgoing (right side, green); customer messages are
  // incoming (left side). senderRole is always set by the backend.
  const isCustomerMessage = (message) => message?.senderRole === "customer";
  const isOutgoing = (message) => !isCustomerMessage(message);

  useEffect(() => {
    let cancelled = false;
    const loadRoom = async () => {
      try {
        const response = await storeAPI.getStoreById(storeId, "admin");
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
        const data = await messageAPI.getMessages(storeId, {}, "admin");
        const list = Array.isArray(data?.data)
          ? data.data
          : Array.isArray(data)
            ? data
            : [];
        if (!cancelled) setMessages(list);
        if (!cancelled) {
          messageAPI.markAsRead(storeId, "admin").catch(() => {});
        }
      } catch {
        if (!cancelled) setMessages([]);
      }
    };
    if (storeId) loadMessages();
    return () => { cancelled = true; };
  }, [storeId]);

  useEffect(() => {
    if (!storeId || !connected) return;
    joinStore(storeId);

    const handleNewMessage = (msg) => {
      const msgStoreId = msg.store?._id || msg.store;
      if (msgStoreId && msgStoreId !== storeId) return;
      setMessages((prev) => {
        const exists = prev.some((m) => m._id && msg._id && m._id === msg._id);
        if (exists) return prev;
        return [...prev, msg];
      });
      if (msg.receiver && (msg.receiver._id || msg.receiver) === currentUserId && !msg.isRead) {
        messageAPI.markAsRead(storeId, "admin").catch(() => {});
      }
    };

    on("newMessage", handleNewMessage);

    return () => {
      off("newMessage", handleNewMessage);
      leaveStore(storeId);
    };
  }, [storeId, joinStore, leaveStore, on, off, connected, currentUserId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async (event) => {
    event.preventDefault();
    const text = input.trim();
    if (!text || sending) return;

    // Resolve the customer in this room so the reply is addressed explicitly.
    // POST /api/messages/:storeId always receives the receiver id (never empty).
    const receiverId = resolveReceiverId();

    const payload = {
      content: text,
      text,
      receiver: receiverId,
      receiverId: receiverId,
      senderRole: currentSenderRole,
      storeId,
    };

    const optimistic = {
      _id: `temp-${Date.now()}`,
      text,
      content: text,
      sender: { _id: currentUserId },
      senderRole: currentSenderRole,
      receiver: receiverId,
      createdAt: new Date().toISOString(),
      status: "sending",
    };

    setMessages((prev) => [...prev, optimistic]);
    setInput("");
    setSending(true);
    setSendError("");

    try {
      const result = await messageAPI.sendMessage(storeId, payload, "admin");
      const saved = result?.data || result || optimistic;
      setMessages((prev) =>
        prev.map((m) =>
          m._id === optimistic._id ? { ...saved, status: "sent" } : m
        )
      );
    } catch (err) {
      setMessages((prev) =>
        prev.map((m) => (m._id === optimistic._id ? { ...m, status: "error" } : m))
      );
      const detail = err?.data?.errors?.[0]?.msg;
      const backendMessage = err?.message || detail || "ส่งข้อความไม่สำเร็จ";
      // Override backend message for admin page to show admin-specific error
      const displayMessage = backendMessage.includes("ไม่พบลูกค้า")
        ? "ไม่พบแอดมินในห้องแชท"
        : backendMessage;
      setSendError(displayMessage);
    } finally {
      setSending(false);
    }
  };

  const handleBack = () => navigate(-1);

  if (loading) {
    return (
      <div className="page customer-page chat-room-page">
        <div className="customer-page-header"><h1>กำลังโหลดห้องแชท...</h1></div>
      </div>
    );
  }

  const storeName = store?.name || "ร้านค้า";
  const storeLogo = store?.logo;

  const isTyping = Object.keys(typingUsers).length > 0;

  return (
    <div className="page customer-page chat-room-page">
      {error && <div className="home-error">{error}</div>}
      <header className="chat-header">
        <button type="button" className="chat-back" onClick={handleBack} aria-label="ย้อนกลับ">
          <ChevronLeftIcon />
        </button>
        <span className="chat-store-avatar">
          {storeLogo ? <img src={storeLogo} alt={storeName} /> : storeName.charAt(0)}
        </span>
        <div className="chat-store-info">
          <strong className="chat-store-name">{storeName}</strong>
          <span className="chat-store-status">
            {connected ? "ออนไลน์" : "ตัดการเชื่อมต่อ"}
          </span>
        </div>
      </header>

      <div className="chat-messages">
        {messages.length === 0 && (
          <div className="chat-empty">
            <p>ยังไม่มีข้อความในห้องแชท</p>
            <p style={{ fontSize: 13, color: "var(--text-muted)" }}>เริ่มต้นด้วยการตอบกลับลูกค้า</p>
          </div>
        )}
        {messages.map((message) => {
          const isMe = isOutgoing(message);
          return (
            <div
              key={message._id}
              className={`chat-message ${isMe ? "me chat-message-out" : "them chat-message-in"} ${message.status === "error" ? "status-error" : ""}`}
            >
              <span className="chat-message-text">{message.text}</span>
              <span className="chat-message-time">
                {message.createdAt ? `${formatDate(message.createdAt)} ${formatTime(message.createdAt)}` : ""}
              </span>
              {message.status === "sending" && <span className="chat-message-time">กำลังส่ง...</span>}
              {message.status === "error" && <span className="chat-message-time">ส่งไม่สำเร็จ</span>}
            </div>
          );
        })}
        {isTyping && <div className="chat-typing">กำลังพิมพ์...</div>}
        <div ref={messagesEndRef} />
      </div>

      {sendError && (
        <div className="chat-send-error" role="alert">
          {sendError}
        </div>
      )}

      <form className="chat-input" onSubmit={handleSend}>
        <input
          type="text"
          placeholder="พิมพ์ข้อความถึงลูกค้า..."
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            if (sendError) setSendError("");
          }}
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
