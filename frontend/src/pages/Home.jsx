import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { productAPI } from "../api/product";

const CATEGORY_ICONS = ["🛍️", "📱", "👕", "🍔", "🏠", "💄", "🎮", "📚", "⚽", "💡"];

export default function Home() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [searchParams] = useSearchParams();

  useEffect(() => {
    const urlSearch = searchParams.get("search") || "";
    setSearch(urlSearch);
  }, [searchParams]);

  useEffect(() => {
    let cancelled = false;
    const loadProducts = async () => {
      try {
        setError("");
        const data = await productAPI.getProducts({ limit: 50 });
        if (!cancelled) {
          setProducts(Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : []);
        }
      } catch (err) {
        if (!cancelled) {
          setProducts([]);
          setError(err.message || "ไม่สามารถโหลดรายการสินค้าได้");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    loadProducts();
    return () => { cancelled = true; };
  }, []);

  const getCategoryName = (product) =>
    typeof product.category === "string" ? product.category : product.category?.name || "";

  const categories = useMemo(
    () => [...new Set(products.map(getCategoryName).filter(Boolean))],
    [products]
  );

  const filteredProducts = useMemo(() => products.filter((product) => {
    const matchesSearch = (product.name || "").toLowerCase().includes(search.toLowerCase().trim());
    const matchesCategory = category ? getCategoryName(product) === category : true;
    return matchesSearch && matchesCategory;
  }), [products, search, category]);

  return (
    <div className="home-page customer-home-page">
      <div className="home-sticky-container">
        <div className="home-sticky-header">
          <div className="home-section-header">
            <div>
              <p className="section-kicker">สินค้าสำหรับคุณ</p>
              <h2 id="product-list-title">รายการสินค้า</h2>
            </div>
          </div>

          <div className="home-controls">
            <input
              type="search"
              className="home-search"
              placeholder="ค้นหาสินค้า..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <select className="home-select" value={category} onChange={(event) => setCategory(event.target.value)}>
              <option value="">ทุกหมวดหมู่</option>
              {categories.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </div>
        </div>

        <section className="home-categories" aria-label="หมวดหมู่สินค้า">
          <div className="home-section-header home-section-header-compact">
            <div>
              <p className="section-kicker">สำรวจหมวดหมู่</p>
              <h2>หมวดหมู่ยอดนิยม</h2>
            </div>
          </div>
          <div className="category-chip-row">
            <button
              type="button"
              className={`category-chip ${category === "" ? "active" : ""}`}
              onClick={() => setCategory("")}
            >
              <span className="category-chip-icon">✨</span>
              <span className="category-chip-label">ทั้งหมด</span>
            </button>
            {categories.map((item, index) => (
              <button
                type="button"
                key={item}
                className={`category-chip ${category === item ? "active" : ""}`}
                onClick={() => setCategory(item)}
              >
                <span className="category-chip-icon">{CATEGORY_ICONS[index % CATEGORY_ICONS.length]}</span>
                <span className="category-chip-label">{item}</span>
              </button>
            ))}
          </div>
        </section>
      </div>

      <section className="home-products" aria-labelledby="product-list-title">
        {loading && <div className="home-loading">กำลังโหลดรายการสินค้า...</div>}
        {error && <div className="home-error" role="alert">{error}</div>}

        {!loading && !error && (
          <div className="product-grid">
            {filteredProducts.length === 0 ? (
              <p className="product-empty">ไม่พบสินค้าที่ตรงกับเงื่อนไข</p>
            ) : filteredProducts.map((product, index) => {
              const displayPrice = product.discountPrice ?? product.price;
              const hasDiscount = product.discountPrice != null && product.discountPrice < product.price;
              const image = product.images?.[0] || "https://via.placeholder.com/600x600?text=No+Image";
              const stock = product.stock;
              const stockLabel = stock != null && stock !== ""
                ? `คงเหลือ: ${Number(stock).toLocaleString()} ชิ้น`
                : "คงเหลือ: ไม่ระบุ";
              const isBestSeller = index % 4 === 0;
              const isRecommended = hasDiscount || index % 3 === 1;

              return (
                <Link to={`/products/${product._id}`} className="product-card-link" key={product._id}>
                  <article className="product-card">
                    <div className="product-image-wrap">
                      <img src={image} alt={product.name} className="product-image" />
                      <div className="product-badges">
                        {isBestSeller && <span className="product-badge badge-hot">ขายดี</span>}
                        {isRecommended && <span className="product-badge badge-recommend">สินค้าแนะนำ</span>}
                        {hasDiscount && <span className="product-badge badge-sale">ลดราคา</span>}
                      </div>
                    </div>
                    <div className="product-info">
                      <p className="product-category">{getCategoryName(product) || "ไม่ระบุ category"}</p>
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
        )}
      </section>
    </div>
  );
}