import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { addressAPI, orderAPI } from "../api";
import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { extractList, formatThaiPhone, validateThaiPhone, formatCurrency, formatDate } from "../utils/helpers";
import { countOrdersByFilter, matchesOrderFilter, ORDER_FILTERS, orderStatusLabel, paymentStatusLabel } from "../utils/orderFilters";
import { getPendingPaymentOrders } from "../utils/pendingPayments";
import StoreLocationMap from "../components/StoreLocationMap";
import OrderPaymentModal from "../components/OrderPaymentModal";
import KBZPayPaymentPopup from "../components/KBZPayPaymentPopup";

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

const EMPTY_ADDRESS_FORM = {
  label: "",
  recipient_name: "",
  phone: "",
  street: "",
  district: "",
  province: "",
  postal_code: "",
  coordinates: null,
  is_default: false,
};

const addressToForm = (address) => ({
  label: address?.label || "",
  recipient_name: address?.recipient_name || "",
  phone: address?.phone || "",
  street: address?.street || "",
  district: address?.district || "",
  province: address?.province || "",
  postal_code: address?.postal_code || "",
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
  [address?.street, address?.district, address?.province, address?.postal_code]
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
  { key: "toreceive", label: "ที่ต้องจัดส่ง", Icon: BoxIcon, badge: 0 },
  { key: "toship", label: "ที่ต้องได้รับ", Icon: TruckIcon, badge: 0 },
  { key: "toreview", label: "ให้คะแนน", Icon: StarIcon, badge: 0 },
];

const WALLET_ITEMS = [
  { key: "balance", label: "ยอดเงินคงเหลือ", Icon: WalletIcon },
  { key: "coins", label: "เหรียญโบนัส", Icon: StarIcon },
  { key: "voucher", label: "คูปองของฉัน", Icon: ReceiptIcon },
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
    if (!filter || filter === "all") return orders;
    return orders.filter((order) => matchesOrderFilter(order, filter));
  }, [orders, filter]);

  const getFilterLabel = (key) => {
    const f = ORDER_FILTERS.find((fl) => fl.key === key);
    return f?.label || key;
  };

  const getOrderCurrency = (order) => {
    if (order.payment_method === "kbzpay" && order.amount_mmk) {
      return "MMK";
    }
    return "THB";
  };

  const pendingOrders = useMemo(() => {
    return filteredOrders.filter(
      (order) => order.payment_status === "pending" && order.status !== "cancelled"
    );
  }, [filteredOrders]);

  const currencyGroups = useMemo(() => {
    const groups = {};
    pendingOrders.forEach((order) => {
      const currency = getOrderCurrency(order);
      if (!groups[currency]) {
        groups[currency] = { orders: [], total: 0 };
      }
      groups[currency].orders.push(order);
      groups[currency].total += Number(order.total_amount || 0);
    });
    return groups;
  }, [pendingOrders]);

  const showSummary = Object.keys(currencyGroups).length > 0;

  if (filteredOrders.length === 0) {
    return (
      <div className="modal-order-list-empty">
        <p>ไม่พบคำสั่งซื้อในหมวด "{getFilterLabel(filter)}"</p>
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
            {(order.store_orders || []).map((storeOrder) => (
              <div className="modal-order-store" key={storeOrder.id}>
                <span className="modal-order-store-name">
                  {storeOrder.store_snapshot?.name || storeOrder.store?.name || "ร้านค้า"}
                </span>
                <span className="modal-order-store-total">{formatCurrency(storeOrder.total_amount)}</span>
                <span className={`modal-store-status status-${storeOrder.status}`}>
                  {orderStatusLabel(storeOrder.status)}
                </span>
              </div>
            ))}
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
                {paymentStatusLabel(order.payment_status)}
              </span>
            </div>
            <div className="modal-order-total">
              <span>รวมทั้งสิ้น</span>
              <strong>{formatCurrency(order.total_amount)}</strong>
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
                {group.orders.map((order) => (
                  <div key={order.id} className="modal-summary-order-line">
                    <span>#{order.order_number}</span>
                    <span>{formatCurrency(order.total_amount, currency)}</span>
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

export default function Account() {
  const { customer, logout } = useAuth();
  const user = customer?.user;
  const navigate = useNavigate();
  const isLoggedIn = Boolean(user);

  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuRef = useRef(null);
  const [activeModal, setActiveModal] = useState(null);
  const [payModalOpen, setPayModalOpen] = useState(false);
  const [payPopupOrders, setPayPopupOrders] = useState([]);

  const [orders, setOrders] = useState([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [ordersError, setOrdersError] = useState("");
  const [addresses, setAddresses] = useState([]);
  const [addressesLoading, setAddressesLoading] = useState(false);
  const [addressesError, setAddressesError] = useState("");
  const [addressFormOpen, setAddressFormOpen] = useState(false);
  const [editingAddressId, setEditingAddressId] = useState(null);
  const [addressForm, setAddressForm] = useState(EMPTY_ADDRESS_FORM);
  const [addressFormError, setAddressFormError] = useState("");
  const [addressSaving, setAddressSaving] = useState(false);
  const [addressActionId, setAddressActionId] = useState(null);
  const [walletBalance, setWalletBalance] = useState(0);
  const [walletCoins, setWalletCoins] = useState(0);
  const [walletVouchers, setWalletVouchers] = useState([]);
  const [cards, setCards] = useState([]);
  const [bankAccounts, setBankAccounts] = useState([]);
  const [financeHistory, setFinanceHistory] = useState([]);

  const purchaseTileBadges = useMemo(() => countOrdersByFilter(orders), [orders]);

  // Every unpaid order of the current customer, regardless of the active
  // order-list filter, so the payment popup can summarise all of them.
  const payableOrders = useMemo(() => getPendingPaymentOrders(orders), [orders]);

  const PURCHASE_TILES = useMemo(() => [
    { key: "topay", label: "ที่ต้องชำระ", Icon: WalletPayIcon, badge: purchaseTileBadges.topay || 0 },
    { key: "toreceive", label: "ที่ต้องจัดส่ง", Icon: BoxIcon, badge: purchaseTileBadges.toreceive || 0 },
    { key: "toship", label: "ที่ต้องได้รับ", Icon: TruckIcon, badge: purchaseTileBadges.toship || 0 },
    { key: "toreview", label: "ให้คะแนน", Icon: StarIcon, badge: purchaseTileBadges.toreview || 0 },
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
    }
  }, [isLoggedIn]);

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
    try {
      const result = await orderAPI.getWallet ? await orderAPI.getWallet() : null;
      const data = result?.data || result || {};
      setWalletBalance(data.balance ?? 0);
      setWalletCoins(data.coins ?? 0);
      setWalletVouchers(Array.isArray(data.vouchers) ? data.vouchers : []);
    } catch {
      // silent
    }
  }, [isLoggedIn]);

  const loadFinance = useCallback(async () => {
    if (!isLoggedIn) return;
    try {
      const result = await orderAPI.getFinance ? await orderAPI.getFinance() : null;
      const data = result?.data || result || {};
      setCards(Array.isArray(data.cards) ? data.cards : []);
      setBankAccounts(Array.isArray(data.banks) ? data.banks : []);
      setFinanceHistory(Array.isArray(data.history) ? data.history : []);
    } catch {
      // silent
    }
  }, [isLoggedIn]);

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
    if (activeModal === "finance-cards" || activeModal === "finance-bank" || activeModal === "finance-history") {
      loadFinance();
    }
  }, [activeModal, loadOrders, loadAddresses, loadWallet, loadFinance]);

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

  const handlePay = (orders) => {
    setPayPopupOrders(Array.isArray(orders) ? orders : []);
    setPayModalOpen(true);
  };

  const openAddressForm = (address = null) => {
    setEditingAddressId(address?.id || null);
    setAddressForm(addressToForm(address));
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
    if (!validateThaiPhone(addressForm.phone)) {
      setAddressFormError("กรุณากรอกเบอร์โทรศัพท์ให้ถูกต้อง");
      return;
    }
    if (!addressForm.street.trim() || !addressForm.district.trim() || !addressForm.province.trim()) {
      setAddressFormError("กรุณากรอกที่อยู่ ตำบล/แขวง และจังหวัด");
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
      district: addressForm.district.trim(),
      province: addressForm.province.trim(),
      postal_code: addressForm.postal_code.trim(),
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
        handleOpenModal("profile");
        break;
      case "address":
        handleOpenModal("addresses");
        break;
      case "security":
        handleOpenModal("security");
        break;
      case "wallet":
        handleOpenModal("wallet");
        break;
      case "orders":
        handleOpenModal("orders");
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
        else if (key === "toreview") handleOpenModal("orders-toreview");
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
                <span>{user?.name?.charAt(0)?.toUpperCase() || <UserIcon size={30} />}</span>
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
        <section className="acct-card">
          <header className="acct-card-head">
            <h2 className="acct-card-title">
              <span className="acct-title-icon"><WalletIcon /></span>
              My Wallet
            </h2>
          </header>
          <div className="acct-wallet-balance">
            <span className="acct-wallet-amount">฿0.00</span>
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
                <div>
                  <h3>แก้ไขข้อมูลส่วนตัว</h3>
                  <form className="modal-form">
                    <div className="form-group">
                      <label className="form-label">ชื่อ</label>
                      <input type="text" className="form-input" defaultValue={user?.name || ""} />
                    </div>
                    <div className="form-group">
                      <label className="form-label">เบอร์||(number)</label>
                      <input type="tel" className="form-input" defaultValue={user?.phone || ""} />
                    </div>
                    <div className="form-actions">
                      <button type="button" className="btn-outline" onClick={handleCloseModal}>Cancel</button>
                      <button type="button" className="btn">Save</button>
                    </div>
                  </form>
                </div>
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
                              <input
                                id="address-phone"
                                type="tel"
                                className="form-input"
                                value={addressForm.phone}
                                onChange={(event) => handleAddressFieldChange("phone", event.target.value)}
                                placeholder="08X-XXX-XXXX"
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
                              <label className="form-label" htmlFor="address-district">ตำบล/แขวง *</label>
                              <input
                                id="address-district"
                                type="text"
                                className="form-input"
                                value={addressForm.district}
                                onChange={(event) => handleAddressFieldChange("district", event.target.value)}
                              />
                            </div>
                            <div className="form-group">
                              <label className="form-label" htmlFor="address-province">จังหวัด *</label>
                              <input
                                id="address-province"
                                type="text"
                                className="form-input"
                                value={addressForm.province}
                                onChange={(event) => handleAddressFieldChange("province", event.target.value)}
                              />
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
                <div>
                  <h3>ความปลอดภัย / บัญชีที่เชื่อมต่อ</h3>
                  <p>จัดการความปลอดภัยและบัญชีที่เชื่อมต่อ</p>
                </div>
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
              {["wallet-balance", "wallet-coins", "wallet-voucher"].includes(activeModal) && (
                <div>
                  <h3>My Wallet</h3>
                  <p>ข้อมูลwallet</p>
                </div>
              )}
              {["finance-cards", "finance-bank", "finance-history"].includes(activeModal) && (
                <div>
                  <h3>บริการทางการเงิน</h3>
                  <p>ข้อมูลการเงิน</p>
                </div>
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
        />
      )}
    </div>
  );
}