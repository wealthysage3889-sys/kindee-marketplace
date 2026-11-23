import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { adminAPI } from "../api/admin";
import { storeAPI } from "../api/product";
import StoreProfileEditModal from "../components/StoreProfileEditModal";

const MODAL_TITLES = {
  profile: "แก้ไขข้อมูลส่วนตัว",
  password: "เปลี่ยนรหัสผ่าน",
  addAdmin: "เพิ่มแอดมิน",
  socialLogin: "ตั้งค่า Google / Social Login",
  exchangeRate: "ตั้งค่าอัตราแลกเปลี่ยน THB → MMK",
  vat: "ตั้งค่าภาษีมูลค่าเพิ่ม",
};

const MoreVerticalIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <circle cx="12" cy="5" r="1.8" />
    <circle cx="12" cy="12" r="1.8" />
    <circle cx="12" cy="19" r="1.8" />
  </svg>
);
const EditIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
  </svg>
);
const StoreIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 9l1.5-5h15L21 9" /><path d="M4 9v11h16V9" /><path d="M9 20v-6h6v6" /><path d="M3 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0" />
  </svg>
);
const KeyIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="7.5" cy="15.5" r="4.5" /><path d="m10.7 12.3 8.8-8.8" /><path d="m15 5 3 3" /><path d="m18 8 2-2" />
  </svg>
);
const PlusIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);
const SettingsIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
  </svg>
);
const SocialIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);
const LogoutIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5" /><path d="M21 12H9" />
  </svg>
);
const ExchangeRateIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <line x1="12" y1="1" x2="12" y2="23" />
    <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
  </svg>
);
const VatIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 22l-2-2" />
    <circle cx="12" cy="8" r="7" />
  </svg>
);
const StoreProductsIcon = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" /><line x1="3" y1="6" x2="21" y2="6" /><path d="M16 10a4 4 0 0 1-8 0" />
  </svg>
);
const OrderIcon = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M6 3h12l1 4v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V7l1-4z" /><path d="M6 7h12" /><path d="M9 16h6" />
  </svg>
);
const StatsIcon = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M18 20V10M12 20V4M6 20v-6" />
  </svg>
);
const StoreSettingsIcon = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
  </svg>
);

const ADMIN_STORE_TILES = [
  { key: "kbzpay", label: "ตั้งค่า(Boxer)", Icon: StoreProductsIcon },
  { key: "orders", label: "รอตั้งชื่อ", Icon: OrderIcon, to: "/selladmin/reports" },
  { key: "stats", label: "รอตั้งชื่อ", Icon: StatsIcon, to: "/selladmin/reports" },
  { key: "store-settings", label: "รอตั้งชื่อ", Icon: StoreSettingsIcon, to: "/selladmin/account" },
];

const emptySocial = () => ({
  google: { clientId: "", clientSecret: "", enabled: false, hasSecret: false },
  facebook: { appId: "", appSecret: "", enabled: false, hasSecret: false },
  line: { channelId: "", channelSecret: "", enabled: false, hasSecret: false },
});

export default function AdminAccount() {
  const { admin, logout, updateProfile } = useAuth();
  const user = admin?.user;
  const navigate = useNavigate();

  const [menuOpen, setMenuOpen] = useState(false);
  const [modal, setModal] = useState(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [formSuccess, setFormSuccess] = useState("");
  const [profileForm, setProfileForm] = useState({ name: "", phone: "", address: "" });
  const [passwordForm, setPasswordForm] = useState({ password: "", confirm: "" });
  const [adminForm, setAdminForm] = useState({ name: "", email: "", password: "" });
  const [socialForm, setSocialForm] = useState(emptySocial());
  const [exchangeRateForm, setExchangeRateForm] = useState({ rate: "", updatedAt: "" });
  const [vatForm, setVatForm] = useState({ rate: "", updatedAt: "" });
  const [store, setStore] = useState(null);
  const [storeLoading, setStoreLoading] = useState(true);
  const [storeLoadError, setStoreLoadError] = useState(false);
  const [storeModalOpen, setStoreModalOpen] = useState(false);
  const [kbzpayOpen, setKbzpayOpen] = useState(false);
  const [kbzpayForm, setKbzpayForm] = useState({ accountName: "", phoneNumber: "", receiverName: "", enabled: true });
  const [kbzpayQrFile, setKbzpayQrFile] = useState(null);
  const [kbzpayQrPreview, setKbzpayQrPreview] = useState(null);
  const [kbzpaySaving, setKbzpaySaving] = useState(false);
  const [kbzpayError, setKbzpayError] = useState("");
  const [kbzpaySuccess, setKbzpaySuccess] = useState("");
  const [kbzpaySettings, setKbzpaySettings] = useState(null);
  const menuRef = useRef(null);

  const origin = typeof window !== "undefined" ? window.location.origin : "";

  useEffect(() => {
    let active = true;
    const ownerId = user?._id || user?.id;
    const loadStore = async () => {
      if (!ownerId) { if (active) { setStore(null); setStoreLoadError(false); setStoreLoading(false); } return; }
      setStoreLoading(true);
      setStoreLoadError(false);
      try {
        const response = await storeAPI.getStoreByOwner(ownerId, "admin");
        console.debug("[AdminAccount] store response", response);
        let stores = [];
        if (Array.isArray(response)) stores = response;
        else if (Array.isArray(response?.data)) stores = response.data;
        else if (response?.data && typeof response.data === "object") stores = [response.data];
        else if (response && typeof response === "object" && (response._id || response.id)) stores = [response];
        const firstValid = stores.find((s) => s && (s._id || s.id)) || null;
        if (active) setStore(firstValid);
      } catch (err) {
        console.error("[AdminAccount] store load error", err?.message || err);
        if (active) { setStore(null); setStoreLoadError(true); }
      }
      finally { if (active) setStoreLoading(false); }
    };
    loadStore();
    return () => { active = false; };
  }, [user?._id, user?.id]);

  // โหลดการตั้งค่า KBZPay จริงของร้านค้านี้เมื่อเปิด popup ตั้งค่าการชำระเงิน
  useEffect(() => {
    let active = true;
    if (!kbzpayOpen || !store) return;
    const storeId = store._id || store.id;
    if (!storeId) return;
    setKbzpayError("");
    const loadSettings = async () => {
      try {
        const response = await storeAPI.getKbzpaySettings(storeId, "admin");
        const data = response?.data || response || null;
        if (!active) return;
        if (data) {
          setKbzpaySettings(data);
          setKbzpayForm({
            accountName: data.kbzpay_account_name ?? data.accountName ?? "",
            phoneNumber: data.kbzpay_phone_number ?? data.phoneNumber ?? "",
            receiverName: data.kbzpay_receiver_name ?? data.receiverName ?? "",
            enabled: data.kbzpay_enabled !== undefined
              ? Boolean(data.kbzpay_enabled)
              : data.enabled !== undefined
                ? Boolean(data.enabled)
                : true,
          });
        }
        if (data?.kbzpay_qr_url ?? data?.qrUrl) {
          setKbzpayQrPreview(data.kbzpay_qr_url ?? data.qrUrl ?? null);
        }
      } catch {
        if (active) setKbzpaySettings(null);
      }
    };
    loadSettings();
    return () => { active = false; };
  }, [kbzpayOpen, store]);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const handleClickOutside = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false); };
    const handleEscape = (e) => { if (e.key === "Escape") setMenuOpen(false); };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => { document.removeEventListener("mousedown", handleClickOutside); document.removeEventListener("keydown", handleEscape); };
  }, [menuOpen]);

  const handleLogout = async () => {
    setMenuOpen(false);
    // Clear the admin session and let ProtectedRoute redirect declaratively.
    // Navigating before the state commit makes the login page observe the
    // still-active session and bounce back to /selladmin.
    await logout("admin");
  };

  const openProfile = () => {
    setMenuOpen(false); setFormError(""); setFormSuccess("");
    setProfileForm({ name: user?.name || "", phone: user?.phone || "", address: user?.address || "" });
    setModal("profile");
  };
  const openPassword = () => { setMenuOpen(false); setFormError(""); setFormSuccess(""); setPasswordForm({ password: "", confirm: "" }); setModal("password"); };
  const openAddAdmin = () => { setMenuOpen(false); setFormError(""); setFormSuccess(""); setAdminForm({ name: "", email: "", password: "" }); setModal("addAdmin"); };
  const openSettings = () => { setMenuOpen(false); navigate("/selladmin"); };
  const openStoreProfile = () => {
    if (!store) {
      setFormError("กำลังโหลดข้อมูลร้านค้า กรุณารอสักครู่");
      return;
    }
    setMenuOpen(false);
    setStoreModalOpen(true);
  };

  const openSocialLogin = async () => {
    setMenuOpen(false); setFormError(""); setFormSuccess("");
    try {
      const response = await adminAPI.getSettings("oauth");
      const list = Array.isArray(response?.data) ? response.data : [];
      const get = (k) => {
        const row = list.find((s) => String(s.key || '').toLowerCase() === String(k).toLowerCase());
        return row?.value ?? "";
      };
      const getHasSecret = (k) => {
        const row = list.find((s) => String(s.key || '').toLowerCase() === String(k).toLowerCase());
        return row?.hasValue === true;
      };
      const on = (k) => {
        const v = String(get(k)).toLowerCase();
        return v === "true" || v === "1";
      };
      setSocialForm({
        google: { clientId: get("google_client_id") || get("GOOGLE_CLIENT_ID"), clientSecret: "", enabled: on("google_enabled") || on("GOOGLE_ENABLED"), hasSecret: getHasSecret("google_client_secret") },
        facebook: { appId: get("facebook_app_id") || get("FACEBOOK_APP_ID"), appSecret: "", enabled: on("facebook_enabled") || on("FACEBOOK_ENABLED"), hasSecret: getHasSecret("facebook_app_secret") },
        line: { channelId: get("line_channel_id") || get("LINE_CHANNEL_ID"), channelSecret: "", enabled: on("line_enabled") || on("LINE_ENABLED"), hasSecret: getHasSecret("line_channel_secret") },
      });
    } catch {
      setSocialForm(emptySocial());
    }
    setModal("socialLogin");
  };

  const openExchangeRate = async () => {
    setMenuOpen(false); setFormError(""); setFormSuccess("");
    try {
      const response = await adminAPI.getSettings("exchange_rate");
      const list = Array.isArray(response?.data) ? response.data : [];
      const get = (k) => {
        const row = list.find((s) => String(s.key || '').toLowerCase() === String(k).toLowerCase());
        return row?.value ?? "";
      };
      setExchangeRateForm({
        rate: get("exchange_rate_thb_mmk") || "",
        updatedAt: ""
      });
    } catch {
      setExchangeRateForm({ rate: "", updatedAt: "" });
    }
    setModal("exchangeRate");
  };

  const openVatSettings = async () => {
    setMenuOpen(false); setFormError(""); setFormSuccess("");
    try {
      const res = await settingsAPI.getByKey("vat_rate");
      const rate = res?.data?.value != null ? Number(res.data.value) : 7;
      setVatForm({
        rate: Number.isFinite(rate) ? String(rate) : "7",
        updatedAt: ""
      });
    } catch {
      setVatForm({ rate: "7", updatedAt: "" });
    }
    setModal("vat");
  };

  const closeModal = () => { if (saving) return; setModal(null); setFormError(""); setFormSuccess(""); };

  const openKbzpay = () => { setKbzpayQrFile(null); setKbzpayQrPreview(null); setKbzpaySettings(null); setKbzpayOpen(true); };

  const closeKbzpay = () => { if (kbzpaySaving) return; setKbzpayOpen(false); setKbzpayError(""); setKbzpaySuccess(""); setKbzpayQrFile(null); setKbzpayQrPreview(null); setKbzpaySettings(null); };

  const handleKbzpayQrChange = (e) => {
    const file = e.target.files?.[0] || null;
    setKbzpayError("");
    if (file && !file.type.startsWith("image/")) {
      setKbzpayError("กรุณาเลือกไฟล์รูปภาพ");
      return;
    }
    if (file && file.size > 5 * 1024 * 1024) {
      setKbzpayError("ขนาดไฟล์ต้องไม่เกิน 5MB");
      return;
    }
    setKbzpayQrFile(file);
    setKbzpayQrPreview(file ? URL.createObjectURL(file) : null);
  };

  const handleKbzpaySubmit = async (e) => {
    e.preventDefault();
    setKbzpayError("");
    setKbzpaySuccess("");
    if (!kbzpayForm.accountName.trim()) { setKbzpayError("กรุณากรอกชื่อบัญชี KBZPay"); return; }
    if (!kbzpayForm.phoneNumber.trim()) { setKbzpayError("กรุณากรอกเบอร์โทรศัพท์"); return; }
    if (!kbzpayForm.receiverName.trim()) { setKbzpayError("กรุณากรอกชื่อผู้รับเงิน"); return; }

    const storeId = store?._id || store?.id;
    if (!storeId) { setKbzpayError("ไม่พบร้านค้า"); return; }

    setKbzpaySaving(true);
    try {
      await storeAPI.updateKbzpaySettings(storeId, {
        accountName: kbzpayForm.accountName.trim(),
        phoneNumber: kbzpayForm.phoneNumber.trim(),
        receiverName: kbzpayForm.receiverName.trim(),
        enabled: kbzpayForm.enabled,
      }, "admin");

      if (kbzpayQrFile) {
        await storeAPI.uploadKbzpayQr(storeId, kbzpayQrFile, "admin");
      }

      // โหลดค่าล่าสุดกลับมาแสดงหลังบันทึก
      const response = await storeAPI.getKbzpaySettings(storeId, "admin");
      const data = response?.data || response || null;
      if (data) {
        setKbzpaySettings(data);
        if (data.kbzpay_qr_url ?? data.qrUrl) setKbzpayQrPreview(data.kbzpay_qr_url ?? data.qrUrl ?? null);
      }

      setKbzpayQrFile(null);
      setKbzpaySuccess("บันทึกการตั้งค่า KBZPay เรียบร้อยแล้ว");
      setTimeout(() => { closeKbzpay(); }, 800);
    } catch (err) {
      setKbzpayError(err.message || "บันทึกการตั้งค่า KBZPay ไม่สำเร็จ");
    } finally {
      setKbzpaySaving(false);
    }
  };

  const handleProfileSubmit = async (e) => {
    e.preventDefault(); setFormError(""); setFormSuccess("");
    if (!profileForm.name.trim()) { setFormError("กรุณากรอกชื่อ"); return; }
    setSaving(true);
    try {
      await updateProfile({ name: profileForm.name.trim(), phone: profileForm.phone.trim(), address: profileForm.address.trim() }, "admin");
      setFormSuccess("บันทึกข้อมูลเรียบร้อยแล้ว"); setTimeout(() => setModal(null), 700);
    } catch (err) { setFormError(err.message || "บันทึกข้อมูลไม่สำเร็จ"); }
    finally { setSaving(false); }
  };

  const handlePasswordSubmit = async (e) => {
    e.preventDefault(); setFormError(""); setFormSuccess("");
    if (passwordForm.password.length < 6) { setFormError("รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร"); return; }
    if (passwordForm.password !== passwordForm.confirm) { setFormError("รหัสผ่านใหม่และการยืนยันไม่ตรงกัน"); return; }
    setSaving(true);
    try {
      await updateProfile({ password: passwordForm.password }, "admin");
      setFormSuccess("เปลี่ยนรหัสผ่านเรียบร้อยแล้ว"); setTimeout(() => setModal(null), 700);
    } catch (err) { setFormError(err.message || "เปลี่ยนรหัสผ่านไม่สำเร็จ"); }
    finally { setSaving(false); }
  };

  const handleAddAdminSubmit = async (e) => {
    e.preventDefault(); setFormError(""); setFormSuccess("");
    const name = adminForm.name.trim(); const email = adminForm.email.trim();
    if (!name) { setFormError("กรุณากรอกชื่อ"); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setFormError("กรุณากรอกอีเมลให้ถูกต้อง"); return; }
    if (adminForm.password.length < 6) { setFormError("รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร"); return; }
    setSaving(true);
    try {
      await adminAPI.createUser({ name, email, password: adminForm.password, role: "admin" });
      setFormSuccess("สร้างบัญชีแอดมินเรียบร้อยแล้ว"); setTimeout(() => setModal(null), 700);
    } catch (err) { setFormError(err.message || "สร้างบัญชีแอดมินไม่สำเร็จ"); }
    finally { setSaving(false); }
  };

  const handleSocialSubmit = async (e) => {
    e.preventDefault(); setFormError(""); setFormSuccess("");
    setSaving(true);
    try {
      const settings = [
        { key: "google_client_id", value: socialForm.google.clientId.trim(), category: "oauth", isPublic: false },
        { key: "google_enabled", value: String(!!socialForm.google.enabled), category: "oauth", isPublic: false },
        { key: "facebook_app_id", value: socialForm.facebook.appId.trim(), category: "oauth", isPublic: false },
        { key: "facebook_enabled", value: String(!!socialForm.facebook.enabled), category: "oauth", isPublic: false },
        { key: "line_channel_id", value: socialForm.line.channelId.trim(), category: "oauth", isPublic: false },
        { key: "line_enabled", value: String(!!socialForm.line.enabled), category: "oauth", isPublic: false },
      ];

      // Only include secret if user entered a new value (non-empty)
      if (socialForm.google.clientSecret.trim() !== "") {
        settings.push({ key: "google_client_secret", value: socialForm.google.clientSecret.trim(), category: "oauth", isPublic: false });
      }
      if (socialForm.facebook.appSecret.trim() !== "") {
        settings.push({ key: "facebook_app_secret", value: socialForm.facebook.appSecret.trim(), category: "oauth", isPublic: false });
      }
      if (socialForm.line.channelSecret.trim() !== "") {
        settings.push({ key: "line_channel_secret", value: socialForm.line.channelSecret.trim(), category: "oauth", isPublic: false });
      }

      await adminAPI.bulkUpdateSettings(settings);
      setFormSuccess("บันทึกการตั้งค่า Social Login เรียบร้อยแล้ว");
      setTimeout(() => setModal(null), 800);
    } catch (err) { setFormError(err.message || "บันทึกการตั้งค่าไม่สำเร็จ"); }
    finally { setSaving(false); }
  };

  const handleExchangeRateSubmit = async (e) => {
    e.preventDefault(); setFormError(""); setFormSuccess("");
    const rate = Number(exchangeRateForm.rate);
    if (!Number.isFinite(rate) || rate <= 0) {
      setFormError("กรุณากรอกอัตราแลกเปลี่ยนที่ถูกต้อง (ตัวเลขมากกว่า 0)");
      return;
    }
    setSaving(true);
    try {
      const settings = [
        { key: "exchange_rate_thb_mmk", value: String(rate), category: "exchange_rate", isPublic: true },
      ];
      await adminAPI.bulkUpdateSettings(settings);
      setFormSuccess("บันทึกอัตราแลกเปลี่ยน THB → MMK เรียบร้อยแล้ว");
      setTimeout(() => setModal(null), 800);
    } catch (err) { setFormError(err.message || "บันทึกอัตราแลกเปลี่ยนไม่สำเร็จ"); }
    finally { setSaving(false); }
  };

  const handleVatSubmit = async (e) => {
    e.preventDefault(); setFormError(""); setFormSuccess("");
    const rate = Number(vatForm.rate);
    if (!Number.isFinite(rate)) {
      setFormError("กรุณากรอกอัตราภาษีเป็นตัวเลข");
      return;
    }
    if (rate < 0) {
      setFormError("อัตราภาษีติดลบไม่ได้");
      return;
    }
    if (rate > 100) {
      setFormError("อัตราภาษีต้องไม่เกิน 100%");
      return;
    }
    setSaving(true);
    try {
      const settings = [
        { key: "vat_rate", value: String(rate), category: "vat", isPublic: true, description: "ภาษีมูลค่าเพิ่ม (VAT) อัตราร้อยละ" }
      ];
      await adminAPI.bulkUpdateSettings(settings);
      setFormSuccess("บันทึกอัตราภาษีมูลค่าเพิ่มเรียบร้อยแล้ว");
      setVatForm((p) => ({ ...p, updatedAt: new Date().toISOString() }));
      setTimeout(() => setModal(null), 800);
    } catch (err) {
      setFormError(err.message || "บันทึกอัตราภาษีไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  };

  const copyText = async (text) => {
    try { await navigator.clipboard.writeText(text); setFormSuccess("คัดลอก Callback URL แล้ว"); setTimeout(() => setFormSuccess(""), 1500); }
    catch { setFormError("คัดลอกไม่สำเร็จ"); }
  };

  const menuItem = (label, Icon, onClick, danger = false) => (
    <button type="button" role="menuitem" className={`account-menu-item${danger ? " account-menu-item-danger" : ""}`} onClick={onClick}>
      <span className="account-menu-item-icon"><Icon /></span><span>{label}</span>
    </button>
  );

  const renderStoreTile = ({ key, label, Icon, to, onClick }) => {
    const handleClick = key === "kbzpay" ? openKbzpay : onClick;
    if (handleClick) {
      return (
        <button key={key} type="button" className="admin-store-tile" onClick={handleClick}>
          <span className="admin-store-tile-icon"><Icon /></span>
          <span className="admin-store-tile-label">{label}</span>
        </button>
      );
    }
    return (
      <Link key={key} to={to} className="admin-store-tile">
        <span className="admin-store-tile-icon"><Icon /></span>
        <span className="admin-store-tile-label">{label}</span>
      </Link>
    );
  };

  const ProviderSection = ({ title, enabled, onToggle, callbackUrl, callbackLabel, children }) => (
    <div className="form-group" style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 12, marginBottom: 12 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <strong>{title}</strong>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 14 }}>
          <input type="checkbox" checked={enabled} onChange={(e) => onToggle(e.target.checked)} />
          เปิดใช้งาน
        </label>
      </div>
      {children}
      <div style={{ marginTop: 8 }}>
        <label className="form-label" style={{ fontSize: 12 }}>{callbackLabel || `Callback URL (คัดลอกไปวางในระบบของ ${title})`}</label>
        <div style={{ display: "flex", gap: 8 }}>
          <input className="form-input" readOnly value={callbackUrl} style={{ fontSize: 12 }} onFocus={(e) => e.target.select()} />
          <button type="button" className="btn-outline" onClick={() => copyText(callbackUrl)} style={{ whiteSpace: "nowrap" }}>คัดลอก</button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="page admin-account-page">
      <section className="admin-account-hero">
        <div className="admin-account-hero-inner">
          <div className="admin-account-profile">
            <div className="admin-account-avatar">
              {store?.logo ? <img src={store.logo} alt={store.name} className="admin-account-logo" /> : store?.name ? store.name.charAt(0).toUpperCase() : <StoreIcon />}
            </div>
            <div className="admin-account-text">
              <p className="admin-account-label">ร้านค้าของฉัน</p>
              {storeLoading ? <p className="admin-account-sub">กำลังโหลดข้อมูลร้านค้า...</p> : store ? (
                <>
                  <h1 className="admin-account-name">{store.name}</h1>
                  <p className="admin-account-sub">{store.description || "ยังไม่มีคำอธิบายร้านค้า"}</p>
                  {store.phone && <p className="admin-account-phone">โทรศัพท์: {store.phone}</p>}
                </>
              ) : (
                <>
                  <h1 className="admin-account-name">สร้างร้านค้าของคุณ</h1>
                  <p className="admin-account-sub">เพิ่มโลโก้ รูปปก และข้อมูลร้านค้า เพื่อให้ลูกค้าค้นหาและเห็นร้านของคุณ</p>
                </>
              )}
            </div>
          </div>
          <div className="admin-account-hero-actions">
            {!storeLoading && store && <Link to={`/stores/${store._id}`} className="admin-account-btn admin-account-btn-solid">ดูหน้าร้านค้าฝั่งลูกค้า</Link>}
            {!storeLoading && (
              <button type="button" className="admin-account-btn admin-account-btn-ghost" onClick={openStoreProfile}>
                {store ? <><EditIcon /> แก้ไขโปรไฟล์ร้านค้า</> : <><StoreIcon /> สร้างร้านค้าของคุณ</>}
              </button>
            )}
          </div>
        </div>
        <div className="admin-account-menu" ref={menuRef}>
          <button type="button" className={`admin-account-menu-btn${menuOpen ? " active" : ""}`} onClick={() => setMenuOpen((o) => !o)} aria-label="ตัวเลือกเพิ่มเติม" aria-haspopup="menu" aria-expanded={menuOpen}>
            <MoreVerticalIcon />
          </button>
          {menuOpen && (
            <div className="account-menu-dropdown" role="menu">
              {menuItem("แก้ไขข้อมูลส่วนตัว", EditIcon, openProfile)}
              {menuItem("เปลี่ยนรหัสผ่าน", KeyIcon, openPassword)}
              {!storeLoading && menuItem(store ? "แก้ไขโปรไฟล์ร้านค้า" : "สร้างร้านค้าของคุณ", StoreIcon, openStoreProfile)}
              {menuItem("ตั้งค่าระบบ", SettingsIcon, openSettings)}
              {menuItem("เพิ่มแอดมิน", PlusIcon, openAddAdmin)}
              {menuItem("ตั้งค่า Google / Social Login", SocialIcon, openSocialLogin)}
              {menuItem("ตั้งค่าอัตราแลกเปลี่ยน THB → MMK", ExchangeRateIcon, openExchangeRate)}
              {menuItem("ภาษีมูลค่าเพิ่ม", VatIcon, openVatSettings)}
              <div className="account-menu-divider" />
              {menuItem("ออกจากระบบ", LogoutIcon, handleLogout, true)}
            </div>
          )}
        </div>
      </section>

      <section className="admin-store-tiles-card">
        <header className="admin-store-tiles-head"><h2 className="admin-store-tiles-title">จัดการร้านค้า</h2></header>
        <div className="admin-store-tiles">{ADMIN_STORE_TILES.map(renderStoreTile)}</div>
      </section>

      {modal && (
        <div className="account-modal-overlay" role="dialog" aria-modal="true" aria-label={MODAL_TITLES[modal]} onMouseDown={(e) => { if (e.target === e.currentTarget) closeModal(); }}>
          <div className="account-modal" style={modal === "socialLogin" ? { maxWidth: 720, width: "100%" } : undefined}>
            <div className="account-modal-header">
              <h2>{MODAL_TITLES[modal]}</h2>
              <button type="button" className="account-modal-close" onClick={closeModal} aria-label="ปิด">×</button>
            </div>

            {formError && <div className="alert alert-error account-modal-alert">{formError}</div>}
            {formSuccess && <div className="alert alert-success account-modal-alert">{formSuccess}</div>}

            {modal === "profile" && (
              <form onSubmit={handleProfileSubmit} className="account-modal-form">
                <div className="account-modal-body">
                  <div className="form-group"><label className="form-label" htmlFor="account-name">ชื่อ</label>
                    <input id="account-name" className="form-input" value={profileForm.name} onChange={(e) => setProfileForm((p) => ({ ...p, name: e.target.value }))} autoComplete="name" />
                  </div>
                  <div className="form-group"><label className="form-label" htmlFor="account-phone">โทรศัพท์</label>
                    <input id="account-phone" className="form-input" value={profileForm.phone} onChange={(e) => setProfileForm((p) => ({ ...p, phone: e.target.value }))} autoComplete="tel" />
                  </div>
                  <div className="form-group"><label className="form-label" htmlFor="account-address">ที่อยู่</label>
                    <textarea id="account-address" className="form-input" rows="3" value={profileForm.address} onChange={(e) => setProfileForm((p) => ({ ...p, address: e.target.value }))} autoComplete="street-address" />
                  </div>
                </div>
                <div className="account-modal-actions">
                  <button type="button" className="btn-outline" onClick={closeModal} disabled={saving}>ยกเลิก</button>
                  <button type="submit" className="btn" disabled={saving}>{saving ? "กำลังบันทึก..." : "บันทึก"}</button>
                </div>
              </form>
            )}

            {modal === "password" && (
              <form onSubmit={handlePasswordSubmit} className="account-modal-form">
                <div className="account-modal-body">
                  <div className="form-group"><label className="form-label" htmlFor="account-password">รหัสผ่านใหม่</label>
                    <input id="account-password" type="password" className="form-input" value={passwordForm.password} onChange={(e) => setPasswordForm((p) => ({ ...p, password: e.target.value }))} autoComplete="new-password" />
                  </div>
                  <div className="form-group"><label className="form-label" htmlFor="account-password-confirm">ยืนยันรหัสผ่านใหม่</label>
                    <input id="account-password-confirm" type="password" className="form-input" value={passwordForm.confirm} onChange={(e) => setPasswordForm((p) => ({ ...p, confirm: e.target.value }))} autoComplete="new-password" />
                  </div>
                </div>
                <div className="account-modal-actions">
                  <button type="button" className="btn-outline" onClick={closeModal} disabled={saving}>ยกเลิก</button>
                  <button type="submit" className="btn" disabled={saving}>{saving ? "กำลังเปลี่ยน..." : "เปลี่ยนรหัสผ่าน"}</button>
                </div>
              </form>
            )}

            {modal === "addAdmin" && (
              <form onSubmit={handleAddAdminSubmit} className="account-modal-form">
                <div className="account-modal-body">
                  <div className="form-group"><label className="form-label" htmlFor="add-admin-name">ชื่อ</label>
                    <input id="add-admin-name" className="form-input" value={adminForm.name} onChange={(e) => setAdminForm((p) => ({ ...p, name: e.target.value }))} autoComplete="name" />
                  </div>
                  <div className="form-group"><label className="form-label" htmlFor="add-admin-email">อีเมล</label>
                    <input id="add-admin-email" type="email" className="form-input" value={adminForm.email} onChange={(e) => setAdminForm((p) => ({ ...p, email: e.target.value }))} autoComplete="email" />
                  </div>
                  <div className="form-group"><label className="form-label" htmlFor="add-admin-password">รหัสผ่าน</label>
                    <input id="add-admin-password" type="password" className="form-input" value={adminForm.password} onChange={(e) => setAdminForm((p) => ({ ...p, password: e.target.value }))} autoComplete="new-password" />
                  </div>
                </div>
                <div className="account-modal-actions">
                  <button type="button" className="btn-outline" onClick={closeModal} disabled={saving}>ยกเลิก</button>
                  <button type="submit" className="btn" disabled={saving}>{saving ? "กำลังสร้าง..." : "สร้างบัญชีแอดมิน"}</button>
                </div>
              </form>
            )}

{modal === "socialLogin" && (
              <form onSubmit={handleSocialSubmit} className="account-modal-form">
                <div className="account-modal-body">
                  <ProviderSection
                    title="Google"
                    enabled={socialForm.google.enabled}
                    onToggle={(v) => setSocialForm((p) => ({ ...p, google: { ...p.google, enabled: v } }))}
                    callbackUrl={origin}
                    callbackLabel="Authorized JavaScript origins (คัดลอกไปวางใน Google Cloud Console)"
                  >
                    <div className="form-group">
                      <label className="form-label">Google Client ID</label>
                      <input className="form-input" value={socialForm.google.clientId} onChange={(e) => setSocialForm((p) => ({ ...p, google: { ...p.google, clientId: e.target.value } }))} placeholder="Client ID จาก Google Cloud Console" />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Google Client Secret</label>
                      <input type="password" className="form-input" value={socialForm.google.clientSecret} onChange={(e) => setSocialForm((p) => ({ ...p, google: { ...p.google, clientSecret: e.target.value } }))} placeholder="เว้นว่างเพื่อคงค่าเดิม" />
                      {socialForm.google.hasSecret && <p className="form-hint" style={{ color: "#059669", fontSize: 12, marginTop: 4 }}>✓ ตั้งค่า Secret ไว้แล้ว — เว้นว่างเพื่อคงค่าเดิม</p>}
                    </div>
                     <p className="form-hint">ตั้งค่าใน Google Cloud Console &gt; APIs &amp; Services &gt; Credentials (เพิ่ม Authorized JavaScript origins: {origin})</p>
                  </ProviderSection>

                  <ProviderSection
                    title="Facebook"
                    enabled={socialForm.facebook.enabled}
                    onToggle={(v) => setSocialForm((p) => ({ ...p, facebook: { ...p.facebook, enabled: v } }))}
                    callbackUrl={`${origin}/login`}
                    callbackLabel="Valid OAuth Redirect URIs (คัดลอกไปวางใน Facebook Developers)"
                  >
                    <div className="form-group">
                      <label className="form-label">Facebook App ID</label>
                      <input className="form-input" value={socialForm.facebook.appId} onChange={(e) => setSocialForm((p) => ({ ...p, facebook: { ...p.facebook, appId: e.target.value } }))} placeholder="App ID จาก Facebook Developers" />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Facebook App Secret</label>
                      <input type="password" className="form-input" value={socialForm.facebook.appSecret} onChange={(e) => setSocialForm((p) => ({ ...p, facebook: { ...p.facebook, appSecret: e.target.value } }))} placeholder="เว้นว่างเพื่อคงค่าเดิม" />
                      {socialForm.facebook.hasSecret && <p className="form-hint" style={{ color: "#059669", fontSize: 12, marginTop: 4 }}>✓ ตั้งค่า Secret ไว้แล้ว — เว้นว่างเพื่อคงค่าเดิม</p>}
                    </div>
                     <p className="form-hint">ตั้งค่าใน Facebook Developers &gt; Facebook Login &gt; Settings (Valid OAuth Redirect URIs: {origin}/login และ {origin}/register)</p>
                  </ProviderSection>

                  <ProviderSection
                    title="LINE"
                    enabled={socialForm.line.enabled}
                    onToggle={(v) => setSocialForm((p) => ({ ...p, line: { ...p.line, enabled: v } }))}
                    callbackUrl={`${origin}/oauth/line/callback`}
                    callbackLabel="Callback URL (คัดลอกไปวางใน LINE Developers Console)"
                  >
                    <div className="form-group">
                      <label className="form-label">LINE Channel ID</label>
                      <input className="form-input" value={socialForm.line.channelId} onChange={(e) => setSocialForm((p) => ({ ...p, line: { ...p.line, channelId: e.target.value } }))} placeholder="Channel ID จาก LINE Developers" />
                    </div>
                    <div className="form-group">
                      <label className="form-label">LINE Channel Secret</label>
                      <input type="password" className="form-input" value={socialForm.line.channelSecret} onChange={(e) => setSocialForm((p) => ({ ...p, line: { ...p.line, channelSecret: e.target.value } }))} placeholder="เว้นว่างเพื่อคงค่าเดิม" />
                      {socialForm.line.hasSecret && <p className="form-hint" style={{ color: "#059669", fontSize: 12, marginTop: 4 }}>✓ ตั้งค่า Secret ไว้แล้ว — เว้นว่างเพื่อคงค่าเดิม</p>}
                    </div>
                     <p className="form-hint">ตั้งค่าใน LINE Developers Console &gt; LINE Login &gt; Callback URL: {origin}/oauth/line/callback (เปิด scope: profile, openid, email)</p>
                  </ProviderSection>
                </div>
                <div className="account-modal-actions">
                  <button type="button" className="btn-outline" onClick={closeModal} disabled={saving}>ยกเลิก</button>
                  <button type="submit" className="btn" disabled={saving}>{saving ? "กำลังบันทึก..." : "บันทึกการตั้งค่า"}</button>
                </div>
              </form>
            )}

            {modal === "exchangeRate" && (
              <form onSubmit={handleExchangeRateSubmit} className="account-modal-form">
                <div className="account-modal-body">
                  <div className="form-group">
                    <label className="form-label" htmlFor="exchange-rate">อัตราแลกเปลี่ยน (1 THB = ? MMK) *</label>
                    <input
                      id="exchange-rate"
                      type="number"
                      step="0.01"
                      min="0.01"
                      className="form-input"
                      value={exchangeRateForm.rate}
                      onChange={(e) => setExchangeRateForm((p) => ({ ...p, rate: e.target.value }))}
                      placeholder="เช่น 45.50"
                      autoComplete="off"
                    />
                  </div>
                  <p className="form-hint">
                    อัตรานี้จะถูกใช้ในการชำระเงินผ่าน KBZPay (Myanmar Wallet) แทนการดึงอัตราจาก API อัตโนมัติ<br />
                    หากไม่ได้ตั้งค่า ระบบจะใช้ API open.er-api.com ในการดึงอัตราแบบเรียลไทม์
                  </p>
                  <p className="form-hint" style={{ color: "#6b7280", fontSize: 12 }}>
                    ตัวอย่าง: 1 THB = 45.50 MMK
                  </p>
                </div>
                <div className="account-modal-actions">
                  <button type="button" className="btn-outline" onClick={closeModal} disabled={saving}>ยกเลิก</button>
                  <button type="submit" className="btn" disabled={saving}>{saving ? "กำลังบันทึก..." : "บันทึกอัตราแลกเปลี่ยน"}</button>
                </div>
</form>
            )}
            {modal === "vat" && (
              <form onSubmit={handleVatSubmit} className="account-modal-form">
                <div className="account-modal-body">
                  <div className="form-group">
                    <label className="form-label" htmlFor="vat-rate">อัตราภาษีมูลค่าเพิ่ม (%) *</label>
                    <input
                      id="vat-rate"
                      type="number"
                      step="0.01"
                      min="0"
                      max="100"
                      className="form-input"
                      value={vatForm.rate}
                      onChange={(e) => setVatForm((p) => ({ ...p, rate: e.target.value }))}
                      placeholder="เช่น 7"
                      autoComplete="off"
                    />
                  </div>
                  <p className="form-hint">
                    อัตราปัจจุบัน: <strong>{vatForm.rate === "" ? "7" : vatForm.rate}%</strong> (ค่าเริ่มต้นเมื่อยังไม่ได้ตั้งค่า) ·{" "}
                    ตัวอย่าง: ราคาสินค้า 1,000 บาท × {(Number(vatForm.rate) || 7)}% = ภาษี {((Number(vatForm.rate) || 7) * 10).toFixed(2)} บาท
                  </p>
                  <p className="form-hint" style={{ color: "#6b7280", fontSize: 12 }}>
                    ค่านี้จะถูกใช้คำนวณภาษีในตะกร้าและหน้าชำระเงินสำหรับลูกค้าทุกคน (0% = ปิด VAT)
                    {vatForm.updatedAt && (
                      <span> · แก้ไขล่าสุด: {new Date(vatForm.updatedAt).toLocaleString("th-TH")}</span>
                    )}
                  </p>
                </div>
                <div className="account-modal-actions">
                  <button type="button" className="btn-outline" onClick={closeModal} disabled={saving}>ยกเลิก</button>
                  <button type="submit" className="btn" disabled={saving}>{saving ? "กำลังบันทึก..." : "บันทึกอัตราภาษี"}</button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

{kbzpayOpen && (
        <div className="account-modal-overlay" role="dialog" aria-modal="true" aria-label="ตั้งค่าการชำระเงิน" onMouseDown={(e) => { if (e.target === e.currentTarget) closeKbzpay(); }}>
          <div className="account-modal" style={{ maxWidth: 560, width: "100%" }}>
            <div className="account-modal-header">
              <h2>ตั้งค่าการชำระเงิน</h2>
              <button type="button" className="account-modal-close" onClick={closeKbzpay} aria-label="ปิด">×</button>
            </div>
            {kbzpayError && <div className="alert alert-error account-modal-alert">{kbzpayError}</div>}
            {kbzpaySuccess && <div className="alert alert-success account-modal-alert">{kbzpaySuccess}</div>}
            <form onSubmit={handleKbzpaySubmit} className="account-modal-form">
              <div className="account-modal-body">
                <div className="form-group">
                  <label className="form-label" htmlFor="kbzpay-account-name">ชื่อบัญชี KBZPay *</label>
                  <input id="kbzpay-account-name" className="form-input" value={kbzpayForm.accountName} onChange={(e) => setKbzpayForm((p) => ({ ...p, accountName: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="kbzpay-phone">เบอร์โทรศัพท์ *</label>
                  <input id="kbzpay-phone" className="form-input" value={kbzpayForm.phoneNumber} onChange={(e) => setKbzpayForm((p) => ({ ...p, phoneNumber: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="kbzpay-receiver">ชื่อผู้รับเงิน *</label>
                  <input id="kbzpay-receiver" className="form-input" value={kbzpayForm.receiverName} onChange={(e) => setKbzpayForm((p) => ({ ...p, receiverName: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="kbzpay-qr">QR Code (ไม่เกิน 5MB)</label>
                  <input id="kbzpay-qr" type="file" accept="image/*" onChange={handleKbzpayQrChange} />
                  {kbzpayQrPreview && <img src={kbzpayQrPreview} alt="QR preview" style={{ marginTop: 8, maxWidth: 200, borderRadius: 8 }} />}
                </div>
                <div className="form-group">
                  <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 14 }}>
                    <input type="checkbox" checked={kbzpayForm.enabled} onChange={(e) => setKbzpayForm((p) => ({ ...p, enabled: e.target.checked }))} />
                    เปิดใช้งาน
                  </label>
                </div>
              </div>
              <div className="account-modal-actions">
                <button type="button" className="btn-outline" onClick={closeKbzpay} disabled={kbzpaySaving}>ยกเลิก</button>
                <button type="submit" className="btn" disabled={kbzpaySaving}>{kbzpaySaving ? "กำลังบันทึก..." : "บันทึก"}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {storeModalOpen && store && (
        <StoreProfileEditModal store={store} mode="admin" onClose={() => setStoreModalOpen(false)} onSaved={setStore} />
      )}
    </div>
  );
}
