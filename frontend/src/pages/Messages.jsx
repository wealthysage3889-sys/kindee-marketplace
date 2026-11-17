import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { storeAPI } from "../api/product";
import { chatAPI } from "../api";
import { useAuth } from "../context/AuthContext";

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
  const { customer } = useAuth();
  const currentUserId = customer?.user?.id || customer?.user?._id || null;

  const fromStore = new URLSearchParams(location.search).get("fromStore");
  const openStore = new URLSearchParams(location.search).get("openStore");
  const storeId = fromStore || openStore;

  const visibleStores = useMemo(
    () =>
      stores.filter(
        (store) =>
          !currentUserId ||
          String(store.owner_id || store.ownerId || "") !== String(currentUserId)
      ),
    [stores, currentUserId]
  );

  const openRequestedRef = useRef("");

  const openConversation = async (id, { replaceListRoute = false } = {}) => {
    if (!id || openingId) return;
    const requestKey = `${id}|${currentUserId || ""}`;
    if (openRequestedRef.current === requestKey) return;
    openRequestedRef.current = requestKey;
    setOpeningId(id);
    setError("");
    try {
      const result = await chatAPI.getOrCreateConversation(id);
      const conversation = result?.data || result;
      if (conversation?.id) {
        openRequestedRef.current = "";
        navigate(`/messages/${conversation.id}`, { replace: replaceListRoute });
      } else {
        setError("ไม่สามารถเปิดการสนทนาได้");
        openRequestedRef.current = "";
      }
    } catch (err) {
      setError(err.message || "ไม่สามารถเปิดการสนทนาได้");
      openRequestedRef.current = "";
    } finally {
      setOpeningId("");
    }
  };

  useEffect(() => {
    if (!openStore) return;
    let cancelled = false;
    const initOpen = async () => {
      setError("");
      try {
        const res = await storeAPI.getStoreById(openStore);
        const storeData = (res && res.data) || res || null;
        if (
          storeData &&
          currentUserId &&
          String(storeData.owner_id || storeData.ownerId) === String(currentUserId)
        ) {
          if (!cancelled) {
            setError("ไม่สามารถเริ่มแชทกับร้านของตัวเองได้");
            setOpeningId("");
            navigate("/messages", { replace: true });
          }
          return;
        }
      } catch {
      }
      if (!cancelled) await openConversation(openStore, { replaceListRoute: true });
    };
    initOpen();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openStore, currentUserId]);

  useEffect(() => {
    let cancelled = false;
    const loadStores = async () => {
      try {
        const data = await storeAPI.getStores({ limit: 50 });
        if (!cancelled) {
          const storesList =
            Array.isArray(data?.data?.stores)
              ? data.data.stores
              : Array.isArray(data?.stores)
                ? data.stores
                : [];
          setStores(storesList);
        }
      } catch (err) {
        if (!cancelled) setError(err.message || "ไม่สามารถโหลดรายชื่อร้านค้าได้");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    loadStores();
    return () => {
      cancelled = true;
    };
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
          {visibleStores.length === 0 ? (
            <p className="product-empty">ยังไม่มีร้านค้าให้ส่งข้อความ</p>
          ) : (
            visibleStores.map((store) => (
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
