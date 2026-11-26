import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useSocket } from "../context/SocketContext";
import { addressAPI, authAPI, orderAPI, walletAPI } from "../api";
import { storeAPI } from "../api/product";
import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { extractList, formatThaiPhone, validatePhone, formatCurrency, formatDate, showToast } from "../utils/helpers";
import { countOrdersByFilter, getReadDeliveredOrderIds, getStoreOrderStatusDisplay, markDeliveredOrdersRead, matchesOrderFilter, ORDER_FILTERS, orderStatusLabel, paymentStatusLabel, sortOrdersByNewest } from "../utils/orderFilters";
import { getPendingPaymentOrders, getStoreOrders, resolveStoreOrderStoreId, getOrderPaymentCurrency, getOrderPaymentAmount, roundMoney } from "../utils/pendingPayments";
import StoreLocationMap from "../components/StoreLocationMap";
import PhoneInput from "../components/PhoneInput";
import OrderPaymentModal from "../components/OrderPaymentModal";
import KBZPayPaymentPopup from "../components/KBZPayPaymentPopup";
import EditProfileModal from "../components/EditProfileModal";

const UserIcon = ({ size = 26 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </svg>
);

const WalletPayIcon = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H18a2 2 0 0 1 2 2v1" />
    <path d="M3 7.5V17a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-2" />
    <path d="M21 9.5h-4a2.5 2.5 0 0 0 0 5h4a1 1 0 0 0 1-1v-3a1 1 0 0 0-1-1Z" />
  </svg>
);

const BoxIcon = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 8 12 3 3 8v8l9 5 9-5Z" />
    <path d="m3 8 9 5 9-5" />
    <path d="M12 13v8" />
  </svg>
);

const TruckIcon = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 6h11v10H3z" />
    <path d="M14 9h4l3 3v4h-7z" />
    <circle cx="7" cy="18.5" r="1.6" />
    <circle cx="17.5" cy="18.5" r="1.6" />
  </svg>
);

const StarIcon = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m12 3 2.6 5.3 5.9.8-4.3 4.2 1 5.9-5.2-2.8-5.2 2.8 1-5.9L3.5 9.1l5.9-.8Z" />
  </svg>
);

const WalletIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M20 7H6a2 2 0 0 1 0-4h11v4" />
    <path d="M4 5v14a2 2 0 0 0 2 2h14V7H6a2 2 0 0 0-2 2" />
    <path d="M16.5 13.5h.01" />
  </svg>
);

const CardIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="2.5" y="5" width="19" height="14" rx="2.5" />
    <path d="M2.5 10h19" />
    <path d="M6.5 15h4" />
  </svg>
);

const BankIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 9.5 12 4l9 5.5" />
    <path d="M5 10v8M9.5 10v8M14.5 10v8M19 10v8" />
    <path d="M3 20.5h18" />
  </svg>
);

const ReceiptIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M6 2.5h12v19l-3-2-3 2-3-2-3 2Z" />
    <path d="M9 7.5h6M9 11.5h6M9 15.5h3" />
  </svg>
);

const MeeCardIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="2.5" y="5" width="19" height="14" rx="2.5" />
    <path d="M2.5 10h19" />
    <path d="M7 13h10" />
    <path d="M12 10v10" />
  </svg>
);

const ChevronRightIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m9 6 6 6-6 6" />
  </svg>
);

const LOGOUT_ICON = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <path d="m16 17 5-5-5-5" />
    <path d="M21 12H9" />
  </svg>
);

const ThreeDotsIcon = ({ size = 22 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="6" r="1" />
    <circle cx="12" cy="12" r="1" />
    <circle cx="12" cy="18" r="1" />
  </svg>
);

const SettingsIcon = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

const EditProfileIcon = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
  </svg>
);

const AddressIcon = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
    <circle cx="12" cy="10" r="3" />
  </svg>
);

const SecurityIcon = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="2" y="6" width="20" height="12" rx="2" />
    <path d="M12 6v-4" />
    <path d="M12 18v4" />
    <path d="M8 12h8" />
  </svg>
);

const ShieldIcon = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 2l4 9v6a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2v-6l4-9" />
  </svg>
);

const DeviceIcon = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
    <line x1="8" y1="21" x2="16" y2="21" />
    <line x1="12" y1="17" x2="12" y2="21" />
  </svg>
);

const HistoryIcon = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="10" />
    <polyline points="12 6 12 12 16 14" />
  </svg>
);

const AlertIcon = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M10 29v-6l2-2 2 2v6" />
    <polyline points="10 14 12 14 14 14" />
    <path d="M7 23h10" />
  </svg>
);

const LogoutAllIcon = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <path d="m16 17 5-5-5-5" />
    <path d="M21 12H9" />
    <circle cx="12" cy="12" r="1" />
  </svg>
);

const UnlinkIcon = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M15 15l-4-4 4-4" />
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
  </svg>
);

const GoogleSecIcon = () => (
  <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
    <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.5 30.2 0 24 0 14.6 0 6.4 5.4 2.5 13.3l7.8 6.1C12.2 13.2 17.6 9.5 24 9.5Z" />
    <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-2.8-.4-4.1H24v9h12.7c-.3 2.1-1.6 5.2-4.6 7.3l7.6 5.9c4.5-4.2 6.8-10.3 6.8-18.1Z" />
    <path fill="#FBBC05" d="M10.3 28.6A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.2.8-4.6l-7.8-6.1A24 24 0 0 0 0 24c0 3.9.9 7.5 2.5 10.7l7.8-6.1Z" />
    <path fill="#34A853" d="M24 48c6.2 0 11.5-2 15.3-5.6l-7.6-5.9c-2 1.4-4.7 2.4-7.7 2.4-6.4 0-11.8-3.7-13.7-9.4l-7.8 6.1C6.4 42.6 14.6 48 24 48Z" />
  </svg>
);
const FacebookSecIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
    <path fill="#1877F2" d="M22 12.06C22 6.5 17.52 2 12 2S2 6.5 2 12.06c0 5 3.66 9.15 8.44 9.94v-7.03H7.9v-2.9h2.54V9.85c0-2.52 1.5-3.92 3.77-3.92 1.1 0 2.24.2 2.24.2v2.46h-1.26c-1.24 0-1.63.78-1.63 1.57v1.9h2.78l-.45 2.9h-2.33V22c4.78-.79 8.44-4.94 8.44-9.94Z" />
  </svg>
);
const LineSecIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
    <path fill="#06C755" d="M21.6 10.3c0-4.2-4.3-7.6-9.6-7.6S2.4 6.1 2.4 10.3c0 3.8 3.5 6.9 8.2 7.5.3.1.8.3.9.6.1.3.1.7 0 1l-.1.8c0 .2-.2.9.7.5.9-.4 4.8-2.8 6.5-4.8 1.2-1.3 2-2.9 2-4.6Z" />
    <path fill="#fff" d="M8.1 8.7H6.8v4.1h1.3zm.2 0h1.2l1.9 2.7V8.7h1.3v4.1h-1.2L9.6 10v2.8H8.3zm5.1 1.4h1.4v1.2h-1.4v.3h1.4v1.2h-2.7V8.7h2.7v1.2h-1.4zm2.9 2.7h-1.2V8.7h1.2z" />
  </svg>
);

const EMPTY_ADDRESS_FORM = {
  label: "",
  recipient_name: "",
  phone: "",
  street: "",
  subdistrict: "",
  district: "",
  province: "",
  postal_code: "",
  country: "TH",
  additional_details: "",
  coordinates: null,
  is_default: false,
};

const addressToForm = (address) => ({
  label: address?.label || "",
  recipient_name: address?.recipient_name || "",
  phone: address?.phone || "",
  street: address?.street || "",
  subdistrict: address?.subdistrict || "",
  district: address?.district || "",
  province: address?.province || "",
  postal_code: address?.postal_code || "",
  country: address?.country || "TH",
  additional_details: address?.additional_details || "",
  coordinates:
    address?.lat !== undefined &&
    address?.lat !== null &&
    address?.lng !== undefined &&
    address?.lng !== null
      ? { lat: Number(address.lat), lng: Number(address.lng) }
      : null,
  is_default: Boolean(address?.is_default),
});

const addressLines = (address) =>
  [address?.street, address?.subdistrict, address?.district, address?.province, address?.postal_code]
    .map((part) => String(part || "").trim())
    .filter(Boolean);

const hasValidCoordinates = (address) =>
  address?.lat !== undefined &&
  address?.lat !== null &&
  address?.lng !== undefined &&
  address?.lng !== null &&
  Number.isFinite(Number(address.lat)) &&
  Number.isFinite(Number(address.lng));

const PURCHASE_TILES = [
  { key: "topay", label: "ที่ต้องชำระ", Icon: WalletPayIcon, badge: 0 },
  { key: "toship", label: "ที่ต้องจัดส่ง", Icon: TruckIcon, badge: 0 },
  { key: "toreceive", label: "ที่ต้องได้รับ", Icon: BoxIcon, badge: 0 },
  { key: "toreview", label: "รับสินค้าแล้ว", Icon: StarIcon, badge: 0 },
];

const WALLET_ITEMS = [
  { key: "balance", label: "ยอดเงินคงเหลือ", Icon: WalletIcon },
  { key: "coins", label: "เหรียญโบนัส", Icon: StarIcon },
  { key: "voucher", label: "คูปองของฉัน", Icon: ReceiptIcon },
  { key: "mee-card", label: "สมัครวอเลท Mee Card", Icon: MeeCardIcon },
];

const FINANCE_ITEMS = [
  { key: "cards", label: "บัตรของฉัน", Icon: CardIcon },
  { key: "bank", label: "บัญชีธนาคาร", Icon: BankIcon },
  { key: "history", label: "ประวัติการเงิน", Icon: ReceiptIcon },
];

const ROLE_LABELS = {
  customer: "ลูกค้า",
  seller: "ผู้ขาย",
  admin: "แอดมิน",
  owner: "เจ้าของระบบ",
};

const OrderListModal = ({ orders, filter, onClose, payableOrders = [], onPay }) => {
  const navigate = useNavigate();

  const filteredOrders = useMemo(() => {
    const filtered = !filter || filter === "all"
      ? orders
      : orders.filter((order) => matchesOrderFilter(order, filter));
    return sortOrdersByNewest(filtered);
  }, [orders, filter]);

  const getFilterLabel = (key) => {
    const f = ORDER_FILTERS.find((fl) => fl.key === key);
    return f?.label || key;
  };

  const pendingOrders = useMemo(() => {
    return filteredOrders.filter(
      (order) => order.payment_status === "pending" && order.status !== "cancelled"
    );
  }, [filteredOrders]);

  const currencyGroups = useMemo(() => {
    const groups = {};
    pendingOrders.forEach((order) => {
      const currency = getOrderPaymentCurrency(order);
      const amount = getOrderPaymentAmount(order, currency);
      if (!groups[currency]) {
        groups[currency] = { orders: [], total: 0 };
      }
      groups[currency].orders.push({ order, amount });
      groups[currency].total = roundMoney(groups[currency].total + amount);
    });
    return groups;
  }, [pendingOrders]);

  const showSummary = Object.keys(currencyGroups).length > 0;

  if (filteredOrders.length === 0) {
    return (
      <div className="modal-order-list-empty">
        <p>
          {filter === "toreview"
            ? "ยังไม่มีออเดอร์ที่รับสินค้าแล้ว"
            : `ไม่พบคำสั่งซื้อในหมวด "${getFilterLabel(filter)}"`}
        </p>
      </div>
    );
  }

  return (
    <div className="modal-order-list">
      {filteredOrders.map((order) => (
        <div
          key={order.id}
          role="button"
          tabIndex={0}
          className="modal-order-card"
          onClick={() => { window.location.href = `/orders/${order.id}`; }}
          onKeyDown={(e) => { if (e.key === "Enter") window.location.href = `/orders/${order.id}`; }}
        >
          <div className="modal-order-card-head">
            <div>
              <span className="modal-order-number">#{order.order_number}</span>
              <span className="modal-order-date">{formatDate(order.created_at)}</span>
            </div>
            <span className={`modal-order-status status-${order.status}`}>
              {orderStatusLabel(order.status)}
            </span>
          </div>

          <div className="modal-order-stores">
            {(order.store_orders || []).map((storeOrder) => {
              const storeStatus = getStoreOrderStatusDisplay(order.status, storeOrder.status);
              return (
                <div className="modal-order-store" key={storeOrder.id}>
                  <span className="modal-order-store-name">
                    {storeOrder.store_snapshot?.name || storeOrder.store?.name || "ร้านค้า"}
                  </span>
                  <span className="modal-order-store-total">{formatCurrency(storeOrder.total_amount)}</span>
                  <span className={`modal-store-status ${storeStatus.statusClass}`}>
                    {storeStatus.label}
                  </span>
                </div>
              );
            })}
          </div>

          <div className="modal-order-card-foot">
            <div className="modal-order-payment">
              <span className="modal-payment-method">
                {order.payment_method === "cod" ? "ชำระปลายทาง" :
                 order.payment_method === "promptpay" ? "PromptPay" :
                 order.payment_method === "transfer" ? "โอนเงิน" :
                 order.payment_method === "card" ? "บัตรเครดิต" :
                 order.payment_method === "wallet" ? "กระเป๋าเงิน" :
                 order.payment_method === "kbzpay" ? "KBZPay" : order.payment_method}
              </span>
              <span className={`modal-payment-status status-${order.payment_status}`}>
                {paymentStatusLabel(order.payment_status, order.status, order.payment_method)}
              </span>
            </div>
            <div className="modal-order-total">
              <span>รวมทั้งสิ้น</span>
              <strong>
                {formatCurrency(
                  getOrderPaymentAmount(order, getOrderPaymentCurrency(order)),
                  getOrderPaymentCurrency(order)
                )}
              </strong>
            </div>
          </div>
        </div>
      ))}

      {showSummary && (
        <div className="modal-order-summary">
          {Object.entries(currencyGroups).map(([currency, group]) => (
            <div key={currency} className="modal-summary-currency-group">
              <div className="modal-summary-header">
                <span className="modal-summary-label">ยอดชำระรวม ({currency})</span>
                <span className="modal-summary-count">{group.orders.length} Orders</span>
              </div>
              <div className="modal-summary-total">
                {group.orders.map(({ order, amount }) => (
                  <div key={order.id} className="modal-summary-order-line">
                    <span>#{order.order_number}</span>
                    <span>{formatCurrency(amount, currency)}</span>
                  </div>
                ))}
                <div className="modal-summary-grand-total">
                  <span>รวมทั้งสิ้น</span>
                  <strong>{formatCurrency(group.total, currency)}</strong>
                </div>
              </div>
            </div>
          ))}
          {payableOrders.length > 0 && (
            <div className="modal-summary-action">
              <button type="button" className="btn btn-pay-summary" onClick={() => onPay?.(payableOrders)}>
                ชำระเงินทันที
              </button>
              <span className="modal-summary-disabled-hint">
                ระบบรับชำระออนไลน์อยู่ระหว่างเชื่อมต่อ
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ============================================================================
// SecurityModal — ความปลอดภัย / บัญชีที่เชื่อมต่อ (6 ฟังก์ชัน)
// ============================================================================
const SecurityModal = ({
  user,
  sessions,
  sessionsLoading,
  sessionsError,
  loginHistory,
  historyLoading,
  historyError,
  securityAlerts,
  alertsLoading,
  alertsError,
  connectedAccounts,
  accountsLoading,
  accountsError,
  cpForm,
  setCpForm,
  cpError,
  cpSuccess,
  cpSaving,
  onChangePassword,
  onRevokeSession,
  onLogoutAllDevices,
  logoutAllLoading,
  onUnlinkSocial,
  onMarkAlertRead,
  securityActionId,
  securityTab,
  setSecurityTab,
}) => {
  const currentUserId = user?.id;
  const isCurrentSession = (s) => {
    // Heuristic: mark the most recently active session as "current device"
    // (Supabase does not expose which row belongs to the active access token).
    return s.last_activity_at && sessions.length > 0
      ? s.last_activity_at === sessions.reduce((max, cur) => (cur.last_activity_at > max.last_activity_at ? cur : max)).last_activity_at
      : false;
  };

  const TABS = [
    { key: "overview", label: "ภาพรวม", Icon: ShieldIcon },
    { key: "sessions", label: "อุปกรณ์และเซสชัน", Icon: DeviceIcon },
    { key: "history", label: "ประวัติการเข้าสู่ระบบ", Icon: HistoryIcon },
    { key: "alerts", label: "การแจ้งเตือนความปลอดภัย", Icon: AlertIcon },
  ];

  const providerMeta = {
    google: { label: "Google", Icon: GoogleSecIcon },
    facebook: { label: "Facebook", Icon: FacebookSecIcon },
    line: { label: "LINE", Icon: LineSecIcon },
  };

  const unreadCount = securityAlerts.filter((a) => !a.is_read).length;

  const formatDevice = (s) => {
    const parts = [s.device_name, s.browser, s.os].filter(Boolean);
    return parts.length > 0 ? parts.join(" · ") : "อุปกรณ์ไม่ระบุ";
  };

  const formatLocation = (s) => (s.country ? `(${s.country}${s.city ? `, ${s.city}` : ""})` : "");

  const renderTabButton = (tab) => {
    const active = securityTab === tab.key;
    return (
      <button
        key={tab.key}
        type="button"
        className={`security-tab-btn ${active ? "security-tab-btn-active" : ""}`}
        onClick={() => setSecurityTab(tab.key)}
        aria-pressed={active}
      >
        <span className="security-tab-icon"><tab.Icon size={16} /></span>
        <span>{tab.label}</span>
        {tab.key === "alerts" && unreadCount > 0 && (
          <span className="security-tab-badge">{unreadCount}</span>
        )}
      </button>
    );
  };

  return (
    <div className="security-modal">
      <div className="security-header">
        <h3 className="security-title">ความปลอดภัย / บัญชีที่เชื่อมต่อ</h3>
        <p className="security-subtitle">จัดการรหัสผ่าน บัญชีที่เชื่อมต่อ เซสชัน ประวัติการเข้าสู่ระบบ และการแจ้งเตือน</p>
      </div>

      <div className="security-tabs">
        {TABS.map(renderTabButton)}
      </div>

      {/* ===== 1. เปลี่ยนรหัสผ่าน ===== */}
      {securityTab === "overview" && (
        <div className="security-section security-section-password">
          <div className="security-section-head">
            <h4 className="security-section-title"><ShieldIcon size={16} /> เปลี่ยนรหัสผ่าน</h4>
          </div>
          <p className="security-section-desc">เปลี่ยนรหัสผ่านบัญชีของคุณ ต้องยืนยันรหัสผ่านปัจจุบันก่อน</p>
          {cpError && <p className="form-hint-error">{cpError}</p>}
          {cpSuccess && <p className="security-hint-success">{cpSuccess}</p>}
          <form className="modal-form" onSubmit={onChangePassword}>
            <div className="form-group">
              <label className="form-label" htmlFor="security-cp-current">รหัสผ่านปัจจุบัน *</label>
              <input
                id="security-cp-current"
                type="password"
                className="form-input"
                value={cpForm.currentPassword}
                onChange={(e) => setCpForm((p) => ({ ...p, currentPassword: e.target.value }))}
                disabled={cpSaving}
              />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="security-cp-new">รหัสผ่านใหม่ *</label>
              <input
                id="security-cp-new"
                type="password"
                className="form-input"
                value={cpForm.newPassword}
                onChange={(e) => setCpForm((p) => ({ ...p, newPassword: e.target.value }))}
                minLength={6}
                disabled={cpSaving}
              />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="security-cp-confirm">ยืนยันรหัสผ่านใหม่ *</label>
              <input
                id="security-cp-confirm"
                type="password"
                className="form-input"
                value={cpForm.confirmPassword}
                onChange={(e) => setCpForm((p) => ({ ...p, confirmPassword: e.target.value }))}
                minLength={6}
                disabled={cpSaving}
              />
            </div>
            <div className="form-actions">
              <button type="button" className="btn-outline" onClick={() => { setCpForm({ currentPassword: "", newPassword: "", confirmPassword: "" }); setCpError(""); setCpSuccess(""); }}>
                ยกเลิก
              </button>
              <button type="submit" className="btn" disabled={cpSaving}>
                {cpSaving ? "กำลังเปลี่ยน..." : "เปลี่ยนรหัสผ่าน"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ===== 2. บัญชีที่เชื่อมต่อ (Google/Facebook/LINE) ===== */}
      {securityTab === "overview" && (
        <div className="security-section security-section-accounts">
          <div className="security-section-head">
            <h4 className="security-section-title"><ShieldIcon size={16} /> บัญชีที่เชื่อมต่อ</h4>
          </div>
          <p className="security-section-desc">ผู้ให้บริการเข้าสู่ระบบภายนอกที่เชื่อมต่อกับบัญชีของคุณ ถอนการเชื่อมต่อได้เมื่อยังเหลือช่องทางเข้าสู่ระบบอย่างน้อยหนึ่งช่องทาง</p>
          {accountsError && <p className="form-hint-error">{accountsError}</p>}
          <div className="security-account-list">
            {accountsLoading ? (
              <p>กำลังโหลดบัญชีที่เชื่อมต่อ...</p>
            ) : connectedAccounts.length === 0 ? (
              <p className="security-empty">ยังไม่ได้เชื่อมต่อบัญชีโซเชียลใด ๆ</p>
            ) : (
              connectedAccounts.map((acct) => {
                const meta = providerMeta[acct.provider];
                const busy = securityActionId === acct.provider;
                return (
                  <div key={acct.provider} className="security-account-card">
                    <div className="security-account-head">
                      <div className="security-account-info">
                        <span className="security-account-icon">{meta && <meta.Icon size={18} />}</span>
                        <span className="security-account-name">{meta ? meta.label : acct.provider}</span>
                        <span className="security-account-id">…{String(acct.id || "").slice(-4)}</span>
                      </div>
                      <button
                        type="button"
                        className="btn-outline security-unlink-btn"
                        onClick={() => onUnlinkSocial(acct.provider)}
                        disabled={busy}
                        aria-label={`ยกเลิกเชื่อมต่อ ${meta?.label || acct.provider}`}
                      >
                        {busy ? "กำลังถอน..." : "ถอนการเชื่อมต่อ"}
                      </button>
                    </div>
                    <p className="security-account-hint">ถอนแล้วจะเข้าสู่ระบบผ่าน {meta?.label || acct.provider} ไม่ได้อีกต่อไป</p>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* ===== 3. อุปกรณ์และเซสชันที่เข้าสู่ระบบ ===== */}
      {securityTab === "sessions" && (
        <div className="security-section security-section-sessions">
          <div className="security-section-head">
            <h4 className="security-section-title"><DeviceIcon size={16} /> อุปกรณ์และเซสชันที่เข้าสู่ระบบ</h4>
          </div>
          <p className="security-section-desc">เซสชันที่ยังใช้งานอยู่ของคุณ เครื่องที่มีป้าย "ปัจจุบัน" คือเครื่องที่คุณใช้อยู่ขณะนี้ การถอนเซสชันรายเครื่องเป็นการปิดใช้งานตัวชี้วัด (soft revoke) — เพื่อเพิกถอนโทเค็นทั้งหมดทันที ให้ใช้ออกจากระบบทุกอุปกรณ์ด้านล่าง</p>
          {sessionsError && <p className="form-hint-error">{sessionsError}</p>}
          <div className="security-session-list">
            {sessionsLoading ? (
              <p>กำลังโหลดเซสชัน...</p>
            ) : sessions.length === 0 ? (
              <p className="security-empty">ยังไม่มีข้อมูลเซสชันที่ใช้งานอยู่</p>
            ) : (
              sessions.map((s) => {
                const current = isCurrentSession(s);
                const busy = securityActionId === s.id;
                return (
                  <article key={s.id} className={`security-session-card ${current ? "security-session-current" : ""}`}>
                    <div className="security-session-head">
                      <div className="security-session-info">
                        <span className="security-session-device">{formatDevice(s)}</span>
                        {current && <span className="security-session-badge security-badge-current">ปัจจุบัน</span>}
                        <span className="security-session-location">{formatLocation(s)}</span>
                      </div>
                      <div className="security-session-time">
                        <span className="security-session-label">ล่าสุด</span>
                        <span className="security-session-value">{new Date(s.last_activity_at).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" })}</span>
                      </div>
                    </div>
                    <div className="security-session-foot">
                      <span className="security-session-ip">{s.ip_address || "—"}</span>
                      <span className="security-session-user-agent">{s.user_agent ? s.user_agent.slice(0, 60) : "—"}</span>
                      <button
                        type="button"
                        className="btn-outline security-revoke-btn"
                        onClick={() => onRevokeSession(s.id)}
                        disabled={busy || current}
                        aria-label={`ยกเลิกเซสชัน ${formatDevice(s)}`}
                      >
                        {busy ? "กำลังยกเลิก..." : current ? "อุปกรณ์นี้" : "ยกเลิกเซสชัน"}
                      </button>
                    </div>
                  </article>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* ===== 4. ประวัติการเข้าสู่ระบบ ===== */}
      {securityTab === "history" && (
        <div className="security-section security-section-history">
          <div className="security-section-head">
            <h4 className="security-section-title"><HistoryIcon size={16} /> ประวัติการเข้าสู่ระบบ</h4>
          </div>
          <p className="security-section-desc">บันทึกเหตุการณ์การยืนยันตัวตน (เข้าสู่ระบบสำเร็จ/ล้มเหลว ออกจากระบบ เปลี่ยนรหัสผ่าน ถอนการเชื่อมต่อสังคม) พร้อมบริบทคำขอ</p>
          {historyError && <p className="form-hint-error">{historyError}</p>}
          <div className="security-history-list">
            {historyLoading ? (
              <p>กำลังโหลดประวัติ...</p>
            ) : loginHistory.length === 0 ? (
              <p className="security-empty">ยังไม่มีประวัติการเข้าสู่ระบบ</p>
            ) : (
              <table className="security-history-table">
                <thead>
                  <tr>
                    <th>เหตุการณ์</th>
                    <th className="security-history-col-status">สถานะ</th>
                    <th className="security-history-col-device">อุปกรณ์ / เบราว์เซอร์</th>
                    <th className="security-history-col-loc">ตำแหน่ง (โดยประมาณ)</th>
                    <th className="security-history-col-time">เวลา</th>
                  </tr>
                </thead>
                <tbody>
                  {loginHistory.map((h) => (
                    <tr key={h.id} className={`security-history-row ${!h.success ? "security-history-fail" : ""}`}>
                      <td className="security-history-event">
                        {h.event_type === "login_success" ? "เข้าสู่ระบบสำเร็จ" : h.event_type === "login_failure" ? "เข้าสู่ระบบล้มเหลว" : h.event_type === "logout" ? "ออกจากระบบ" : h.event_type === "password_change" ? "เปลี่ยนรหัสผ่าน" : h.event_type === "social_unlink" ? "ถอนการเชื่อมต่อโซเชียล" : h.event_type === "session_revoked" ? "ยกเลิกเซสชัน" : h.event_type}
                      </td>
                      <td className="security-history-status">
                        <span className={`security-history-badge ${h.success ? "security-history-success" : "security-history-fail-badge"}`}>
                          {h.success ? "สำเร็จ" : "ล้มเหลว"}
                        </span>
                        {!h.success && h.failure_reason && <span className="security-history-reason">{h.failure_reason}</span>}
                      </td>
                      <td className="security-history-device">
                        {(h.device_name || h.browser || h.os) ? [h.device_name, h.browser, h.os].filter(Boolean).join(" · ") : "—"}
                      </td>
                      <td className="security-history-loc">{h.country ? `${h.country}${h.city ? `, ${h.city}` : ""}` : "—"}</td>
                      <td className="security-history-time">{new Date(h.created_at).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* ===== 5. การแจ้งเตือนความปลอดภัย ===== */}
      {securityTab === "alerts" && (
        <div className="security-section security-section-alerts">
          <div className="security-section-head">
            <h4 className="security-section-title"><AlertIcon size={16} /> การแจ้งเตือนความปลอดภัย</h4>
            {unreadCount > 0 && <span className="security-alerts-unread">{unreadCount} รายการยังไม่อ่าน</span>}
          </div>
          <p className="security-section-desc">แจ้งเตือนเมื่อมีการเข้าสู่ระบบจากอุปกรณ์ใหม่ ประเทศใหม่ หรือพยายามเข้าสู่ระบบล้มเหลวหลายครั้ง คลิกเพื่อทำเครื่องหมายอ่านแล้ว</p>
          {alertsError && <p className="form-hint-error">{alertsError}</p>}
          <div className="security-alert-list">
            {alertsLoading ? (
              <p>กำลังโหลดการแจ้งเตือน...</p>
            ) : securityAlerts.length === 0 ? (
              <p className="security-empty">ไม่มีการแจ้งเตือนความปลอดภัย</p>
            ) : (
              securityAlerts.map((a) => {
                const busy = securityActionId === a.id;
                return (
                  <div key={a.id} className={`security-alert-card ${!a.is_read ? "security-alert-unread" : ""}`}>
                    <div className="security-alert-head">
                      <span className={`security-alert-type ${a.severity === "high" ? "security-alert-high" : ""}`}>{a.alert_type}</span>
                      <span className="security-alert-severity">{a.severity}</span>
                      {!a.is_read && <span className="security-alert-dot" /> }
                    </div>
                    <div className="security-alert-body">
                      <div className="security-alert-title">{a.title}</div>
                      {a.description && <div className="security-alert-desc">{a.description}</div>}
                      <div className="security-alert-meta">
                        {a.ip_address && <span>IP: {a.ip_address}</span>}
                        {a.country && <span>ประเทศ: {a.country}</span>}
                        {a.device_id && <span>อุปกรณ์: {a.device_id.slice(-8)}</span>}
                      </div>
                    </div>
                    <div className="security-alert-foot">
                      <span className="security-alert-time">{new Date(a.created_at).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" })}</span>
                      {!a.is_read && (
                        <button
                          type="button"
                          className="btn-outline security-alert-read-btn"
                          onClick={() => onMarkAlertRead(a.id)}
                          disabled={busy}
                        >
                          {busy ? "กำลังอ่าน..." : "ทำเครื่องหมายอ่านแล้ว"}
                        </button>
                      )}
                      {a.is_read && <span className="security-alert-read-badge">อ่านแล้ว</span>}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* ===== 6. ออกจากระบบทุกอุปกรณ์ ===== */}
      {securityTab === "overview" && (
        <div className="security-section security-section-logoutall">
          <div className="security-section-head">
            <h4 className="security-section-title"><LogoutAllIcon size={16} /> ออกจากระบบทุกอุปกรณ์</h4>
          </div>
          <p className="security-section-desc">เพิกถอนเซสชันทั้งหมดและออกจากระบบบนทุกอุปกรณ์ คุณจะต้องเข้าสู่ระบบใหม่บนทุกเครื่อง (รวมถึงเครื่องนี้)</p>
          <div className="security-logoutall-actions">
            <button type="button" className="btn btn-danger security-logoutall-btn" onClick={onLogoutAllDevices} disabled={logoutAllLoading}>
              {logoutAllLoading ? "กำลังออกจากระบบทุกอุปกรณ์..." : "ออกจากระบบทุกอุปกรณ์"}
            </button>
          </div>
          <p className="security-hint-note">หมายเหตุ: ระบบสามารถเพิกถอนทุกเซสชันผ่านโทเค็นที่ถืออยู่ได้ (global) แต่ไม่สามารถเลือกเพิกถอนเครื่องใดเครื่องหนึ่งโดยระบุ ID จากอุปกรณ์อื่นได้ เนื่องจากข้อจำกัดของ Supabase Auth</p>
        </div>
      )}
    </div>
  );
};

const WalletBalanceModal = ({ balance, coins, loading, error, onClose, walletSettings }) => {
  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('th-TH', {
      style: 'currency',
      currency: 'THB',
      minimumFractionDigits: 2,
    }).format(amount || 0);
  };

  if (loading) {
    return (
      <div className="wallet-modal-loading">
        <div className="loading-spinner" />
        <p>กำลังโหลดข้อมูลกระเป๋าเงิน...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="wallet-modal-error">
        <p className="form-hint-error">{error}</p>
        <button type="button" className="btn" onClick={onClose}>ปิด</button>
      </div>
    );
  }

  return (
    <div>
      <h3>ยอดเงินคงเหลือ</h3>
      <div className="wallet-balance-card">
        <div className="wallet-balance-amount">{formatCurrency(balance)}</div>
        <div className="wallet-balance-label">บาท</div>
        {!walletSettings.enabled && (
          <div className="wallet-disabled-notice">
            <span className="notice-icon">⚠️</span>
            <span>ระบบวอเลทลูกค้าถูกปิดใช้งานชั่วคราว ไม่สามารถชำระเงินด้วยวอเลทได้</span>
          </div>
        )}
      </div>
      <div className="wallet-balance-actions">
        <button type="button" className="btn btn-outline" onClick={onClose}>ปิด</button>
        {walletSettings.enabled && (
          <button type="button" className="btn" onClick={() => { onClose(); window.open('/wallet/topup', '_blank'); }}>
            เติมเงิน
          </button>
        )}
      </div>
      <div className="wallet-summary">
        <div className="wallet-summary-item">
          <span className="wallet-summary-label">เหรียญโบนัส</span>
          <span className="wallet-summary-value">{coins} เหรียญ</span>
        </div>
      </div>
    </div>
  );
};

const WalletCoinsModal = ({ coins, loading, error, onClose }) => {
  if (loading) {
    return (
      <div className="wallet-modal-loading">
        <div className="loading-spinner" />
        <p>กำลังโหลดข้อมูลเหรียญโบนัส...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="wallet-modal-error">
        <p className="form-hint-error">{error}</p>
        <button type="button" className="btn" onClick={onClose}>ปิด</button>
      </div>
    );
  }

  return (
    <div>
      <h3>เหรียญโบนัส</h3>
      <div className="wallet-coins-card">
        <div className="wallet-coins-amount">{coins}</div>
        <div className="wallet-coins-label">เหรียญ</div>
        <p className="wallet-coins-desc">สะสมเหรียญจากการซื้อสินค้าและกิจกรรมต่างๆ เพื่อแลกของรางวัลหรือส่วนลด</p>
      </div>
      <div className="wallet-coins-history">
        <h4>ประวัติเหรียญโบนัส</h4>
        <p className="wallet-empty">ยังไม่มีประวัติการได้รับ/ใช้เหรียญโบนัส</p>
      </div>
      <button type="button" className="btn" onClick={onClose}>ปิด</button>
    </div>
  );
};

const WalletVoucherModal = ({ vouchers, loading, error, onClose }) => {
  const formatDate = (dateStr) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString('th-TH', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  if (loading) {
    return (
      <div className="wallet-modal-loading">
        <div className="loading-spinner" />
        <p>กำลังโหลดคูปองของฉัน...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="wallet-modal-error">
        <p className="form-hint-error">{error}</p>
        <button type="button" className="btn" onClick={onClose}>ปิด</button>
      </div>
    );
  }

  const activeVouchers = vouchers.filter(v => v.is_active && new Date(v.valid_until) > new Date());
  const expiredVouchers = vouchers.filter(v => !v.is_active || new Date(v.valid_until) <= new Date());

  return (
    <div>
      <h3>คูปองของฉัน</h3>
      {activeVouchers.length > 0 && (
        <div className="voucher-section">
          <h4>คูปองที่ใช้งานได้ ({activeVouchers.length})</h4>
          <div className="voucher-list">
            {activeVouchers.map((voucher) => (
              <div key={voucher.id} className="voucher-card">
                <div className="voucher-card-main">
                  <div className="voucher-code">{voucher.code}</div>
                  <div className="voucher-info">
                    <div className="voucher-name">{voucher.name}</div>
                    <div className="voucher-desc">{voucher.description || '-'}</div>
                    <div className="voucher-meta">
                      <span>ส่วนลด: {voucher.discount_type === 'percentage' ? voucher.discount_value + '%' : formatCurrency(voucher.discount_value)}</span>
                      {voucher.min_order_amount > 0 && <span>ขั้นต่ำ: {formatCurrency(voucher.min_order_amount)}</span>}
                      {voucher.max_discount_amount && <span>สูงสุด: {formatCurrency(voucher.max_discount_amount)}</span>}
                    </div>
                  </div>
                </div>
                <div className="voucher-card-side">
                  <div className="voucher-expiry">หมดอายุ: {formatDate(voucher.valid_until)}</div>
                  <div className="voucher-usage">ใช้แล้ว: {voucher.used_count}/{voucher.usage_limit}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {expiredVouchers.length > 0 && (
        <div className="voucher-section">
          <h4>คูปองที่หมดอายุ ({expiredVouchers.length})</h4>
          <div className="voucher-list expired">
            {expiredVouchers.map((voucher) => (
              <div key={voucher.id} className="voucher-card expired">
                <div className="voucher-card-main">
                  <div className="voucher-code">{voucher.code}</div>
                  <div className="voucher-info">
                    <div className="voucher-name">{voucher.name}</div>
                    <div className="voucher-meta">หมดอายุ: {formatDate(voucher.valid_until)}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {(activeVouchers.length === 0 && expiredVouchers.length === 0) && (
        <div className="wallet-empty-state">
          <p>ยังไม่มีคูปอง</p>
        </div>
      )}
      <button type="button" className="btn" onClick={onClose}>ปิด</button>
    </div>
  );
};

const FinanceCardsModal = ({ cards, loading, error, onClose, onAddCard, onEditCard, onDeleteCard }) => {
  if (loading) {
    return (
      <div className="wallet-modal-loading">
        <div className="loading-spinner" />
        <p>กำลังโหลดบัตรของฉัน...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="wallet-modal-error">
        <p className="form-hint-error">{error}</p>
        <button type="button" className="btn" onClick={onClose}>ปิด</button>
      </div>
    );
  }

  return (
    <div>
      <div className="modal-header-with-action">
        <h3>บัตรของฉัน</h3>
        <button type="button" className="btn btn-sm" onClick={onAddCard}>เพิ่มบัตร</button>
      </div>
      {cards.length > 0 ? (
        <div className="card-list">
          {cards.map((card) => (
            <div key={card.id} className="finance-card-item">
              <div className="finance-card-info">
                <div className="finance-card-icon">{card.card_brand?.toUpperCase() || 'CARD'}</div>
                <div className="finance-card-details">
                  <div className="finance-card-name">{card.card_brand?.toUpperCase() || 'บัตร'} •••• {card.card_last4}</div>
                  <div className="finance-card-meta">หมดอายุ {card.card_exp_month?.toString().padStart(2, '0')}/{String(card.card_exp_year).slice(-2)}</div>
                  {card.cardholder_name && <div className="finance-card-holder">{card.cardholder_name}</div>}
                  {card.is_default && <span className="finance-card-badge default">บัตรหลัก</span>}
                </div>
              </div>
              <div className="finance-card-actions">
                <button type="button" className="btn-outline btn-sm" onClick={() => onEditCard(card)}>แก้ไข</button>
                <button type="button" className="btn-outline btn-sm danger" onClick={() => onDeleteCard(card.id)}>ลบ</button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="wallet-empty-state">
          <p>ยังไม่มีบัตรที่บันทึกไว้</p>
          <button type="button" className="btn btn-sm" onClick={onAddCard} style={{ marginTop: '12px' }}>เพิ่มบัตรแรกของฉัน</button>
        </div>
      )}
      <button type="button" className="btn" onClick={onClose} style={{ marginTop: '16px' }}>ปิด</button>
    </div>
  );
};

const FinanceBankModal = ({ bankAccounts, loading, error, onClose, onAddBankAccount, onEditBankAccount, onDeleteBankAccount, onVerifyBankAccount }) => {
  if (loading) {
    return (
      <div className="wallet-modal-loading">
        <div className="loading-spinner" />
        <p>กำลังโหลดบัญชีธนาคาร...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="wallet-modal-error">
        <p className="form-hint-error">{error}</p>
        <button type="button" className="btn" onClick={onClose}>ปิด</button>
      </div>
    );
  }

  return (
    <div>
      <div className="modal-header-with-action">
        <h3>บัญชีธนาคาร</h3>
        <button type="button" className="btn btn-sm" onClick={onAddBankAccount}>เพิ่มบัญชี</button>
      </div>
      {bankAccounts.length > 0 ? (
        <div className="bank-list">
          {bankAccounts.map((account) => (
            <div key={account.id} className="finance-bank-item">
              <div className="finance-bank-info">
                <div className="finance-bank-icon">{account.bank_name?.charAt(0) || '🏦'}</div>
                <div className="finance-bank-details">
                  <div className="finance-bank-name">{account.bank_name}</div>
                  <div className="finance-bank-meta">เลขที่: ••••{account.account_number?.slice(-4)} · {account.account_name}</div>
                  <div className="finance-bank-meta">ประเภท: {account.account_type === 'savings' ? 'ออมทรัพย์' : account.account_type === 'current' ? 'กระแสรายวัน' : 'เงินฝากประจำ'}</div>
                  {account.is_default && <span className="finance-bank-badge default">บัญชีหลัก</span>}
                  {account.is_verified ? <span className="finance-bank-badge verified">ยืนยันแล้ว</span> : <span className="finance-bank-badge pending">รอยืนยัน</span>}
                </div>
              </div>
              <div className="finance-bank-actions">
                {!account.is_verified && (
                  <button type="button" className="btn-outline btn-sm" onClick={() => onVerifyBankAccount(account.id)}>ยืนยัน</button>
                )}
                <button type="button" className="btn-outline btn-sm" onClick={() => onEditBankAccount(account)}>แก้ไข</button>
                <button type="button" className="btn-outline btn-sm danger" onClick={() => onDeleteBankAccount(account.id)}>ลบ</button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="wallet-empty-state">
          <p>ยังไม่มีบัญชีธนาคารที่บันทึกไว้</p>
          <button type="button" className="btn btn-sm" onClick={onAddBankAccount} style={{ marginTop: '12px' }}>เพิ่มบัญชีแรกของฉัน</button>
        </div>
      )}
      <button type="button" className="btn" onClick={onClose} style={{ marginTop: '16px' }}>ปิด</button>
    </div>
  );
};

const FinanceHistoryModal = ({ history, loading, error, onClose }) => {
  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('th-TH', {
      style: 'currency',
      currency: 'THB',
      minimumFractionDigits: 2,
    }).format(amount || 0);
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleString('th-TH', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getTypeLabel = (type) => {
    const labels = {
      wallet_topup: 'เติมเงินวอเลท',
      wallet_payment: 'ชำระเงินวอเลท',
      wallet_refund: 'คืนเงินวอเลท',
      wallet_reward: 'รางวัลวอเลท',
      wallet_adjustment: 'ปรับยอดวอเลท',
      coin_earned: 'ได้เหรียญโบนัส',
      coin_spent: 'ใช้เหรียญโบนัส',
      coin_expired: 'เหรียญหมดอายุ',
      voucher_received: 'ได้รับคูปอง',
      voucher_used: 'ใช้คูปอง',
      voucher_expired: 'คูปองหมดอายุ',
      card_added: 'เพิ่มบัตร',
      card_removed: 'ลบบัตร',
      card_used: 'ใช้บัตร',
      bank_added: 'เพิ่มบัญชีธนาคาร',
      bank_removed: 'ลบบัญชีธนาคาร',
      bank_verified: 'ยืนยันบัญชีธนาคาร',
      order_payment: 'ชำระออเดอร์',
      order_refund: 'คืนเงินออเดอร์',
      order_cod: 'ชำระปลายทาง',
      promotion_reward: 'รางวัลโปรโมชั่น',
    };
    return labels[type] || type;
  };

  const getTypeColor = (type) => {
    if (type.includes('topup') || type.includes('earned') || type.includes('received') || type.includes('refund') || type.includes('reward')) return 'success';
    if (type.includes('payment') || type.includes('spent') || type.includes('used') || type.includes('removed')) return 'expense';
    return 'neutral';
  };

  if (loading) {
    return (
      <div className="wallet-modal-loading">
        <div className="loading-spinner" />
        <p>กำลังโหลดประวัติการเงิน...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="wallet-modal-error">
        <p className="form-hint-error">{error}</p>
        <button type="button" className="btn" onClick={onClose}>ปิด</button>
      </div>
    );
  }

  return (
    <div>
      <h3>ประวัติการเงิน</h3>
      {history.length > 0 ? (
        <div className="finance-history-list">
          {history.map((item) => (
            <div key={item.id} className="finance-history-item">
              <div className="finance-history-main">
                <div className={`finance-history-type ${getTypeColor(item.type)}`}>
                  <span className="finance-history-icon">{getTypeColor(item.type) === 'success' ? '+' : getTypeColor(item.type) === 'expense' ? '-' : '•'}</span>
                </div>
                <div className="finance-history-info">
                  <div className="finance-history-label">{getTypeLabel(item.type)}</div>
                  <div className="finance-history-desc">{item.description}</div>
                  <div className="finance-history-time">{formatDate(item.created_at)}</div>
                </div>
              </div>
              <div className="finance-history-amounts">
                {item.amount !== 0 && item.amount !== undefined && (
                  <div className={`finance-history-amount ${item.amount > 0 ? 'positive' : 'negative'}`}>
                    {item.amount > 0 ? '+' : ''}{formatCurrency(item.amount)}
                  </div>
                )}
                {item.coins !== 0 && item.coins !== undefined && (
                  <div className={`finance-history-coins ${item.coins > 0 ? 'positive' : 'negative'}`}>
                    {item.coins > 0 ? '+' : ''}{item.coins} 🪙
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="wallet-empty-state">
          <p>ยังไม่มีประวัติการเงิน</p>
        </div>
      )}
      <button type="button" className="btn" onClick={onClose}>ปิด</button>
    </div>
  );
};

const MeeCardRegistrationModal = ({ registration, loading, error, onClose, onSubmit, formData, onFieldChange, submitting, success, formError }) => {
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 10 }, (_, i) => currentYear + i);
  const months = Array.from({ length: 12 }, (_, i) => ({
    value: String(i + 1).padStart(2, '0'),
    label: String(i + 1).padStart(2, '0'),
  }));

  if (loading) {
    return (
      <div className="wallet-modal-loading">
        <div className="loading-spinner" />
        <p>กำลังโหลดข้อมูล...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="wallet-modal-error">
        <p className="form-hint-error">{error}</p>
        <button type="button" className="btn" onClick={onClose}>ปิด</button>
      </div>
    );
  }

  // If already registered, show status
  if (registration) {
    const getStatusLabel = (status) => {
      const labels = {
        pending: 'รอการอนุมัติ',
        approved: 'อนุมัติแล้ว',
        rejected: 'ถูกปฏิเสธ',
        expired: 'หมดอายุ',
      };
      return labels[status] || status;
    };

    const getStatusColor = (status) => {
      if (status === 'approved') return 'success';
      if (status === 'rejected') return 'error';
      if (status === 'pending') return 'warning';
      return 'neutral';
    };

    return (
      <div>
        <h3>สมัครวอเลท Mee Card</h3>
        <div className="mee-card-status-card">
          <div className={`mee-card-status-badge ${getStatusColor(registration.status)}`}>
            {getStatusLabel(registration.status)}
          </div>
          <div className="mee-card-status-details">
            <div className="mee-card-status-item">
              <span className="mee-card-status-label">หมายเลขบัตร</span>
              <span className="mee-card-status-value">•••• {registration.mee_card_number?.slice(-4) || '****'}</span>
            </div>
            <div className="mee-card-status-item">
              <span className="mee-card-status-label">ชื่อผู้ถือบัตร</span>
              <span className="mee-card-status-value">{registration.mee_card_holder_name}</span>
            </div>
            <div className="mee-card-status-item">
              <span className="mee-card-status-label">หมดอายุ</span>
              <span className="mee-card-status-value">{registration.mee_card_exp_month?.toString().padStart(2, '0')}/{String(registration.mee_card_exp_year).slice(-2)}</span>
            </div>
            <div className="mee-card-status-item">
              <span className="mee-card-status-label">ประเภทบัตร</span>
              <span className="mee-card-status-value">{registration.mee_card_type === 'debit' ? 'เดบิต' : registration.mee_card_type === 'credit' ? 'เครดิต' : 'เติมเงิน'}</span>
            </div>
            <div className="mee-card-status-item">
              <span className="mee-card-status-label">สถานะ</span>
              <span className="mee-card-status-value">{getStatusLabel(registration.status)}</span>
            </div>
            {registration.status === 'pending' && (
              <div className="mee-card-status-item">
                <span className="mee-card-status-label">ส่งคำขอเมื่อ</span>
                <span className="mee-card-status-value">{new Date(registration.created_at).toLocaleString('th-TH')}</span>
              </div>
            )}
            {registration.status === 'rejected' && registration.rejection_reason && (
              <div className="mee-card-status-item error">
                <span className="mee-card-status-label">เหตุผลที่ถูกปฏิเสธ</span>
                <span className="mee-card-status-value">{registration.rejection_reason}</span>
              </div>
            )}
            {registration.status === 'approved' && registration.verified_at && (
              <div className="mee-card-status-item">
                <span className="mee-card-status-label">อนุมัติเมื่อ</span>
                <span className="mee-card-status-value">{new Date(registration.verified_at).toLocaleString('th-TH')}</span>
              </div>
            )}
          </div>
          {registration.status === 'rejected' && (
            <button type="button" className="btn" onClick={() => onSubmit({ preventDefault: () => {} })}>
              สมัครใหม่
            </button>
          )}
        </div>
        <button type="button" className="btn btn-outline" onClick={onClose} style={{ marginTop: '16px' }}>ปิด</button>
      </div>
    );
  }

  // Show registration form
  return (
    <div>
      <h3>สมัครวอเลทด้วยบัตร Mee Card</h3>
      <p className="form-hint" style={{ marginBottom: '20px', fontSize: '14px', color: '#6b7280' }}>
        กรอกข้อมูลบัตร Mee Card ของคุณเพื่อสมัครเปิดใช้งานวอเลท ระบบจะตรวจสอบและอนุมัติภายใน 24 ชั่วโมง
      </p>
      {success && <div className="alert alert-success" style={{ marginBottom: '16px' }}>{success}</div>}
      {formError && <div className="alert alert-error" style={{ marginBottom: '16px' }}>{formError}</div>}
      <form onSubmit={onSubmit} className="mee-card-form">
        <div className="form-group">
          <label className="form-label" htmlFor="mee-card-number">หมายเลขบัตร Mee Card *</label>
          <input
            id="mee-card-number"
            type="text"
            className="form-input"
            value={formData.mee_card_number}
            onChange={(e) => onFieldChange('mee_card_number', e.target.value)}
            placeholder="XXXX XXXX XXXX XXXX"
            maxLength={19}
            disabled={submitting}
            autoComplete="cc-number"
          />
        </div>
        <div className="form-group">
          <label className="form-label" htmlFor="mee-card-holder-name">ชื่อผู้ถือบัตร *</label>
          <input
            id="mee-card-holder-name"
            type="text"
            className="form-input"
            value={formData.mee_card_holder_name}
            onChange={(e) => onFieldChange('mee_card_holder_name', e.target.value)}
            placeholder="ชื่อตามบัตร"
            maxLength={100}
            disabled={submitting}
            autoComplete="cc-name"
          />
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label" htmlFor="mee-card-exp-month">เดือนหมดอายุ *</label>
            <select
              id="mee-card-exp-month"
              className="form-input"
              value={formData.mee_card_exp_month}
              onChange={(e) => onFieldChange('mee_card_exp_month', e.target.value)}
              disabled={submitting}
            >
              <option value="">เลือกเดือน</option>
              {months.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="mee-card-exp-year">ปีหมดอายุ *</label>
            <select
              id="mee-card-exp-year"
              className="form-input"
              value={formData.mee_card_exp_year}
              onChange={(e) => onFieldChange('mee_card_exp_year', e.target.value)}
              disabled={submitting}
            >
              <option value="">เลือกปี</option>
              {years.map((y) => (
                <option key={y} value={String(y)}>{y}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="form-group">
          <label className="form-label" htmlFor="mee-card-type">ประเภทบัตร</label>
          <select
            id="mee-card-type"
            className="form-input"
            value={formData.mee_card_type}
            onChange={(e) => onFieldChange('mee_card_type', e.target.value)}
            disabled={submitting}
          >
            <option value="debit">เดบิต (Debit)</option>
            <option value="credit">เครดิต (Credit)</option>
            <option value="prepaid">เติมเงิน (Prepaid)</option>
          </select>
        </div>
        <div className="form-group">
          <label className="form-label" htmlFor="mee-card-phone">เบอร์โทรศัพท์</label>
          <input
            id="mee-card-phone"
            type="tel"
            className="form-input"
            value={formData.phone_number}
            onChange={(e) => onFieldChange('phone_number', e.target.value)}
            placeholder="08X-XXX-XXXX"
            maxLength={20}
            disabled={submitting}
            autoComplete="tel"
          />
        </div>
        <div className="form-group">
          <label className="form-label" htmlFor="mee-card-email">อีเมล</label>
          <input
            id="mee-card-email"
            type="email"
            className="form-input"
            value={formData.email}
            onChange={(e) => onFieldChange('email', e.target.value)}
            placeholder="example@email.com"
            maxLength={100}
            disabled={submitting}
            autoComplete="email"
          />
        </div>
        <div className="form-hint" style={{ fontSize: '12px', color: '#6b7280', marginTop: '8px' }}>
          ข้อมูลบัตรจะถูกเข้ารหัสและเก็บรักษาอย่างปลอดภัย ระบบจะไม่แสดงหมายเลขบัตรเต็ม
        </div>
        <div className="account-modal-actions" style={{ marginTop: '24px' }}>
          <button type="button" className="btn-outline" onClick={onClose} disabled={submitting}>ยกเลิก</button>
          <button type="submit" className="btn" disabled={submitting}>
            {submitting ? 'กำลังส่งคำขอ...' : 'ส่งคำขอสมัคร'}
          </button>
        </div>
      </form>
    </div>
  );
};

export default function Account() {
  const { customer, logout } = useAuth();
  const user = customer?.user;
  const { on, off } = useSocket();
  const navigate = useNavigate();
  const isLoggedIn = Boolean(user);

  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuRef = useRef(null);
  const [activeModal, setActiveModal] = useState(null);
  const [payModalOpen, setPayModalOpen] = useState(false);
  const [payPopupOrders, setPayPopupOrders] = useState([]);
  const [kbzpaySettingsByStore, setKbzpaySettingsByStore] = useState({});

  const [orders, setOrders] = useState([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [ordersError, setOrdersError] = useState("");
  const [ordersLoaded, setOrdersLoaded] = useState(false);
  const [addresses, setAddresses] = useState([]);
  const [addressesLoading, setAddressesLoading] = useState(false);
  const [addressesError, setAddressesError] = useState("");
  const [addressFormOpen, setAddressFormOpen] = useState(false);
  const [editingAddressId, setEditingAddressId] = useState(null);
  const [addressForm, setAddressForm] = useState(EMPTY_ADDRESS_FORM);
  const [addressFormError, setAddressFormError] = useState("");
  const [addressSaving, setAddressSaving] = useState(false);
  const [addressActionId, setAddressActionId] = useState(null);
  const prevAccountNameRef = useRef(user?.name || "");
  const bulkUpdatingRef = useRef(false);
  const [walletBalance, setWalletBalance] = useState(0);
  const [walletCoins, setWalletCoins] = useState(0);
  const [walletVouchers, setWalletVouchers] = useState([]);
  const [walletLoading, setWalletLoading] = useState(false);
  const [walletError, setWalletError] = useState("");
  const [cards, setCards] = useState([]);
  const [bankAccounts, setBankAccounts] = useState([]);
  const [financeHistory, setFinanceHistory] = useState([]);
  const [financeLoading, setFinanceLoading] = useState(false);
  const [financeError, setFinanceError] = useState("");
  const [walletSettings, setWalletSettings] = useState({ enabled: false });

  // ================ Mee Card Wallet Registration state ================
  const [meeCardForm, setMeeCardForm] = useState({
    mee_card_number: "",
    mee_card_holder_name: "",
    mee_card_exp_month: "",
    mee_card_exp_year: "",
    mee_card_type: "debit",
    phone_number: "",
    email: "",
  });
  const [meeCardLoading, setMeeCardLoading] = useState(false);
  const [meeCardError, setMeeCardError] = useState("");
  const [meeCardSuccess, setMeeCardSuccess] = useState("");
  const [meeCardRegistration, setMeeCardRegistration] = useState(null);

  // ================ Security / Connected Accounts state ================
  const [securityTab, setSecurityTab] = useState("overview");
  const [sessions, setSessions] = useState([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsError, setSessionsError] = useState("");
  const [loginHistory, setLoginHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [securityAlerts, setSecurityAlerts] = useState([]);
  const [alertsLoading, setAlertsLoading] = useState(false);
  const [alertsError, setAlertsError] = useState("");
  const [connectedAccounts, setConnectedAccounts] = useState([]);
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [accountsError, setAccountsError] = useState("");

  // Change password form
  const [cpForm, setCpForm] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [cpError, setCpError] = useState("");
  const [cpSuccess, setCpSuccess] = useState("");
  const [cpSaving, setCpSaving] = useState(false);

  // Logout all devices
  const [logoutAllLoading, setLogoutAllLoading] = useState(false);

  // Action busyness per row (revoke session, unlink account, mark alert read)
  const [securityActionId, setSecurityActionId] = useState(null);

  const [readDeliveredIds, setReadDeliveredIds] = useState(() => new Set());
  useEffect(() => {
    setReadDeliveredIds(getReadDeliveredOrderIds(user?.id));
  }, [user?.id]);

  const unreadDeliveredCount = useMemo(() => {
    const deliveredIds = orders.filter((order) => matchesOrderFilter(order, "toreview")).map((order) => order?.id).filter(Boolean);
    return deliveredIds.filter((id) => !readDeliveredIds.has(id)).length;
  }, [orders, readDeliveredIds]);

  const purchaseTileBadges = useMemo(() => countOrdersByFilter(orders), [orders]);

  // Every unpaid order of the current customer, regardless of the active
  // order-list filter, so the payment popup can summarise all of them.
  const payableOrders = useMemo(() => getPendingPaymentOrders(orders), [orders]);

  const PURCHASE_TILES = useMemo(() => [
    { key: "topay", label: "ที่ต้องชำระ", Icon: WalletPayIcon, badge: purchaseTileBadges.topay || 0 },
    { key: "toship", label: "ที่ต้องจัดส่ง", Icon: TruckIcon, badge: purchaseTileBadges.toship || 0 },
    { key: "toreceive", label: "ที่ต้องได้รับ", Icon: BoxIcon, badge: purchaseTileBadges.toreceive || 0 },
    { key: "toreview", label: '\u0E23\u0E31\u0E1A\u0E2A\u0E34\u0E19\u0E04\u0E49\u0E32\u0E41\u0E25\u0E49\u0E27', Icon: StarIcon, badge: unreadDeliveredCount || 0 },
  ], [purchaseTileBadges]);

  const loadOrders = useCallback(async () => {
    if (!isLoggedIn) return;
    setOrdersLoading(true);
    setOrdersError("");
    try {
      const result = await orderAPI.getMyOrders({ limit: 50 });
      const list = result?.data?.orders || result?.data || [];
      setOrders(Array.isArray(list) ? list : []);
    } catch (err) {
      setOrdersError(err.message || "ไม่สามารถ加载ประวัติคำสั่งซื้อได้");
     } finally {
       setOrdersLoading(false);
       setOrdersLoaded(true);
     }
  }, [isLoggedIn]);

  useEffect(() => {
    if (!isLoggedIn) return;
    loadOrders();
  }, [isLoggedIn, loadOrders]);

  const loadAddresses = useCallback(async () => {
    if (!isLoggedIn) return;
    setAddressesLoading(true);
    setAddressesError("");
    try {
      const result = await addressAPI.getAddresses();
      setAddresses(extractList(result, "addresses"));
    } catch (err) {
      setAddressesError(err.message || "ไม่สามารถโหลดที่อยู่ได้");
    } finally {
      setAddressesLoading(false);
    }
  }, [isLoggedIn]);

  const loadWallet = useCallback(async () => {
    if (!isLoggedIn) return;
    setWalletLoading(true);
    setWalletError("");
    try {
      const [summaryResult, vouchersResult, settingsResult] = await Promise.all([
        walletAPI.getSummary(),
        walletAPI.getVouchers(),
        walletAPI.getSettings(),
      ]);
      const summary = summaryResult?.data || {};
      setWalletBalance(Number(summary.balance || 0));
      setWalletCoins(Number(summary.coins || 0));
      setWalletVouchers(Array.isArray(vouchersResult?.data) ? vouchersResult.data : []);
      setWalletSettings(settingsResult?.data || { enabled: false });
    } catch (err) {
      setWalletError(err.message || "ไม่สามารถโหลดข้อมูลกระเป๋าเงินได้");
    } finally {
      setWalletLoading(false);
    }
  }, [isLoggedIn]);

  const loadMeeCardRegistration = useCallback(async () => {
    if (!isLoggedIn) return;
    try {
      const result = await walletAPI.getMyMeeCardRegistration();
      setMeeCardRegistration(result?.data || null);
    } catch (err) {
      // Ignore error if registration doesn't exist yet
      setMeeCardRegistration(null);
    }
  }, [isLoggedIn]);

  const loadFinance = useCallback(async () => {
    if (!isLoggedIn) return;
    setFinanceLoading(true);
    setFinanceError("");
    try {
      const [cardsResult, bankAccountsResult, historyResult] = await Promise.all([
        walletAPI.getCards(),
        walletAPI.getBankAccounts(),
        walletAPI.getHistory({ limit: 20 }),
      ]);
      setCards(Array.isArray(cardsResult?.data) ? cardsResult.data : []);
      setBankAccounts(Array.isArray(bankAccountsResult?.data) ? bankAccountsResult.data : []);
      setFinanceHistory(Array.isArray(historyResult?.data?.history) ? historyResult.data.history : []);
    } catch (err) {
      setFinanceError(err.message || "ไม่สามารถโหลดข้อมูลบริการทางการเงินได้");
    } finally {
      setFinanceLoading(false);
    }
  }, [isLoggedIn]);

  // ================ Wallet/Finance handlers ================
  const handleDeleteCard = async (cardId) => {
    const confirmed = window.confirm("ต้องการลบบัตรนี้หรือไม่?");
    if (!confirmed) return;
    try {
      await walletAPI.deleteCard(cardId);
      await loadFinance();
      showToast("ลบบัตรเรียบร้อยแล้ว", "success");
    } catch (err) {
      showToast(err.message || "ลบบัตรไม่สำเร็จ", "error");
    }
  };

  const handleDeleteBankAccount = async (bankAccountId) => {
    const confirmed = window.confirm("ต้องการลบบัญชีธนาคารนี้หรือไม่?");
    if (!confirmed) return;
    try {
      await walletAPI.deleteBankAccount(bankAccountId);
      await loadFinance();
      showToast("ลบบัญชีธนาคารเรียบร้อยแล้ว", "success");
    } catch (err) {
      showToast(err.message || "ลบบัญชีธนาคารไม่สำเร็จ", "error");
    }
  };

  const handleVerifyBankAccount = async (bankAccountId) => {
    try {
      await walletAPI.verifyBankAccount(bankAccountId);
      await loadFinance();
      showToast("ยืนยันบัญชีธนาคารเรียบร้อยแล้ว", "success");
    } catch (err) {
      showToast(err.message || "ยืนยันบัญชีธนาคารไม่สำเร็จ", "error");
    }
};

  // ================ Mee Card Wallet Registration handlers ================
  const handleMeeCardFieldChange = (field, value) => {
    setMeeCardForm((prev) => ({ ...prev, [field]: value }));
    setMeeCardError("");
    setMeeCardSuccess("");
  };

  const handleMeeCardSubmit = async (e) => {
    e.preventDefault();
    setMeeCardError("");
    setMeeCardSuccess("");

    // Validate required fields
    if (!meeCardForm.mee_card_number.trim()) {
      setMeeCardError("กรุณากรอกหมายเลขบัตร Mee Card");
      return;
    }
    if (!meeCardForm.mee_card_holder_name.trim()) {
      setMeeCardError("กรุณากรอกชื่อผู้ถือบัตร");
      return;
    }
    if (!meeCardForm.mee_card_exp_month) {
      setMeeCardError("กรุณาเลือกเดือนหมดอายุ");
      return;
    }
    if (!meeCardForm.mee_card_exp_year) {
      setMeeCardError("กรุณาเลือกปีหมดอายุ");
      return;
    }

    // Validate expiry date is not in the past
    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().getMonth() + 1;
    const expYear = parseInt(meeCardForm.mee_card_exp_year);
    const expMonth = parseInt(meeCardForm.mee_card_exp_month);

    if (expYear < currentYear || (expYear === currentYear && expMonth < currentMonth)) {
      setMeeCardError("บัตรหมดอายุแล้ว ไม่สามารถลงทะเบียนได้");
      return;
    }

    setMeeCardLoading(true);
    try {
      const result = await walletAPI.createMeeCardRegistration({
        mee_card_number: meeCardForm.mee_card_number.trim(),
        mee_card_holder_name: meeCardForm.mee_card_holder_name.trim(),
        mee_card_exp_month: expMonth,
        mee_card_exp_year: expYear,
        mee_card_type: meeCardForm.mee_card_type,
        phone_number: meeCardForm.phone_number.trim() || undefined,
        email: meeCardForm.email.trim() || undefined,
      });

      setMeeCardRegistration(result?.data || null);
      setMeeCardSuccess("ส่งคำขอสมัครวอเลท Mee Card เรียบร้อยแล้ว รอการอนุมัติจากแอดมิน");
      // Reset form
      setMeeCardForm({
        mee_card_number: "",
        mee_card_holder_name: "",
        mee_card_exp_month: "",
        mee_card_exp_year: "",
        mee_card_type: "debit",
        phone_number: "",
        email: "",
      });
      // Reload wallet to update status
      await loadWallet();
      await loadMeeCardRegistration();
    } catch (err) {
      setMeeCardError(err.message || "ส่งคำขอสมัครไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
    } finally {
      setMeeCardLoading(false);
    }
  };

  // ================ Security: loaders ================
  const loadSessions = useCallback(async () => {
    if (!isLoggedIn) return;
    setSessionsLoading(true);
    setSessionsError("");
    try {
      const result = await authAPI.getSessions();
      const list = extractList(result, "sessions") || extractList(result, "data");
      setSessions(Array.isArray(list) ? list : []);
    } catch (err) {
      setSessionsError(err.message || "โหลดเซสชันไม่สำเร็จ");
    } finally {
      setSessionsLoading(false);
    }
  }, [isLoggedIn]);

  const loadLoginHistory = useCallback(async () => {
    if (!isLoggedIn) return;
    setHistoryLoading(true);
    setHistoryError("");
    try {
      const result = await authAPI.getLoginHistory();
      const list = extractList(result, "login_history") || extractList(result, "data");
      setLoginHistory(Array.isArray(list) ? list : []);
    } catch (err) {
      setHistoryError(err.message || "โหลดประวัติการเข้าสู่ระบบไม่สำเร็จ");
    } finally {
      setHistoryLoading(false);
    }
  }, [isLoggedIn]);

  const loadSecurityAlerts = useCallback(async () => {
    if (!isLoggedIn) return;
    setAlertsLoading(true);
    setAlertsError("");
    try {
      const result = await authAPI.getSecurityAlerts();
      const list = extractList(result, "security_alerts") || extractList(result, "data");
      setSecurityAlerts(Array.isArray(list) ? list : []);
    } catch (err) {
      setAlertsError(err.message || "โหลดการแจ้งเตือนไม่สำเร็จ");
    } finally {
      setAlertsLoading(false);
    }
  }, [isLoggedIn]);

  const loadConnectedAccounts = useCallback(async () => {
    if (!isLoggedIn) return;
    setAccountsLoading(true);
    setAccountsError("");
    try {
      const result = await authAPI.getProfile();
      const profile = extractList(result, "profiles")?.[0] || result?.data || result || {};
      const providers = [];
      if (profile.google_id) providers.push({ provider: "google", label: "Google", id: profile.google_id });
      if (profile.facebook_id) providers.push({ provider: "facebook", label: "Facebook", id: profile.facebook_id });
      if (profile.line_id) providers.push({ provider: "line", label: "LINE", id: profile.line_id });
      setConnectedAccounts(providers);
    } catch (err) {
      setAccountsError(err.message || "โหลดบัญชีที่เชื่อมต่อไม่สำเร็จ");
    } finally {
      setAccountsLoading(false);
    }
  }, [isLoggedIn]);

  // ================ Security: handlers ================
  const handleChangePassword = async (event) => {
    event.preventDefault();
    setCpError("");
    setCpSuccess("");
    if (!cpForm.currentPassword.trim()) {
      setCpError("กรุณากรอกรหัสผ่านปัจจุบัน");
      return;
    }
    if (!cpForm.newPassword || cpForm.newPassword.length < 6) {
      setCpError("รหัสผ่านใหม่ต้องมีอย่างน้อย 6 ตัวอักษร");
      return;
    }
    if (cpForm.newPassword !== cpForm.confirmPassword) {
      setCpError("ยืนยันรหัสผ่านใหม่ไม่ตรงกัน");
      return;
    }
    setCpSaving(true);
    try {
      await authAPI.changePassword(cpForm.currentPassword, cpForm.newPassword);
      setCpSuccess("เปลี่ยนรหัสผ่านเรียบร้อยแล้ว");
      setCpForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
    } catch (err) {
      setCpError(err.message || "เปลี่ยนรหัสผ่านไม่สำเร็จ");
    } finally {
      setCpSaving(false);
    }
  };

  const handleRevokeSession = async (sessionId) => {
    const confirmed = window.confirm("ต้องการยกเลิกเซสชันนี้หรือไม่?");
    if (!confirmed) return;
    setSecurityActionId(sessionId);
    setSessionsError("");
    try {
      await authAPI.revokeSession(sessionId);
      setSessions(sessions.filter((s) => s.id !== sessionId));
      showToast("ยกเลิกเซสชันเรียบร้อยแล้ว", "success");
    } catch (err) {
      setSessionsError(err.message || "ยกเลิกเซสชันไม่สำเร็จ");
    } finally {
      setSecurityActionId(null);
    }
  };

  const handleLogoutAllDevices = async () => {
    const confirmed = window.confirm("ต้องการออกจากระบบทุกอุปกรณ์หรือไม่? คุณจะต้องเข้าสู่ระบบใหม่บนอุปกรณ์ทั้งหมด");
    if (!confirmed) return;
    setLogoutAllLoading(true);
    try {
      // Revoke all tracked sessions (soft flag) and all Supabase refresh tokens globally.
      await authAPI.revokeAllSessions();
      await logout("customer", { revokeAllSessions: true, scope: "global" });
      navigate("/");
    } catch (err) {
      setSessionsError(err.message || "ออกจากระบบทุกอุปกรณ์ไม่สำเร็จ");
    } finally {
      setLogoutAllLoading(false);
    }
  };

  const handleUnlinkSocial = async (provider) => {
    setSecurityActionId(provider);
    setAccountsError("");
    try {
      await authAPI.unlinkSocial(provider);
      setConnectedAccounts(connectedAccounts.filter((a) => a.provider !== provider));
      showToast(`ยกเลิกการเชื่อมต่อ ${provider} เรียบร้อยแล้ว`, "success");
      loadConnectedAccounts();
    } catch (err) {
      setAccountsError(err.message || `ยกเลิกการเชื่อมต่อ ${provider} ไม่สำเร็จ`);
    } finally {
      setSecurityActionId(null);
    }
  };

  const handleMarkAlertRead = async (alertId) => {
    setSecurityActionId(alertId);
    setAlertsError("");
    try {
      await authAPI.markAlertRead(alertId);
      setSecurityAlerts(securityAlerts.map((a) => (a.id === alertId ? { ...a, is_read: true, read_at: new Date().toISOString() } : a)));
      showToast("ทำเครื่องหมายอ่านเรียบร้อยแล้ว", "success");
    } catch (err) {
      setAlertsError(err.message || "ทำเครื่องหมายอ่านไม่สำเร็จ");
    } finally {
      setSecurityActionId(null);
    }
  };

  useEffect(() => {
    if (activeModal === "orders-all" || activeModal === "orders-topay" || activeModal === "orders-toreceive" || activeModal === "orders-toship" || activeModal === "orders-toreview") {
      loadOrders();
    }
    if (activeModal === "addresses") {
      loadAddresses();
    }
    if (activeModal === "wallet-balance" || activeModal === "wallet-coins" || activeModal === "wallet-voucher") {
      loadWallet();
    }
    if (activeModal === "mee-card-registration") {
      loadMeeCardRegistration();
    }
    if (activeModal === "finance-cards" || activeModal === "finance-bank" || activeModal === "finance-history") {
      loadFinance();
    }
    if (activeModal === "security") {
      loadSessions();
      loadLoginHistory();
      loadSecurityAlerts();
      loadConnectedAccounts();
    }
  }, [activeModal, loadOrders, loadAddresses, loadWallet, loadMeeCardRegistration, loadFinance, loadSessions, loadLoginHistory, loadSecurityAlerts, loadConnectedAccounts]);

  // Auto-close the "ที่ต้องชำระ" order list modal once there are no more
  // orders that still require payment (e.g. after a successful slip submit).
  // Other category modals are intentionally left untouched.
  useEffect(() => {
    if (activeModal !== "orders-topay" || ordersLoading || !ordersLoaded) return;
    const hasTopay = orders.some((order) => matchesOrderFilter(order, "topay"));
    if (!hasTopay) {
      setActiveModal(null);
      setPayModalOpen(false);
      setPayPopupOrders([]);
    }
  }, [activeModal, orders, ordersLoading, ordersLoaded]);

  // Realtime: refresh orders when an order status changes (e.g. store owner
  // accepts an order) so the account modal shows the latest status and payment
  // badge consistently with /selladmin/orders. The customer socket joins the
  // user_* room on connect, so orderStatusUpdate for this customer arrives here.
  useEffect(() => {
    if (!isLoggedIn) return;
    const onOrderStatusUpdate = () => {
      loadOrders();
    };
    on("orderStatusUpdate", onOrderStatusUpdate);
    return () => off("orderStatusUpdate", onOrderStatusUpdate);
  }, [on, off, isLoggedIn, loadOrders]);

  const handleOpenModal = (modalName) => setActiveModal(modalName);

  const handleCloseModal = () => {
    setActiveModal(null);
    setPayModalOpen(false);
    setPayPopupOrders([]);
    setAddressFormOpen(false);
    setEditingAddressId(null);
    setAddressForm(EMPTY_ADDRESS_FORM);
    setAddressFormError("");
  };

  const handlePay = async (orders) => {
    const orderList = Array.isArray(orders) ? orders : [];
    setPayPopupOrders(orderList);
    await loadKbzpaySettings(orderList);
    setPayModalOpen(true);
  };

  const loadKbzpaySettings = useCallback(async (orderList) => {
    // Resolve store ids from the SAME order data the modal/popup render.
    // The customer order payload nests the store under store_order.store, so we
    // must read the id from there (a flat store_order.store_id is not returned).
    const storeIds = new Set();
    (Array.isArray(orderList) ? orderList : []).forEach((o) => {
      getStoreOrders(o).forEach((so) => {
        const sid = resolveStoreOrderStoreId(so);
        if (sid) storeIds.add(sid);
      });
    });
    setKbzpaySettingsByStore({});
    if (!storeIds.size) {
      return;
    }
    const results = await Promise.all(
      [...storeIds].map((sid) =>
        storeAPI
          .getKbzpaySettings(sid, "customer")
          .then((res) => ({ sid, data: res?.data ?? res ?? null }))
          .catch(() => ({ sid, data: null }))
      )
    );
    const next = {};
    results.forEach(({ sid, data }) => {
      next[sid] = data;
    });
    setKbzpaySettingsByStore(next);
  }, []);

  const openAddressForm = (address = null) => {
    setEditingAddressId(address?.id || null);
    const form = addressToForm(address);
    if (!address) {
      form.recipient_name = user?.name || "";
    }
    setAddressForm(form);
    setAddressFormError("");
    setAddressFormOpen(true);
  };

  const handleAddressFieldChange = (field, value) => {
    setAddressForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleAddressSubmit = async (event) => {
    event.preventDefault();
    setAddressFormError("");

    if (!addressForm.label.trim()) {
      setAddressFormError("กรุณาระบุชื่อที่อยู่");
      return;
    }
    if (!addressForm.recipient_name.trim()) {
      setAddressFormError("กรุณาระบุชื่อผู้รับ");
      return;
    }
    if (!validatePhone(addressForm.phone)) {
      setAddressFormError("กรุณากรอกเบอร์โทรศัพท์ให้ถูกต้อง");
      return;
    }
    if (!addressForm.street.trim() || !addressForm.subdistrict.trim() || !addressForm.district.trim() || !addressForm.province.trim()) {
      setAddressFormError("กรุณากรอกที่อยู่ ตำบล/แขวง อำเภอ/เขต/เมือง และจังหวัด/รัฐ");
      return;
    }
    if (!/^[0-9]{5}$/.test(addressForm.postal_code.trim())) {
      setAddressFormError("รหัสไปรษณีย์ต้องมี 5 หลัก");
      return;
    }

    const payload = {
      label: addressForm.label.trim(),
      recipient_name: addressForm.recipient_name.trim(),
      phone: addressForm.phone.trim(),
      street: addressForm.street.trim(),
      subdistrict: addressForm.subdistrict.trim(),
      district: addressForm.district.trim(),
      province: addressForm.province.trim(),
      postal_code: addressForm.postal_code.trim(),
      country: addressForm.country.trim().toUpperCase(),
      additional_details: addressForm.additional_details.trim(),
      lat: addressForm.coordinates?.lat ?? null,
      lng: addressForm.coordinates?.lng ?? null,
      is_default: Boolean(addressForm.is_default),
    };

    setAddressSaving(true);
    try {
      if (editingAddressId) {
        await addressAPI.update(editingAddressId, payload);
      } else {
        await addressAPI.create(payload);
      }
      await loadAddresses();
      setAddressFormOpen(false);
      setEditingAddressId(null);
      setAddressForm(EMPTY_ADDRESS_FORM);
    } catch (err) {
      setAddressFormError(err.message || "ไม่สามารถบันทึกที่อยู่ได้");
    } finally {
      setAddressSaving(false);
    }
  };

  const handleDeleteAddress = async (address) => {
    const confirmed = window.confirm(`ต้องการลบที่อยู่ "${address.label || address.recipient_name}" หรือไม่?`);
    if (!confirmed) return;

    setAddressesError("");
    setAddressActionId(address.id);
    try {
      await addressAPI.remove(address.id);
      if (editingAddressId === address.id) {
        setAddressFormOpen(false);
        setEditingAddressId(null);
      }
      await loadAddresses();
    } catch (err) {
      setAddressesError(err.message || "ไม่สามารถลบที่อยู่ได้");
    } finally {
      setAddressActionId(null);
    }
  };

  const handleSetDefaultAddress = async (address) => {
    setAddressesError("");
    setAddressActionId(address.id);
    try {
      await addressAPI.setDefault(address.id);
      await loadAddresses();
    } catch (err) {
      setAddressesError(err.message || "ไม่สามารถตั้งค่าที่อยู่หลักได้");
    } finally {
      setAddressActionId(null);
    }
  };

  // อัปเดตชื่อผู้รับเฉพาะที่อยู่ของผู้ใช้ที่ล็อกอินอยู่ที่ยังคงใช้ชื่อบัญชีเดิมเป็นชื่อผู้รับ
  // (ที่อยู่ที่ผู้ใช้กำหนดชื่อเป็นบุคคลอื่นไว้จะไม่ถูกแตะต้อง)
  const updateRecipientNames = useCallback(async (previousName, newName) => {
    if (bulkUpdatingRef.current) return;
    const targets = addresses.filter((a) => a.recipient_name === previousName);
    if (!targets.length) return;
    bulkUpdatingRef.current = true;
    setAddressesError("");
    try {
      await Promise.all(targets.map((a) => addressAPI.update(a.id, { recipient_name: newName })));
      await loadAddresses();
      showToast("อัปเดตชื่อผู้รับในที่อยู่จัดส่งเรียบร้อยแล้ว", "success");
    } catch (err) {
      setAddressesError(err.message || "ไม่สามารถอัปเดตชื่อผู้รับในที่อยู่จัดส่งได้ กรุณาลองอีกครั้ง");
      throw err;
    } finally {
      bulkUpdatingRef.current = false;
    }
  }, [addresses, loadAddresses]);

  const handleProfileSaved = useCallback((updatedUser) => {
    const previousName = prevAccountNameRef.current;
    const newName = (updatedUser?.name || "").trim();
    if (!newName || newName === previousName) return;
    const hasMatching = addresses.some((a) => a.recipient_name === previousName);
    if (!hasMatching) {
      prevAccountNameRef.current = newName;
      return;
    }
    const confirmed = window.confirm(
      `ชื่อบัญชีเปลี่ยนเป็น "${newName}" แล้ว\n\nต้องการเปลี่ยนชื่อผู้รับในที่อยู่จัดส่งที่บันทึกไว้ให้เป็นชื่อใหม่ ("${newName}") หรือไม่?\n\nที่อยู่ที่เคยกำหนดชื่อผู้รับเป็นชื่ออื่นแล้วจะไม่ถูกเปลี่ยน`
    );
    if (!confirmed) {
      prevAccountNameRef.current = newName;
      return;
    }
    updateRecipientNames(previousName, newName).then(() => {
      prevAccountNameRef.current = newName;
    }).catch(() => {
      prevAccountNameRef.current = newName;
    });
  }, [addresses, updateRecipientNames]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setIsMenuOpen(false);
      }
    };

    const handleEscape = (event) => {
      if (event.key === "Escape") {
        setIsMenuOpen(false);
      }
    };

    if (isMenuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleEscape);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isMenuOpen]);

  const closeMenu = () => setIsMenuOpen(false);

  const handleMenuItemClick = (action) => {
    closeMenu();
    switch (action) {
      case "settings":
        handleOpenModal("settings");
        break;
      case "profile":
        handleOpenModal("edit-profile");
        break;
      case "address":
        handleOpenModal("addresses");
        break;
      case "security":
        handleOpenModal("security");
        break;
      case "wallet":
        // Scroll to My Wallet section
        const walletSection = document.getElementById("my-wallet-section");
        if (walletSection) {
          walletSection.scrollIntoView({ behavior: "smooth", block: "start" });
          // Highlight briefly
          walletSection.style.transition = "box-shadow 0.3s ease, background 0.3s ease";
          walletSection.style.boxShadow = "0 0 0 3px var(--acct-orange)";
          walletSection.style.background = "var(--acct-orange-soft)";
          setTimeout(() => {
            walletSection.style.boxShadow = "";
            walletSection.style.background = "";
          }, 1500);
        }
        break;
      case "orders":
        handleOpenModal("orders-all");
        break;
      case "logout":
        handleLogout();
        break;
      default:
        break;
    }
  };

  const handleLogout = async () => {
    await logout("customer");
    navigate("/");
  };

  const handleLockedAction = () => {
    if (!isLoggedIn) navigate("/login");
  };

  const renderTile = ({ key, label, Icon, badge }) => (
    <button
      key={key}
      type="button"
      className="acct-tile"
      onClick={() => {
        if (!isLoggedIn) {
          navigate("/login");
          return;
        }
        if (key === "topay") handleOpenModal("orders-topay");
        else if (key === "toreceive") handleOpenModal("orders-toreceive");
        else if (key === "toship") handleOpenModal("orders-toship");
        else if (key === "toreview") { const deliveredIds = orders.filter((order) => matchesOrderFilter(order, "toreview")).map((order) => order?.id).filter(Boolean); markDeliveredOrdersRead(user?.id, deliveredIds); setReadDeliveredIds(getReadDeliveredOrderIds(user?.id)); handleOpenModal("orders-toreview"); }
      }}
    >
      <span className="acct-tile-icon">
        <Icon />
        {badge > 0 && <span className="acct-tile-badge">{badge}</span>}
      </span>
      <span className="acct-tile-label">{label}</span>
    </button>
  );

  const renderRowItem = ({ key, label, Icon }) => (
    <button
      key={key}
      type="button"
      className="acct-row-item"
      onClick={() => {
        if (!isLoggedIn) {
          navigate("/login");
          return;
        }
        if (key === "balance") handleOpenModal("wallet-balance");
        else if (key === "coins") handleOpenModal("wallet-coins");
        else if (key === "voucher") handleOpenModal("wallet-voucher");
        else if (key === "mee-card") handleOpenModal("mee-card-registration");
        else if (key === "cards") handleOpenModal("finance-cards");
        else if (key === "bank") handleOpenModal("finance-bank");
        else if (key === "history") handleOpenModal("finance-history");
      }}
    >
      <span className="acct-row-item-icon">
        <Icon />
      </span>
      <span className="acct-row-item-label">{label}</span>
      <span className="acct-row-item-chevron">
        <ChevronRightIcon />
      </span>
    </button>
  );

return (
    <div className="page acct-page">
      <section className="acct-hero" style={{ position: "relative" }}>
        <div className="acct-hero-inner">
          <div className="acct-profile">
            <div className="acct-avatar">
              {isLoggedIn ? (
                user?.avatar_url ? (
                  <img
                    src={user.avatar_url}
                    alt="โปรไฟล์"
                    className="acct-avatar-img"
                    onError={(e) => {
                      e.target.style.display = "none";
                    }}
                  />
                ) : (
                  <span>{user?.name?.charAt(0)?.toUpperCase() || <UserIcon size={30} />}</span>
                )
              ) : (
                <UserIcon size={34} />
              )}
            </div>
            <div className="acct-profile-text">
              {isLoggedIn ? (
                <>
                  <h1 className="acct-name">{user?.name || "ไม่ระบุชื่อ"}</h1>
                  <p className="acct-sub">{user?.email || "ไม่ระบุอีเมล"}</p>
                  <span className="acct-role">{ROLE_LABELS[user?.role] || "สมาชิก"}</span>
                </>
              ) : (
                <>
                  <h1 className="acct-name">ยินดีต้อนรับ</h1>
                  <p className="acct-sub">เข้าสู่ระบบเพื่อจัดการคำสั่งซื้อและบัญชีของคุณ</p>
                </>
              )}
            </div>
          </div>

          {isLoggedIn && (
            <div
              className="acct-menu-wrapper"
              style={{ position: "absolute", top: "16px", right: "16px", zIndex: "20" }}
              ref={menuRef}
            >
              <button
                type="button"
                className="acct-menu-btn"
                onClick={() => setIsMenuOpen(!isMenuOpen)}
                aria-expanded={isMenuOpen}
                aria-haspopup="true"
                aria-label="菜单设置账户"
              >
                <ThreeDotsIcon size={22} />
              </button>

              {isMenuOpen && (
                <div
                  className="acct-dropdown-menu"
                  style={{ position: "absolute", top: "100%", right: "0", marginTop: "8px", zIndex: "30" }}
                  role="menu"
                >
                  <button
                    type="button"
                    className="acct-dropdown-item"
                    role="menuitem"
                    onClick={() => handleMenuItemClick("settings")}
                  >
                    <span className="acct-dropdown-icon">
                      <SettingsIcon />
                    </span>
                    ตั้งค่าบัญชี
                  </button>
<button
                     type="button"
                     className="acct-dropdown-item"
                     role="menuitem"
                     onClick={() => handleMenuItemClick("profile")}
                   >
                     <span className="acct-dropdown-icon">
                       <EditProfileIcon />
                     </span>
                     แก้ไขข้อมูลส่วนตัว
                   </button>
                   <button
                     type="button"
                     className="acct-dropdown-item"
                     role="menuitem"
                     onClick={() => handleMenuItemClick("address")}
                   >
                     <span className="acct-dropdown-icon">
                       <AddressIcon />
                     </span>
                     จัดการที่อยู่จัดส่ง
                   </button>
                  <button
                    type="button"
                    className="acct-dropdown-item"
                    role="menuitem"
                    onClick={() => handleMenuItemClick("security")}
                  >
                    <span className="acct-dropdown-icon">
                      <SecurityIcon />
                    </span>
                    ความปลอดภัย / บัญชีที่เชื่อมต่อ
                  </button>
                  <button
                    type="button"
                    className="acct-dropdown-item"
                    role="menuitem"
                    onClick={() => handleMenuItemClick("wallet")}
                  >
                    <span className="acct-dropdown-icon">
                      <WalletIcon />
                    </span>
                    กระเป๋าเงิน
                  </button>
                  <button
                    type="button"
                    className="acct-dropdown-item"
                    role="menuitem"
                    onClick={() => handleMenuItemClick("orders")}
                  >
                    <span className="acct-dropdown-icon">
                      <BoxIcon />
                    </span>
                    รายการซื้อ
                  </button>
                  <hr className="acct-dropdown-divider" />
                  <button
                    type="button"
                    className="acct-dropdown-item acct-dropdown-item-danger"
                    role="menuitem"
                    onClick={() => handleMenuItemClick("logout")}
                  >
                    <span className="acct-dropdown-icon">
                      {LOGOUT_ICON}
                    </span>
                    ออกจากระบบ
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      <section className="acct-card">
        <header className="acct-card-head">
          <h2 className="acct-card-title">การซื้อของฉัน</h2>
          <button type="button" className="acct-link-more" onClick={() => (isLoggedIn ? handleOpenModal("orders-all") : navigate("/login"))}>
            ดูทั้งหมด
            <ChevronRightIcon />
          </button>
        </header>
        <div className="acct-tiles">{PURCHASE_TILES.map(renderTile)}</div>
      </section>

      <div className="acct-two-col">
        <section className="acct-card" id="my-wallet-section">
          <header className="acct-card-head">
            <h2 className="acct-card-title">
              <span className="acct-title-icon"><WalletIcon /></span>
              My Wallet
            </h2>
          </header>
          <div className="acct-wallet-balance">
            {walletLoading ? (
              <span className="acct-wallet-amount">โหลด중...</span>
            ) : walletError ? (
              <span className="acct-wallet-amount" style={{ color: "var(--error)" }}>{walletError}</span>
            ) : (
              <span className="acct-wallet-amount">{formatCurrency(walletBalance)}</span>
            )}
            <span className="acct-wallet-caption">ยอดเงินคงเหลือในกระเป๋าเงิน</span>
          </div>
          <div className="acct-row-list">{WALLET_ITEMS.map(renderRowItem)}</div>
        </section>

        <section className="acct-card">
          <header className="acct-card-head">
            <h2 className="acct-card-title">
              <span className="acct-title-icon"><CardIcon /></span>
              บริการทางการเงิน
            </h2>
          </header>
          <div className="acct-row-list">{FINANCE_ITEMS.map(renderRowItem)}</div>
        </section>
      </div>

      {activeModal && (
        <div className="modal-backdrop" onClick={handleCloseModal}>
          <div className="modal-container" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="modal-close" onClick={handleCloseModal} aria-label="ปิด">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 6 6 18" />
                <path d="m6 6 12 12" />
              </svg>
            </button>
            <div className="modal-body">
              {activeModal === "settings" && (
                <div>
                  <h3>ตั้งค่าบัญชี</h3>
                  <p>ตัวเลือกการจัดการบัญชีของคุณ</p>
                </div>
              )}
              {activeModal === "edit-profile" && (
                <EditProfileModal user={user} onClose={handleCloseModal} onSaved={handleProfileSaved} />
              )}
              {activeModal === "addresses" && (
                <div>
                  <h3>จัดการที่อยู่จัดส่ง</h3>
                  {addressesLoading ? (
                    <p>กำลังโหลดที่อยู่...</p>
                  ) : (
                    <>
                      {addressesError && <p className="form-hint-error">{addressesError}</p>}
                      {addressFormOpen ? (
                        <form className="modal-form" onSubmit={handleAddressSubmit}>
                          <div className="form-group">
                            <label className="form-label" htmlFor="address-label">ชื่อที่อยู่ *</label>
                            <input
                              id="address-label"
                              type="text"
                              className="form-input"
                              value={addressForm.label}
                              onChange={(event) => handleAddressFieldChange("label", event.target.value)}
                              placeholder="เช่น บ้าน ที่ทำงาน"
                              maxLength={50}
                            />
                          </div>
                          <div className="form-row">
                            <div className="form-group">
                              <label className="form-label" htmlFor="address-recipient">ชื่อผู้รับ *</label>
                              <input
                                id="address-recipient"
                                type="text"
                                className="form-input"
                                value={addressForm.recipient_name}
                                onChange={(event) => handleAddressFieldChange("recipient_name", event.target.value)}
                                maxLength={120}
                              />
                            </div>
                            <div className="form-group">
                              <label className="form-label" htmlFor="address-phone">เบอร์โทรศัพท์ *</label>
                              <PhoneInput
                                id="address-phone"
                                value={addressForm.phone}
                                onChange={(e164) => handleAddressFieldChange("phone", e164)}
                                required
                                placeholder="08X-XXX-XXXX"
                                label="เบอร์โทรศัพท์ *"
                              />
                            </div>
                          </div>
                          <div className="form-group">
                            <label className="form-label" htmlFor="address-street">ที่อยู่/ถนน/ซอย *</label>
                            <input
                              id="address-street"
                              type="text"
                              className="form-input"
                              value={addressForm.street}
                              onChange={(event) => handleAddressFieldChange("street", event.target.value)}
                              maxLength={500}
                            />
                          </div>
                          <div className="form-row">
                            <div className="form-group">
                              <label className="form-label" htmlFor="address-subdistrict">ตำบล/แขวง *</label>
                              <input
                                id="address-subdistrict"
                                type="text"
                                className="form-input"
                                value={addressForm.subdistrict}
                                onChange={(event) => handleAddressFieldChange("subdistrict", event.target.value)}
                                maxLength={120}
                              />
                            </div>
                            <div className="form-group">
                              <label className="form-label" htmlFor="address-district">อำเภอ/เขต/เมือง *</label>
                              <input
                                id="address-district"
                                type="text"
                                className="form-input"
                                value={addressForm.district}
                                onChange={(event) => handleAddressFieldChange("district", event.target.value)}
                                maxLength={120}
                              />
                            </div>
                          </div>
                          <div className="form-row">
                            <div className="form-group">
                              <label className="form-label" htmlFor="address-province">จังหวัด/รัฐ *</label>
                              <input
                                id="address-province"
                                type="text"
                                className="form-input"
                                value={addressForm.province}
                                onChange={(event) => handleAddressFieldChange("province", event.target.value)}
                                maxLength={120}
                              />
                            </div>
                            <div className="form-group">
                              <label className="form-label" htmlFor="address-country">ประเทศ</label>
                              <select
                                id="address-country"
                                className="form-input"
                                value={addressForm.country}
                                onChange={(event) => handleAddressFieldChange("country", event.target.value)}
                              >
                                <option value="TH">🇹🇭 ประเทศไทย</option>
                                <option value="MM">🇲🇲 เมียนมา</option>
                              </select>
                            </div>
                          </div>
                          <div className="form-group">
                            <label className="form-label" htmlFor="address-postal">รหัสไปรษณีย์ *</label>
                            <input
                              id="address-postal"
                              type="text"
                              className="form-input"
                              value={addressForm.postal_code}
                              onChange={(event) => handleAddressFieldChange("postal_code", event.target.value)}
                              inputMode="numeric"
                              maxLength={5}
                            />
                          </div>
                          <div className="form-group">
                            <label className="form-label" htmlFor="address-additional">รายละเอียดเพิ่มเติมสำหรับผู้จัดส่ง</label>
                            <textarea
                              id="address-additional"
                              className="form-input"
                              value={addressForm.additional_details}
                              onChange={(event) => handleAddressFieldChange("additional_details", event.target.value)}
                              rows={3}
                              placeholder="เช่น โทรสั่งก่อนส่ง ส่งที่櫃台รับฝาก ฯลฯ"
                              maxLength={500}
                            />
                          </div>
                          <div className="form-group">
                            <label className="form-label">พิกัดจัดส่งบนแผนที่</label>
                            <StoreLocationMap
                              value={addressForm.coordinates}
                              onChange={(coordinates) => handleAddressFieldChange("coordinates", coordinates)}
                              markerLabel="ตำแหน่งจัดส่ง"
                              hint="คลิกบนแผนที่เพื่อปักหมุด หรือลากหมุดไปยังตำแหน่งจัดส่งจริง"
                              height={220}
                            />
                          </div>
                          <label className="address-default-toggle">
                            <input
                              type="checkbox"
                              checked={addressForm.is_default}
                              onChange={(event) => handleAddressFieldChange("is_default", event.target.checked)}
                            />
                            ตั้งเป็นที่อยู่หลัก
                          </label>
                          {addressFormError && <p className="form-hint-error">{addressFormError}</p>}
                          <div className="form-actions">
                            <button
                              type="button"
                              className="btn-outline"
                              onClick={() => {
                                setAddressFormOpen(false);
                                setAddressFormError("");
                              }}
                            >
                              ยกเลิก
                            </button>
                            <button type="submit" className="btn" disabled={addressSaving}>
                              {addressSaving ? "กำลังบันทึก..." : "บันทึกที่อยู่"}
                            </button>
                          </div>
                        </form>
                      ) : (
                        <div className="address-book">
                          {addresses.length === 0 ? (
                            <p>ยังไม่มีที่อยู่ที่บันทึกไว้</p>
                          ) : (
                            <div className="address-list">
                              {addresses.map((address) => {
                                const lines = addressLines(address);
                                const busy = addressActionId === address.id;
                                return (
                                  <article
                                    className={`address-card ${address.is_default ? "is-default" : ""}`}
                                    key={address.id}
                                  >
                                    <div className="address-card-head">
                                      <div>
                                        <h4>{address.label || "ที่อยู่"}</h4>
                                        {address.is_default && <span className="address-default-badge">ที่อยู่หลัก</span>}
                                      </div>
                                      <div className="address-card-actions">
                                        <button
                                          type="button"
                                          className="address-action"
                                          onClick={() => openAddressForm(address)}
                                          disabled={busy}
                                        >
                                          แก้ไข
                                        </button>
                                        {!address.is_default && (
                                          <button
                                            type="button"
                                            className="address-action"
                                            onClick={() => handleSetDefaultAddress(address)}
                                            disabled={busy}
                                          >
                                            ตั้งเป็นหลัก
                                          </button>
                                        )}
                                        <button
                                          type="button"
                                          className="address-action address-action-danger"
                                          onClick={() => handleDeleteAddress(address)}
                                          disabled={busy}
                                        >
                                          ลบ
                                        </button>
                                      </div>
                                    </div>
                                    <p className="address-recipient">
                                      <strong>{address.recipient_name}</strong>
                                      <span> · {formatThaiPhone(address.phone)}</span>
                                    </p>
                                    {lines.length > 0 && <p>{lines.join(" ")}</p>}
                                    {hasValidCoordinates(address) && (
                                      <p className="coordinates">
                                        พิกัด: {Number(address.lat).toFixed(6)}, {Number(address.lng).toFixed(6)}
                                      </p>
                                    )}
                                  </article>
                                );
                              })}
                            </div>
                          )}
                          <button type="button" className="btn address-add-btn" onClick={() => openAddressForm()}>
                            เพิ่มที่อยู่ใหม่
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
              {activeModal === "security" && (
                <SecurityModal
                  user={user}
                  sessions={sessions}
                  sessionsLoading={sessionsLoading}
                  sessionsError={sessionsError}
                  loginHistory={loginHistory}
                  historyLoading={historyLoading}
                  historyError={historyError}
                  securityAlerts={securityAlerts}
                  alertsLoading={alertsLoading}
                  alertsError={alertsError}
                  connectedAccounts={connectedAccounts}
                  accountsLoading={accountsLoading}
                  accountsError={accountsError}
                  cpForm={cpForm}
                  setCpForm={setCpForm}
                  cpError={cpError}
                  cpSuccess={cpSuccess}
                  cpSaving={cpSaving}
                  onChangePassword={handleChangePassword}
                  onRevokeSession={handleRevokeSession}
                  onLogoutAllDevices={handleLogoutAllDevices}
                  logoutAllLoading={logoutAllLoading}
                  onUnlinkSocial={handleUnlinkSocial}
                  onMarkAlertRead={handleMarkAlertRead}
                  securityActionId={securityActionId}
                  securityTab={securityTab}
                  setSecurityTab={setSecurityTab}
                />
              )}
              {activeModal === "orders-all" && (
                <OrderListModal orders={orders} filter="all" onClose={handleCloseModal} />
              )}
              {activeModal === "orders-topay" && (
                <OrderListModal
                  orders={orders}
                  filter="topay"
                  onClose={handleCloseModal}
                  payableOrders={payableOrders}
                  onPay={handlePay}
                />
              )}
              {activeModal === "orders-toreceive" && (
                <OrderListModal orders={orders} filter="toreceive" onClose={handleCloseModal} />
              )}
              {activeModal === "orders-toship" && (
                <OrderListModal orders={orders} filter="toship" onClose={handleCloseModal} />
              )}
              {activeModal === "orders-toreview" && (
                <OrderListModal orders={orders} filter="toreview" onClose={handleCloseModal} />
              )}
              {activeModal === "wallet-balance" && (
                <WalletBalanceModal
                  balance={walletBalance}
                  coins={walletCoins}
                  loading={walletLoading}
                  error={walletError}
                  onClose={handleCloseModal}
                  walletSettings={walletSettings}
                />
              )}
              {activeModal === "wallet-coins" && (
                <WalletCoinsModal
                  coins={walletCoins}
                  loading={walletLoading}
                  error={walletError}
                  onClose={handleCloseModal}
                />
              )}
              {activeModal === "wallet-voucher" && (
                <WalletVoucherModal
                  vouchers={walletVouchers}
                  loading={walletLoading}
                  error={walletError}
                  onClose={handleCloseModal}
                />
              )}
              {activeModal === "mee-card-registration" && (
                <MeeCardRegistrationModal
                  registration={meeCardRegistration}
                  loading={meeCardLoading}
                  error={meeCardError}
                  onClose={handleCloseModal}
                  onSubmit={handleMeeCardSubmit}
                  formData={meeCardForm}
                  onFieldChange={handleMeeCardFieldChange}
                  submitting={meeCardLoading}
                  success={meeCardSuccess}
                  formError={meeCardError}
                />
              )}
              {activeModal === "finance-cards" && (
                <FinanceCardsModal
                  cards={cards}
                  loading={financeLoading}
                  error={financeError}
                  onClose={handleCloseModal}
                  onAddCard={() => handleOpenModal("finance-add-card")}
                  onEditCard={(card) => handleOpenModal("finance-edit-card", card)}
                  onDeleteCard={(cardId) => handleDeleteCard(cardId)}
                />
              )}
              {activeModal === "finance-bank" && (
                <FinanceBankModal
                  bankAccounts={bankAccounts}
                  loading={financeLoading}
                  error={financeError}
                  onClose={handleCloseModal}
                  onAddBankAccount={() => handleOpenModal("finance-add-bank")}
                  onEditBankAccount={(account) => handleOpenModal("finance-edit-bank", account)}
                  onDeleteBankAccount={(accountId) => handleDeleteBankAccount(accountId)}
                  onVerifyBankAccount={(accountId) => handleVerifyBankAccount(accountId)}
                />
              )}
              {activeModal === "finance-history" && (
                <FinanceHistoryModal
                  history={financeHistory}
                  loading={financeLoading}
                  error={financeError}
                  onClose={handleCloseModal}
                />
              )}
            </div>
          </div>
        </div>
      )}
      {payModalOpen && (
        <KBZPayPaymentPopup
          open={payModalOpen}
          onClose={() => setPayModalOpen(false)}
          orders={payPopupOrders}
          ordersLoading={ordersLoading}
          kbzpaySettings={kbzpaySettingsByStore}
          onSubmitted={() => { loadOrders(); }}
        />
      )}
    </div>
  );
}




