import { useEffect, useRef, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { uploadAPI } from "../api";
import { showToast } from "../utils/helpers";

const CancelIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const SaveIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M19 4H2a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h17a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2Z" />
    <polyline points="14 2 9 7 14 12" />
  </svg>
);

const CameraIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
    <circle cx="12" cy="13" r="3" />
  </svg>
);

const AlertIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="8" x2="12" y2="12" />
    <line x1="12" y1="16" x2="12.01" y2="16" />
  </svg>
);

const CheckIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

export default function EditProfileModal({ user, onClose, onSaved }) {
  const { updateProfile } = useAuth();
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [formSuccess, setFormSuccess] = useState("");
  const [avatarFile, setAvatarFile] = useState(null);
  const [avatarPreview, setAvatarPreview] = useState(user?.avatar_url || null);
  const [name, setName] = useState(user?.name || "");
  const fileInputRef = useRef(null);
  const closeTimerRef = useRef(null);

  useEffect(() => {
    setName(user?.name || "");
    setAvatarPreview(user?.avatar_url || null);
    setAvatarFile(null);
    setFormError("");
    setFormSuccess("");
  }, [user]);

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === "Escape") handleClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
  }, []);

  const handleClose = () => {
    if (saving) return;
    onClose();
  };

  const handleAvatarChange = (event) => {
    const file = event.target.files[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setFormError("กรุณาเลือกไฟล์รูปภาพเท่านั้น");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setFormError("ขนาดไฟล์รูปต้องไม่เกิน 5MB");
      return;
    }
    setAvatarFile(file);
    const reader = new FileReader();
    reader.onload = (e) => setAvatarPreview(e.target.result);
    reader.readAsDataURL(file);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setFormError("");
    setFormSuccess("");

    if (!name || !name.trim()) {
      setFormError("กรุณาระบุชื่อ");
      return;
    }
    setSaving(true);
    try {
      let avatarUrl = user?.avatar_url || null;

      // อัปโหลดรูปโปรไฟล์ขึ้น Supabase Storage ก่อน (endpoint นี้อัปเดต avatar_url ในฐานข้อมูลโดยตรง)
      if (avatarFile) {
        const uploaded = await uploadAPI.uploadAvatar(avatarFile);
        const url = uploaded?.data?.url;
        if (!url) throw new Error("อัปโหลดรูปโปรไฟล์ไม่สำเร็จ");
        avatarUrl = url;
      }

      // อัปเดตชื่อผ่าน /auth/profile (ผูกกับผู้ใช้ที่ล็อกอินอยู่เท่านั้น, RLS ป้องกันการแก้ผู้ใช้อื่น)
      const updatedUser = await updateProfile(
        {
          name: name.trim(),
          ...(avatarUrl ? { avatar_url: avatarUrl } : {}),
        },
        "customer"
      );

      if (updatedUser) {
        setFormSuccess("บันทึกข้อมูลส่วนตัวเรียบร้อยแล้ว");
        showToast("บันทึกข้อมูลส่วนตัวเรียบร้อยแล้ว", "success");
        if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
        closeTimerRef.current = setTimeout(() => {
          onClose();
          if (onSaved) onSaved(updatedUser);
        }, 800);
      }
    } catch (err) {
      setFormError(err.message || "บันทึกข้อมูลไม่สำเร็จ กรุณาลองอีกครั้ง");
      showToast(err.message || "บันทึกข้อมูลไม่สำเร็จ", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 4 }}>
      <h3>แก้ไขข้อมูลส่วนตัว</h3>
      <p>แก้ไขชื่อ ที่อยู่ และรูปโปรไฟล์ของบัญชีที่ใช้ล็อกอินอยู่</p>

      {formError && (
        <div className="alert alert-error" role="alert" style={{ display: "flex", alignItems: "center", gap: 8, margin: 0 }}>
          <AlertIcon /> {formError}
        </div>
      )}
      {formSuccess && (
        <div className="alert alert-success" role="alert" style={{ display: "flex", alignItems: "center", gap: 8, margin: 0 }}>
          <CheckIcon /> {formSuccess}
        </div>
      )}

      <form onSubmit={handleSubmit} className="modal-form" style={{ marginTop: 0, gap: 14 }}>
        <div className="form-group" style={{ marginBottom: 12 }}>
          <label className="form-label" style={{ display: "block" }}>รูปโปรไฟล์</label>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 8 }}>
            <div
              style={{
                width: 96,
                height: 96,
                borderRadius: "50%",
                overflow: "hidden",
                border: "1px solid var(--border)",
                background: "#f8fafc",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              {avatarPreview ? (
                <img
                  src={avatarPreview}
                  alt="โปรไฟล์"
                  style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                  onError={(e) => {
                    e.target.style.display = "none";
                  }}
                />
              ) : (
                <CameraIcon style={{ width: 34, height: 34, color: "#94a3b8" }} />
              )}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <input
                type="file"
                ref={fileInputRef}
                accept="image/*"
                onChange={handleAvatarChange}
                id="avatar-upload"
                style={{ position: "absolute", width: 0, height: 0, opacity: 0, pointerEvents: "none" }}
              />
              <button type="button" className="btn btn-outline" onClick={() => fileInputRef.current?.click()} disabled={saving} style={{ minHeight: 36 }}>
                <CameraIcon style={{ width: 16, height: 16, marginRight: 6 }} /> เลือกรูปภาพ
              </button>
              <p className="form-hint" style={{ margin: 0, fontSize: 12 }}>
                รองรับ JPEG/PNG/WebP ไม่เกิน 5MB
              </p>
            </div>
          </div>
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="edit-profile-name">
            ชื่อที่แสดง <span className="required">*</span>
          </label>
          <input
            id="edit-profile-name"
            type="text"
            className="form-input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoComplete="name"
            required
            disabled={saving}
            maxLength={120}
          />
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="edit-profile-email">
            อีเมล (บัญชี)
          </label>
          <input
            id="edit-profile-email"
            type="email"
            className="form-input"
            value={user?.email || ""}
            readOnly
            disabled={saving}
          />
          <p className="form-hint">
            อีเมลแสดงตามข้อมูลบัญชีจริง ไม่สามารถแก้ไขได้จากหน้านี้ (การเปลี่ยนอีเมลต้องยืนยันผ่านขั้นตอนของ Supabase Auth)
          </p>
        </div>

        <div className="form-actions" style={{ marginTop: 8 }}>
          <button type="button" className="btn btn-outline" onClick={handleClose} disabled={saving}>
            <CancelIcon style={{ width: 16, height: 16, marginRight: 6 }} /> ยกเลิก
          </button>
          <button type="submit" className="btn" disabled={saving}>
            {saving ? (
              <>
                <span className="spinner" style={{ width: 16, height: 16, marginRight: 6, display: "inline-block" }} />
                กำลังบันทึก...
              </>
            ) : (
              <>
                <SaveIcon style={{ width: 16, height: 16, marginRight: 6 }} /> บันทึก
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
