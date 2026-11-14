import { Link, useNavigate, useLocation } from "react-router-dom";
import { useCart } from "../context/CartContext";

const formatPrice = (value) => `${Number(value || 0).toLocaleString()} บาท`;

const ChevronLeftIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
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

export default function Cart() {
  const { items, updateQuantity, removeItem, clear, totalCount, totalPrice } = useCart();
  const handleBack = useBackNavigation();

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
              <p className="cart-item-price">{formatPrice(item.price)}</p>

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
        <div className="cart-summary-row cart-summary-total">
          <span>ยอดรวม</span>
          <span>{formatPrice(totalPrice)}</span>
        </div>
        <button type="button" className="btn cart-checkout">ทำการสั่งซื้อ</button>
        <Link to="/" className="cart-continue">เลือกซื้อสินค้าต่อ</Link>
      </div>
    </div>
  );
}