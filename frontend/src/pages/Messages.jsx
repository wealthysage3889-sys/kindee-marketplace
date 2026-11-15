import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { storeAPI } from "../api/product";
import { chatAPI } from "../api";

const ChevronLeftIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m15 18-6-6 6-6" />
  </svg>
);

export default function Messages() {
  const [stores, setStores] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [openingId, setOpeningId] = useState("");
  const location = useLocation();
  const navigate = useNavigate();

  const fromStore = new URLSearchParams(location.search).get("fromStore");
  const openStore = new URLSearchParams(location.search).get("openStore");
  const storeId = fromStore || openStore;

  const openConversation = async (id) => {
    if (!id || openingId) return;
    setOpeningId(id);
    setError("");
    try {
      const result = await chatAPI.getOrCreateConversation(id);
      const conversation = result?.data || result;
      if (conversation?.id) {
        navigate(`/messages/${conversation.id}`);
      } else {
        setError("ไม่สามารถเปิดการสนทนาได้");
      }
    } catch (err) {
      setError(err.message || "ไม่สามารถเปิดการสนทนาได้");
    } finally {
      setOpeningId("");
    }
  };

  // ถ้ามีการระบุ openStore ให้เด้งไปยังห้องแชทกับร้านค้านั้นทันที
  useEffect(() => {
    if (openStore) {
      openConversation(openStore);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openStore]);

  useEffect(() => {
    let cancelled = false;
    const loadStores = async () => {
      try {
        const data = await storeAPI.getStores({ limit: 50 });
        if (!cancelled) setStores(Array.isArray(data?.data) ? data.data : []);
      } catch (err) {
        if (!cancelled) setError(err.message || "ไม่สามารถโหลดรายชื่อร้านค้าได้");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    loadStores();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="page customer-page messages-page">
      <div className="customer-page-header">
        <Link
          to={storeId ? `/stores/${storeId}` : "/stores"}
          className="chat-back"
          aria-label="กลับหน้าร้านค้า"
        >
          <ChevronLeftIcon />
        </Link>
        <h1>ข้อความ</h1>
        <p>เลือกแชทกับร้านค้าเพื่อสอบถามสินค้า</p>
      </div>
      {loading && <div className="home-loading">กำลังโหลดร้านค้า...</div>}
      {error && <div className="home-error">{error}</div>}
      {!loading && !error && (
        <div className="store-grid">
          {stores.length === 0 ? (
            <p className="product-empty">ยังไม่มีร้านค้าให้ส่งข้อความ</p>
          ) : (
            stores.map((store) => (
              <Link
                to={`/messages/${store._id}`}
                className="chat-card"
                key={store._id}
                onClick={(event) => {
                  event.preventDefault();
                  openConversation(store._id);
                }}
              >
                <span className="chat-avatar">
                  {store.logo || store.logo_url ? (
                    <img src={store.logo || store.logo_url} alt={store.name} />
                  ) : (
                    (store.name || "ร้านค้า").charAt(0)
                  )}
                </span>
                <div className="chat-info">
                  <strong className="chat-name">{store.name || "ร้านค้า"}</strong>
                  <span className="chat-status">
                    {openingId === store._id
                      ? "กำลังเปิดแชท..."
                      : store.isActive === false || store.is_active === false
                        ? "ร้านค้าปิดทำการ"
                        : "เปิดร้าน"}
                  </span>
                </div>
                <span className="chat-time">แชท</span>
              </Link>
            ))
          )}
        </div>
      )}
    </div>
  );
}
