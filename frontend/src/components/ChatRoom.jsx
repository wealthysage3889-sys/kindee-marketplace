import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useSocket } from "../context/SocketContext";
import { chatAPI, uploadAPI, normalizeAttachment } from "../api";
import { formatDate } from "../utils/helpers";
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

export default function ChatRoom({ conversationId: conversationIdProp, mode: modeProp, initialMessages }) {
  const routeParams = useParams();
  const location = useLocation();
  const conversationId = conversationIdProp || routeParams.conversationId;

  const { customer, admin } = useAuth();
  const mode = resolveChatMode(modeProp, location.pathname);
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

  const currentMember = conversation?.members?.find(
    (m) => String(m.profile_id ?? m.profileId) === String(currentUserId)
  );
  const serverLastReadId = currentMember?.last_read_message_id
    ?? currentMember?.lastReadMessageId
    ?? null;

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
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // Socket event handlers
  useEffect(() => {
    if (!connected) return;

    const handleNewMessage = (message) => {
      const incomingConversationId = message?.conversation_id ?? message?.conversationId;
      // Never touch another room's state.
      if (incomingConversationId && String(incomingConversationId) !== String(conversationId)) return;

      const senderId = message?.sender_id ?? message?.senderId;
      if (senderId && currentUserId && String(senderId) === String(currentUserId)) return;

      setMessages(prev => {
        const id = message?.id ?? message?._id;
        if (prev.some(m => String(m.id ?? m._id) === String(id))) return prev;
        return [...prev, message];
      });

      // User is in the room and can see the message -> mark read now.
      if (visibleRef.current) {
        markAsRead(message?.id ?? message?._id);
      }
    };

    on("newMessage", handleNewMessage);

    return () => {
      off("newMessage", handleNewMessage);
    };
  }, [conversationId, connected, currentUserId, on, off, markAsRead]);

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

  // Render message content
  const renderMessageContent = (message) => {
    const attachments = message.attachments || [];
    const firstAttachment = attachments[0];

    switch (message.type) {
      case "image":
        return (
          <div className="message-image">
            <img
              src={attachmentUrl(firstAttachment) || message.content}
              alt={attachmentName(firstAttachment)}
              onClick={() => {
                const url = attachmentUrl(firstAttachment);
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
        return (
          <div className="message-order-update">
            <span className="order-badge">📦 อัปเดตออเดอร์</span>
            <p>{message.content}</p>
          </div>
        );
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
                      <img
                        src={attachmentUrl(att)}
                        alt={attachmentName(att)}
                        onClick={() => window.open(attachmentUrl(att), "_blank")}
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

  return (
    <div className="chat-room">
      <div className="chat-header">
        <div className="chat-header-left">
          <div className="chat-avatar">
            {conversation?.store?.logo_url ? (
              <img src={conversation.store.logo_url} alt={conversation.store.name} />
            ) : conversation?.store?.name ? (
              <span>{conversation.store.name.charAt(0)}</span>
            ) : (
              <span>{conversation?.title?.charAt(0) || "💬"}</span>
            )}
          </div>
          <div className="chat-title">
            <h3>{conversation?.store?.name || conversation?.title || "การสนทนา"}</h3>
            {conversation?.store_order && (
              <span className="chat-order">ออเดอร์ #{conversation.store_order.store_order_number}</span>
            )}
          </div>
        </div>
        <div className="chat-header-right">
          {conversation?.type === "store_customer" && (
            <button className="call-btn" type="button" onClick={() => {
              emit("callSignal", {
                callId: `call-${Date.now()}`,
                signal: { type: "offer" }
              });
            }}>
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
    </div>
  );
}