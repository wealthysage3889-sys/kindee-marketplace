import React, { useEffect, useMemo, useRef, useState } from "react";
import { storeAPI } from "../api/product";
import { orderAPI } from "../api";
import { formatCurrency } from "../utils/helpers";
import {
  getPendingPaymentOrders,
  getStoreOrders,
  resolveStoreOrderStoreId,
  resolveStoreOrderStoreName,
  getOrderPaymentCurrency,
  getOrderPaymentAmount,
  roundMoney,
} from "../utils/pendingPayments";
import "./KBZPayPaymentPopup.css";

const CURRENCY_SORT = { THB: 0, MMK: 1 };

const EMPTY_ORDERS = [];
const EMPTY_CHECKOUT_STORES = [];

// Slip upload constraints — PNG/JPG/JPEG/WEBP only, max 10MB (matches the
// storage bucket file_size_limit and the backend allowed mime types).
const SLIP_ACCEPT = "image/png,image/jpeg,image/webp";
const SLIP_ALLOWED_MIME = ["image/png", "image/jpeg", "image/webp"];
const SLIP_MAX_BYTES = 10 * 1024 * 1024;

const StoreIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 9l1.5-5h15L21 9" /><path d="M4 9v11h16V9" /><path d="M9 20v-6h6v6" /><path d="M3 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0" />
  </svg>
);

const QrIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
    <path d="M3 3h18v18H3z" />
    <line x1="12" y1="3" x2="12" y2="21" />
    <line x1="3" y1="12" x2="21" y2="12" />
  </svg>
);

const PhoneIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
  </svg>
);

const UserIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
  </svg>
);

const CloseIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M18 6 6 18" /><path d="m6 6 12 12" />
  </svg>
);

// ปรับข้อมูลตั้งค่า KBZPay จากร้านค้าให้เป็นรูปแบบเดียวกัน
// อ่านค่าฝั่ง snake_case (ชื่อคอลัมน์จริงใน DB ตาม migration 019_store_kbzpay_settings)
// เป็นหลัก แล้วค่อย fallback เป็น camelCase กัน API ตัวอื่นคืนคนละรูปแบบ
const normalizeKbzpaySettings = (raw) => {
  if (!raw) return null;
  const enabled = raw.kbzpay_enabled !== undefined ? Boolean(raw.kbzpay_enabled) : Boolean(raw.enabled);
  return {
    accountName: raw.kbzpay_account_name ?? raw.accountName ?? "",
    phoneNumber: raw.kbzpay_phone_number ?? raw.phoneNumber ?? "",
    receiverName: raw.kbzpay_receiver_name ?? raw.receiverName ?? "",
    qrUrl: raw.kbzpay_qr_url ?? raw.qrUrl ?? "",
    enabled,
  };
};

const isConfigured = (settings) => Boolean(
  settings &&
  settings.enabled &&
  settings.accountName &&
  settings.phoneNumber &&
  settings.receiverName
);

const settingsEqual = (a, b) => {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.enabled === b.enabled &&
    a.accountName === b.accountName &&
    a.phoneNumber === b.phoneNumber &&
    a.receiverName === b.receiverName &&
    a.qrUrl === b.qrUrl
  );
};

// สร้างคลังการตั้งค่า KBZPay ต่อ instance ของป๊อปอัป
// - cache   storeId -> settings ที่ normalize แล้ว (หรือ null ถ้าโหลดไม่สำเร็จ)
// - inflight storeId -> Promise ที่กำลังบินอยู่ ดedupe คำขอเดียวกันที่ซ้อนทับกัน
// คลังนี้อายุเท่ากับตัวป๊อปอัปที่ mount อยู่ (ปิดแล้วเปิดใหม่ = เริ่มต้นใหม่)
// จึงไม่เผย settings เก่ารอบก่อนให้รอบ checkout ใหม่โดยไม่ตั้งใจ
function createSettingsCache() {
  const cache = new Map();
  const inflight = new Map();
  async function fetchSettings(storeId) {
    if (cache.has(storeId)) return cache.get(storeId);
    if (inflight.has(storeId)) return inflight.get(storeId);
    const promise = (async () => {
      try {
        const res = await storeAPI.getKbzpaySettings(storeId, "customer");
        const settings = normalizeKbzpaySettings(res?.data || res || null);
        cache.set(storeId, settings);
        return settings;
      } catch {
        cache.set(storeId, null);
        return null;
      } finally {
        inflight.delete(storeId);
      }
    })();
    inflight.set(storeId, promise);
    return promise;
  }
  return { fetchSettings, cache };
}

export default function KBZPayPaymentPopup({
  open,
  onClose,
  orders = EMPTY_ORDERS,
  ordersLoading = false,
  kbzpaySettings,
  onSubmitted,
  checkoutMode = false,
  checkoutStores = EMPTY_CHECKOUT_STORES,
  onCheckoutSubmit,
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [settingsByStore, setSettingsByStore] = useState({});
  const [settingsVersion, setSettingsVersion] = useState(0);
  const [copiedPhone, setCopiedPhone] = useState("");
  const [downloadError, setDownloadError] = useState("");

  // สถานะการส่งสลิปจากปุ่ม Footer "ตกลง" (ส่งทุกกลุ่มร้านค้ารอบเดียว)
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");

  // Per-store slip upload state keyed by storeId. แต่ละร้านมีไฟล์ที่เลือกและ
  // preview ของตัวเอง แยกกันไม่ให้ร้านอื่นกระทบ
  const [slipFile, setSlipFile] = useState({});
  const [slipPreview, setSlipPreview] = useState({});
  const [slipError, setSlipError] = useState({});
  const [showAlert, setShowAlert] = useState(false);

  const settingsCacheRef = useRef(null);
  if (settingsCacheRef.current === null) {
    settingsCacheRef.current = createSettingsCache();
  }
  const wasOpenRef = useRef(open);

  // Create an object URL for a freshly selected file so the customer can see a
  // preview before submitting, and revoke it when replaced/removed.
  const setPreviewFor = (storeId, file) => {
    setSlipPreview((prev) => {
      if (prev[storeId]) URL.revokeObjectURL(prev[storeId]);
      return { ...prev, [storeId]: file ? URL.createObjectURL(file) : "" };
    });
  };

  useEffect(() => () => {
    Object.values(slipPreview).forEach((url) => url && URL.revokeObjectURL(url));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const wasOpen = wasOpenRef.current;
    wasOpenRef.current = open;
    if (!wasOpen || open) return;
    setSlipFile({});
    setSlipPreview((prev) => {
      Object.values(prev).forEach((url) => url && URL.revokeObjectURL(url));
      return {};
    });
    setSlipError({});
    setSubmitError("");
    setShowAlert(false);
  }, [open]);

  const handleSelectSlip = (storeId, file) => {
    setSlipError((prev) => ({ ...prev, [storeId]: "" }));
    if (!file) {
      setSlipFile((prev) => ({ ...prev, [storeId]: null }));
      setPreviewFor(storeId, null);
      return;
    }
    if (!SLIP_ALLOWED_MIME.includes(file.type)) {
      setSlipFile((prev) => ({ ...prev, [storeId]: null }));
      setPreviewFor(storeId, null);
      setSlipError((prev) => ({ ...prev, [storeId]: "รองรับเฉพาะไฟล์ PNG, JPG, JPEG, WEBP" }));
      return;
    }
    if (file.size > SLIP_MAX_BYTES) {
      setSlipFile((prev) => ({ ...prev, [storeId]: null }));
      setPreviewFor(storeId, null);
      setSlipError((prev) => ({ ...prev, [storeId]: "ไฟล์สลิปมีขนาดใหญ่เกิน 10MB" }));
      return;
    }
    setSlipFile((prev) => ({ ...prev, [storeId]: file }));
    setPreviewFor(storeId, file);
  };

  const pick = (o, ...ks) => { for (const k of ks) if (o && o[k] !== undefined && o[k] !== null) return o[k]; return undefined; };
  const pendingOrders = useMemo(
    () => getPendingPaymentOrders(orders).filter((order) => pick(order, "payment_method", "paymentMethod") === "kbzpay"),
    [orders]
  );

  // กรองมัลติสโเตอร์: แยกกลุ่มตาม store ของแต่ละออเดอร์ (อ่านผ่าน resolver เดียวกับ
  // ที่ Order Modal ใช้ เพื่อไม่ให้ข้อมูลที่ Modal แสดงได้กลับถูก Popup ตัดทิ้ง)
  // แต่ละร้านค้าจะแสดงเฉพาะออเดอร์ของตัวเองเท่านั้น
  //
  // checkout mode: ยังไม่มี Order (ยังไม่ได้สร้าง) จึงสร้างกลุ่มร้านค้าจาก
  // cart ที่ส่งมาแทน (checkoutStores) เพื่อแสดงข้อมูลรับชำระและแนบสลิปก่อน
  // สร้าง Order ทีหลังเมื่อกด ตกลง
  const storeGroups = useMemo(() => {
    if (checkoutMode && checkoutStores.length > 0) {
      const groups = new Map();
      checkoutStores.forEach((cs) => {
        const sid = cs.storeId;
        if (!sid) return;
        const currency = cs.currency || "MMK";
        const amount = cs.amountMmk || 0;
        const existing = groups.get(sid);
        if (existing) {
          if (!existing.storeName || existing.storeName === "ร้านค้า") {
            existing.storeName = cs.storeName || existing.storeName;
          }
          return;
        }
        const byCurrency = new Map();
        byCurrency.set(currency, { orders: [], total: amount, count: 1 });
        groups.set(sid, {
          storeId: sid,
          storeName: cs.storeName || "ร้านค้า",
          byCurrency,
          orderNumbers: new Set(),
          orders: [],
          seenOrderIds: new Set(),
        });
      });
      return Array.from(groups.values()).sort((a, b) => a.storeName.localeCompare(b.storeName));
    }

    const groups = new Map();
    pendingOrders.forEach((order) => {
      const orderId = pick(order, "id", "order_id", "orderId");
      const currency = getOrderPaymentCurrency(order);
      const amount = getOrderPaymentAmount(order, currency);
      const storeIdsForOrder = new Set();

      getStoreOrders(order).forEach((so) => {
        const sid = resolveStoreOrderStoreId(so);
        if (!sid) return;
        storeIdsForOrder.add(sid);
        if (!groups.has(sid)) {
          groups.set(sid, {
            storeId: sid,
            storeName: resolveStoreOrderStoreName(so) || "ร้านค้า",
            byCurrency: new Map(),
            orderNumbers: new Set(),
            orders: [],
            seenOrderIds: new Set(),
          });
        } else {
          // อัปเดตชื่อร้านถ้ากลุ่มตั้งชื่อชั่วคราวไว้ แล้วเจอชื่อจริงจากรายการถัดไป
          const g = groups.get(sid);
          if ((!g.storeName || g.storeName === "ร้านค้า")) {
            const name = resolveStoreOrderStoreName(so);
            if (name) g.storeName = name;
          }
        }
      });

      // เพิ่มออเดอร์เข้ากลุ่มร้านที่เกี่ยวข้องเพียงครั้งเดียวต่อร้าน
      storeIdsForOrder.forEach((sid) => {
        const g = groups.get(sid);
        if (orderId !== undefined && g.seenOrderIds.has(orderId)) return;
        if (orderId !== undefined) g.seenOrderIds.add(orderId);
        g.orderNumbers.add(order.order_number);
        g.orders.push({ order, amount });
        if (!g.byCurrency.has(currency)) {
          g.byCurrency.set(currency, { orders: [], total: 0, count: 0 });
        }
        const cg = g.byCurrency.get(currency);
        cg.orders.push({ order, amount });
        cg.total = roundMoney(cg.total + amount);
        cg.count += 1;
      });
    });
    return Array.from(groups.values()).sort((a, b) => a.storeName.localeCompare(b.storeName));
  }, [checkoutMode, checkoutStores, pendingOrders]);

  const storeIds = useMemo(
    () => [...new Set(storeGroups.map((group) => group.storeId).filter(Boolean))],
    [storeGroups]
  );
  const storeIdsKey = JSON.stringify(storeIds);

  // โหลดการตั้งค่าร้านค้าจาก Admin Store Payment Settings เมื่อเปิด popup
  // ถ้ามีอยู่ใน Props หรือ cache แล้วจะใช้ทันที ไม่เรียก API ซ้ำ (ข้อมูลไม่เก่า ไม่ null)
  // ใช้ in-flight deduplication กันคำขอ storeId เดียวกันซ้อนทับ และใช้ cancelled flag
  // กันไม่ให้ request เก่าอัปเดต state หลัง component unmount
  useEffect(() => {
    if (!open) return undefined;
    const settingsCache = settingsCacheRef.current;
    const cache = settingsCache.cache;
    const fetchSettings = settingsCache.fetchSettings;
    const cancelled = { current: false };

    storeIds.forEach((sid) => {
      if (!(sid in (kbzpaySettings || {}))) return;
      const next = normalizeKbzpaySettings(kbzpaySettings[sid]);
      if (!settingsEqual(cache.get(sid), next)) cache.set(sid, next);
    });

    const missing = storeIds.filter((sid) => !cache.has(sid));

    const mirrorCacheToState = () => {
      setSettingsByStore((prev) => {
        const next = { ...prev };
        let changed = false;
        storeIds.forEach((sid) => {
          const val = cache.get(sid);
          if (val !== undefined && !settingsEqual(prev[sid], val)) {
            next[sid] = val;
            changed = true;
          }
        });
        return changed ? next : prev;
      });
    };

    setLoading(true);
    setError("");

    if (missing.length === 0) {
      mirrorCacheToState();
      setLoading(false);
      return () => { cancelled.current = true; };
    }

    Promise.all(missing.map((sid) => fetchSettings(sid))).then((results) => {
      if (cancelled.current) return;
      results.forEach((settings, i) => {
        if (!settingsEqual(cache.get(missing[i]), settings)) {
          cache.set(missing[i], settings);
        }
      });
      mirrorCacheToState();
      const failed = results.filter((settings) => settings === null);
      if (failed.length > 0) {
        setError("ไม่สามารถโหลดการตั้งค่าร้านค้าบางร้านได้");
      }
      setLoading(false);
    });

    return () => { cancelled.current = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, storeIdsKey, kbzpaySettings, settingsVersion]);

  const retrySettings = () => {
    const cache = settingsCacheRef.current.cache;
    storeIds.forEach((sid) => {
      if (cache.get(sid) === null) cache.delete(sid);
    });
    setSettingsVersion((version) => version + 1);
  };

  const handleClose = (event) => {
    if (event) event.stopPropagation();
    onClose?.();
  };

  // ร้านค้าถือว่าแนบสลิปพร้อมส่งเมื่อมีไฟล์ที่ผ่าน validation และมี Preview แล้ว
  // (ยังไม่นับว่าเป็นการส่งสำเร็จจนกว่า Backend จะยืนยัน)
  const storeSlipReady = (storeId) =>
    Boolean(slipFile[storeId] && slipPreview[storeId]);

  // ปุ่ม Footer "ตกลง" เป็นปุ่มหลักสำหรับส่งสลิปทุกกลุ่มร้านค้า
  const handleDoneClick = async () => {
    if (submitting) return; // ป้องกัน Double Submit
    const notReady = storeGroups.find(
      (g) => !(slipFile[g.storeId] && slipPreview[g.storeId])
    );
    if (notReady) {
      setShowAlert(true);
      return;
    }
    setSubmitting(true);
    setSubmitError("");
    try {
      if (checkoutMode) {
        // Checkout mode: ยังไม่มี Order — หน้าหลักจะสร้าง Order ก่อนแล้วค่อย
        // ผูกสลิปกับ Order ของแต่ละร้านค้า (rollback ถ้าอัปโหลดสลิปไม่สำเร็จ)
        await onCheckoutSubmit?.(slipFile);
      } else {
        // ส่งข้อมูลแยกตามร้านค้า พร้อม orderIds และไฟล์สลิปของร้านค้านั้น
        await Promise.all(
          storeGroups.map((g) => {
            const orderIds = g.orders
              .map(({ order }) => pick(order, "id", "order_id", "orderId"))
              .filter(Boolean);
            return orderAPI.submitStorePaymentSlips(g.storeId, orderIds, slipFile[g.storeId], "");
          })
        );
      }
      // ส่งสำเร็จครบทุกกลุ่มร้านค้า — ปิด Popup และแจ้งหน้าหลักโหลดใหม่
      onClose?.();
      onSubmitted?.();
    } catch (err) {
      // ส่งไม่สำเร็จ — แสดงข้อผิดพลาดและคง Popup ไว้ให้ลองใหม่
      setSubmitError(err?.message || "ส่งสลิปไม่สำเร็จ กรุณาลองใหม่");
    } finally {
      setSubmitting(false);
    }
  };

  const handleAlertClose = () => {
    setShowAlert(false);
  };

  const handleCopyPhone = async (phone) => {
    const value = String(phone || "").trim();
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        const ta = document.createElement("textarea");
        ta.value = value;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopiedPhone(value);
      setTimeout(() => setCopiedPhone(""), 2000);
    } catch {
      setCopiedPhone("");
    }
  };

  const handleDownloadQr = async (url) => {
    setDownloadError("");
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error("download failed");
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = "Kindee-Admin-Shop-KBZPay-QR.jpg";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
    } catch {
      setDownloadError("ดาวน์โหลด QR Code ไม่สำเร็จ");
    }
  };

  const handleKeyDown = (event) => {
    if (event.key === "Escape") handleClose();
  };

  useEffect(() => {
    if (!open) return undefined;
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, handleKeyDown]);

  if (!open) return null;

  const totalStores = storeGroups.length;
  const totalOrders = storeGroups.reduce((sum, g) => sum + g.orderNumbers.size, 0);
  const pendingCount = pendingOrders.length;
  const grandTotalMmk = storeGroups.reduce((sum, g) => {
    let t = 0;
    g.byCurrency.forEach((cg, currency) => { if (currency === "MMK") t += cg.total; });
    return sum + t;
  }, 0);
  const allSlipsReady =
    totalStores > 0 && storeGroups.every((g) => storeSlipReady(g.storeId));

  return (
    <div
      className="kbzpay-popup-overlay"
      onClick={handleClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="kbzpay-popup-title"
    >
      <div
        className="kbzpay-popup-panel"
        onClick={(event) => event.stopPropagation()}
      >
        <button type="button" className="kbzpay-popup-close" onClick={handleClose} aria-label="ปิด">
          <CloseIcon />
        </button>

        <header className="kbzpay-popup-head">
          <div className="kbzpay-popup-icon"><StoreIcon /></div>
          <div>
            <h2 id="kbzpay-popup-title">ข้อมูลรับชำระเงิน KBZPay</h2>
            <p>
              {ordersLoading
                ? "กำลังโหลดคำสั่งซื้อ..."
                : checkoutMode
                  ? `${totalStores} ร้านค้า · ยอดรวม ${formatCurrency(grandTotalMmk, 'MMK')}`
                  : pendingCount === 0
                    ? "ไม่พบรายการที่รอชำระ"
                    : totalStores > 0
                      ? `รวม ${totalOrders} รายการจาก ${totalStores} ร้านค้า`
                      : "ไม่พบข้อมูลร้านค้าสำหรับคำสั่งซื้อ"}
            </p>
          </div>
        </header>

        {/* 1) กำลังโหลด Orders */}
        {ordersLoading && (
          <div className="kbzpay-popup-state">กำลังโหลดคำสั่งซื้อ...</div>
        )}

        {/* 2) ไม่มี KBZPay pending Orders จริง (ไม่ใช้ใน checkout mode เพราะยังไม่มี Order) */}
        {!checkoutMode && !ordersLoading && pendingCount === 0 && (
          <div className="kbzpay-popup-state">
            <p>ไม่มีคำสั่งซื้อที่รอชำระเงินผ่าน KBZPay</p>
          </div>
        )}

        {/* 3) มีออเดอร์ แต่ไม่พบข้อมูลร้านค้า (ข้อมูลไม่ครบ) — ต้องไม่กลับไปเป็น empty state */}
        {!checkoutMode && !ordersLoading && pendingCount > 0 && totalStores === 0 && (
          <div className="kbzpay-popup-state kbzpay-popup-error">
            <p>ไม่พบข้อมูลร้านค้าสำหรับคำสั่งซื้อ KBZPay จึงไม่สามารถแสดงข้อมูลรับชำระได้</p>
            <p className="kbzpay-notice-hint">กรุณาลองใหม่อีกครั้ง หากยังไม่พบข้อมูลโปรดติดต่อร้านค้า</p>
          </div>
        )}

        {/* 4) กำลังโหลดข้อมูลรับชำระจากร้านค้า (Settings) */}
        {!ordersLoading && totalStores > 0 && loading && (
          <div className="kbzpay-popup-state">กำลังโหลดข้อมูลรับชำระจากร้านค้า...</div>
        )}

        {/* 5) โหลด Settings ไม่สำเร็จ */}
        {!ordersLoading && totalStores > 0 && !loading && error && (
          <div className="kbzpay-popup-state kbzpay-popup-error">
            <p>{error}</p>
            <button type="button" className="kbzpay-popup-retry" onClick={retrySettings}>
              ลองใหม่
            </button>
          </div>
        )}

        {/* 6) โหลดสำเร็จ — แสดงรายการพร้อมข้อมูลบัญชีแต่ละร้าน */}
        {!ordersLoading &&
          !loading &&
          !error &&
          storeGroups.map((group) => {
            const rawSettings = (kbzpaySettings?.[group.storeId] ?? settingsByStore[group.storeId] ?? null);
            const settings = normalizeKbzpaySettings(rawSettings);
            const enabled = Boolean(settings?.enabled);
            const configured = isConfigured(settings);
            const currencyEntries = Array.from(group.byCurrency.entries()).sort(
              ([a], [b]) => (CURRENCY_SORT[a] ?? 99) - (CURRENCY_SORT[b] ?? 99)
            );
            const grandTotal = currencyEntries.reduce((sum, [, cg]) => sum + cg.total, 0);

            return (
              <section className="kbzpay-store-group" key={group.storeId}>
                <div className="kbzpay-store-header">
                  <div className="kbzpay-store-info">
                    <span className="kbzpay-store-name">{group.storeName}</span>
                    <span className={`kbzpay-store-badge ${enabled ? "kbzpay-badge-enabled" : "kbzpay-badge-disabled"}`}>
                      {enabled ? "เปิดรับชำระ KBZPay" : "ปิดใช้งาน KBZPay"}
                    </span>
                  </div>
                </div>

                <div className="kbzpay-store-body">
                  <div className="kbzpay-payment-detail">
                    {configured ? (
                      <>
                        <div className="kbzpay-detail-row">
                          <span className="kbzpay-detail-label"><UserIcon /> ชื่อบัญชี KBZPay</span>
                          <span className="kbzpay-detail-value">{settings.accountName}</span>
                        </div>
                        <div className="kbzpay-detail-row">
                          <span className="kbzpay-detail-label"><PhoneIcon /> เบอร์โทรศัพท์ / หมายเลขบัญชี</span>
                          <span className="kbzpay-detail-value">
                            {settings.phoneNumber}
                            <button
                              type="button"
                              className="kbzpay-copy-btn"
                              onClick={(e) => { e.stopPropagation(); handleCopyPhone(settings.phoneNumber); }}
                              aria-label="คัดลอกหมายเลข KBZPay"
                              title="คัดลอก"
                            >
                              {copiedPhone === String(settings.phoneNumber || "").trim() ? "คัดลอกแล้ว" : "คัดลอก"}
                            </button>
                          </span>
                        </div>
                        <div className="kbzpay-detail-row">
                          <span className="kbzpay-detail-label"><UserIcon /> ชื่อผู้รับเงิน</span>
                          <span className="kbzpay-detail-value">{settings.receiverName}</span>
                        </div>
                        <div className="kbzpay-detail-row">
                          <span className="kbzpay-detail-label"><QrIcon /> QR Code ร้านค้า</span>
                          <span className="kbzpay-detail-value">
                            {settings.qrUrl ? (
                              <>
                                <img
                                  className="kbzpay-qr-image"
                                  src={settings.qrUrl}
                                  alt={`QR Code ${group.storeName}`}
                                  loading="lazy"
                                />
                                <button
                                  type="button"
                                  className="kbzpay-download-btn"
                                  onClick={(e) => { e.stopPropagation(); handleDownloadQr(settings.qrUrl); }}
                                  aria-label="ดาวน์โหลด QR Code"
                                  title="ดาวน์โหลด QR Code"
                                >
                                  ดาวน์โหลด QR Code
                                </button>
                                {downloadError && <span className="kbzpay-qr-error">{downloadError}</span>}
                              </>
                            ) : (
                              <span className="kbzpay-qr-empty">ร้านค้ายังไม่ได้อัปโหลด QR Code</span>
                            )}
                          </span>
                        </div>
                      </>
                    ) : !enabled ? (
                      <div className="kbzpay-store-notice">
                        <p>ร้านค้านี้ปิดใช้งานการรับชำระผ่าน KBZPay</p>
                        <p className="kbzpay-notice-hint">
                          โปรดเลือกวิธีชำระเงินอื่น หรือติดต่อร้านค้าให้เปิดใช้งาน KBZPay
                        </p>
                      </div>
                    ) : (
                      <div className="kbzpay-store-notice">
                        <p>ยังไม่ได้ตั้งค่าข้อมูลบัญชี KBZPay ให้ครบถ้วน</p>
                        <p className="kbzpay-notice-hint">
                          โปรดติดต่อร้านค้าเพื่อขอข้อมูลการโอนเงิน หรือเลือกวิธีชำระเงินอื่น
                        </p>
                      </div>
                    )}
                  </div>

                  <div className="kbzpay-slip-upload">
                    <strong className="kbzpay-slip-label">แนบสลิปการโอนเงิน</strong>
                    <p className="kbzpay-slip-hint">
                      เลือกไฟล์รูปภาพสลิป (PNG, JPG, JPEG, WEBP) ขนาดไม่เกิน 10MB
                    </p>
                    {slipPreview[group.storeId] ? (
                      <div className="kbzpay-slip-preview">
                        <img
                          className="kbzpay-slip-preview-img"
                          src={slipPreview[group.storeId]}
                          alt="ตัวอย่างสลิปการโอนเงิน"
                        />
                        <span className="kbzpay-slip-filename">{slipFile[group.storeId]?.name}</span>
                      </div>
                    ) : null}
                    <div className="kbzpay-slip-actions">
                      <label className="kbzpay-slip-select">
                        <input
                          type="file"
                          accept={SLIP_ACCEPT}
                          className="kbzpay-slip-input"
                          aria-label="เลือกไฟล์สลิป"
                          onChange={(e) => handleSelectSlip(group.storeId, e.target.files?.[0] || null)}
                          disabled={submitting}
                        />
                        {slipPreview[group.storeId] ? "เปลี่ยนไฟล์" : "เลือกไฟล์สลิป"}
                      </label>
                    </div>
                    {slipError[group.storeId] ? (
                      <div className="kbzpay-slip-error">{slipError[group.storeId]}</div>
                    ) : null}
                  </div>
                </div>
              </section>
              );
          })}
        {!loading && !error && totalStores > 0 && (
          <div className="kbzpay-popup-foot">
            <div className="kbzpay-popup-summary">
              <span>ร้านค้าทั้งหมด</span>
              <strong>{totalStores}</strong>
              {!checkoutMode && totalOrders > 0 && (
                <>
                  <span>| Order ทั้งหมด</span>
                  <strong>{totalOrders}</strong>
                </>
              )}
              {grandTotalMmk > 0 && (
                <>
                  <span>| ยอดรวม (MMK)</span>
                  <strong>{formatCurrency(grandTotalMmk, 'MMK')}</strong>
                </>
              )}
            </div>
            <p className="kbzpay-popup-notice">
              เมื่อทำการชำระเงินแล้ว กรุณาแนบสลิปแล้วทำการกด ตกลง เพื่อทำรายการได้เลย
            </p>
            {submitError && (
              <div className="kbzpay-slip-error">{submitError}</div>
            )}
            <button type="button" className="btn kbzpay-popup-done" onClick={handleDoneClick} disabled={submitting}>
              {submitting ? "กำลังส่งสลิป..." : "ตกลง"}
            </button>
          </div>
        )}

        {/* Alert popup when user clicks ตกลง before all slips attached */}
        {showAlert && (
          <div className="kbzpay-alert-overlay" onClick={handleAlertClose} role="dialog" aria-modal="true" aria-labelledby="kbzpay-alert-title">
            <div className="kbzpay-alert-panel" onClick={(event) => event.stopPropagation()}>
              <h3 id="kbzpay-alert-title" className="kbzpay-alert-title">แจ้งเตือน</h3>
              <p className="kbzpay-alert-message">กรุณาชำระเงินก่อน แล้วนำสลิปมาแนบ แล้วกดตกลงใหม่</p>
              <button type="button" className="btn kbzpay-alert-btn" onClick={handleAlertClose}>
                ตกลง
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
