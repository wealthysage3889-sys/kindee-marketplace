import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { productAPI, storeAPI } from "../api/product";

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
        if (!cancelled) setError(err.message || "ไม่สามารถโหลดร้านค้าได้");
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
      {loading && <div className="home-loading">กำลังโหลดร้านค้า...</div>}
      {error && <div className="home-error">{error}</div>}
      {!loading && !error && (
        <div className="store-grid">
          {stores.length === 0 ? <p className="product-empty">ยังไม่มีร้านค้า</p> : stores.map((store) => (
            <Link to={`/stores/${store._id}`} className="store-card" key={store._id}>
              <span className="store-avatar">{(store.name || "?")[0]}</span>
              <strong className="store-name">{store.name || "ร้านค้า"}</strong>
              <small>ดูสินค้าในร้าน</small>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}