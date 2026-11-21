import { useState, useEffect } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { useCart } from "../context/CartContext";
import CheckoutModal from "../components/CheckoutModal";
import { settingsAPI, storeAPI } from "../api";
import { formatCurrency } from "../utils/helpers";

const ChevronLeftIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m15 18-6-6 6-6" />
  </svg>
);

function useBackNavigation() {
  const navigate = useNavigate();
  const location = useLocation();

  const handleBack = () => {
    const from = location.state?.from;
    if (from) {
      navigate(from);
    } else if (window.history.length > 1) {
      navigate(-1);
    } else {
      navigate("/");
    }
  };

  return handleBack;
}

// Mirrors backend buildOrderPlan and Checkout.jsx#computeOrderTotals so the
// cart's THB total is identical to the total Checkout confirms before creating
// an order: per-store subtotal, VAT rounded per store, delivery fee per store
// (always charged, matching store_orders.shipping_fee), then rounded grand total.
const roundMoney = (value) => {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return 0;
  return Math.round((amount + Number.EPSILON) * 100) / 100;
};

const getStoreField = (store, camelKey, snakeKey) =>
  store[camelKey] !== undefined ? store[camelKey] : store[snakeKey];

export default function Cart() {
  const { items, updateQuantity, removeItem, clear, totalCount, totalPrice } = useCart();
  const handleBack = useBackNavigation();
  const navigate = useNavigate();

  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [vatRate, setVatRate] = useState(7);
  const [vatLoading, setVatLoading] = useState(true);
  const [stores, setStores] = useState([]);
  const [storesLoading, setStoresLoading] = useState(false);
  const handleCheckout = () => {
    setCheckoutOpen(true);
  };

  useEffect(() => {
    const loadVatRate = async () => {
      try {
        const res = await settingsAPI.getByKey("vat_rate");
        const rate = res?.data?.value != null ? Number(res.data.value) : 7;
        setVatRate(Number.isFinite(rate) && rate >= 0 && rate <= 100 ? rate : 7);
      } catch {
        setVatRate(7);
      } finally {
        setVatLoading(false);
      }
    };
    loadVatRate();
  }, []);

  // Load store info (delivery_fee / minimum_order) for every store in the cart
  // so shipping is calculated from real store settings, never hardcoded.
  useEffect(() => {
    const loadStoreInfo = async () => {
      const storeIds = [...new Set(items.map((item) => item.storeId).filter(Boolean))];
      setStoresLoading(true);
      const nextStores = [];
      for (const storeId of storeIds) {
        try {
          const store = await storeAPI.getById(storeId);
          nextStores.push(store.data);
        } catch (error) {
          console.error("Failed to load store:", error);
        }
      }
      setStores(nextStores);
      setStoresLoading(false);
    };
    loadStoreInfo();
  }, [items]);

  const computeOrderTotals = (discountAmount = 0) => {
    let totalSubtotal = 0;
    let totalShippingFee = 0;
    let totalTax = 0;

    stores.forEach((store) => {
      const storeItems = items.filter((item) => item.storeId === store.id);
      const storeSubtotal = roundMoney(
        storeItems.reduce((sum, item) => sum + item.price * item.quantity, 0)
      );
      const shippingFee = roundMoney(getStoreField(store, "deliveryFee", "delivery_fee") || 0);
      const taxAmount = roundMoney(storeSubtotal * (vatRate / 100));

      totalSubtotal = roundMoney(totalSubtotal + storeSubtotal);
      totalShippingFee = roundMoney(totalShippingFee + shippingFee);
      totalTax = roundMoney(totalTax + taxAmount);
    });

    return {
      totalSubtotal,
      totalShippingFee,
      totalTax,
      totalAmount: roundMoney(totalSubtotal + totalShippingFee + totalTax - discountAmount),
    };
  };

  const orderSummary = computeOrderTotals();
  const { totalShippingFee: shippingFee, totalTax: taxAmount, totalAmount } =
    orderSummary;

  if (items.length === 0) {
    return (
      <div className="cart-page">
        <div className="cart-header">
          <button type="button" className="cart-back" onClick={handleBack} aria-label="ย้อนกลับ">
            <ChevronLeftIcon />
          </button>
          <h1 className="cart-title">รถเข็นของฉัน</h1>
        </div>
        <div className="cart-empty">
          <p>ยังไม่มีสินค้าในรถเข็น</p>
          <Link to="/" className="btn cart-empty-btn">เลือกซื้อสินค้า</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="cart-page">
      <div className="cart-header">
        <button type="button" className="cart-back" onClick={handleBack} aria-label="ย้อนกลับ">
          <ChevronLeftIcon />
        </button>
        <h1 className="cart-title">รถเข็นของฉัน</h1>
        <button type="button" className="cart-clear" onClick={clear}>
          ล้างทั้งหมด
        </button>
      </div>

      <div className="cart-list">
        {items.map((item) => (
          <article className="cart-item" key={item.id}>
            <Link to={`/products/${item.id}`} className="cart-item-image-link">
              <img src={item.image} alt={item.name} className="cart-item-image" />
            </Link>

            <div className="cart-item-body">
              <Link to={`/products/${item.id}`} className="cart-item-name">
                {item.name}
              </Link>
              {item.sellerName && <p className="cart-item-seller">{item.sellerName}</p>}
              <p className="cart-item-price">{formatCurrency(item.price)}</p>

              <div className="cart-item-actions">
                <div className="qty-control" aria-label="จำนวนสินค้า">
                  <button
                    type="button"
                    className="qty-btn"
                    onClick={() => updateQuantity(item.id, item.quantity - 1)}
                    disabled={item.quantity <= 1}
                    aria-label="ลดจำนวน"
                  >
                    −
                  </button>
                  <span className="qty-value">{item.quantity}</span>
                  <button
                    type="button"
                    className="qty-btn"
                    onClick={() => updateQuantity(item.id, item.quantity + 1)}
                    disabled={item.stock != null && item.quantity >= item.stock}
                    aria-label="เพิ่มจำนวน"
                  >
                    +
                  </button>
                </div>

                <button
                  type="button"
                  className="cart-item-remove"
                  onClick={() => removeItem(item.id)}
                >
                  ลบ
                </button>
              </div>
            </div>
          </article>
        ))}
      </div>

      <div className="cart-summary">
        <div className="cart-summary-row">
          <span>สินค้าทั้งหมด</span>
          <span>{totalCount} ชิ้น</span>
        </div>
        <div className="cart-summary-row">
          <span>ราคาสินค้า</span>
          <span>{formatCurrency(totalPrice)}</span>
        </div>
        {storesLoading ? (
          <div className="cart-summary-row">
            <span>ค่าจัดส่ง</span>
            <span>กำลังคำนวณ...</span>
          </div>
        ) : (
          <div className="cart-summary-row">
            <span>ค่าจัดส่ง</span>
            <span>{formatCurrency(shippingFee)}</span>
          </div>
        )}
        <div className="cart-summary-row">
          <span>ภาษีมูลค่าเพิ่ม ({vatRate}%)</span>
          <span>{formatCurrency(taxAmount)}</span>
        </div>
        {storesLoading ? (
          <div className="cart-summary-row cart-summary-total">
            <span>ยอดรวมทั้งหมด</span>
            <span>กำลังคำนวณ...</span>
          </div>
        ) : (
          <div className="cart-summary-row cart-summary-total">
            <span>ยอดรวมทั้งหมด</span>
            <span>{formatCurrency(totalAmount)}</span>
          </div>
        )}
        <button type="button" className="btn cart-checkout" onClick={handleCheckout}>
          ทำการสั่งซื้อ
        </button>
        <Link to="/" className="cart-continue">เลือกซื้อสินค้าต่อ</Link>
      </div>
      <CheckoutModal open={checkoutOpen} onClose={() => setCheckoutOpen(false)} orderSummary={orderSummary} />
    </div>
  );
}
