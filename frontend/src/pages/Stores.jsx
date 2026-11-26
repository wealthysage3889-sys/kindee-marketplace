import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { productAPI, storeAPI } from "../api/product";

// Resolve the store logo URL from the same fields used by the admin profile
// and the store detail page. The backend stores the path under `logo_url`
// (snake_case); some endpoints also mirror it as `logo` (camelCase).
const resolveStoreLogo = (store) =>
  store?.logo || store?.logoUrl || store?.logo_url || null;

export default function Stores() {
  const [stores, setStores] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    const loadStores = async () => {
      try {
        const data = await storeAPI.getStores({ limit: 50, isActive: true });
        if (!cancelled) {
          const storesList = data?.data?.stores || data?.stores || (Array.isArray(data?.data) ? data.data : []);
          setStores(Array.isArray(storesList) ? storesList : []);
        }
      } catch (err) {
        if (!cancelled) setError(err.message || "ไม่สามารถ loading ร้านค้าได้");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    loadStores();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="page customer-page">
      <div className="customer-page-header">
        <h1>ร้านค้า</h1>
        <p>ค้นพบร้านค้าและสินค้าทั้งหมดใน Kindee</p>
      </div>
      {loading && <div className="home-loading">กำลัง loading ร้านค้า...</div>}
      {error && <div className="home-error">{error}</div>}
      {!loading && !error && (
        <div className="store-grid">
          {stores.length === 0 ? <p className="product-empty">ยังไม่มีร้านค้า</p> : stores.map((store) => {
            const logoUrl = resolveStoreLogo(store);
            const storeId = store._id || store.id;
            const storeName = store.name || "ร้านค้า";
            return (
              <Link to={`/stores/${storeId}`} className="store-card" key={storeId}>
                <span className="store-avatar">
                  {logoUrl ? (
                    <img
                      src={logoUrl}
                      alt={storeName}
                      loading="lazy"
                      onError={(e) => {
                        // Image failed to load: hide it so the fallback shows
                        e.currentTarget.style.display = "none";
                      }}
                    />
                  ) : null}
                  <span className="store-avatar-fallback">
                    {storeName.charAt(0).toUpperCase()}
                  </span>
                </span>
                <strong className="store-name">{storeName}</strong>
                <small>ดูสินค้าในร้าน</small>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}