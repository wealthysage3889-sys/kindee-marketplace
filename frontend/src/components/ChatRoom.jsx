import { useState, useEffect, useRef, useCallback } from "react";
import { useParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useSocket } from "../context/SocketContext";
import { chatAPI, uploadAPI } from "../api";
import { formatRelativeTime, formatDate } from "../utils/helpers";
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

export default function ChatRoom({ conversationId: conversationIdProp, storeOrderId, initialMessages }) {
  const routeParams = useParams();
  const conversationId = conversationIdProp || routeParams.conversationId;
  const { user } = useAuth();
  const { 
    joinConversation, 
    leaveConversation, 
    sendCallSignal,
    on, 
    off, 
    emit,
    typingUsers 
  } = useSocket();
  
  const [messages, setMessages] = useState(initialMessages || []);
  const [newMessage, setNewMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [showAttachments, setShowAttachments] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [conversation, setConversation] = useState(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState("");
  
  const messagesEndRef = useRef(null);
  const messageInputRef = useRef(null);
  const typingTimeoutRef = useRef(null);
  const isTypingRef = useRef(false);

  // Load conversation info
  useEffect(() => {
    if (conversationId) {
      chatAPI.getConversation(conversationId)
        .then(res => setConversation(res.data))
        .catch(err => console.error("Failed to load conversation:", err));
    }
  }, [conversationId]);

  // Join conversation
  useEffect(() => {
    if (conversationId) {
      joinConversation(conversationId);
    }
    
    return () => {
      if (conversationId) {
        leaveConversation(conversationId);
      }
    };
  }, [conversationId, joinConversation, leaveConversation]);

  // Load messages
  const loadMessages = useCallback(async (pageNum = 1, append = false) => {
    setLoading(true);
    try {
      const result = await chatAPI.getMessages(conversationId, { page: pageNum, limit: 50 });
      const newMessages = result.data;
      
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
  }, [conversationId]);

  useEffect(() => {
    loadMessages(1, false);
  }, [conversationId, loadMessages]);

  // Scroll to bottom
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // Socket event handlers
  useEffect(() => {
    const handleNewMessage = (message) => {
      setMessages(prev => {
        // Avoid duplicates
        if (prev.some(m => m.id === message.id)) return prev;
        return [...prev, message];
      });
      
      // Mark as read if we're in the conversation
      chatAPI.markAsRead(conversationId, message.id).catch(() => {});
    };
    
    const handleMessagesRead = ({ userId, count }) => {
      // Update read status
    };
    
    const handleTyping = ({ userId, name }) => {
      // Show typing indicator
    };
    
    const handleStopTyping = ({ userId }) => {
      // Hide typing indicator
    };
    
    on("newMessage", handleNewMessage);
    on("messagesRead", handleMessagesRead);
    on("typing", handleTyping);
    on("stopTyping", handleStopTyping);
    
    return () => {
      off("newMessage", handleNewMessage);
      off("messagesRead", handleMessagesRead);
      off("typing", handleTyping);
      off("stopTyping", handleStopTyping);
    };
  }, [conversationId, on, off]);

  // Send message
  const handleSendMessage = async (e) => {
    e.preventDefault();
    
    if ((!newMessage.trim() && selectedFiles.length === 0) || sending) return;
    
    setSending(true);
    const content = newMessage.trim();
    setNewMessage("");
    setShowAttachments(false);
    const filesToSend = [...selectedFiles];
    setSelectedFiles([]);
    isTypingRef.current = false;
    clearTimeout(typingTimeoutRef.current);
    stopTyping();
    
    try {
      // Upload attachments first
      let attachments = [];
      if (filesToSend.length > 0) {
        const uploadResult = await uploadAPI.uploadChatAttachment(conversationId, filesToSend);
        attachments = uploadResult.data;
      }
      
      // Send message
      await chatAPI.sendMessage(conversationId, {
        content: content || undefined,
        type: filesToSend.length > 0 ? (filesToSend[0].type.startsWith("image/") ? "image" : "file") : "text",
        attachments,
        metadata: {}
      });
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
      startTyping(user.name);
    }
    
    clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      isTypingRef.current = false;
      stopTyping();
    }, 2000);
  };

  const startTyping = (name) => {
    emit("typing", { conversationId, name });
  };

  const stopTyping = () => {
    emit("stopTyping", { conversationId });
  };

  // File selection
  const handleFileSelect = (e) => {
    const files = Array.from(e.target.files);
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
    switch (message.type) {
      case "image":
        return (
          <div className="message-image">
            <img src={message.content || message.attachments?.[0]?.file_url} alt="Image" onClick={() => window.open(message.attachments?.[0]?.file_url, "_blank")} />
          </div>
        );
      case "file":
        return (
          <div className="message-file">
            <a href={message.attachments?.[0]?.file_url} target="_blank" rel="noopener noreferrer">
              <span className="file-icon">📄</span>
              <span className="file-name">{message.attachments?.[0]?.file_name || message.content}</span>
              <span className="file-size">{(message.attachments?.[0]?.file_size / 1024).toFixed(1)} KB</span>
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
          <div className="message-text">{message.content}</div>
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
            <button className="call-btn" onClick={() => {
              // Initiate call
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
          <button className="load-more-btn" onClick={handleLoadMore} disabled={loading}>
            {loading ? "กำลังโหลด..." : "โหลดข้อความก่อนหน้า"}
          </button>
        )}
        
        {messages.map((message, index) => {
          const isOwn = message.sender_id === user.id;
          const showTime = index === 0 || 
            new Date(message.created_at).getTime() - new Date(messages[index - 1]?.created_at).getTime() > 5 * 60 * 1000;
          
          return (
            <div key={message.id} className={`message ${isOwn ? "own" : ""}`}>
              {!isOwn && (
                <div className="message-sender">
                  <img src={message.sender?.avatar_url} alt={message.sender?.name} />
                  <span>{message.sender?.name}</span>
                </div>
              )}
              
              <div className="message-bubble">
                {renderMessageContent(message)}
                
                {message.attachments && message.attachments.length > 0 && message.type === "text" && (
                  <div className="message-attachments">
                    {message.attachments.map((att, i) => (
                      <div key={i} className="attachment">
                        {att.mime_type.startsWith("image/") ? (
                          <img src={att.file_url} alt={att.file_name} onClick={() => window.open(att.file_url, "_blank")} />
                        ) : (
                          <a href={att.file_url} target="_blank" rel="noopener noreferrer">
                            <span className="file-icon">📄</span>
                            <span>{att.file_name}</span>
                          </a>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                
                <div className="message-time">
                  {formatMessageTime(message.created_at)}
                  {isOwn && message.is_read && <span className="read-receipt">✓✓</span>}
                </div>
              </div>
              
              {showTime && (
                <div className="message-date-separator">{formatDate(message.created_at)}</div>
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
              <span className="selected-file" key={index}>
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
            onClick={() => setShowAttachments(!showAttachments)}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.49"></path>
            </svg>
          </button>
          
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
          
          {showAttachments && (
            <input
              type="file"
              multiple
              accept="image/*,application/pdf,.doc,.docx"
              onChange={handleFileSelect}
              className="file-input"
              style={{ display: "none" }}
              ref={(el) => el?.click()}
            />
          )}
          
          <button 
            type="submit" 
            className="send-btn"
            disabled={!newMessage.trim() && selectedFiles.length === 0 || sending}
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