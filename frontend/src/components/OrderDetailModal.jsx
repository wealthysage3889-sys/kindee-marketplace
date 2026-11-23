import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { formatDate } from "../utils/helpers";
import { orderAPI } from "../api";
import "./OrderDetailModal.css";

const STATUS_LABELS = {
  pending: "รอการยืนยัน",
  confirmed: "ยืนยันแล้ว",
  preparing: "กำลังเตรียม",
  ready_for_pickup: "พร้อมรับสินค้า",
  picked_up: "รับสินค้าแล้ว",
  in_transit: "กำลังจัดส่ง",
  delivered: "จัดส่งสำเร็จ",
  cancelled: "ยกเลิก",
  refunded: "คืนเงินแล้ว",
  failed: "ล้มเหลว",
};

const PAYMENT_METHOD_LABELS = {
  cod: "ชำระเงินปลายทาง",
  promptpay: "PromptPay",
  kbzpay: "KBZPay Wallet (Myanmar)",
  transfer: "โอนเงิน",
};

function paymentStatusLabel(paymentStatus, orderStatus, paymentMethod) {
  if (orderStatus === "cancelled" || orderStatus === "refunded" || orderStatus === "failed") {
    return "ไม่ต้องชำระ";
  }
  if (paymentMethod === "cod") {
    if (orderStatus === "delivered") return "ชำระแล้ว";
    return "รอชำระปลายทาง";
  }
  if (paymentMethod === "kbzpay") {
    if (paymentStatus === "paid") return "ชำระแล้ว";
    if (paymentStatus === "awaiting_review") return "รอตรวจสอบสลิป";
    if (paymentStatus === "expired") return "หมดอายุ";
    return "รอชำระ";
  }
  if (paymentMethod === "promptpay" || paymentMethod === "transfer") {
    if (paymentStatus === "paid") return "ชำระแล้ว";
    if (paymentStatus === "awaiting_review") return "รอตรวจสอบสลิป";
    return "รอชำระ";
  }
  return paymentStatus || "-";
}

function formatCurrency(amount, currency = "THB") {
  const n = Number(amount);
  if (!Number.isFinite(n)) return currency === "THB" ? "฿0.00" : "0.00";
  if (currency === "THB") return `฿${n.toFixed(2)}`;
  if (currency === "MMK") return `Ks${n.toLocaleString()}`;
  return `${currency} ${n.toFixed(2)}`;
}

function formatAddress(addr) {
  if (!addr) return "-";
  if (typeof addr === "string") return addr;
  const parts = [];
  if (addr.address_line) parts.push(addr.address_line);
  if (addr.subdistrict) parts.push(addr.subdistrict);
  if (addr.district) parts.push(addr.district);
  if (addr.province) parts.push(addr.province);
  if (addr.postal_code) parts.push(addr.postal_code);
  if (addr.country) parts.push(addr.country);
  return parts.length ? parts.join(" ") : "-";
}

// Resolve the image source for a payment slip.
// Backend (orderService.getOrderById → withSignedUrls) attaches a freshly
// signed `slip_view_url` to every slip, so prefer it. Fall back to the raw
// columns only: legacy rows expose a public `slip_url`; multi-store rows store
// a bare storage path in `slip_url`/`slip_path`. Never build a URL from a path
// here — the signed-URL helper already exists on the backend.
function slipViewUrl(slip) {
  return slip?.slip_view_url || slip?.slip_url || slip?.slip_path || "";
}

function renderOrderSlips(o) {
  const slips = Array.isArray(o.payment_slips) ? o.payment_slips : [];
  if (slips.length === 0) return null;

  return (
    <div className="admin-order-detail-section">
      <h3>สลิปการชำระเงิน</h3>
      {slips.map((s) => (
        <div key={s.id} className="admin-order-detail-slip">
          {slipViewUrl(s) ? (
            <img
              className="admin-order-detail-slip-img"
              src={slipViewUrl(s)}
              alt={`สลิป ${s.id}`}
              loading="lazy"
            />
          ) : (
            <div className="admin-order-detail-slip-placeholder">ไม่พบไฟล์สลิป</div>
          )}
          <div className="admin-order-detail-row">
            <span className="admin-order-detail-label">สถานะสลิป</span>
            <span className={`slip-badge slip-${s.slip_status} admin-order-detail-value`}>
              {({ uploaded: "รอการตรวจสอบ", approved: "อนุมัติแล้ว", rejected: "ปฏิเสธแล้ว" }[s.slip_status] || s.slip_status || "-")}
            </span>
          </div>
          {s.reject_reason && (
            <div className="admin-order-detail-row">
              <span className="admin-order-detail-label">สาเหตุปฏิเสธ</span>
              <span className="admin-order-detail-value">{s.reject_reason}</span>
            </div>
          )}
          {s.created_at && (
            <div className="admin-order-detail-row">
              <span className="admin-order-detail-label">อัปโหลดเมื่อ</span>
              <span className="admin-order-detail-value">{formatDate(s.created_at)}</span>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function renderOrderDetail(o) {
  const orderNumber = o.order_number || "-";
  const customer = o.customer || o.customer_snapshot || {};
  const storeOrders = Array.isArray(o.store_orders) ? o.store_orders : [];
  const items = storeOrders.flatMap((so) => (Array.isArray(so.order_items) ? so.order_items : []));
  const delivery = storeOrders[0]?.delivery || o.delivery;

  const storeNames = storeOrders
    .map((so) => so.store_snapshot?.name || so.store?.name || "ร้านค้า")
    .filter(Boolean);

  const addressRows = [];
  if (o.customer_snapshot?.address) {
    addressRows.push({ label: "ที่อยู่ลูกค้า", value: formatAddress(o.customer_snapshot.address) });
  }
  if (delivery?.delivery_address) {
    addressRows.push({ label: "ที่อยู่จัดส่ง", value: formatAddress(delivery.delivery_address) });
  }
  if (delivery?.pickup_address) {
    addressRows.push({ label: "จุดรับสินค้า", value: formatAddress(delivery.pickup_address) });
  }

  return (
    <>
      <div className="admin-order-detail-grid">
        <div className="admin-order-detail-col">
          <h3>ข้อมูลคำสั่งซื้อ</h3>
          <div className="admin-order-detail-row">
            <span className="admin-order-detail-label">เลขที่ออเดอร์</span>
            <span className="admin-order-detail-value">#{orderNumber}</span>
          </div>
          <div className="admin-order-detail-row">
            <span className="admin-order-detail-label">รหัสคำสั่งซื้อ</span>
            <span className="admin-order-detail-value">{o.id || "-"}</span>
          </div>
          <div className="admin-order-detail-row">
            <span className="admin-order-detail-label">วันและเวลาสั่งซื้อ</span>
            <span className="admin-order-detail-value">{formatDate(o.created_at)}</span>
          </div>
          <div className="admin-order-detail-row">
            <span className="admin-order-detail-label">สถานะคำสั่งซื้อ</span>
            <span className={`badge badge-${o.status || "pending"} admin-order-detail-value`}>
              {STATUS_LABELS[o.status] || o.status || "-"}
            </span>
          </div>
          <div className="admin-order-detail-row">
            <span className="admin-order-detail-label">สถานะการชำระเงิน</span>
            <span className={`payment-badge payment-${o.payment_status || "pending"} admin-order-detail-value`}>
              {paymentStatusLabel(o.payment_status, o.status, o.payment_method)}
            </span>
          </div>
          <div className="admin-order-detail-row">
            <span className="admin-order-detail-label">วิธีชำระเงิน</span>
            <span className="admin-order-detail-value">{PAYMENT_METHOD_LABELS[o.payment_method] || o.payment_method || "-"}</span>
          </div>
          <div className="admin-order-detail-row">
            <span className="admin-order-detail-label">ยอดรวม</span>
            <span className="admin-order-detail-value">{formatCurrency(o.total_amount)}</span>
          </div>
          {o.subtotal != null && (
            <div className="admin-order-detail-row">
              <span className="admin-order-detail-label">ราคาสินค้ารวม</span>
              <span className="admin-order-detail-value">{formatCurrency(o.subtotal)}</span>
            </div>
          )}
          {o.shipping_fee != null && o.shipping_fee > 0 && (
            <div className="admin-order-detail-row">
              <span className="admin-order-detail-label">ค่าจัดส่ง</span>
              <span className="admin-order-detail-value">{formatCurrency(o.shipping_fee)}</span>
            </div>
          )}
          {o.tax_amount != null && o.tax_amount > 0 && (
            <div className="admin-order-detail-row">
              <span className="admin-order-detail-label">ภาษีมูลค่าเพิ่ม ({(o.vat_rate ?? 7)}%)</span>
              <span className="admin-order-detail-value">{formatCurrency(o.tax_amount)}</span>
            </div>
          )}
          {o.discount_amount != null && o.discount_amount > 0 && (
            <div className="admin-order-detail-row">
              <span className="admin-order-detail-label">ส่วนลด</span>
              <span className="admin-order-detail-value">-{formatCurrency(o.discount_amount)}</span>
            </div>
          )}
          {o.payment_method === "kbzpay" && o.amount_mmk != null && (
            <div className="admin-order-detail-row">
              <span className="admin-order-detail-label">ยอดรวม (MMK)</span>
              <span className="admin-order-detail-value">{formatCurrency(o.amount_mmk, "MMK")}</span>
            </div>
          )}
        </div>
        <div className="admin-order-detail-col">
          <h3>ข้อมูลลูกค้า</h3>
          <div className="admin-order-detail-row">
            <span className="admin-order-detail-label">ชื่อลูกค้า</span>
            <span className="admin-order-detail-value">{customer.name || "-"}</span>
          </div>
          {customer.phone && (
            <div className="admin-order-detail-row">
              <span className="admin-order-detail-label">เบอร์โทรศัพท์</span>
              <span className="admin-order-detail-value">{customer.phone}</span>
            </div>
          )}
          <h3>ร้านค้า</h3>
          {storeNames.length ? (
            storeNames.map((name, index) => (
              <div key={index} className="admin-order-detail-row">
                <span className="admin-order-detail-label">{storeNames.length > 1 ? `ร้านค้าที่ ${index + 1}` : "ร้านค้า"}</span>
                <span className="admin-order-detail-value">{name}</span>
              </div>
            ))
          ) : (
            <div className="admin-order-detail-row">
              <span className="admin-order-detail-label">ร้านค้า</span>
              <span className="admin-order-detail-value">-</span>
            </div>
          )}
          <h3>ที่อยู่จัดส่งและข้อมูลการจัดส่ง</h3>
          {addressRows.length ? (
            addressRows.map((row, index) => (
              <div key={index} className="admin-order-detail-row">
                <span className="admin-order-detail-label">{row.label}</span>
                <span className="admin-order-detail-value">{row.value}</span>
              </div>
            ))
          ) : (
            <div className="admin-order-detail-row">
              <span className="admin-order-detail-label">ที่อยู่</span>
              <span className="admin-order-detail-value">-</span>
            </div>
          )}
          {delivery ? (
            <>
              <div className="admin-order-detail-row">
                <span className="admin-order-detail-label">สถานะจัดส่ง</span>
                <span className="admin-order-detail-value">{delivery.status || "-"}</span>
              </div>
              {delivery.courier?.profile?.name && (
                <div className="admin-order-detail-row">
                  <span className="admin-order-detail-label">ผู้จัดส่ง</span>
                  <span className="admin-order-detail-value">{delivery.courier.profile.name}</span>
                </div>
              )}
            </>
          ) : (
            <div className="admin-order-detail-row">
              <span className="admin-order-detail-label">สถานะจัดส่ง</span>
              <span className="admin-order-detail-value">-</span>
            </div>
          )}
        </div>
      </div>

      <div className="admin-order-detail-section">
        <h3>รายการสินค้า</h3>
        {items.length ? (
          <table className="admin-order-detail-items-table">
            <thead>
              <tr>
                <th style={{ width: 44 }}>รูป</th>
                <th>สินค้า</th>
                <th className="admin-order-detail-numeric">ร้านค้า</th>
                <th className="admin-order-detail-numeric">จำนวน</th>
                <th className="admin-order-detail-numeric">ราคา</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, index) => {
                const so = storeOrders.find((s) => Array.isArray(s.order_items) && s.order_items.includes(it));
                return (
                  <tr key={`${it.product_name || "item"}-${index}`}>
                    <td>
                      {it.product_image ? (
                        <img className="admin-order-detail-item-img" src={it.product_image} alt={it.product_name || ""} loading="lazy" />
                      ) : (
                        <span className="admin-order-detail-item-img admin-order-detail-item-img-empty">-</span>
                      )}
                    </td>
                    <td>{it.product_name || "-"}</td>
                    <td className="admin-order-detail-numeric">
                      {so ? so.store_snapshot?.name || so.store?.name || "ร้านค้า" : "-"}
                    </td>
                    <td className="admin-order-detail-numeric">{it.quantity != null ? it.quantity : 1}</td>
                    <td className="admin-order-detail-numeric">{formatCurrency(it.total_price)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <p>ไม่พบรายการสินค้า</p>
        )}
      </div>

      {renderOrderSlips(o)}
    </>
  );
}

export default function OrderDetailModal({ isOpen, onClose, orderId, mode = "admin" }) {
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isOpen || !orderId) return;

    let cancelled = false;
    const loadOrder = async () => {
      setLoading(true);
      setError("");
      try {
        const res = await orderAPI.getById(orderId);
        const data = res?.data || res || null;
        if (!cancelled) setOrder(data);
      } catch (err) {
        if (!cancelled) setError(err.message || "ไม่สามารถโหลดรายละเอียดคำสั่งซื้อได้");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    loadOrder();
    return () => {
      cancelled = true;
    };
  }, [isOpen, orderId]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape") onClose?.();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget) onClose?.();
  };

  return createPortal(
    <div
      className="admin-order-detail-overlay"
      role="presentation"
      onMouseDown={handleBackdropClick}
    >
      <div className="admin-order-detail-panel" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="admin-order-detail-close" onClick={onClose} aria-label="ปิด">
          &times;
        </button>
        <header className="admin-order-detail-header">
          <h2 id="admin-order-detail-title">รายละเอียดคำสั่งซื้อ</h2>
          {order?.order_number && <span className="admin-order-detail-order-no">#{order.order_number}</span>}
        </header>
        <div className="admin-order-detail-body">
          {loading && <div className="admin-order-detail-loading">กำลังโหลดรายละเอียด...</div>}
          {error && !order && (
            <div className="admin-order-detail-error" role="alert">
              {error}
              <button
                type="button"
                className="btn btn-outline btn-small"
                onClick={() => {
                  if (orderId) {
                    orderAPI.getById(orderId).then((res) => setOrder(res?.data || res)).catch(() => {});
                  }
                }}
                style={{ marginTop: 8 }}
              >
                ลองใหม่
              </button>
            </div>
          )}
          {order && !loading && renderOrderDetail(order)}
        </div>
        <div className="admin-order-detail-actions">
          <button type="button" className="btn btn-secondary admin-order-detail-btn-close" onClick={onClose}>
            ปิด
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}