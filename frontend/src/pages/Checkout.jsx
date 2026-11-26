import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useCart } from "../context/CartContext";
import html2canvas from "html2canvas";
import { addressAPI, orderAPI, storeAPI, settingsAPI } from "../api";
import { extractList, formatCurrency, formatPhone, validatePhone } from "../utils/helpers";
import PhoneInput from "../components/PhoneInput";
import KBZPayPaymentPopup from "../components/KBZPayPaymentPopup";
import "./Checkout.css";

const NOMINATIM_REVERSE_URL = "https://nominatim.openstreetmap.org/reverse";
const GEOLOCATION_OPTIONS = { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 };
const DELIVERY_STATUS = {
  IDLE: "idle",
  LOCATING: "locating",
  READY: "ready",
  ERROR: "error",
};

const round6 = (value) => Math.round(Number(value) * 1e6) / 1e6;

// Mirrors backend utils/productPricing.js#roundMoney and
// backend services/orderService.js#buildOrderPlan so the frontend's MMK
// amount is calculated from the exact same THB total the backend charges.
const roundMoney = (value) => {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return 0;
  return Math.round((amount + Number.EPSILON) * 100) / 100;
};

// Formats a Myanmar Kyat amount for display, e.g. "MMK 724,855.00".
// Uses the same 2-decimal rounding rule as THB so both currencies stay aligned.
const formatMMK = (amount) => {
  const value = Number(amount);
  if (!Number.isFinite(value)) return "-";
  const formatted = new Intl.NumberFormat("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
  return `MMK ${formatted}`;
};

const getStoreField = (store, camelKey, snakeKey) =>
  store[camelKey] !== undefined ? store[camelKey] : store[snakeKey];

// Computes order totals identically to the backend:
// per-store subtotal, VAT (roundMoney each), shipping fee per store
// (always charged, matching store_orders.shipping_fee), then rounded grand total.
// Accepts items/stores/vatRate/discountAmount so it never relies on out-of-scope state.
// discountAmount is subtracted to match backend buildOrderPlan#totalAmount exactly.
const computeOrderTotals = (items, stores, vatRate, discountAmount = 0) => {
  let totalSubtotal = 0;
  let totalShippingFee = 0;
  let totalTax = 0;

  (stores || []).forEach((store) => {
    const storeItems = items.filter((item) => item.storeId === store.id);
    const storeSubtotal = roundMoney(
      storeItems.reduce((sum, item) => sum + item.price * item.quantity, 0)
    );
    const shippingFee = roundMoney(getStoreField(store, 'deliveryFee', 'delivery_fee') || 0);
    const taxAmount = roundMoney(storeSubtotal * (vatRate / 100));

    totalSubtotal = roundMoney(totalSubtotal + storeSubtotal);
    totalShippingFee = roundMoney(totalShippingFee + shippingFee);
    totalTax = roundMoney(totalTax + taxAmount);
  });

  return {
    totalSubtotal,
    totalShippingFee,
    totalTax,
    totalAmount: roundMoney(totalSubtotal + totalShippingFee + totalTax - discountAmount),
  };
};

const isValidCoordinate = (lat, lng) =>
  Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;

const firstText = (source, keys) => {
  for (const key of keys) {
    const value = source?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
};

const uniqueValues = (values) => {
  const seen = new Set();
  return values.filter((value) => {
    if (!value || seen.has(value)) return false;
    seen.add(value);
    return true;
  });
};

const describeReverseGeocode = (data) => {
  const details = data?.address || {};
  const houseNumber = [firstText(details, ["house_number"]), firstText(details, ["house_name"])]
    .filter(Boolean)
    .join(" ");
  const road = firstText(details, ["road", "pedestrian", "footway", "path", "residential", "street"]);
  const subdistrict = firstText(details, ["suburb", "village", "quarter", "neighbourhood", "hamlet"]);
  const district = firstText(details, ["city_district", "district", "county", "municipality"]);
  const province = firstText(details, ["state", "province", "region"]);
  const postalCode = firstText(details, ["postcode"]);
  const country = firstText(details, ["country"]);

  const formatted = uniqueValues([
    houseNumber,
    road,
    subdistrict,
    district,
    province,
    postalCode,
    country,
  ]).join(" ");

  return {
    formatted: formatted || String(data?.display_name || "").trim(),
    houseNumber,
    road,
    subdistrict,
    district,
    province,
    postalCode,
    country,
  };
};

const geolocationErrorMessage = (error) => {
  if (error?.code === 1) {
    return "ไม่สามารถระบุตำแหน่งได้ กรุณาอนุญาตการเข้าถึงตำแหน่ง";
  }
  if (error?.code === 3) {
    return "ใช้เวลาค้นหาตำแหน่งนานเกินไป กรุณาลองดึงตำแหน่งอีกครั้ง";
  }
  return "ไม่สามารถระบุตำแหน่งได้ กรุณาลองดึงตำแหน่งอีกครั้ง";
};

const fetchReverseGeocode = async (lat, lng, signal) => {
  const url = `${NOMINATIM_REVERSE_URL}?format=jsonv2&lat=${lat}&lon=${lng}&addressdetails=1&accept-language=th`;
  const response = await fetch(url, { signal, headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error("reverse geocoding failed");
  const data = await response.json();
  const description = describeReverseGeocode(data);
  if (!description.formatted) throw new Error("empty reverse geocoding result");
  return description;
};

const coordinatesFromAddress = (address) => {
  if (
    address?.lat === undefined ||
    address?.lat === null ||
    address?.lng === undefined ||
    address?.lng === null
  ) {
    return null;
  }
  const lat = Number(address.lat);
  const lng = Number(address.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
};

const fullAddressFromAddress = (address) =>
  [address?.street, address?.subdistrict, address?.district, address?.province, address?.postal_code]
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join(" ");

function LocationPicker({ coordinates, address, onCoordinatesChange, onAddressChange }) {
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState("");
  const [addressText, setAddressText] = useState(address || "");

  useEffect(() => {
    setAddressText(address || "");
  }, [address]);

  const onCoordinatesChangeRef = useRef(onCoordinatesChange);
  onCoordinatesChangeRef.current = onCoordinatesChange;

  const onAddressChangeRef = useRef(onAddressChange);
  onAddressChangeRef.current = onAddressChange;

  const requestLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setError("เบราว์เซอร์ไม่รองรับการระบุตำแหน่ง");
      return;
    }
    setLocating(true);
    setError("");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        const next = { lat, lng };
        onCoordinatesChangeRef.current(next);
        reverseGeocode(lat, lng);
        setLocating(false);
      },
      (err) => {
        setError(geolocationErrorMessage(err));
        setLocating(false);
      },
      GEOLOCATION_OPTIONS
    );
  }, []);

  // ขอ GPS อัตโนมัติเมื่อป๊อปอัปที่อยู่จัดส่งเปิดขึ้น
  useEffect(() => {
    requestLocation();
  }, [requestLocation]);

  const reverseGeocode = async (lat, lng) => {
    try {
      const description = await fetchReverseGeocode(lat, lng, new AbortController().signal);
      setAddressText(description.formatted);
      onAddressChangeRef.current?.(description.formatted);
    } catch (err) {
      console.error("Reverse geocode error:", err);
    }
  };

  const handleAddressChange = (e) => {
    const value = e.target.value;
    setAddressText(value);
    onAddressChangeRef.current?.(value);
  };

  return (
    <div className="location-picker">
      {locating && (
        <div className="locating-status">
          <p>กำลังดึงตำแหน่งจาก GPS...</p>
        </div>
      )}

      {error && (
        <div className="location-error-state">
          <p className="location-error">{error}</p>
          <button type="button" onClick={requestLocation} className="btn-retry">
            ลองใหม่
          </button>
        </div>
      )}

      {coordinates && (
        <div className="selected-location">
          <label>ที่อยู่จัดส่ง:</label>
          <textarea
            value={addressText}
            onChange={handleAddressChange}
            rows={3}
            placeholder="รายละเอียดที่อยู่ (บ้านเลขที่ ซอย ถนน แขวง/ตำบล เขต/อำเภอ จังหวัด รหัสไปรษณีย์)"
          />
          <p className="coordinates">
            พิกัด: {coordinates.lat.toFixed(6)}, {coordinates.lng.toFixed(6)}
          </p>
          <button type="button" onClick={requestLocation} className="btn-retry">
            ใช้ตำแหน่งปัจจุบันอีกครั้ง
          </button>
        </div>
      )}

      {!coordinates && !locating && !error && (
        <button type="button" onClick={requestLocation} className="btn-retry">
          ใช้ตำแหน่งปัจจุบันอีกครั้ง
        </button>
      )}
    </div>
  );
}

export { LocationPicker };
export default function Checkout({ orderSummary, initialStep = 1, initialPaymentMethod = "cod", kbzpaySettings } = {}) {
  const { user, isAuthenticated } = useAuth();
  const { items, totalPrice, totalCount, clear } = useCart();
  const navigate = useNavigate();
  
  const [step, setStep] = useState(initialStep); // 1: address, 2: payment, 3: confirm
  const [coordinates, setCoordinates] = useState(null);
  const [deliveryAddress, setDeliveryAddress] = useState({
    name: user?.name || "",
    phone: user?.phone || "",
    address: "",
    subdistrict: "",
    district: "",
    province: "",
    postalCode: "",
    country: "TH",
    additionalDetails: "",
    label: ""
  });
  const [paymentMethod, setPaymentMethod] = useState(initialPaymentMethod);
  const [exchangeRate, setExchangeRate] = useState(null);
  const [rateUpdatedAt, setRateUpdatedAt] = useState(null);
  const [rateSource, setRateSource] = useState(null); // 'admin' or 'api'
  const [rateLoading, setRateLoading] = useState(false);
  const [rateError, setRateError] = useState("");
  const [vatRate, setVatRate] = useState(7);
  const [vatLoading, setVatLoading] = useState(true);
  const [customerNotes, setCustomerNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [stores, setStores] = useState([]);
  const [savedAddresses, setSavedAddresses] = useState([]);
  const [savedAddressesLoading, setSavedAddressesLoading] = useState(false);
  const [savedAddressesError, setSavedAddressesError] = useState("");
  const [selectedAddressId, setSelectedAddressId] = useState(null);
  const initialAddressAppliedRef = useRef(false);
  const submitLockRef = useRef(false);
  const summaryRef = useRef(null);
  const [kbzpayPopupOpen, setKbzpayPopupOpen] = useState(false);
  const [kbzpayPayload, setKbzpayPayload] = useState(null);
  const [kbzpayLoading, setKbzpayLoading] = useState(false);

  const applySavedAddress = useCallback((address) => {
    const nextCoordinates = coordinatesFromAddress(address);
    setCoordinates(nextCoordinates);
    setDeliveryAddress({
      name: address?.recipient_name || "",
      phone: address?.phone || "",
      address: fullAddressFromAddress(address) || address?.street || "",
      subdistrict: address?.subdistrict || "",
      district: address?.district || "",
      province: address?.province || "",
      postalCode: address?.postal_code || "",
      country: address?.country || "TH",
      additionalDetails: address?.additional_details || "",
      label: address?.label || "",
    });
    setSelectedAddressId(address?.id || null);
    setError("");
  }, []);

  const loadSavedAddresses = useCallback(async () => {
    if (!isAuthenticated) return;
    setSavedAddressesLoading(true);
    setSavedAddressesError("");
    try {
      const result = await addressAPI.getAddresses();
      const list = extractList(result, "addresses");
      setSavedAddresses(list);
      if (!initialAddressAppliedRef.current && list.length > 0) {
        const initialAddress = list.find((address) => address.is_default) || list[0];
        applySavedAddress(initialAddress);
        initialAddressAppliedRef.current = true;
      }
    } catch (error) {
      setSavedAddressesError(error.message || "ไม่สามารถโหลดที่อยู่ที่บันทึกไว้ได้");
    } finally {
      setSavedAddressesLoading(false);
    }
  }, [applySavedAddress, isAuthenticated]);

  useEffect(() => {
    loadSavedAddresses();
  }, [loadSavedAddresses]);

  const startManualAddress = () => {
    initialAddressAppliedRef.current = true;
    setSelectedAddressId(null);
    setCoordinates(null);
    setDeliveryAddress({
      name: user?.name || "",
      phone: user?.phone || "",
      address: "",
      subdistrict: "",
      district: "",
      province: "",
      postalCode: "",
      country: "TH",
      additionalDetails: "",
      label: "",
    });
    setError("");
  };

  const updateDeliveryAddress = (patch) => {
    setDeliveryAddress((prev) => ({ ...prev, ...patch, label: "" }));
    setSelectedAddressId(null);
  };

  const handleCoordinatesChange = (nextCoordinates) => {
    setCoordinates(nextCoordinates);
    setDeliveryAddress((prev) => ({ ...prev, label: "" }));
    setSelectedAddressId(null);
  };

  // Load store info for delivery fees
  useEffect(() => {
    let cancelled = false;
    const loadStoreInfo = async () => {
      const storeIds = [...new Set(items.map((item) => item.storeId).filter(Boolean))];
      const byId = {};
      for (const storeId of storeIds) {
        try {
          const store = await storeAPI.getById(storeId);
          if (!cancelled && store?.data) byId[store.data.id] = store.data;
        } catch (error) {
          console.error("Failed to load store:", error);
        }
      }
      if (!cancelled) setStores(Object.values(byId));
    };
    loadStoreInfo();
    return () => { cancelled = true; };
  }, [items]);

  const handleAddressSubmit = (e) => {
    e.preventDefault();
    
    if (!coordinates) {
      setError("กรุณาดึงตำแหน่งจาก GPS ก่อนดำเนินการต่อ");
      return;
    }
    
    if (!validatePhone(deliveryAddress.phone)) {
      setError("กรุณากรอกเบอร์โทรศัพท์ให้ถูกต้อง (รองรับไทย +66 และเมียนมา +95)");
      return;
    }
    
    setStep(2);
    setError("");
  };

  useEffect(() => {
    if (paymentMethod !== "kbzpay") return;
    let cancelled = false;
    const fetchRate = async () => {
      setRateLoading(true);
      setRateError("");
      try {
        // First, try to get admin-defined exchange rate from settings
        let adminRate = null;
        try {
          const settingsRes = await settingsAPI.getByKey("exchange_rate_thb_mmk");
          if (settingsRes?.data?.value) {
            adminRate = Number(settingsRes.data.value);
          }
        } catch {
          // Settings not found or not accessible, will fall back to API
        }

        if (adminRate && Number.isFinite(adminRate) && adminRate > 0) {
          if (cancelled) return;
          setExchangeRate(adminRate);
          setRateSource("admin");
          setRateUpdatedAt(new Date().toISOString());
        } else {
          // Fall back to external API
          const res = await fetch("https://open.er-api.com/v6/latest/THB");
          if (!res.ok) throw new Error("rate fetch failed");
          const data = await res.json();
          if (!data || data.result !== "success" || !data.rates || !data.rates.MMK) {
            throw new Error("invalid rate response");
          }
          if (cancelled) return;
          setExchangeRate(Number(data.rates.MMK));
          setRateSource("api");
          setRateUpdatedAt(data.time_last_update_utc || new Date().toISOString());
        }
      } catch (err) {
        if (cancelled) return;
        setExchangeRate(null);
        setRateUpdatedAt(null);
        setRateSource(null);
        setRateError("Unable to fetch THB to MMK exchange rate. Please retry or choose another method.");
      } finally {
        if (!cancelled) setRateLoading(false);
      }
    };
    fetchRate();
    return () => { cancelled = true; };
  }, [paymentMethod]);

  useEffect(() => {
    const loadVatRate = async () => {
      try {
        const res = await settingsAPI.getByKey("vat_rate");
        const rate = res?.data?.value != null ? Number(res.data.value) : 7;
        setVatRate(Number.isFinite(rate) && rate >= 0 && rate <= 100 ? rate : 7);
      } catch {
        setVatRate(7);
      } finally {
        setVatLoading(false);
      }
    };
    loadVatRate();
  }, []);

  const handlePaymentSubmit = (e) => {
    e.preventDefault();
    
    // Validate KBZPay exchange rate is ready before proceeding to confirmation
    if (paymentMethod === "kbzpay") {
      if (rateLoading) {
        setError("กำลังดึงอัตราแลกเปลี่ยน กรุณารอสักครู่");
        return;
      }
      if (rateError || !exchangeRate) {
        setError("ไม่สามารถดึงอัตราแลกเปลี่ยนได้ กรุณาลองใหม่หรือเลือกวิธีชำระเงินอื่น");
        return;
      }
    }
    
    setStep(3);
    setError("");
  };

  const handleConfirmOrder = async () => {
    if (submitLockRef.current) return;

    // Validate KBZPay exchange rate before proceeding
    if (paymentMethod === "kbzpay") {
      if (rateLoading) {
        setError("กำลังดึงอัตราแลกเปลี่ยน กรุณารอสักครู่");
        return;
      }
      if (rateError || !exchangeRate) {
        setError("ไม่สามารถดึงอัตราแลกเปลี่ยนได้ กรุณาลองใหม่หรือเลือกวิธีชำระเงินอื่น");
        return;
      }
    }

    // Validate that the logged-in profile has name and phone before submitting the order
    if (!user?.name || !user?.phone) {
      setError("ยังไม่พบชื่อและเบอร์โทรศัพท์ในโปรไฟล์ของคุณ กรุณาแก้ไขโปรไฟล์ให้ครบถ้วนก่อนสั่งซื้อ");
      return;
    }

    // Prepare order items with store info (shared by KBZPay and other methods)
    const orderItems = items.map((item) => ({
      productId: item.id,
      quantity: item.quantity,
    }));

    // Format delivery address
    const selectedAddress = savedAddresses.find((address) => address.id === selectedAddressId) || null;
    const formattedAddress = {
      name: deliveryAddress.name,
      phone: deliveryAddress.phone,
      address: deliveryAddress.address,
      subdistrict: deliveryAddress.subdistrict,
      district: deliveryAddress.district,
      province: deliveryAddress.province,
      postalCode: deliveryAddress.postalCode,
      country: deliveryAddress.country,
      additionalDetails: deliveryAddress.additionalDetails,
      ...(selectedAddress
        ? {
            label: selectedAddress.label || "",
            place_name: selectedAddress.label || selectedAddress.recipient_name || "",
            address_book_id: selectedAddress.id,
          }
        : {}),
    };

    if (paymentMethod === "kbzpay") {
      // KBZPay: ห้ามสร้าง Order ในขั้นตอนนี้ — เปิด Popup เพื่อแนบสลิปก่อน
      setKbzpayPayload({
        items: orderItems,
        paymentMethod: "kbzpay",
        exchangeRate,
        exchangeRateSource: rateSource === "admin" ? "admin_settings" : "open.er-api.com",
        exchangeRateUpdatedAt: rateUpdatedAt,
        amountMMK: roundMoney(totalAmount * exchangeRate),
        customerNotes,
        deliveryAddress: formattedAddress,
        customerCoordinates: coordinates,
      });
      setError("");
      setKbzpayPopupOpen(true);
      return;
    }

    submitLockRef.current = true;
    setLoading(true);
    setError("");
    try {
      const result = await orderAPI.create({
        items: orderItems,
        paymentMethod,
        ...(paymentMethod === "kbzpay"
          ? {
              exchangeRate,
              exchangeRateSource: rateSource === "admin" ? "admin_settings" : "open.er-api.com",
              exchangeRateUpdatedAt: rateUpdatedAt,
              amountMMK: roundMoney(totalAmount * exchangeRate),
            }
          : {}),
        customerNotes,
        deliveryAddress: formattedAddress,
        customerCoordinates: coordinates,
      });

      // Capture summary image after successful order creation
      try {
        if (summaryRef.current) {
          const canvas = await html2canvas(summaryRef.current, { scale: 2, useCORS: true, backgroundColor: "#ffffff" });
          const link = document.createElement("a");
          const now = new Date();
          const pad = (n) => String(n).padStart(2, "0");
          const name = `kindee-order-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.png`;
          link.download = name;
          link.href = canvas.toDataURL("image/png");
          link.click();
        }
      } catch (imgErr) {
        alert("สั่งซื้อสำเร็จแล้ว แต่ไม่สามารถสร้างภาพสรุปรายการได้");
      }

      clear();
      navigate(`/orders/${result.data.id}`);
    } catch (err) {
      setError(err.message || "เกิดข้อผิดพลาดในการสั่งซื้อ");
    } finally {
      setLoading(false);
      submitLockRef.current = false;
    }
  };

  // KBZPay checkout flow: สร้าง Order แล้วค่อยผูกสลิปกับ Order ของแต่ละร้านค้า
  // หากอัปโหลดสลิปไม่สำเร็จ ต้องยกเลิก Order ที่สร้างไว้ ไม่ให้เหลือ Order
  // ที่สร้างสำเร็จแต่ไม่มีสลิปค้างอยู่ในระบบ
  const handleKbzpayCheckoutSubmit = async (slipFilesByStore) => {
    if (!kbzpayPayload) return;
    setKbzpayLoading(true);
    let createdOrderId = null;
    try {
      const result = await orderAPI.create(kbzpayPayload);
      createdOrderId = result.data?.id;
      if (!createdOrderId) {
        throw new Error("สร้างคำสั่งซื้อไม่สำเร็จ: ไม่พบ Order ID ใน response");
      }
      // Backend stores store_orders with `id` (store_order PK) AND `parent_order_id`
      // (FK to orders.id). The submit-slip endpoint queries `.from('orders')` by id,
      // so orderIds must be the PARENT order id — not the store_order id.
      // All store orders of one checkout share the same parent order id, and the
      // backend verifies store ownership per order by joining store_orders.
      const storeOrders = result.data?.store_orders || [];
      const parentOrderIdsByStore = {};
      storeOrders.forEach((so) => {
        const sid = so.store_id || (so.store && so.store.id);
        if (!sid) return;
        (parentOrderIdsByStore[sid] = parentOrderIdsByStore[sid] || []).push(createdOrderId);
      });

      // อัปโหลดสลิปแยกตามร้านค้า ผูกกับ Order ของร้านค้านั้น
      await Promise.all(
        Object.entries(slipFilesByStore).map(async ([storeId, file]) => {
          const orderIds = parentOrderIdsByStore[storeId] || [];
          if (orderIds.length === 0) {
            throw new Error(`ไม่พบคำสั่งซื้อของร้านค้า ${storeId}`);
          }
          return orderAPI.submitStorePaymentSlips(storeId, orderIds, file, "");
        })
      );

      // ทำรายการสำเร็จทุกกลุ่มร้านค้า — เคลียร์ตะกร้า ปิด popup ไปหน้าติดตามออเดอร์
      clear();
      setKbzpayPopupOpen(false);
      navigate(`/orders/${createdOrderId}`);
    } catch (err) {
      // Rollback: ยกเลิก Order ที่สร้างไว้ ไม่ให้เหลือ Order โดยไม่มีสลิป
      if (createdOrderId) {
        try {
          await orderAPI.cancel(createdOrderId, "ยกเลิกคำสั่งซื้อเนื่องจากอัปโหลดสลิปไม่สำเร็จ");
        } catch {
          // ignore rollback errors; the surfaced error is the original failure
        }
      }
      throw err;
    } finally {
      setKbzpayLoading(false);
    }
  };

  const computedTotals = computeOrderTotals(items, stores, vatRate);
  const totals = orderSummary || computedTotals;
  const shippingFee = totals.totalShippingFee;
  const taxAmount = totals.totalTax;
  const totalAmount = totals.totalAmount;
  const displayVatRate = orderSummary?.vatRate ?? vatRate;

  // KBZPay customers see their order in MMK using the same THB→MMK rate that was
  // fetched in step 2 (and sent to the backend for validation). Any other method
  // keeps the original THB-only display.
  const isKbzpay = paymentMethod === "kbzpay";
  const hasValidRate =
    isKbzpay && !rateLoading && !rateError && Number.isFinite(exchangeRate) && exchangeRate > 0;

  // Per-store MMK amounts for the KBZPay popup (checkout mode), computed with the
  // same per-store subtotal/shipping/VAT rules as the backend so the displayed
  // MMK totals match what will be charged.
  const checkoutStores = useMemo(() => {
    if (!isKbzpay || !hasValidRate) return [];
    return stores.map((store) => {
      const storeItems = items.filter((item) => item.storeId === store.id);
      const subtotal = roundMoney(storeItems.reduce((sum, item) => sum + item.price * item.quantity, 0));
      const shippingFee = roundMoney(getStoreField(store, 'deliveryFee', 'delivery_fee') || 0);
      const taxAmount = roundMoney(subtotal * (vatRate / 100));
      const storeTotalThb = roundMoney(subtotal + shippingFee + taxAmount);
      return {
        storeId: store.id,
        storeName: store.name,
        amountMmk: roundMoney(storeTotalThb * exchangeRate),
      };
    });
  }, [stores, items, vatRate, exchangeRate, isKbzpay, hasValidRate]);

  // Formats a THB amount as "฿X / MMK Y" for KBZPay, or THB-only otherwise.
  // Used by the grand-total row, which keeps both currencies.
  // MMK is derived from the exact same THB value the row displays and rounded with
  // the same roundMoney rule the backend uses, so totals always line up.
  const displayMoney = (amount) => {
    const thb = formatCurrency(amount);
    if (!hasValidRate) return thb;
    return `${thb} / ${formatMMK(roundMoney(amount * exchangeRate))}`;
  };

  // MMK-only display for KBZPay (item rows, subtotal, shipping, VAT).
  // Any other payment method keeps the original THB-only display.
  const displayMoneyMMKOnly = (amount) => {
    if (!hasValidRate) return formatCurrency(amount);
    return formatMMK(roundMoney(amount * exchangeRate));
  };

  const paymentMethodDisplay =
    paymentMethod === "cod"
      ? "ชำระเงินปลายทาง"
      : "KBZPay Wallet (Myanmar)";

  if (!isAuthenticated) {
    return (
      <div className="checkout-container">
        <div className="checkout-auth-required">
          <h2>กรุณาเข้าสู่ระบบเพื่อสั่งซื้อ</h2>
          <p>คุณต้องเข้าสู่ระบบก่อนจะสามารถทำการสั่งซื้อได้</p>
          <button onClick={() => navigate("/login")}>เข้าสู่ระบบ</button>
        </div>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="checkout-container">
        <div className="empty-cart">
          <h2>ตะกร้าสินค้าว่างเปล่า</h2>
          <button onClick={() => navigate("/")}>กลับไปหน้าหลัก</button>
        </div>
      </div>
    );
  }

  return (
    <div className="checkout-container">
      <div className="checkout-progress">
        <div className={`step ${step >= 1 ? "active" : ""}`}>
          <span className="step-number">1</span>
          <span className="step-label">ที่อยู่จัดส่ง</span>
        </div>
        <div className={`step ${step >= 2 ? "active" : ""}`}>
          <span className="step-number">2</span>
          <span className="step-label">ชำระเงิน</span>
        </div>
        <div className={`step ${step >= 3 ? "active" : ""}`}>
          <span className="step-number">3</span>
          <span className="step-label">ยืนยัน</span>
        </div>
      </div>

      {step === 1 && (
        <form onSubmit={handleAddressSubmit} className="checkout-form">
          {(savedAddressesLoading || savedAddresses.length > 0 || savedAddressesError) && (
            <div className="form-section">
              <h3>ที่อยู่ที่บันทึกไว้</h3>
              {savedAddressesLoading && <p>กำลังโหลดที่อยู่...</p>}
              {savedAddressesError && <div className="error-message">{savedAddressesError}</div>}
              {savedAddresses.length > 0 && (
                <div className="saved-address-grid">
                  <button
                    type="button"
                    className={`saved-address-card ${selectedAddressId === null ? "selected" : ""}`}
                    onClick={startManualAddress}
                  >
                    <span className="saved-address-card-title">
                      <strong>ใช้ที่อยู่ใหม่</strong>
                    </span>
                    <span>กรอกข้อมูลผู้รับและที่อยู่ด้านล่าง</span>
                  </button>
                  {savedAddresses.map((address) => {
                    const addressCoordinates = coordinatesFromAddress(address);
                    return (
                      <button
                        type="button"
                        className={`saved-address-card ${selectedAddressId === address.id ? "selected" : ""}`}
                        key={address.id}
                        onClick={() => applySavedAddress(address)}
                      >
                        <span className="saved-address-card-title">
                          <strong>{address.label || "ที่อยู่"}</strong>
                          {address.is_default && <span className="saved-address-default">ที่อยู่หลัก</span>}
                        </span>
                        <span>
                          {address.recipient_name} · {formatPhone(address.phone)}
                        </span>
                        {fullAddressFromAddress(address) && <span>{fullAddressFromAddress(address)}</span>}
                        {addressCoordinates && (
                          <span className="saved-address-coordinates">
                            พิกัด: {addressCoordinates.lat.toFixed(6)}, {addressCoordinates.lng.toFixed(6)}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          <div className="form-section">
            <h3>ข้อมูลผู้รับ</h3>
            <div className="form-row">
              <div className="form-group">
                <label>ชื่อ-นามสกุล *</label>
                <input
                  type="text"
                  value={deliveryAddress.name}
                  onChange={(e) => updateDeliveryAddress({ name: e.target.value })}
                  required
                />
              </div>
              <div className="form-group">
                <PhoneInput
                  value={deliveryAddress.phone}
                  onChange={(e164) => updateDeliveryAddress({ phone: e164 })}
                  required
                  placeholder="08X-XXX-XXXX"
                  label="เบอร์โทรศัพท์ *"
                />
              </div>
            </div>
          </div>

          <div className="form-section">
            <h3>ตำแหน่งจัดส่ง</h3>
            <p className="map-instruction">ระบบจะขอตำแหน่งจาก GPS อัตโนมัติ กรุณาอนุญาตการเข้าถึงตำแหน่ง</p>
            <LocationPicker
              coordinates={coordinates}
              address={deliveryAddress.address}
              onCoordinatesChange={handleCoordinatesChange}
              onAddressChange={(addr) => updateDeliveryAddress({ address: addr })}
            />
          </div>

          {error && <div className="error-message">{error}</div>}

          <div className="form-actions">
            <button type="submit" className="btn-primary" disabled={!coordinates}>
              ถัดไป: ชำระเงิน
            </button>
          </div>
        </form>
      )}

      {step === 2 && (
        <form onSubmit={handlePaymentSubmit} className="checkout-form">
          <div className="form-section">
            <h3>เลือกวิธีชำระเงิน</h3>
            <div className="payment-options">
              <label className={`payment-option ${paymentMethod === "cod" ? "selected" : ""}`}>
                <input
                  type="radio"
                  name="paymentMethod"
                  value="cod"
                  checked={paymentMethod === "cod"}
                  onChange={(e) => setPaymentMethod(e.target.value)}
                />
                <div className="payment-option-content">
                  <span className="payment-icon">💵</span>
                  <div>
                    <strong>ชำระเงินปลายทาง (COD)</strong>
                    <p>จ่ายเงินสดเมื่อได้รับสินค้า</p>
                  </div>
                </div>
              </label>

              <label className={`payment-option ${paymentMethod === "kbzpay" ? "selected" : ""}`}>
                <input
                  type="radio"
                  name="paymentMethod"
                  value="kbzpay"
                  checked={paymentMethod === "kbzpay"}
                  onChange={(e) => setPaymentMethod(e.target.value)}
                />
                <div className="payment-option-content">
                  <span className="payment-icon">KBZ</span>
                  <div>
                    <strong>KBZPay Wallet (Myanmar)</strong>
                    <p>Pay in MMK using live THB to MMK rate</p>
                  </div>
                </div>
              </label>

              {paymentMethod === "kbzpay" && (
                <div className="kbzpay-exchange-rate">
                  {rateLoading && <p className="rate-loading">กำลังดึงอัตราแลกเปลี่ยน...</p>}
                  {rateError && (
                    <div className="rate-error">
                      <span>{rateError}</span>
                      <button type="button" className="btn-retry" onClick={() => {
                        // Trigger re-fetch by temporarily switching payment method
                        setPaymentMethod("cod");
                        setTimeout(() => setPaymentMethod("kbzpay"), 0);
                      }}>
                        ลองใหม่
                      </button>
                    </div>
                  )}
                  {exchangeRate && !rateLoading && !rateError && (
                    <div className="rate-success">
                      <p><strong>อัตราแลกเปลี่ยน:</strong> 1 THB = {exchangeRate.toFixed(2)} MMK</p>
                      <p><strong>อัปเดตเมื่อ:</strong> {new Date(rateUpdatedAt).toLocaleString('th-TH')}</p>
                      <p><strong>แหล่งข้อมูล:</strong> {rateSource === "admin" ? "การตั้งค่าของแอดมิน (Admin Settings)" : "open.er-api.com (API อัตโนมัติ)"}</p>
                      <p className="rate-preview"><strong>ยอดโดยประมาณ:</strong> ~{roundMoney(totalAmount * exchangeRate)} MMK</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="form-section">
            <h3>หมายเหตุเพิ่มเติม (ถ้ามี)</h3>
            <textarea
              value={customerNotes}
              onChange={(e) => setCustomerNotes(e.target.value)}
              rows={3}
              placeholder="ข้อมูลเพิ่มเติมสำหรับผู้จัดส่ง..."
            />
          </div>

          {error && <div className="error-message">{error}</div>}

          <div className="form-actions">
            <button type="button" className="btn-secondary" onClick={() => setStep(1)}>กลับ</button>
            <button 
              type="submit" 
              className="btn-primary" 
              disabled={paymentMethod === "kbzpay" && (rateLoading || rateError || !exchangeRate)}
            >
              ถัดไป: ยืนยัน
            </button>
          </div>
        </form>
      )}

      {step === 3 && (
        <div className="checkout-form">
          <div ref={summaryRef}>
          <div className="form-section">
            <h3>สรุปรายการสั่งซื้อ</h3>
            <div className="order-summary">
              {items.length > 0 ? (
                <>
                  <div className="order-items-table">
                    <div className="order-items-header">
                      <span>ชื่อสินค้า</span>
                      <span>จำนวน</span>
                      <span>ยอดเงิน</span>
                    </div>
                    {items.map(item => (
                      <div key={item.id} className="order-item-row">
                        <span className="item-name-cell">{item.name}</span>
                        <span className="item-qty-cell">{item.quantity} ชิ้น</span>
                        <span className="item-price-cell">{displayMoneyMMKOnly(item.price * item.quantity)}</span>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <p className="empty-order">ไม่มีรายการสินค้า</p>
              )}
              
              <div className="summary-row">
                <span>สินค้าทั้งหมด</span>
                <span>{totalCount} ชิ้น</span>
              </div>
              <div className="summary-row">
                <span>ราคาสินค้า</span>
                <span>{displayMoneyMMKOnly(totalPrice)}</span>
              </div>
              <div className="summary-row">
                <span>ค่าจัดส่ง</span>
                <span>{displayMoneyMMKOnly(shippingFee)}</span>
              </div>
              <div className="summary-row">
                <span>ภาษีมูลค่าเพิ่ม ({displayVatRate}%)</span>
                <span>{displayMoneyMMKOnly(taxAmount)}</span>
              </div>
              <div className="summary-row total">
                <span>รวมทั้งสิ้น</span>
                <span>{displayMoney(totalAmount)}</span>
              </div>
            </div>
          </div>

          <div className="form-section">
            <h3>วิธีชำระเงิน</h3>
            <p>{paymentMethodDisplay}</p>
            {isKbzpay && hasValidRate && (
              <div className="kbzpay-exchange-rate">
                <div className="rate-success">
                  <p><strong>อัตราแลกเปลี่ยน:</strong> 1 THB = {exchangeRate.toFixed(2)} MMK</p>
                  <p><strong>อัปเดตเมื่อ:</strong> {new Date(rateUpdatedAt).toLocaleString('th-TH')}</p>
                  <p><strong>แหล่งข้อมูล:</strong> {rateSource === "admin" ? "การตั้งค่าของแอดมิน (Admin Settings)" : "open.er-api.com (API อัตโนมัติ)"}</p>
                </div>
              </div>
            )}
            {isKbzpay && !hasValidRate && (
              <div className="rate-error">
                <span>
                  {rateLoading
                    ? "กำลังดึงอัตราแลกเปลี่ยน..."
                    : rateError || "ไม่พบอัตราแลกเปลี่ยน ไม่สามารถแสดงยอด MMK ได้"}
                </span>
                <button type="button" className="btn-secondary" onClick={() => setStep(2)}>
                  กลับไปขั้นตอนชำระเงิน
                </button>
              </div>
            )}
          </div>
          </div>

          {customerNotes && (
            <div className="form-section">
              <h3>หมายเหตุ</h3>
              <p>{customerNotes}</p>
            </div>
          )}

          {error && <div className="error-message">{error}</div>}

          <div className="form-actions">
            <button type="button" className="btn-secondary" onClick={() => setStep(2)}>แก้ไข</button>
            <button 
              type="button" 
              className="btn-primary btn-large" 
              onClick={handleConfirmOrder}
              disabled={loading || (paymentMethod === "kbzpay" && (rateLoading || rateError || !exchangeRate))}
            >
              {loading ? "กำลังดำเนินการ..." : "ยืนยันสั่งซื้อ"}
            </button>
          </div>

          <KBZPayPaymentPopup
            open={kbzpayPopupOpen}
            checkoutMode
            checkoutStores={checkoutStores}
            kbzpaySettings={kbzpaySettings}
            onClose={() => setKbzpayPopupOpen(false)}
            onSubmitted={() => setKbzpayPopupOpen(false)}
            onCheckoutSubmit={handleKbzpayCheckoutSubmit}
          />
        </div>
      )}
    </div>
  );
}

