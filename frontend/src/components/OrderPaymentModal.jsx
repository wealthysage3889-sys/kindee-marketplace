import { useEffect, useMemo } from "react";
import { formatCurrency, formatDate } from "../utils/helpers";
import { paymentMethodLabel } from "../utils/orderFilters";
import { buildPendingPaymentSummary } from "../utils/pendingPayments";
import "./OrderPaymentModal.css";

const PAYMENT_NOTES = {
  kbzpay: "KBZPay อยู่ระหว่างเชื่อมต่อระบบรับชำระเงิน — ยังไม่สามารถชำระเงินออนไลน์ได้ในขณะนี้",
  cod: "COD ชำระเงินสดกับผู้จัดส่งเมื่อได้รับสินค้า",
};

const groupPaymentNotes = (group) => {
  const methods = [...new Set(group.orders.map(({ order }) => order.payment_method))];
  return methods
    .map((method) => PAYMENT_NOTES[method] || "วิธีชำระเงินนี้อยู่ระหว่างเชื่อมต่อระบบรับชำระ")
    .filter((note, index, notes) => notes.indexOf(note) === index);
};

export default function OrderPaymentModal({
  open,
  onClose,
  orders = [],
  loading = false,
  error = "",
  onRetry,
}) {
  const summary = useMemo(() => buildPendingPaymentSummary(orders), [orders]);

  useEffect(() => {
    if (!open) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === "Escape") onClose?.();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  const hasOrders = summary.orderCount > 0;

  return (
    <div className="order-pay-overlay" onClick={onClose}>
      <div
        className="order-pay-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="order-pay-title"
        onClick={(event) => event.stopPropagation()}
      >
        <button type="button" className="order-pay-close" onClick={onClose} aria-label="ปิด">
          ×
        </button>

        <header className="order-pay-head">
          <h2 id="order-pay-title">ชำระเงินคำสั่งซื้อ</h2>
          <p>
            {hasOrders
              ? `รายการที่ยังรอชำระทั้งหมด ${summary.orderCount} รายการ`
              : "รายการที่ยังรอชำระทั้งหมด"}
          </p>
        </header>

        <div className="order-pay-body">
          {loading && <p className="order-pay-state">กำลังโหลดรายการคำสั่งซื้อ...</p>}

          {!loading && error && (
            <div className="order-pay-state order-pay-error">
              <p>{error}</p>
              {onRetry && (
                <button type="button" className="order-pay-retry" onClick={onRetry}>
                  ลองใหม่
                </button>
              )}
            </div>
          )}

          {!loading && !error && !hasOrders && (
            <p className="order-pay-state">ไม่มีคำสั่งซื้อที่ต้องชำระ</p>
          )}

          {!loading &&
            !error &&
            summary.groups.map((group) => (
              <section className="order-pay-group" key={group.currency}>
                <header className="order-pay-group-head">
                  <span className="order-pay-group-currency">
                    ยอดชำระรวม ({group.currency})
                  </span>
                  <span className="order-pay-group-count">{group.orderCount} Orders</span>
                </header>

                <ul className="order-pay-orders">
                  {group.orders.map(({ order, amount }) => (
                    <li className="order-pay-order" key={order.id}>
                      <div className="order-pay-order-head">
                        <span className="order-pay-order-number">#{order.order_number}</span>
                        <span className="order-pay-order-amount">
                          {formatCurrency(amount, group.currency)}
                        </span>
                      </div>
                      <div className="order-pay-order-meta">
                        <span className="order-pay-method">
                          {paymentMethodLabel(order.payment_method)}
                        </span>
                        <span className="order-pay-order-date">{formatDate(order.created_at)}</span>
                      </div>
                    </li>
                  ))}
                </ul>

                <div className="order-pay-group-total">
                  <span>รวมทั้งสิ้น</span>
                  <strong>{formatCurrency(group.total, group.currency)}</strong>
                </div>

                <ul className="order-pay-notes">
                  {groupPaymentNotes(group).map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              </section>
            ))}
        </div>

        <footer className="order-pay-foot">
          <div className="order-pay-notice" role="status">
            <strong>ระบบรับชำระออนไลน์อยู่ระหว่างเชื่อมต่อ</strong>
            <p>
              ยังไม่มีการสร้างรายการชำระเงิน หรือเปลี่ยนสถานะการชำระเงินของคำสั่งซื้อในขั้นตอนนี้
            </p>
          </div>
          <button type="button" className="btn order-pay-done" onClick={onClose}>
            ปิด
          </button>
        </footer>
      </div>
    </div>
  );
}
