import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate, useLocation, Link } from "react-router-dom";
import { productAPI } from "../api/product";
import { useCart } from "../context/CartContext";

const PLACEHOLDER_IMAGE = "https://via.placeholder.com/600x600?text=No+Image";

const StoreIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 9h18l-1-5H4L3 9Z" />
    <path d="M5 9v11h14V9" />
    <path d="M9 20v-6h6v6" />
  </svg>
);

const ChatIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4v8Z" />
    <path d="M8 9h8M8 13h5" />
  </svg>
);

const CartIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="9" cy="20" r="1" />
    <circle cx="19" cy="20" r="1" />
    <path d="M3 4h2l2.4 11.2a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.6L21 8H6" />
  </svg>
);

const SearchIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="11" cy="11" r="7" />
    <path d="m21 21-4.3-4.3" />
  </svg>
);

const ChevronLeftIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m15 18-6-6 6-6" />
  </svg>
);

const ShareIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="18" cy="5" r="3" />
    <circle cx="6" cy="12" r="3" />
    <circle cx="18" cy="19" r="3" />
    <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
    <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
  </svg>
);

const MoreIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <circle cx="12" cy="12" r="1" />
    <circle cx="12" cy="5" r="1" />
    <circle cx="12" cy="19" r="1" />
  </svg>
);

const StarIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2Z" />
  </svg>
);

export default function ProductDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { addItem, totalCount } = useCart();

  const [product, setProduct] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedImage, setSelectedImage] = useState(0);
  const [quantity, setQuantity] = useState(1);
  const [toast, setToast] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [relatedProducts, setRelatedProducts] = useState([]);
  const [relatedLoading, setRelatedLoading] = useState(false);
  const toastTimer = useRef(null);

  const categoryName = product
    ? typeof product.category === "string"
      ? product.category
      : product.category?.name || ""
    : "";

  useEffect(() => {
    let cancelled = false;
    const loadProduct = async () => {
      try {
        setError("");
        setLoading(true);
        const data = await productAPI.getProductById(id);
        if (!cancelled) {
          setProduct(data?.data || data || null);
        }
      } catch (err) {
        if (!cancelled) {
          setProduct(null);
          setError(err.message || "ไม่สามารถโหลดรายละเอียดสินค้าได้");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    if (id) loadProduct();
    return () => { cancelled = true; };
  }, [id]);

  useEffect(() => {
    setSelectedImage(0);
    setQuantity(1);
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    const loadRelatedProducts = async () => {
      try {
        setRelatedLoading(true);
        const data = await productAPI.getProducts({ limit: 20 });
        const all = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
        const related = all.filter((p) => p._id !== product._id);
        const sameCategory = related.filter((p) => {
          const cat = typeof p.category === "string" ? p.category : p.category?.name || "";
          return cat === categoryName;
        });
        const others = related.filter((p) => {
          const cat = typeof p.category === "string" ? p.category : p.category?.name || "";
          return cat !== categoryName;
        });
        if (!cancelled) {
          setRelatedProducts([...sameCategory, ...others].slice(0, 8));
        }
      } catch (err) {
        if (!cancelled) setRelatedProducts([]);
      } finally {
        if (!cancelled) setRelatedLoading(false);
      }
    };
    if (product) loadRelatedProducts();
    return () => { cancelled = true; };
  }, [product, categoryName]);

  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);

  const handleBack = () => {
    navigate(-1);
  };

  const showToast = (message) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 2200);
  };

  if (loading) {
    return (
      <div className="product-detail-page">
        <div className="product-detail-loading">กำลังโหลดรายละเอียดสินค้า...</div>
      </div>
    );
  }

  if (error || !product) {
    return (
      <div className="product-detail-page">
        <div className="product-detail-error" role="alert">
          {error || "ไม่พบสินค้า"}
        </div>
        <Link to="/" className="btn btn-outline">กลับไปหน้าหลัก</Link>
      </div>
    );
  }

  const images = product.images && product.images.length > 0
    ? product.images
    : [PLACEHOLDER_IMAGE];

  const safeIndex = Math.min(selectedImage, images.length - 1);
  const hasMultipleImages = images.length > 1;

  const displayPrice = product.discountPrice ?? product.price;
  const hasDiscount = product.discountPrice != null && product.discountPrice < product.price;
  const stock = product.stock != null && product.stock !== "" ? Number(product.stock) : null;
  const isOutOfStock = stock != null && stock <= 0;
  const maxQuantity = stock != null && stock > 0 ? stock : 1;

  const stockLabel = stock == null
    ? "คงเหลือ: ไม่ระบุ"
    : isOutOfStock
      ? "สินค้าหมด"
      : `คงเหลือ: ${stock.toLocaleString()} ชิ้น`;
  const stockClass = isOutOfStock ? " out" : stock != null && stock <= 5 ? " low" : "";

  const sellerName = typeof product.seller === "object" ? product.seller?.name : null;
  const rating = Number(product.ratingsAverage) || 0;
  const ratingCount = Number(product.ratingsQuantity) || 0;

  const goToImage = (index) => {
    if (!hasMultipleImages) return;
    const next = (index + images.length) % images.length;
    setSelectedImage(next);
  };

  const handleAddToCart = () => {
    if (isOutOfStock) return;
    addItem(product, quantity);
    showToast("เพิ่มลงรถเข็นแล้ว");
  };

  const handleBuyNow = () => {
    if (isOutOfStock) return;
    addItem(product, quantity);
    navigate("/cart", { state: { from: location.pathname } });
  };

  const handleShare = async () => {
    if (!product) return;
    const title = product.name;
    const text = `${product.name} - ราคา ${product.price} บาท`;
    const url = window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({ title, text, url });
      } else {
        await navigator.clipboard.writeText(url);
        showToast("คัดลอกลิงก์สินค้าเรียบร้อยแล้ว");
      }
    } catch (err) {
      showToast("แชร์สินค้าไม่สำเร็จ");
    }
  };

  const handleSearch = (e) => {
    e.preventDefault();
    const query = searchQuery.trim();
    if (query) {
      navigate(`/?search=${encodeURIComponent(query)}`);
    } else {
      navigate("/");
    }
  };

  return (
    <div className="product-detail-page">
      <div className="product-detail-sticky-header">
        <button type="button" className="product-detail-back" onClick={handleBack} aria-label="ย้อนกลับ">
          <ChevronLeftIcon />
        </button>
        <form className="product-detail-search" onSubmit={handleSearch}>
          <span className="product-detail-search-icon" aria-hidden="true">
            <SearchIcon />
          </span>
          <input
            type="text"
            className="product-detail-search-input"
            placeholder="ค้นหาสินค้า..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </form>
        <div className="product-detail-actions">
          <button type="button" className="product-detail-action-btn" onClick={handleShare} aria-label="แชร์">
            <ShareIcon />
          </button>
          <Link to="/cart" className="product-detail-action-btn" aria-label="รถเข็นสินค้า" state={{ from: location.pathname }}>
            <CartIcon />
            {totalCount > 0 && (
              <span className="product-detail-cart-badge">{totalCount}</span>
            )}
          </Link>
          <button type="button" className="product-detail-action-btn" aria-label="ตัวเลือกเพิ่มเติม">
            <MoreIcon />
          </button>
        </div>
      </div>

      <article className="product-detail-card">
        <div className="product-detail-images">
          <div className="product-detail-main">
            <img
              src={images[safeIndex]}
              alt={`${product.name} - รูปที่ ${safeIndex + 1}`}
              className="product-detail-main-image"
            />

            {hasMultipleImages && (
              <>
                <button
                  type="button"
                  className="product-detail-nav prev"
                  onClick={() => goToImage(safeIndex - 1)}
                  aria-label="รูปก่อนหน้า"
                >
                  ‹
                </button>
                <button
                  type="button"
                  className="product-detail-nav next"
                  onClick={() => goToImage(safeIndex + 1)}
                  aria-label="รูปถัดไป"
                >
                  ›
                </button>
                <span className="product-detail-counter">
                  {safeIndex + 1} / {images.length}
                </span>
              </>
            )}
          </div>

          {hasMultipleImages && (
            <div className="product-detail-thumbs" role="tablist" aria-label="รูปภาพสินค้า">
              {images.map((img, index) => (
                <button
                  key={index}
                  type="button"
                  role="tab"
                  aria-selected={safeIndex === index}
                  className={`product-detail-thumb${safeIndex === index ? " active" : ""}`}
                  onClick={() => setSelectedImage(index)}
                >
                  <img src={img} alt={`รูปที่ ${index + 1}`} />
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="product-detail-info">
          <div className="product-detail-topline">
            {categoryName && <span className="product-detail-category">{categoryName}</span>}
            {rating > 0 && (
              <span className="product-detail-rating">
                <span className="product-detail-rating-stars"><StarIcon /></span>
                {rating.toFixed(1)}
                {ratingCount > 0 && <span className="product-detail-rating-count">({ratingCount})</span>}
              </span>
            )}
          </div>

          <h1 className="product-detail-name">{product.name}</h1>

          <div className="product-detail-price">
            <span className="price-current">{Number(displayPrice || 0).toLocaleString()} บาท</span>
            {hasDiscount && (
              <>
                <span className="price-original">{Number(product.price).toLocaleString()} บาท</span>
                <span className="price-discount-badge">
                  -{Math.round((1 - displayPrice / product.price) * 100)}%
                </span>
              </>
            )}
          </div>

          <p className={`product-detail-stock${stockClass}`}>{stockLabel}</p>

          <div className="product-detail-purchase">
            <span className="product-detail-qty-label">จำนวน</span>
            <div className="qty-control">
              <button
                type="button"
                className="qty-btn"
                onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                disabled={quantity <= 1 || isOutOfStock}
                aria-label="ลดจำนวน"
              >
                −
              </button>
              <span className="qty-value">{quantity}</span>
              <button
                type="button"
                className="qty-btn"
                onClick={() => setQuantity((q) => Math.min(maxQuantity, q + 1))}
                disabled={quantity >= maxQuantity || isOutOfStock}
                aria-label="เพิ่มจำนวน"
              >
                +
              </button>
            </div>
          </div>

          {sellerName && (
            <Link to={`/stores/${typeof product.seller === "object" ? product.seller._id : product.seller}`} className="product-detail-seller">
              <span className="product-detail-seller-avatar">
                {sellerName.charAt(0).toUpperCase()}
              </span>
              <span className="product-detail-seller-text">
                <small>ร้านค้า</small>
                <strong>{sellerName}</strong>
              </span>
              <span className="product-detail-seller-link">ดูร้าน ›</span>
            </Link>
          )}

          <div className="product-detail-description">
            <h2>รายละเอียดสินค้า</h2>
            <p>{product.description || "ยังไม่มีรายละเอียด"}</p>
          </div>
        </div>
      </article>

      {relatedProducts.length > 0 && (
        <section className="related-products">
          <h2 className="related-products-title">สินค้าที่คุณอาจสนใจ</h2>
          <div className="product-grid">
            {relatedProducts.map((product) => {
              const displayPrice = product.discountPrice ?? product.price;
              const hasDiscount = product.discountPrice != null && product.discountPrice < product.price;
              const image = product.images?.[0] || PLACEHOLDER_IMAGE;
              const stock = product.stock;
              const stockLabel = stock != null && stock !== ""
                ? `คงเหลือ: ${Number(stock).toLocaleString()} ชิ้น`
                : "คงเหลือ: ไม่ระบุ";
              return (
                <Link to={`/products/${product._id}`} className="product-card-link" key={product._id}>
                  <article className="product-card">
                    <img src={image} alt={product.name} className="product-image" />
                    <div className="product-info">
                      <p className="product-category">{typeof product.category === "string" ? product.category : product.category?.name || "ไม่ระบุ category"}</p>
                      <h3 className="product-name">{product.name}</h3>
                      <div className="product-price">
                        <span className="price-current">{Number(displayPrice || 0).toLocaleString()} บาท</span>
                        {hasDiscount && <span className="price-original">{Number(product.price).toLocaleString()} บาท</span>}
                      </div>
                      <p className="product-stock">{stockLabel}</p>
                    </div>
                  </article>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      <div className="product-action-bar">
        <div className="product-action-inner">
          <Link to="/stores" className="product-action-icon" aria-label="ร้านค้า">
            <StoreIcon />
            <span>ร้านค้า</span>
          </Link>
          <Link to="/messages" className="product-action-icon" aria-label="แชทกับร้านค้า">
            <ChatIcon />
            <span>แชท</span>
          </Link>
          <button
            type="button"
            className="product-action-outline"
            onClick={handleAddToCart}
            disabled={isOutOfStock}
          >
            <CartIcon />
            <span>เพิ่มลงรถเข็น</span>
          </button>
          <button
            type="button"
            className="product-action-primary"
            onClick={handleBuyNow}
            disabled={isOutOfStock}
          >
            {isOutOfStock ? "สินค้าหมด" : "ซื้อเลย"}
          </button>
        </div>
      </div>

      {toast && <div className="product-detail-toast" role="status">{toast}</div>}
    </div>
  );
}