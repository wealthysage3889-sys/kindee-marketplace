import { useEffect, useState, useCallback } from "react";
import { useAuth } from "../context/AuthContext";
import { useSocket } from "../context/SocketContext";
import { storeAPI } from "../api/product";
import { orderAPI } from "../api";
import "./SellerOrders.css";

const STATUS_LABELS = {
  pending: "รอดำเนินการ",
  confirmed: "ยืนยันแล้ว",
  preparing: "กำลังเตรียม",
  ready_for_pickup: "พร้อมรับ",
  picked_up: "รับแล้ว",
  in_transit: "กำลังจัดส่ง",
  delivered: "ส่งแล้ว",
  cancelled: "ยกเลิก",
  failed: "ล้มเหลว",
  refunded: "คืนเงิน",
};

const STATUS_TRANSITIONS = {
  pending: ["confirmed", "cancelled"],
  confirmed: ["preparing", "cancelled"],
  preparing: ["ready_for_pickup", "cancelled"],
  ready_for_pickup: ["picked_up", "cancelled"],
  picked_up: ["in_transit", "cancelled"],
  in_transit: ["delivered", "failed"],
  delivered: [],
  cancelled: [],
  failed: [],
};

const TRANSITION_LABELS = {
  confirmed: "รับออเดอร์",
  cancelled: "ปฏิเสธ/ยกเลิก",
  preparing: "เริ่มเตรียม",
  ready_for_pickup: "พร้อมรับ",
  picked_up: "รับแล้ว",
  in_transit: "ส่งออก",
  delivered: "ส่งสำเร็จ",
  failed: "ล้มเหลว",
};

const PAYMENT_STATUS_LABELS = {
  pending: "รอชำระ",
  paid: "ชำระแล้ว",
  failed: "ชำระล้มเหลว",
  refunded: "คืนเงินแล้ว",
  partially_refunded: "คืนเงินบางส่วน",
};

function formatCurrency(amount) {
  const num = Number(amount);
  if (isNaN(num)) return "-";
  return num.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " บาท";
}

function formatAddress(address) {
  if (!address) return "-";
  const parts = [];
  if (address.name) parts.push(`ผู้รับ: ${address.name}`);
  if (address.phone) parts.push(`โทร: ${address.phone}`);
  if (address.address) parts.push(address.address);
  if (address.district) parts.push(`ตำบล/แขวง ${address.district}`);
  if (address.province) parts.push(`อำเภอ/เขต ${address.province}`);
  if (address.postalCode) parts.push(`${address.postalCode}`);
  return parts.join(" · ") || "-";
}

export default function SellerOrders() {
  const { customer } = useAuth();
  const user = customer?.user;
  const { on, off } = useSocket();
  const [stores, setStores] = useState([]);
  const [selectedStoreId, setSelectedStoreId] = useState(null);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [storesLoading, setStoresLoading] = useState(true);
  const [error, setError] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState({});
  const [history, setHistory] = useState({});
  const [historyLoading, setHistoryLoading] = useState({});
  const [actionLoading, setActionLoading] = useState({});
  const [refreshLoading, setRefreshLoading] = useState(false);

  // Load stores on mount
  useEffect(() => {
    let cancelled = false;
    const loadStores = async () => {
      const ownerId = user?._id || user?.id;
      if (!ownerId) return;
      try {
        setStoresLoading(true);
        setError("");
        const storeData = await storeAPI.getStoresByOwner(ownerId);
        const storesList = storeData?.data || storeData || [];
        if (!cancelled) {
          setStores(storesList);
          if (storesList.length > 0 && !selectedStoreId) {
            setSelectedStoreId(storesList[0].id || storesList[0]._id);
          }
        }
      } catch (err) {
        if (!cancelled) setError(err.message || "โหลดร้านค้าไม่สำเร็จ");
      } finally {
        if (!cancelled) setStoresLoading(false);
      }
    };
    loadStores();
    return () => { cancelled = true; };
  }, [user?._id, user?.id]);

  // Fetch orders when store changes
  const fetchOrders = useCallback(async () => {
    if (!selectedStoreId) {
      setOrders([]);
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      setError("");
      const res = await orderAPI.getStoreOrders(selectedStoreId, { status: statusFilter || undefined, limit: 50 });
      const data = res?.data || res;
      setOrders(data?.storeOrders || data?.orders || []);
    } catch (err) {
      setError(err.message || "โหลดออเดอร์ไม่สำเร็จ");
    } finally {
      setLoading(false);
      setRefreshLoading(false);
    }
  }, [selectedStoreId, statusFilter]);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  // Realtime: refresh orders when a store order status changes
  useEffect(() => {
    const onOrderStatusUpdate = (data) => {
      if (selectedStoreId) {
        fetchOrders();
      }
    };
    on("orderStatusUpdate", onOrderStatusUpdate);
    return () => off("orderStatusUpdate", onOrderStatusUpdate);
  }, [on, off, selectedStoreId, fetchOrders]);

  const handleTransition = async (storeOrderId, newStatus) => {
    let notes = "";
    if (newStatus === "cancelled" || newStatus === "failed") {
      const promptMsg = newStatus === "cancelled" ? "เหตุผลในการปฏิเสธ/ยกเลิก:" : "เหตุผลในการบันทึกสถานะล้มเหลว:";
      notes = window.prompt(promptMsg) || "";
      if (!notes.trim()) return;
    }
    try {
      setActionLoading((p) => ({ ...p, [storeOrderId]: true }));
      await orderAPI.updateStoreOrderStatus(storeOrderId, newStatus, notes);
      await fetchOrders();
    } catch (err) {
      setError(err.message || "อัปเดตสถานะไม่สำเร็จ");
    } finally {
      setActionLoading((p) => ({ ...p, [storeOrderId]: false }));
    }
  };

  const toggleHistory = async (storeOrderId) => {
    if (expanded[storeOrderId]) {
      setExpanded((p) => ({ ...p, [storeOrderId]: false }));
      return;
    }
    try {
      setHistoryLoading((p) => ({ ...p, [storeOrderId]: true }));
      const res = await orderAPI.getStoreOrderHistory(storeOrderId);
      setHistory((p) => ({ ...p, [storeOrderId]: res?.data || res || [] }));
      setExpanded((p) => ({ ...p, [storeOrderId]: true }));
    } catch (err) {
      setError(err.message || "โหลดประวัติไม่สำเร็จ");
    } finally {
      setHistoryLoading((p) => ({ ...p, [storeOrderId]: false }));
    }
  };

  const handleRefresh = () => {
    setRefreshLoading(true);
    fetchOrders();
  };

  const selectedStore = stores.find(s => (s.id || s._id) === selectedStoreId);

  const filtered = orders.filter((o) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    const num = (o.order?.order_number || o.store_order_number || "").toLowerCase();
    const name = (o.order?.customer_snapshot?.name || "").toLowerCase();
    const items = (o.order_items || []).map((i) => i.product_name).join(" ").toLowerCase();
    return num.includes(q) || name.includes(q) || items.includes(q);
  });

  if (storesLoading) {
    return <div className="page seller-orders-page"><p>กำลังโหลดร้านค้า...</p></div>;
  }

  if (stores.length === 0) {
    return (
      <div className="page seller-orders-page">
        <div className="seller-orders-header">
          <h1>จัดการออเดอร์</h1>
        </div>
        <div className="empty-state">
          <p>คุณยังไม่มีร้านค้า</p>
          <a href="/stores/create" className="btn btn-primary">สร้างร้านค้าใหม่</a>
        </div>
      </div>
    );
  }

  if (error && !loading && !storesLoading) {
    return (
      <div className="page seller-orders-page">
        <div className="seller-orders-header">
          <h1>จัดการออเดอร์{selectedStore ? ` - ${selectedStore.name}` : ""}</h1>
        </div>
        <div className="alert alert-error" role="alert">{error}</div>
      </div>
    );
  }

  return (
    <div className="page seller-orders-page">
      <header className="seller-orders-header">
        <h1>จัดการออเดอร์{selectedStore ? ` - ${selectedStore.name}` : ""}</h1>
        
        {stores.length > 1 && (
          <div className="seller-store-selector">
            <label htmlFor="store-select">เลือกร้านค้า:</label>
            <select
              id="store-select"
              value={selectedStoreId}
              onChange={(e) => setSelectedStoreId(e.target.value)}
              disabled={loading}
            >
              {stores.map((s) => (
                <option key={s.id || s._id} value={s.id || s._id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="seller-orders-filters">
          <input
            type="search"
            placeholder="ค้นหาเลขที่/ลูกค้า/สินค้า"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            disabled={loading}
          />
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} disabled={loading}>
            <option value="">ทุกสถานะ</option>
            {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <button
            className="btn btn-outline"
            onClick={handleRefresh}
            disabled={loading || refreshLoading}
          >
            {refreshLoading ? "กำลังโหลด..." : "รีเฟรช"}
          </button>
        </div>
      </header>

      {error && <div className="alert alert-error" role="alert">{error}</div>}

      {loading ? (
        <p className="loading-state">กำลังโหลดออเดอร์...</p>
      ) : filtered.length === 0 ? (
        <div className="empty-state">ยังไม่มีออเดอร์ในสถานะที่เลือก</div>
      ) : (
        <div className="seller-orders-list">
          {filtered.map((so) => {
            const transitions = STATUS_TRANSITIONS[so.status] || [];
            const isActionLoading = actionLoading[so.id];
            const isHistoryLoading = historyLoading[so.order?.id || so.parent_order_id];
            const isExpanded = expanded[so.order?.id || so.parent_order_id];
            const historyData = history[so.order?.id || so.parent_order_id] || [];
            return (
              <article key={so.id} className="seller-order-card">
                <div className="seller-order-top">
                  <div>
                    <strong>{so.store_order_number || so.id}</strong>
                    <span className={`badge badge-${so.status}`}>{STATUS_LABELS[so.status] || so.status}</span>
                  </div>
                  <div className="seller-order-meta">
                    <span>ออเดอร์หลัก: {so.order?.order_number || "-"}</span>
                    <span>ลูกค้า: {so.order?.customer_snapshot?.name || "-"}</span>
                    <span>
                      ชำระเงิน:{' '}
                      <span className="payment-status">
                        {PAYMENT_STATUS_LABELS[so.order?.payment_status] || so.order?.payment_status || "-"}
                      </span>
                    </span>
                    <span>ยอด: {formatCurrency(so.total_amount)}</span>
                  </div>
                </div>

                <div className="seller-order-items">
                  {(so.order_items || []).map((it) => (
                    <div key={it.id} className="seller-order-item">
                      <span>{it.product_name} x {it.quantity}</span>
                      <span>{formatCurrency(it.total_price)}</span>
                    </div>
                  ))}
                </div>

                {so.order?.customer_snapshot?.address && (
                  <div className="seller-order-address">
                    <label>ที่อยู่จัดส่ง:</label>
                    <p>{formatAddress(so.order.customer_snapshot.address)}</p>
                  </div>
                )}

                {so.order?.customer_notes && (
                  <div className="seller-order-notes">
                    <label>หมายเหตุลูกค้า:</label>
                    <p>{so.order.customer_notes}</p>
                  </div>
                )}

                <div className="seller-order-actions">
                  {transitions.map((t) => (
                    <button
                      key={t}
                      className={(t === "cancelled" || t === "failed") ? "btn btn-danger" : "btn btn-primary"}
                      disabled={isActionLoading}
                      onClick={() => handleTransition(so.id, t)}
                    >
                      {isActionLoading ? "กำลังดำเนินการ..." : (TRANSITION_LABELS[t] || t)}
                    </button>
                  ))}
                  <button
                    className="btn btn-outline"
                    onClick={() => toggleHistory(so.order?.id || so.parent_order_id)}
                    disabled={isHistoryLoading}
                  >
                    {isHistoryLoading ? "กำลังโหลด..." : (isExpanded ? "ซ่อนประวัติ" : "ประวัติสถานะ")}
                  </button>
                </div>

                {isExpanded && (
                  <div className="seller-order-history">
                    {historyData.length > 0 ? (
                      historyData.map((h, idx) => (
                        <div key={idx} className="history-row">
                          <span>{h.from_status || "-"} → {h.to_status}</span>
                          <span>{new Date(h.created_at).toLocaleString("th-TH")}</span>
                          {h.reason && <span className="history-reason">({h.reason})</span>}
                          {h.changed_by_user && <span className="history-actor">โดย {h.changed_by_user.name} ({h.changed_by_user.role})</span>}
                        </div>
                      ))
                    ) : (
                      <p>ไม่มีประวัติ</p>
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}