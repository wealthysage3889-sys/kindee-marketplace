import { useEffect, useState } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { storeAPI } from "../api/product";
import StoreBottomNav from "../components/StoreBottomNav";
import StoreLocationMap from "../components/StoreLocationMap";

const PLACEHOLDER_IMAGE = "https://via.placeholder.com/600x600?text=No+Image";

const LocationIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
    <circle cx="12" cy="10" r="3" />
  </svg>
);

const ChevronLeftIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m15 18-6-6 6-6" />
  </svg>
);

const SearchIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="11" cy="11" r="8" />
    <path d="m21 21-4.3-4.3" />
  </svg>
);

const CartIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="9" cy="21" r="1" />
    <circle cx="20" cy="21" r="1" />
    <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
  </svg>
);

const MenuIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <line x1="4" y1="12" x2="20" y2="12" />
    <line x1="4" y1="6" x2="20" y2="6" />
    <line x1="4" y1="18" x2="20" y2="18" />
  </svg>
);

const CategoryIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
  </svg>
);

const ChevronRightIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m9 18 6-6-6-6" />
  </svg>
);

const CloseIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const SaleIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M20 8h-6V4a2 2 0 0 0-4 0v4H4a2 2 0 0 0 0 4h2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V12h2a2 2 0 0 0 0-4Z" />
  </svg>
);

export default function StoreProfile() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [store, setStore] = useState(null);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [fallbackStores, setFallbackStores] = useState([]);
  const [activeTab, setActiveTab] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [isLocationOpen, setIsLocationOpen] = useState(false);

  useEffect(() => {
    if (!isLocationOpen) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === "Escape") setIsLocationOpen(false);
    };
    document.addEventListener("keydown", handleKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [isLocationOpen]);

  const tabs = [
    { label: "หน้าหลักร้านค้า", key: "home" },
    { label: "มาใหม่", key: "new" },
  ];

  const handleBack = () => {
    navigate(-1);
  };

  const loadFallbackStores = async () => {
    try {
      const data = await storeAPI.getStoreProducts(id, { limit: 1 });
      const storesData = await storeAPI.getStores({ limit: 10 });
      const stores = Array.isArray(storesData?.data) ? storesData.data : [];
      setFallbackStores(stores);
    } catch (err) {
      console.warn("Failed to load fallback stores:", err);
    }
  };

  useEffect(() => {
    let cancelled = false;
    const loadStore = async () => {
      try {
        setError("");
        setLoading(true);
        
        let storeData = null;
        
        try {
          const response = await storeAPI.getStoreById(id);
          storeData = response?.data || response || null;
        } catch (err) {
          if (err.response?.status !== 404) throw err;
        }

        if (!storeData) {
          try {
            const response = await storeAPI.getStoreByOwner(id);
            storeData = response?.data || response || null;
          } catch (err) {
            if (err.response?.status !== 404) throw err;
          }
        }

        if (!cancelled) {
          if (storeData) {
            setStore(storeData);
            const productsData = await storeAPI.getStoreProducts(storeData._id, { limit: 50 });
            setProducts(Array.isArray(productsData?.data) ? productsData.data : Array.isArray(productsData) ? productsData : []);
          } else {
            await loadFallbackStores();
            setStore(null);
            setProducts([]);
            setError("ร้านค้าที่คุณค้นหาไม่มีอยู่ในระบบ");
          }
        }
      } catch (err) {
        if (!cancelled) {
          setStore(null);
          setProducts([]);
          setError(err.message || "ไม่สามารถโหลดข้อมูลร้านค้าได้");
          await loadFallbackStores();
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    if (id) loadStore();
    return () => { cancelled = true; };
  }, [id]);

  const formatPrice = (value) => `${Number(value || 0).toLocaleString()} บาท`;

  const formatAddress = (address) =>
    [address?.street, address?.district, address?.province, address?.postalCode]
      .map((part) => String(part || "").trim())
      .filter(Boolean)
      .join(" ");

  const storeAddressText = formatAddress(store?.address);
  const storeCoordinates = store?.address?.coordinates;
  const hasValidCoordinates =
    storeCoordinates != null &&
    Number.isFinite(Number(storeCoordinates.lat)) &&
    Number.isFinite(Number(storeCoordinates.lng));

  const getCategoryName = (product) =>
    typeof product.category === "string" ? product.category : product.category?.name || "";

  const getSalesCount = (product) => {
    const sold = product.sold || product.salesCount || 0;
    return Number(sold).toLocaleString();
  };

  if (loading) {
    return (
      <div className="page customer-page store-profile-page">
        <div className="customer-page-header">
          <h1>กำลังโหลดร้านค้า...</h1>
        </div>
      </div>
    );
  }

  if (error || !store) {
    return (
      <div className="page customer-page store-profile-page">
        <div className="customer-page-header">
          <button type="button" className="store-back" onClick={handleBack} aria-label="ย้อนกลับ">
            <ChevronLeftIcon />
          </button>
          <h1>ไม่พบร้านค้า</h1>
        </div>
        <div className="store-error" role="alert">{error || "ร้านค้าที่คุณค้นหาไม่มีอยู่ในระบบ"}</div>
        {fallbackStores.length > 0 && (
          <div className="fallback-stores">
            <h3>ร้านค้าที่อาจสนใจ</h3>
            <div className="store-grid">
              {fallbackStores.slice(0, 6).map((fallbackStore) => (
                <Link to={`/stores/${fallbackStore._id}`} className="store-card" key={fallbackStore._id}>
                  <span className="store-avatar">{fallbackStore.name ? fallbackStore.name.charAt(0).toUpperCase() : "?"}</span>
                  <strong className="store-name">{fallbackStore.name}</strong>
                  <small>ดูสินค้าในร้าน</small>
                </Link>
              ))}
            </div>
          </div>
        )}
        <Link to="/stores" className="btn btn-outline">กลับไปหน้าร้านค้า</Link>
      </div>
    );
  }

  const images = store.images && store.images.length > 0 ? store.images : [PLACEHOLDER_IMAGE];
  const coverImage = images[0];

  return (
    <div className="page customer-page store-profile-page">
      {/* Sticky Header with Back, Search, Cart/Menu */}
      <header className="store-header">
        <button type="button" className="store-back" onClick={handleBack} aria-label="ย้อนกลับ">
          <ChevronLeftIcon />
        </button>
        <div className="store-search" role="search">
          <SearchIcon />
          <input
            type="search"
            placeholder="ค้นหาในร้านค้า |"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="store-search-input"
            aria-label="ค้นหาสินค้าในร้าน"
          />
        </div>
        <div className="store-header-actions">
          <Link to="/cart" className="store-action-btn" aria-label="ตะกร้าสินค้า">
            <CartIcon />
          </Link>
          <button type="button" className="store-action-btn" aria-label="เมนูเพิ่มเติม">
            <MenuIcon />
          </button>
        </div>
      </header>

      {/* Store Hero Section */}
      <div className="customer-page-header">
        <div className="store-hero">
          <img src={coverImage} alt={store.name} className="store-cover" />
          <div className="store-info">
            <span className="store-avatar">
              {store.logo ? (
                <img src={store.logo} alt={store.name} />
              ) : (
                store.name ? store.name.charAt(0).toUpperCase() : "?"
              )}
            </span>
            <h1 className="store-name">{store.name}</h1>
            {store.description && <p className="store-description">{store.description}</p>}
          </div>
        </div>
      </div>

      {/* Store Location Section */}
      {(storeAddressText || hasValidCoordinates) && (
        <section className="store-location-section">
          <div className="store-location-card">
            {hasValidCoordinates ? (
              <button
                type="button"
                className="store-location-trigger"
                onClick={() => setIsLocationOpen(true)}
                aria-haspopup="dialog"
                aria-expanded={isLocationOpen}
              >
                <span className="store-location-trigger-main">
                  <span className="store-location-trigger-icon" aria-hidden="true">
                    <LocationIcon />
                  </span>
                  <span className="store-location-trigger-text">
                    <span className="store-location-trigger-title">ที่ตั้งร้านค้า</span>
                    {storeAddressText && (
                      <span className="store-location-trigger-address">{storeAddressText}</span>
                    )}
                    {!storeAddressText && (
                      <span className="store-location-trigger-address">แตะเพื่อดูตำแหน่งบนแผนที่</span>
                    )}
                  </span>
                </span>
                <span className="store-location-trigger-arrow" aria-hidden="true">
                  <ChevronRightIcon />
                </span>
              </button>
            ) : (
              <div className="store-location-trigger" aria-disabled="true">
                <span className="store-location-trigger-main">
                  <span className="store-location-trigger-icon" aria-hidden="true">
                    <LocationIcon />
                  </span>
                  <span className="store-location-trigger-text">
                    <span className="store-location-trigger-title">ที่ตั้งร้านค้า</span>
                    {storeAddressText && (
                      <span className="store-location-trigger-address">{storeAddressText}</span>
                    )}
                  </span>
                </span>
              </div>
            )}
          </div>
        </section>
      )}

      {isLocationOpen && hasValidCoordinates && (
        <div
          className="store-location-modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-label={`ที่ตั้งร้านค้า ${store.name || ""}`.trim()}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setIsLocationOpen(false);
          }}
        >
          <div className="store-location-modal">
            <div className="store-location-modal-header">
              <button
                type="button"
                className="store-location-modal-back"
                onClick={() => setIsLocationOpen(false)}
              >
                <ChevronLeftIcon />
                <span>ย้อนกลับ</span>
              </button>
              <h2 className="store-location-modal-title">ที่ตั้งร้านค้า</h2>
              <button
                type="button"
                className="store-location-modal-close"
                onClick={() => setIsLocationOpen(false)}
                aria-label="ปิด"
              >
                <CloseIcon />
              </button>
            </div>
            <div className="store-location-modal-body">
              {storeAddressText && <p className="store-location-address">{storeAddressText}</p>}
              <StoreLocationMap
                value={{ lat: Number(storeCoordinates.lat), lng: Number(storeCoordinates.lng) }}
                readOnly
                height={360}
                storeName={store.name}
              />
            </div>
          </div>
        </div>
      )}

      {/* Category Tabs */}
      <nav className="store-tabs" role="tablist" aria-label="หมวดหมู่สินค้า">
        {tabs.map((tab, index) => (
          <button
            key={tab.key}
            role="tab"
            aria-selected={activeTab === index}
            aria-controls={`tabpanel-${tab.key}`}
            id={`tab-${tab.key}`}
            className={`store-tab ${activeTab === index ? "active" : ""}`}
            onClick={() => setActiveTab(index)}
          >
            <CategoryIcon />
            <span>{tab.label}</span>
          </button>
        ))}
      </nav>

      {/* Products Section */}
      <div className="store-products">
        <div className="store-section-header">
          <h2 className="store-section-title">สินค้าในร้าน</h2>
        </div>
        {products.length === 0 ? (
          <p className="product-empty">ร้านนี้ยังไม่มีสินค้า</p>
        ) : (
          <div className="product-grid" role="tabpanel" id={`tabpanel-${tabs[activeTab].key}`} aria-labelledby={`tab-${tabs[activeTab].key}`}>
            {products.map((product) => {
              const displayPrice = product.discountPrice ?? product.price;
              const hasDiscount = product.discountPrice != null && product.discountPrice < product.price;
              const image = product.images?.[0] || PLACEHOLDER_IMAGE;
              const stock = product.stock;
              const stockLabel = stock != null && stock !== ""
                ? `คงเหลือ: ${Number(stock).toLocaleString()} ชิ้น`
                : "คงเหลือ: ไม่ระบุ";
              const salesCount = getSalesCount(product);
              return (
                <Link to={`/products/${product._id}`} className="product-card-link" key={product._id}>
                  <article className="product-card">
                    <div className="product-image-wrapper">
                      <img src={image} alt={product.name} className="product-image" loading="lazy" />
                      {hasDiscount && (
                        <span className="product-discount-badge">
                          -{Math.round((1 - displayPrice / product.price) * 100)}%
                        </span>
                      )}
                    </div>
                    <div className="product-info">
                      <p className="product-category">{getCategoryName(product) || "ไม่ระบุ category"}</p>
                      <h3 className="product-name">{product.name}</h3>
                      <div className="product-price">
                        <span className="price-current">{formatPrice(displayPrice)}</span>
                        {hasDiscount && <span className="price-original">{formatPrice(product.price)}</span>}
                      </div>
                      <div className="product-meta">
                        <span className="product-sales">
                          <SaleIcon />
                          ขายแล้ว {salesCount} ชิ้น
                        </span>
                        <span className="product-stock">{stockLabel}</span>
                      </div>
                    </div>
                  </article>
                </Link>
              );
            })}
          </div>
        )}
      </div>

      <StoreBottomNav />
    </div>
  );
}