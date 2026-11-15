import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { orderAPI } from "../api";
import { formatCurrency, formatDate } from "../utils/helpers";
import "./OrderHistory.css";

const STATUS_LABELS = {
  pending: "รอดำเนินการ",
  confirmed: "ยืนยันแล้ว",
  preparing: "กำลังเตรียม",
  ready_for_pickup: "พร้อมรับสินค้า",
  picked_up: "รับสินค้าแล้ว",
  in_transit: "กำลังจัดส่ง",
  delivered: "จัดส่งสำเร็จ",
  cancelled: "ยกเลิก",
  refunded: "คืนเงิน"
};

export default function OrderHistory() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    const loadOrders = async () => {
      try {
        setError("");
        const result = await orderAPI.getMyOrders({ limit: 50 });
        const list = result?.data?.orders || result?.data || [];
        if (active) setOrders(Array.isArray(list) ? list : []);
      } catch (err) {
        if (active) setError(err.message || "ไม่สามารถโหลดประวัติคำสั่งซื้อได้");
      } finally {
        if (active) setLoading(false);
      }
    };

    loadOrders();
    return () => { active = false; };
  }, []);

  if (loading) {
    return <div className="order-history-page"><p className="order-history-empty">กำลังโหลดคำสั่งซื้อ...</p></div>;
  }

  return (
    <div className="order-history-page">
      <header className="order-history-header">
        <h1>คำสั่งซื้อของฉัน</h1>
        <Link to="/stores" className="order-history-shop-link">เลือกซื้อสินค้าเพิ่ม</Link>
      </header>

      {error && <div className="order-history-error">{error}</div>}

      {!error && orders.length === 0 && (
        <p className="order-history-empty">ยังไม่มีคำสั่งซื้อ</p>
      )}

      <div className="order-history-list">
        {orders.map((order) => (
          <Link to={`/orders/${order.id}`} className="order-history-card" key={order.id}>
            <div className="order-history-card-head">
              <div>
                <span className="order-history-number">#{order.order_number}</span>
                <span className="order-history-date">{formatDate(order.created_at)}</span>
              </div>
              <span className={`order-history-status status-${order.status}`}>
                {STATUS_LABELS[order.status] || order.status}
              </span>
            </div>

            <div className="order-history-stores">
              {(order.store_orders || []).map((storeOrder) => (
                <div className="order-history-store" key={storeOrder.id}>
                  <span className="order-history-store-name">
                    {storeOrder.store_snapshot?.name || storeOrder.store?.name || "ร้านค้า"}
                  </span>
                  <span className="order-history-store-total">{formatCurrency(storeOrder.total_amount)}</span>
                </div>
              ))}
            </div>

            <div className="order-history-card-foot">
              <span>รวมทั้งสิ้น</span>
              <strong>{formatCurrency(order.total_amount)}</strong>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}