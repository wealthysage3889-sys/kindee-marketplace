import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAuth } from "../context/AuthContext";
import { orderAPI, uploadAPI } from "../api";
import { formatDate } from "../utils/helpers";
import { extractStorageObjectPath } from "../utils/storageUrl";
import "./PaymentSlipModal.css";

// Payment slips live in the private `payment-slips` Supabase bucket. The
// backend decorates every order's `payment_slips` with a freshly signed
// `slip_view_url` (orderService.getOrderById → withSignedUrls), so this modal
// never builds storage URLs itself and never touches a new storage system.
const SLIP_BUCKET = "payment-slips";

function slipViewUrl(slip) {
  return slip?.slip_view_url || slip?.slip_url || "";
}

function slipRawPath(slip) {
  return slip?.slip_path || "";
}

export default function PaymentSlipModal({ isOpen, onClose, orderId, mode = "admin" }) {
  const { admin } = useAuth();
  const [order, setOrder] = useState(null);
  const [slip, setSlip] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [imageSrc, setImageSrc] = useState("");
  const [imageLoading, setImageLoading] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const retriedRef = useRef(false);

  useEffect(() => {
    if (!isOpen || !orderId) {
      setOrder(null);
      setSlip(null);
      setLoading(false);
      setError("");
      setImageSrc("");
      setImageLoading(false);
      setImageError(false);
      retriedRef.current = false;
      setRetryKey(0);
      return;
    }

    let cancelled = false;
    const loadOrder = async () => {
      setLoading(true);
      setError("");
      setSlip(null);
      setImageSrc("");
      setImageLoading(false);
      setImageError(false);
      retriedRef.current = false;
      try {
        // Admin token namespace: the backend verifies the caller role and lets
        // admins/owners read any order; customers are limited to their own.
        const res = await orderAPI.getById(orderId, mode);
        const data = res?.data || res || null;
        if (!cancelled) {
          setOrder(data);
          const slips = Array.isArray(data?.payment_slips) ? data.payment_slips : [];
          // Show only slips bound to this exact order id.
          const mine = slips.filter((s) => String(s.order_id) === String(orderId));
          mine.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
          const selected = mine[0] || null;
          setSlip(selected);
          if (selected) {
            setImageSrc(slipViewUrl(selected));
            setImageLoading(true);
          }
        }
      } catch (err) {
        if (!cancelled) setError(err.message || "ไม่สามารถโหลดข้อมูลคำสั่งซื้อได้");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    loadOrder();
    return () => {
      cancelled = true;
    };
  }, [isOpen, orderId, mode, retryKey]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape") onClose?.();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onClose]);

  // Resolve a refreshable {bucket, path} from a stored slip URL/path without
  // building storage URLs by hand. Reuses the existing storage-url helper.
  const resolveSlipPath = useCallback((source) => {
    const parsed = extractStorageObjectPath(source);
    if (parsed) return parsed;
    const raw = slipRawPath(slip);
    if (raw) return { bucket: SLIP_BUCKET, path: raw };
    return null;
  }, [slip]);

  const refreshImage = useCallback(async () => {
    if (retriedRef.current) {
      setImageError(true);
      return;
    }
    const source = imageSrc || slipViewUrl(slip);
    const resolved = resolveSlipPath(source);
    if (!resolved) {
      setImageError(true);
      return;
    }
    retriedRef.current = true;
    try {
      const res = await uploadAPI.getSignedUrl(resolved.bucket, resolved.path, 3600, mode);
      const fresh = res?.data?.signedUrl;
      if (fresh) {
        setImageSrc(fresh);
        setImageError(false);
        setImageLoading(false);
      } else {
        setImageError(true);
      }
    } catch {
      setImageError(true);
    }
  }, [imageSrc, slip, mode, resolveSlipPath]);

  const handleImageError = useCallback(() => {
    void refreshImage();
  }, [refreshImage]);

  const handleRetry = useCallback(() => {
    setError("");
    setRetryKey((prev) => prev + 1);
  }, []);

  const handleBackdropClick = (event) => {
    if (event.target === event.currentTarget) onClose?.();
  };

  if (!isOpen) return null;

  // Admin gate: slip viewing from chat is an admin-only action. Access to
  // third-party orders is enforced by the backend via the admin JWT.
  if (mode !== "admin" || !admin) return null;

  const orderNumber = order?.order_number || "-";
  const slipSource = imageSrc || slipViewUrl(slip);

  return createPortal(
    <div
      className="payment-slip-modal-overlay"
      role="presentation"
      onMouseDown={handleBackdropClick}
    >
      <div className="payment-slip-modal-panel" onClick={(event) => event.stopPropagation()}>
        <button type="button" className="payment-slip-modal-close" onClick={onClose} aria-label="ปิด">
          &times;
        </button>
        <header className="payment-slip-modal-header">
          <h2 id="payment-slip-modal-title">รูปสลิปการชำระเงิน</h2>
          <span className="payment-slip-modal-order-no">#{orderNumber}</span>
        </header>
        <div className="payment-slip-modal-body">
          {loading && !order && (
            <div className="payment-slip-modal-loading">กำลังโหลดสลิป...</div>
          )}
          {error && !order && (
            <div className="payment-slip-modal-error" role="alert">
              {error}
              <button
                type="button"
                className="btn btn-outline btn-small"
                onClick={handleRetry}
                style={{ marginTop: 8 }}
              >
                ลองใหม่
              </button>
            </div>
          )}
          {order && !loading && !slip && (
            <div className="payment-slip-modal-empty">ไม่พบไฟล์สลิปสำหรับคำสั่งซื้อนี้</div>
          )}
          {order && !loading && slip && imageLoading && !imageError && !imageSrc && (
            <div className="payment-slip-modal-loading">กำลังโหลดรูปสลิป...</div>
          )}
          {order && !loading && slip && (
            <>
              {imageError && (
                <div className="payment-slip-modal-empty">โหลดรูปสลิปไม่สำเร็จ</div>
              )}
              {!imageError && imageSrc && (
                <>
                  <div className="payment-slip-modal-image-wrap">
                    {imageLoading && (
                      <div className="payment-slip-modal-loading">กำลังโหลดรูปสลิป...</div>
                    )}
                    <img
                      className="payment-slip-modal-img"
                      src={imageSrc}
                      alt="รูปสลิปการชำระเงิน"
                      onLoad={() => {
                        setImageLoading(false);
                      }}
                      onError={handleImageError}
                    />
                  </div>
                  {slip?.slip_filename && (
                    <div className="payment-slip-modal-file-name">{slip.slip_filename}</div>
                  )}
                </>
              )}
              {!imageError && !imageSrc && !imageLoading && (
                <div className="payment-slip-modal-empty">โหลดรูปสลิปไม่สำเร็จ</div>
              )}
              {!imageError && (
                <>
                  <div className="payment-slip-modal-row">
                    <span className="payment-slip-modal-label">เลขที่คำสั่งซื้อ</span>
                    <span className="payment-slip-modal-value">#{orderNumber}</span>
                  </div>
                  <div className="payment-slip-modal-row">
                    <span className="payment-slip-modal-label">อัปโหลดเมื่อ</span>
                    <span className="payment-slip-modal-value">{slip.created_at ? formatDate(slip.created_at) : "-"}</span>
                  </div>
                  <div className="payment-slip-modal-row">
                    <span className="payment-slip-modal-label">สถานะสลิป</span>
                    <span className={`payment-slip-modal-status slip-${slip.slip_status || ""}`}>
                      {slip.slip_status_label || slip.slip_status || "-"}
                    </span>
                  </div>
                </>
              )}
            </>
          )}
        </div>
        <div className="payment-slip-modal-actions">
          <button type="button" className="btn btn-secondary payment-slip-modal-btn-close" onClick={onClose}>
            ปิด
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
