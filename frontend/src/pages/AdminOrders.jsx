import { useEffect, useState, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import { orderAPI } from "../api";
import { formatCurrency, formatDate } from "../utils/helpers";
import "./AdminOrders.css";

const STATUS_LABELS = {
  pending: "รอดำเนินการ",
  confirmed: "ยืนยันแล้ว",
  preparing: "กำลังเตรียม",
  ready_for_pickup: "พร้อมรับสินค้า",
  picked_up: "รับสินค้าแล้ว",
  in_transit: "กำลังจัดส่ง",
  delivered: "จัดส่งสำเร็จ",
  cancelled: "ยกเลิก",
  refunded: "คืนเงิน",
};

const PAYMENT_STATUS_LABELS = {
  pending: "รอชำระ",
  paid: "ชำระแล้ว",
  failed: "ชำระล้มเหลว",
  refunded: "คืนเงินแล้ว",
  partially_refunded: "คืนเงินบางส่วน",
};

export default function AdminOrders() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [search, setSearch] = useState("");

  const fetchOrders = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const params = { limit: 50 };
      if (statusFilter) params.status = statusFilter;
      const result = await orderAPI.getAllOrders(params);
      const data = result?.data || result;
      const list = data?.orders || data?.data || [];
      setOrders(Array.isArray(list) ? list : []);
    } catch (err) {
      setError(err.message || "ไม่สามารถโหลดรายการคำสั่งซื้อได้");
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  const filtered = orders.filter((order) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    const num = (order.order_number || "").toLowerCase();
    const name = (order.customer?.name || "").toLowerCase();
    const phone = (order.customer?.phone || "").toLowerCase();
    return num.includes(q) || name.includes(q) || phone.includes(q);
  });

  const statusCounts = orders.reduce((acc, o) => {
    acc[o.status] = (acc[o.status] || 0) + 1;
    return acc;
  }, {});

  if (loading) {
    return (
      <div className="page admin-orders-page">
        <div className="admin-orders-header">
          <h1>จัดการคำสั่งซื้อ</h1>
        </div>
        <p className="loading-state">กำลังโหลดคำสั่งซื้อ...</p>
      </div>
    );
  }

  return (
    <div className="page admin-orders-page">
      <div className="admin-orders-header">
        <h1>จัดการคำสั่งซื้อ</h1>
        <div className="admin-orders-stats">
          {Object.entries(STATUS_LABELS).map(([key, label]) => (
            <span
              key={key}
              className={`stat-chip ${statusFilter === key ? "active" : ""} status-${key}`}
              onClick={() => setStatusFilter(statusFilter === key ? "" : key)}
            >
              {label} <span>({statusCounts[key] || 0})</span>
            </span>
          ))}
        </div>
      </div>

      {error && <div className="alert alert-error" role="alert">{error}</div>}

      <div className="admin-orders-toolbar">
        <input
          type="search"
          placeholder="ค้นหาเลขที่ออเดอร์ / ลูกค้า / เบอร์โทร"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Link to="/selladmin" className="btn btn-outline">กลับสู่แดชบอร์ด</Link>
      </div>

      {!error && filtered.length === 0 && (
        <div className="empty-state">
          <p>ไม่พบคำสั่งซื้อในสถานะที่เลือก</p>
        </div>
      )}

      {!error && filtered.length > 0 && (
        <div className="admin-orders-table">
          <table>
            <thead>
              <tr>
                <th>เลขที่ออเดอร์</th>
                <th>ลูกค้า</th>
                <th>ร้านค้า</th>
                <th>สถานะ</th>
                <th>สถานะชำระเงิน</th>
                <th>ยอดรวม</th>
                <th>สั่งเมื่อ</th>
                <th className="admin-orders-th-action">การดำเนินการ</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((order) => (
                <tr key={order.id} className="admin-orders-row">
                  <td>
                    <Link to={`/orders/${order.id}`} className="admin-orders-number">
                      #{order.order_number}
                    </Link>
                  </td>
                  <td>
                    <div className="admin-orders-customer">
                      <span>{order.customer?.name || "-"}</span>
                      {order.customer?.phone && <span className="admin-orders-phone">{order.customer.phone}</span>}
                    </div>
                  </td>
                  <td>
                    {(order.store_orders || []).map((so) => (
                      <span key={so.id} className="admin-orders-store">
                        {so.store?.name || "ร้านค้า"}
                      </span>
                    ))}
                  </td>
                  <td>
                    <span className={`badge badge-${order.status}`}>
                      {STATUS_LABELS[order.status] || order.status}
                    </span>
                  </td>
                  <td>
                    <span className={`payment-badge payment-${order.payment_status}`}>
                      {PAYMENT_STATUS_LABELS[order.payment_status] || order.payment_status || "-"}
                    </span>
                  </td>
                  <td>{formatCurrency(order.total_amount)}</td>
                  <td>{formatDate(order.created_at)}</td>
                  <td className="admin-orders-td-action">
                    <Link to={`/orders/${order.id}`} className="btn btn-outline btn-small">
                      รายละเอียด
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
