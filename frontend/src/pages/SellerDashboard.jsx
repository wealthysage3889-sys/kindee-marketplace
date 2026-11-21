import { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { storeAPI } from "../api/product";
import StoreProfileEditModal from "../components/StoreProfileEditModal";

const PLACEHOLDER_IMAGE = "https://via.placeholder.com/600x600?text=No+Image";

const EditIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
  </svg>
);

export default function SellerDashboard() {
  const { customer } = useAuth();
  const user = customer?.user;
  const [stores, setStores] = useState([]);
  const [selectedStoreId, setSelectedStoreId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showEditModal, setShowEditModal] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const ownerId = user?._id || user?.id;
    const loadStores = async () => {
      if (!ownerId) return;
      try {
        setError("");
        setLoading(true);
        const response = await storeAPI.getStoresByOwner(ownerId);
        const storesList = response?.data || response || [];
        if (!cancelled) {
          setStores(storesList);
          if (storesList.length > 0 && !selectedStoreId) {
            setSelectedStoreId(storesList[0].id || storesList[0]._id);
          }
        }
      } catch (err) {
        if (!cancelled) {
          setError(err.message || "ไม่สามารถโหลดข้อมูลร้านค้าได้");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    loadStores();
    return () => { cancelled = true; };
  }, [user?._id, user?.id]);

  const store = stores.find(s => (s.id || s._id) === selectedStoreId);

  const openEditModal = () => setShowEditModal(true);

  const closeEditModal = () => {
    setShowEditModal(false);
  };

  const days = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
  const dayLabels = {
    monday: "จันทร์",
    tuesday: "อังคาร",
    wednesday: "พุธ",
    thursday: "พฤหัสบดี",
    friday: "ศุกร์",
    saturday: "เสาร์",
    sunday: "อาทิตย์",
  };

  if (loading) {
    return (
      <div className="page seller-dashboard-page">
        <div className="seller-dashboard-header">
          <h1>จัดการร้านค้า</h1>
          <p>กำลังโหลดข้อมูล...</p>
        </div>
      </div>
    );
  }

  if (stores.length === 0) {
    return (
      <div className="page seller-dashboard-page">
        <div className="seller-dashboard-header">
          <h1>จัดการร้านค้า</h1>
        </div>
        <div className="alert alert-error" role="alert">{error || "ยังไม่มีร้านค้า"}</div>
        <div className="seller-empty-state">
          <p>คุณยังไม่มีร้านค้า</p>
          <button className="btn" onClick={() => window.location.href = "/stores/create"}>
            สร้างร้านค้าใหม่
          </button>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page seller-dashboard-page">
        <div className="seller-dashboard-header">
          <h1>จัดการร้านค้า</h1>
        </div>
        <div className="alert alert-error" role="alert">{error}</div>
      </div>
    );
  }

  const coverImage = store.coverImage || store.logo || store.logo_url || store.cover_image_url || PLACEHOLDER_IMAGE;

  return (
    <div className="page seller-dashboard-page">
      {/* Store Header */}
      <header className="seller-dashboard-header">
        {stores.length > 1 && (
          <div className="seller-store-selector">
            <label htmlFor="dashboard-store-select">เลือกร้านค้า:</label>
            <select
              id="dashboard-store-select"
              value={selectedStoreId}
              onChange={(e) => setSelectedStoreId(e.target.value)}
            >
              {stores.map((s) => (
                <option key={s.id || s._id} value={s.id || s._id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="seller-store-hero">
          <img src={coverImage} alt={store.name} className="seller-store-cover" />
          <div className="seller-store-info">
            <div className="seller-store-avatar">
              {store.logo || store.logo_url ? (
                <img src={store.logo || store.logo_url} alt={store.name} />
              ) : (
                store.name ? store.name.charAt(0).toUpperCase() : "?"
              )}
            </div>
            <div className="seller-store-details">
              <h1>{store.name}</h1>
              {store.description && <p className="seller-store-description">{store.description}</p>}
              <div className="seller-store-meta">
                {store.phone && <span>📞 {store.phone}</span>}
                {store.email && <span>✉️ {store.email}</span>}
                {store.address?.province && <span>📍 {store.address.province}</span>}
                {store.categories?.length && (
                  <span>🏷️ {store.categories.join(", ")}</span>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="seller-dashboard-actions">
          <button type="button" className="btn btn-primary" onClick={openEditModal}>
            <EditIcon /> แก้ไขโปรไฟล์ร้านค้า
          </button>
          <a href="/seller/products" className="btn btn-outline">
            จัดการสินค้า
          </a>
          <a href="/seller/orders" className="btn btn-outline">
            จัดการออเดอร์
          </a>
        </div>
      </header>

      {/* Store Info Sections */}
      <main className="seller-dashboard-content">
        <section className="seller-section">
          <h2>ข้อมูลร้านค้า</h2>
          <div className="seller-info-grid">
            <div className="seller-info-item">
              <label>ชื่อร้านค้า</label>
              <p>{store.name}</p>
            </div>
            <div className="seller-info-item">
              <label>คำอธิบาย</label>
              <p>{store.description || "ไม่ได้ระบุ"}</p>
            </div>
            <div className="seller-info-item">
              <label>โทรศัพท์</label>
              <p>{store.phone || "ไม่ได้ระบุ"}</p>
            </div>
            <div className="seller-info-item">
              <label>อีเมล</label>
              <p>{store.email || "ไม่ได้ระบุ"}</p>
            </div>
            <div className="seller-info-item">
              <label>ที่อยู่</label>
              <p>
                {store.address?.street || ""}
                {store.address?.district && ` ตำบล/แขวง ${store.address.district}`}
                {store.address?.province && ` อำเภอ/เขต ${store.address.province}`}
                {store.address?.postalCode && ` ${store.address.postalCode}`}
                || "ไม่ได้ระบุ"
              </p>
            </div>
            <div className="seller-info-item">
              <label>หมวดหมู่</label>
              <p>{store.categories?.join(", ") || "ไม่ได้ระบุ"}</p>
            </div>
            <div className="seller-info-item">
              <label>ค่าจัดส่ง</label>
              <p>{Number(store.deliveryFee || 0).toLocaleString()} บาท</p>
            </div>
            <div className="seller-info-item">
              <label>ยอดสั่งซื้อขั้นต่ำ</label>
              <p>{Number(store.minimumOrder || 0).toLocaleString()} บาท</p>
            </div>
            <div className="seller-info-item">
              <label>เวลาจัดส่งประมาณ</label>
              <p>{store.estimatedDeliveryTime || 30} นาที</p>
            </div>
            <div className="seller-info-item">
              <label>สถานะ</label>
              <p>
                <span className={`seller-status ${store.isActive ? "active" : "inactive"}`}>
                  {store.isActive ? "เปิดให้บริการ" : "ปิดการให้บริการ"}
                </span>
                {store.isVerified && <span className="seller-verified">✅ ร้านค้าที่ยืนยันแล้ว</span>}
              </p>
            </div>
          </div>
        </section>

        {store.openingHours && Object.keys(store.openingHours).length > 0 && (
          <section className="seller-section">
            <h2>ช่วงเวลาเปิดทำการ</h2>
            <div className="seller-hours-grid">
              {days.map((day) => {
                const hours = store.openingHours[day];
                if (!hours || hours.isClosed) {
                  return (
                    <div key={day} className="seller-hour-item closed">
                      <span className="seller-hour-day">{dayLabels[day]}</span>
                      <span className="seller-hour-time">ปิดทำการ</span>
                    </div>
                  );
                }
                return (
                  <div key={day} className="seller-hour-item">
                    <span className="seller-hour-day">{dayLabels[day]}</span>
                    <span className="seller-hour-time">
                      {hours.open} - {hours.close}
                    </span>
                  </div>
                );
              })}
            </div>
          </section>
        )}
      </main>

      {showEditModal && store && (
        <StoreProfileEditModal
          store={store}
          onClose={closeEditModal}
          onSaved={setStore}
        />
      )}
    </div>
  );
}