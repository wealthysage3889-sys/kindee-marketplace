import { useState, useEffect } from "react";
import { useAuth } from "../context/AuthContext";
import { callAPI } from "../api";
import { formatDate, formatRelativeTime, formatDuration } from "../utils/helpers";
import "./CallHistory.css";

const STATUS_LABELS = {
  ringing: "กำลังโทร",
  accepted: "เชื่อมต่อแล้ว",
  rejected: "ปฏิเสธ",
  missed: "ไม่ได้รับ",
  ended: "สิ้นสุด"
};

const STATUS_ICONS = {
  ringing: "📞",
  accepted: "✅",
  rejected: "❌",
  missed: "📵",
  ended: "📞"
};

export default function CallHistory() {
  const { user } = useAuth();
  const [calls, setCalls] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filters, setFilters] = useState({
    status: "",
    type: "",
    page: 1,
    limit: 20
  });
  const [pagination, setPagination] = useState({ total: 0, totalPages: 1 });
  const [selectedCall, setSelectedCall] = useState(null);

  const fetchCalls = async () => {
    setLoading(true);
    try {
      const result = await callAPI.getHistory(filters);
      setCalls(result.data.calls);
      setPagination({
        total: result.data.pagination.total,
        totalPages: result.data.pagination.totalPages
      });
    } catch (err) {
      setError(err.message || "ไม่สามารถโหลดประวัติการโทรได้");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCalls();
  }, [filters]);

  const handleFilterChange = (key, value) => {
    setFilters(prev => ({ ...prev, [key]: value, page: 1 }));
  };

  const handlePageChange = (page) => {
    setFilters(prev => ({ ...prev, page }));
  };

  const getCallDirection = (call) => {
    if (call.caller_id === user.id) return "outgoing";
    if (call.callee_id === user.id) return "incoming";
    return "unknown";
  };

  const getOtherParty = (call) => {
    if (call.caller_id === user.id) return call.callee;
    return call.caller;
  };

  if (loading && calls.length === 0) {
    return (
      <div className="call-history-container">
        <div className="loading">กำลังโหลด...</div>
      </div>
    );
  }

  return (
    <div className="call-history-container">
      <div className="page-header">
        <h1>ประวัติการโทร</h1>
        <div className="call-stats">
          <span>ทั้งหมด: {pagination.total} รายการ</span>
        </div>
      </div>

      <div className="filters-bar">
        <select
          value={filters.status}
          onChange={(e) => handleFilterChange("status", e.target.value)}
          className="filter-select"
        >
          <option value="">ทุกสถานะ</option>
          <option value="ringing">กำลังโทร</option>
          <option value="accepted">เชื่อมต่อแล้ว</option>
          <option value="rejected">ปฏิเสธ</option>
          <option value="missed">ไม่ได้รับ</option>
          <option value="ended">สิ้นสุด</option>
        </select>

        <select
          value={filters.type}
          onChange={(e) => handleFilterChange("type", e.target.value)}
          className="filter-select"
        >
          <option value="">ทุกประเภท</option>
          <option value="voice">เสียง</option>
          <option value="video">วิดีโอ</option>
        </select>
      </div>

      {error && <div className="error-message">{error}</div>}

      {calls.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">📞</div>
          <h3>ยังไม่มีประวัติการโทร</h3>
          <p>เริ่มโทรหาเพื่อนหรือร้านค้าได้เลย</p>
        </div>
      ) : (
        <>
          <div className="calls-list">
            {calls.map(call => {
              const direction = getCallDirection(call);
              const otherParty = getOtherParty(call);
              const isMissed = call.status === "missed" && direction === "incoming";
              
              return (
                <div
                  key={call.id}
                  className={`call-item ${direction} ${isMissed ? "missed" : ""}`}
                  onClick={() => setSelectedCall(call)}
                >
                  <div className="call-avatar">
                    {otherParty?.avatar_url ? (
                      <img src={otherParty.avatar_url} alt={otherParty.name} />
                    ) : (
                      <span>{otherParty?.name?.charAt(0) || "?"}</span>
                    )}
                    {isMissed && <span className="missed-badge">Missed</span>}
                  </div>

                  <div className="call-info">
                    <div className="call-header-row">
                      <span className="call-name">{otherParty?.name || "ไม่ทราบชื่อ"}</span>
                      <span className={`call-status status-${call.status}`}>
                        {STATUS_ICONS[call.status]} {STATUS_LABELS[call.status]}
                      </span>
                    </div>
                    
                    <div className="call-meta">
                      <span className="call-direction">
                        {direction === "outgoing" ? "📤" : "📥"} {direction === "outgoing" ? "โทรออก" : "โทรเข้า"}
                      </span>
                      <span className="call-time">{formatRelativeTime(call.created_at)}</span>
                    </div>
                    
                    {call.duration_seconds && (
                      <div className="call-duration">
                        ⏱ {formatDuration(call.duration_seconds)}
                      </div>
                    )}
                    
                    {call.conversation && (
                      <div className="call-context">
                        {call.conversation.type === "store_customer" && "💬 แชทร้านค้า"}
                        {call.conversation.type === "group" && "👥 แชทกลุ่ม"}
                        {call.store_order && `📦 ออเดอร์ #${call.store_order.store_order_number}`}
                      </div>
                    )}
                  </div>

                  <div className="call-arrow">›</div>
                </div>
              );
            })}
          </div>

          {pagination.totalPages > 1 && (
            <div className="pagination">
              <button
                onClick={() => handlePageChange(filters.page - 1)}
                disabled={filters.page === 1}
                className="page-btn"
              >
                « ก่อนหน้า
              </button>
              <span className="page-info">
                หน้า {filters.page} / {pagination.totalPages}
              </span>
              <button
                onClick={() => handlePageChange(filters.page + 1)}
                disabled={filters.page >= pagination.totalPages}
                className="page-btn"
              >
                ถัดไป »
              </button>
            </div>
          )}
        </>
      )}

      {selectedCall && (
        <CallDetailModal
          call={selectedCall}
          onClose={() => setSelectedCall(null)}
        />
      )}
    </div>
  );
}

function CallDetailModal({ call, onClose }) {
  const { user } = useAuth();
  const direction = call.caller_id === user.id ? "outgoing" : "incoming";
  const otherParty = direction === "outgoing" ? call.callee : call.caller;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>รายละเอียดการโทร</h2>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>

        <div className="call-detail">
          <div className="detail-header">
            <div className="detail-avatar">
              {otherParty?.avatar_url ? (
                <img src={otherParty.avatar_url} alt={otherParty.name} />
              ) : (
                <span>{otherParty?.name?.charAt(0) || "?"}</span>
              )}
            </div>
            <div className="detail-info">
              <h3>{otherParty?.name || "ไม่ทราบชื่อ"}</h3>
              <span className={`detail-status status-${call.status}`}>
                {STATUS_ICONS[call.status]} {STATUS_LABELS[call.status]}
              </span>
            </div>
          </div>

          <div className="detail-grid">
            <div className="detail-item">
              <label>ประเภท</label>
              <value>{direction === "outgoing" ? "โทรออก" : "โทรเข้า"}</value>
            </div>
            <div className="detail-item">
              <label>ประเภทการโทร</label>
              <value>{call.metadata?.call_type === "video" ? "📹 วิดีโอ" : "📞 เสียง"}</value>
            </div>
            <div className="detail-item">
              <label>เวลาเริ่ม</label>
              <value>{formatDate(call.started_at || call.created_at)}</value>
            </div>
            <div className="detail-item">
              <label>เวลาตอบ</label>
              <value>{call.answered_at ? formatDate(call.answered_at) : "-"}</value>
            </div>
            <div className="detail-item">
              <label>เวลาสิ้นสุด</label>
              <value>{call.ended_at ? formatDate(call.ended_at) : "-"}</value>
            </div>
            <div className="detail-item">
              <label>ระยะเวลา</label>
              <value>{call.duration_seconds ? formatDuration(call.duration_seconds) : "-"}</value>
            </div>
            <div className="detail-item">
              <label>เหตุผลสิ้นสุด</label>
              <value>{call.end_reason || "-"}</value>
            </div>
          </div>

          {call.conversation && (
            <div className="detail-section">
              <h4>ข้อมูลเพิ่มเติม</h4>
              <p>ประเภทแชท: {call.conversation.type}</p>
              {call.store_order && (
                <p>ออเดอร์: #{call.store_order.store_order_number}</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}