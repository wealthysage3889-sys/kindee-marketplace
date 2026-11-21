import { useCallback, useEffect, useMemo, useState } from "react";
import { storeAPI } from "../api/product";
import { formatCurrency, formatDate } from "../utils/helpers";
import {
  getPendingPaymentOrders,
  getOrderPaymentCurrency,
  getOrderPaymentAmount,
} from "../utils/pendingPayments";
import "./KBZPayPaymentPopup.css";

const roundMoney = (value) => {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return 0;
  return Math.round((amount + Number.EPSILON) * 100) / 100;
};

const CURRENCY_LABEL = { THB: "THB", MMK: "MMK" };
const CURRENCY_SORT = { THB: 0, MMK: 1 };

const StoreIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 9l1.5-5h15L21 9" /><path d="M4 9v11h16V9" /><path d="M9 20v-6h6v6" /><path d="M3 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0" />
  </svg>
);

const QrIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
    <path d="M3 3h18v18H3z" />
    <line x1="12" y1="3" x2="12" y2="21" />
    <line x1="3" y1="12" x2="21" y2="12" />
  </svg>
);

const PhoneIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
  </svg>
);

const UserIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
  </svg>
);

const CloseIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M18 6 6 18" /><path d="m6 6 12 12" />
  </svg>
);

export default function KBZPayPaymentPopup({ open, onClose, orders = [] }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [settingsByStore, setSettingsByStore] = useState({});

  const pendingOrders = useMemo(() => getPendingPaymentOrders(orders), [orders]);

  const storeGroups = useMemo(() => {
    const groups = new Map();
    pendingOrders.forEach((order) => {
      const currency = getOrderPaymentCurrency(order);
      const amount = getOrderPaymentAmount(order, currency);
      const seenOrderIds = new Set();
      (order.store_orders || []).forEach((so) => {
        const sid = so.store_id;
        if (!sid) return;
        if (!groups.has(sid)) {
          groups.set(sid, {
            storeId: sid,
            storeName: so.store_snapshot?.name || so.store?.name || "ร้านค้า",
            byCurrency: new Map(),
            orderNumbers: new Set(),
          });
        }
        const g = groups.get(sid);
        g.orderNumbers.add(order.order_number);
        if (seenOrderIds.has(order.id)) return;
        seenOrderIds.add(order.id);
        if (!g.byCurrency.has(currency)) {
          g.byCurrency.set(currency, { orders: [], total: 0, count: 0 });
        }
        const cg = g.byCurrency.get(currency);
        cg.orders.push({ order, storeOrder: so, amount });
        cg.total = roundMoney(cg.total + amount);
        cg.count += 1;
      });
    });
    return Array.from(groups.values()).sort((a, b) => a.storeName.localeCompare(b.storeName));
  }, [pendingOrders]);

  useEffect(() => {
    if (!open) return undefined;
    setLoading(true);
    setError("");
    const storeIds = storeGroups.map((g) => g.storeId);
    Promise.all(
      storeIds.map((sid) =>
        storeAPI
          .getKbzpaySettings(sid, "customer")
          .then((res) => ({ sid, data: res?.data || res || null }))
          .catch(() => ({ sid, data: null }))
      )
    ).then((results) => {
      const next = {};
      results.forEach(({ sid, data }) => {
        next[sid] = data;
      });
      setSettingsByStore(next);
      setLoading(false);
    });
    return () => { setLoading(false); };
  }, [open, storeGroups]);

  const handleClose = (event) => {
    if (event) event.stopPropagation();
    onClose?.();
  };

  const handleKeyDown = (event) => {
    if (event.key === "Escape") handleClose();
  };

  useEffect(() => {
    if (!open) return undefined;
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, handleKeyDown]);

  if (!open) return null;

  const totalStores = storeGroups.length;
  const totalOrders = storeGroups.reduce((sum, g) => sum + g.orderNumbers.size, 0);

  return (
    <div
      className="kbzpay-popup-overlay"
      onClick={handleClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="kbzpay-popup-title"
    >
      <div
        className="kbzpay-popup-panel"
        onClick={(event) => event.stopPropagation()}
      >
        <button type="button" className="kbzpay-popup-close" onClick={handleClose} aria-label="ปิด">
          <CloseIcon />
        </button>

        <header className="kbzpay-popup-head">
          <div className="kbzpay-popup-icon"><StoreIcon /></div>
          <div>
            <h2 id="kbzpay-popup-title">ข้อมูลรับชำระเงิน KBZPay</h2>
            <p>
              {totalStores > 0
                ? `รวม ${totalOrders} รายการจาก ${totalStores} ร้านค้า`
                : "ไม่พบรายการที่รอชำระ"}
            </p>
          </div>
        </header>

        {loading && (
          <div className="kbzpay-popup-state">กำลังโหลดข้อมูลรับชำระจากร้านค้า...</div>
        )}

        {!loading && error && (
          <div className="kbzpay-popup-state kbzpay-popup-error">
            <p>{error}</p>
            <button type="button" className="kbzpay-popup-retry" onClick={() => { setLoading(true); setError(""); }}>
              ลองใหม่
            </button>
          </div>
        )}

        {!loading && !error && storeGroups.length === 0 && (
          <div className="kbzpay-popup-state">
            <p>ไม่มีคำสั่งซื้อที่รอชำระเงินผ่าน KBZPay</p>
          </div>
        )}

        {!loading &&
          !error &&
          storeGroups.map((group) => {
            const settings = settingsByStore[group.storeId] || null;
            const configured = Boolean(
              settings &&
                settings.enabled &&
                settings.accountName &&
                settings.phoneNumber &&
                settings.receiverName
            );
            const currencyEntries = Array.from(group.byCurrency.entries()).sort(
              ([a], [b]) => (CURRENCY_SORT[a] ?? 99) - (CURRENCY_SORT[b] ?? 99)
            );
            const grandTotal = currencyEntries.reduce((sum, [, cg]) => sum + cg.total, 0);

            return (
              <section className="kbzpay-store-group" key={group.storeId}>
                <div className="kbzpay-store-header">
                  <div className="kbzpay-store-info">
                    <span className="kbzpay-store-name">{group.storeName}</span>
                    <span className={`kbzpay-store-badge ${configured ? "kbzpay-badge-enabled" : "kbzpay-badge-disabled"}`}>
                      {configured ? "เปิดรับชำระ KBZPay" : "ยังไม่ได้ตั้งค่า KBZPay"}
                    </span>
                  </div>
                </div>

                <div className="kbzpay-store-body">
                  {configured ? (
                    <>
                      <div className="kbzpay-payment-detail">
                        <div className="kbzpay-detail-row">
                          <span className="kbzpay-detail-label"><UserIcon /> ชื่อบัญชี KBZPay</span>
                          <span className="kbzpay-detail-value">{settings.accountName}</span>
                        </div>
                        <div className="kbzpay-detail-row">
                          <span className="kbzpay-detail-label"><PhoneIcon /> เบอร์โทรศัพท์ / หมายเลขบัญชี</span>
                          <span className="kbzpay-detail-value">{settings.phoneNumber}</span>
                        </div>
                        <div className="kbzpay-detail-row">
                          <span className="kbzpay-detail-label"><UserIcon /> ชื่อผู้รับเงิน</span>
                          <span className="kbzpay-detail-value">{settings.receiverName}</span>
                        </div>
                        <div className="kbzpay-detail-row">
                          <span className="kbzpay-detail-label"><QrIcon /> QR Code ร้านค้า</span>
                          <span className="kbzpay-detail-value">
                            {settings.qrUrl ? (
                              <img
                                className="kbzpay-qr-image"
                                src={settings.qrUrl}
                                alt={`QR Code ${group.storeName}`}
                                loading="lazy"
                              />
                            ) : (
                              <span className="kbzpay-qr-empty">ร้านค้ายังไม่ได้อัปโหลด QR Code</span>
                            )}
                          </span>
                        </div>
                      </div>

                      {currencyEntries.map(([currency, cg]) => (
                        <div className="kbzpay-currency-group" key={currency}>
                          <div className="kbzpay-currency-head">
                            <span className="kbzpay-currency-label">จำนวนเงินที่ต้องโอน ({CURRENCY_LABEL[currency] || currency})</span>
                            <span className="kbzpay-currency-count">{cg.count} Orders</span>
                          </div>
                          <ul className="kbzpay-order-list">
                            {cg.orders.map(({ order, storeOrder, amount }) => (
                              <li className="kbzpay-order-item" key={storeOrder.id || order.id}>
                                <span className="kbzpay-order-number">
                                  #{storeOrder.store_order_number || order.order_number}
                                </span>
                                <span className="kbzpay-order-date">{formatDate(order.created_at)}</span>
                                <span className="kbzpay-order-amount">{formatCurrency(amount, currency)}</span>
                              </li>
                            ))}
                          </ul>
                          <div className="kbzpay-currency-total">
                            <span>รวมยอดร้านนี้ ({CURRENCY_LABEL[currency] || currency})</span>
                            <strong>{formatCurrency(cg.total, currency)}</strong>
                          </div>
                        </div>
                      ))}

                      <div className="kbzpay-store-total">
                        <span>ยอดรวมทั้งหมดที่ร้านนี้</span>
                        <strong>{currencyEntries.map(([currency]) => formatCurrency(
                          group.byCurrency.get(currency).total,
                          currency
                        )).join(" + ")}</strong>
                      </div>
                    </>
                  ) : (
                    <div className="kbzpay-store-notice">
                      <p>
                        ร้านค้านี้ยังไม่ได้ตั้งค่าการรับชำระผ่าน KBZPay หรือยังไม่ได้อัปโหลด QR Code
                      </p>
                      <p className="kbzpay-notice-hint">
                        โปรดติดต่อร้านค้าเพื่อขอข้อมูลการโอนเงิน หรือเลือกวิธีชำระเงินอื่น
                      </p>
                    </div>
                  )}
                </div>

                <div className="kbzpay-order-numbers">
                  <strong>Order Number ที่รวมอยู่ในการชำระครั้งนี้:</strong>
                  <span className="kbzpay-order-number-list">
                      {Array.from(group.orderNumbers).map((no) => `#${no}`).join("  ")}
                  </span>
                </div>
              </section>
            );
          })
        }

        {!loading && !error && totalStores > 0 && (
          <div className="kbzpay-popup-foot">
            <div className="kbzpay-popup-summary">
              <span>ร้านค้าทั้งหมด</span>
              <strong>{totalStores}</strong>
              <span>| Order ทั้งหมด</span>
              <strong>{totalOrders}</strong>
            </div>
            <p className="kbzpay-popup-notice">
              การแสดงหน้านี้เป็นเพียงข้อมูลสำหรับประกอบการโอนเงินเท่านั้น
              ระบบยังไม่มีการสร้างรายการชำระเงินใหม่ และยังไม่ได้เปลี่ยนสถานะคำสั่งซื้อหรือการชำระเงินใดๆ
            </p>
            <button type="button" className="btn kbzpay-popup-done" onClick={handleClose}>
              ปิด
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
