import { useState, useEffect, useCallback } from "react";
import { useAuth } from "../context/AuthContext";
import { notificationAPI } from "../api";
import { formatRelativeTime, formatDate } from "../utils/helpers";
import "./Notifications.css";

const NOTIFICATION_ICONS = {
  new_message: "💬",
  order_status: "📦",
  delivery_update: "🚚",
  incoming_call: "📞",
  missed_call: "📵",
  payment: "💰",
  refund: "💸",
  system: "ℹ️",
  promotion: "🎁"
};

const NOTIFICATION_LABELS = {
  new_message: "ข้อความใหม่",
  order_status: "สถานะออเดอร์",
  delivery_update: "การจัดส่ง",
  incoming_call: "สายเข้า",
  missed_call: "สายไม่ได้รับ",
  payment: "ชำระเงิน",
  refund: "คืนเงิน",
  system: "ระบบ",
  promotion: "โปรโมชั่น"
};

export default function NotificationsCenter({ onClose }) {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("all"); // all, unread
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [unreadCount, setUnreadCount] = useState(0);

  const fetchNotifications = useCallback(async (pageNum = 1, append = false) => {
    setLoading(true);
    try {
      const result = await notificationAPI.getAll({ 
        page: pageNum, 
        limit: 20,
        is_read: filter === "unread" ? false : undefined
      });
      
      if (append) {
        setNotifications(prev => [...prev, ...result.data.notifications]);
      } else {
        setNotifications(result.data.notifications);
      }
      
      setHasMore(result.data.pagination.page < result.data.pagination.totalPages);
      setPage(pageNum);
    } catch (err) {
      setError(err.message || "ไม่สามารถโหลดการแจ้งเตือนได้");
    } finally {
      setLoading(false);
    }
  }, [filter]);

  const fetchUnreadCount = useCallback(async () => {
    try {
      const count = await notificationAPI.getUnreadCount();
      setUnreadCount(count);
    } catch (err) {
      console.error("Failed to fetch unread count:", err);
    }
  }, []);

  useEffect(() => {
    fetchNotifications(1, false);
    fetchUnreadCount();
  }, [fetchNotifications, fetchUnreadCount]);

  const handleMarkAsRead = async (notificationId) => {
    try {
      await notificationAPI.markAsRead(notificationId);
      setNotifications(prev => prev.map(n => 
        n.id === notificationId ? { ...n, is_read: true, read_at: new Date().toISOString() } : n
      ));
      setUnreadCount(prev => Math.max(0, prev - 1));
    } catch (err) {
      console.error("Failed to mark as read:", err);
    }
  };

  const handleMarkAllAsRead = async () => {
    try {
      await notificationAPI.markAllAsRead();
      setNotifications(prev => prev.map(n => ({ ...n, is_read: true, read_at: new Date().toISOString() })));
      setUnreadCount(0);
    } catch (err) {
      console.error("Failed to mark all as read:", err);
    }
  };

  const handleDelete = async (notificationId) => {
    try {
      await notificationAPI.delete(notificationId);
      setNotifications(prev => prev.filter(n => n.id !== notificationId));
    } catch (err) {
      console.error("Failed to delete notification:", err);
    }
  };

  const handleLoadMore = () => {
    if (!loading && hasMore) {
      fetchNotifications(page + 1, true);
    }
  };

  const getNotificationIcon = (type) => NOTIFICATION_ICONS[type] || "🔔";
  const getNotificationLabel = (type) => NOTIFICATION_LABELS[type] || type;

  const handleNotificationClick = (notification) => {
    if (!notification.is_read) {
      handleMarkAsRead(notification.id);
    }
    
    // Navigate based on related_type
    if (notification.related_type === "order") {
      window.location.href = `/orders/${notification.related_id}`;
    } else if (notification.related_type === "conversation") {
      window.location.href = `/chat/${notification.related_id}`;
    } else if (notification.related_type === "delivery") {
      window.location.href = `/deliveries/${notification.related_id}`;
    } else if (notification.related_type === "call") {
      window.location.href = `/calls/history`;
    }
    
    onClose?.();
  };

  if (loading && notifications.length === 0) {
    return (
      <div className="notifications-container">
        <div className="loading">กำลังโหลด...</div>
      </div>
    );
  }

  return (
    <div className="notifications-container">
      <div className="notifications-header">
        <div className="header-left">
          <h2>การแจ้งเตือน</h2>
          {unreadCount > 0 && (
            <span className="unread-badge">{unreadCount}</span>
          )}
        </div>
        <div className="header-right">
          <select 
            value={filter} 
            onChange={(e) => setFilter(e.target.value)}
            className="filter-select"
          >
            <option value="all">ทั้งหมด</option>
            <option value="unread">ยังไม่ได้อ่าน ({unreadCount})</option>
          </select>
          {unreadCount > 0 && (
            <button className="btn-mark-all" onClick={handleMarkAllAsRead}>
              อ่านทั้งหมด
            </button>
          )}
          {onClose && (
            <button className="btn-close" onClick={onClose}>×</button>
          )}
        </div>
      </div>

      {error && <div className="error-message">{error}</div>}

      {notifications.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">🔔</div>
          <h3>ไม่มีการแจ้งเตือน</h3>
          <p>{filter === "unread" ? "คุณอ่านครบทุกอย่างแล้ว" : "การแจ้งเตือนจะปรากฏที่นี่"}</p>
        </div>
      ) : (
        <>
          <div className="notifications-list">
            {notifications.map(notification => (
              <div
                key={notification.id}
                className={`notification-item ${!notification.is_read ? "unread" : ""}`}
                onClick={() => handleNotificationClick(notification)}
              >
                <div className="notification-icon">
                  {getNotificationIcon(notification.type)}
                </div>
                <div className="notification-content">
                  <div className="notification-header">
                    <span className="notification-title">{notification.title}</span>
                    <span className="notification-time">
                      {formatRelativeTime(notification.created_at)}
                    </span>
                  </div>
                  <p className="notification-body">{notification.body}</p>
                  <div className="notification-meta">
                    <span className="notification-type">{getNotificationLabel(notification.type)}</span>
                    {formatDate(notification.created_at)}
                  </div>
                </div>
                {!notification.is_read && (
                  <div className="unread-dot" />
                )}
                <button 
                  className="delete-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(notification.id);
                  }}
                  aria-label="ลบการแจ้งเตือน"
                >
                  ×
                </button>
              </div>
            ))}
          </div>

          {hasMore && (
            <button className="load-more-btn" onClick={handleLoadMore} disabled={loading}>
              {loading ? "กำลังโหลด..." : "โหลดเพิ่มเติม"}
            </button>
          )}
        </>
      )}
    </div>
  );
}

// Hook for using notifications in other components
export function useNotifications() {
  const [unreadCount, setUnreadCount] = useState(0);
  
  const fetchUnreadCount = useCallback(async () => {
    try {
      const count = await notificationAPI.getUnreadCount();
      setUnreadCount(count);
    } catch (err) {
      console.error("Failed to fetch unread count:", err);
    }
  }, []);
  
  useEffect(() => {
    fetchUnreadCount();
    const interval = setInterval(fetchUnreadCount, 60000); // Every minute
    return () => clearInterval(interval);
  }, [fetchUnreadCount]);
  
  return { unreadCount, refresh: fetchUnreadCount };
}