import { useEffect, useRef, useState } from "react";
import { storeAPI } from "../api/product";
import StoreLocationMap from "./StoreLocationMap";

const CameraIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
    <circle cx="12" cy="13" r="3" />
  </svg>
);

const SaveIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M15.2 3a25.5 25.5 0 0 1 7 5.5 25.5 25.5 0 0 1 4 12.4" />
    <path d="M8.8 3a25.5 25.5 0 0 0-7 5.5 25.5 25.5 0 0 0-4 12.4" />
    <path d="M2 12l3.3 3.3 6-6" />
    <path d="M22 12l-6.2 6.2" />
  </svg>
);

const CancelIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
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

const buildInitialForm = (store) => ({
  name: store?.name || "",
  description: store?.description || "",
  phone: store?.phone || "",
  email: store?.email || "",
  address: {
    street: "",
    district: "",
    province: "",
    postalCode: "",
    ...store?.address,
    coordinates: store?.address?.coordinates || null,
  },
  categories: store?.categories || [],
  openingHours: store?.openingHours || {},
  deliveryFee: store?.deliveryFee || 0,
  minimumOrder: store?.minimumOrder || 0,
  estimatedDeliveryTime: store?.estimatedDeliveryTime || 30,
});

export default function StoreProfileEditModal({ store, mode = "customer", onClose, onSaved }) {
  const isCreateMode = !store;
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [formSuccess, setFormSuccess] = useState("");
  const [editForm, setEditForm] = useState(() => buildInitialForm(store));
  const [logoPreview, setLogoPreview] = useState(store?.logo || null);
  const [coverPreview, setCoverPreview] = useState(store?.coverImage || null);
  const fileInputRef = useRef(null);
  const coverFileInputRef = useRef(null);
  const closeTimerRef = useRef(null);

  useEffect(
    () => () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    },
    []
  );

  const handleLogoChange = (event) => {
    const file = event.target.files[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setFormError("กรุณาเลือกไฟล์รูปภาพ");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setFormError("ขนาดไฟล์ต้องไม่เกิน 5MB");
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      setLogoPreview(e.target.result);
      setEditForm((prev) => ({ ...prev, logoFile: file }));
    };
    reader.readAsDataURL(file);
  };

  const handleCoverChange = (event) => {
    const file = event.target.files[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setFormError("กรุณาเลือกไฟล์รูปภาพ");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setFormError("ขนาดไฟล์ต้องไม่เกิน 5MB");
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      setCoverPreview(e.target.result);
      setEditForm((prev) => ({ ...prev, coverFile: file }));
    };
    reader.readAsDataURL(file);
  };

  const handleInputChange = (event) => {
    const { name, value } = event.target;
    if (name.startsWith("address.")) {
      const field = name.split(".")[1];
      setEditForm((prev) => ({
        ...prev,
        address: { ...prev.address, [field]: value },
      }));
    } else if (name.startsWith("openingHours.")) {
      const [day, field] = name.split(".");
      setEditForm((prev) => ({
        ...prev,
        openingHours: {
          ...prev.openingHours,
          [day]: { ...prev.openingHours[day], [field]: value },
        },
      }));
    } else {
      setEditForm((prev) => ({ ...prev, [name]: value }));
    }
  };

  const handleCategoriesChange = (event) => {
    const categories = event.target.value
      .split(",")
      .map((c) => c.trim())
      .filter(Boolean);
    setEditForm((prev) => ({ ...prev, categories }));
  };

  const closeModal = () => {
    if (saving) return;
    onClose();
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setFormError("");
    setFormSuccess("");

    if (!editForm.name?.trim()) {
      setFormError("กรุณาระบุชื่อร้านค้า");
      return;
    }

    if (isCreateMode) {
      const requiredFields = [
        ["address.street", editForm.address?.street],
        ["address.district", editForm.address?.district],
        ["address.province", editForm.address?.province],
        ["address.postalCode", editForm.address?.postalCode],
        ["phone", editForm.phone],
      ];
      if (requiredFields.some(([, value]) => !String(value || "").trim())) {
        setFormError("กรุณากรอกที่อยู่ ตำบล/แขวง จังหวัด รหัสไปรษณีย์ และเบอร์โทรศัพท์");
        return;
      }
    }

    if (!isCreateMode && !store) {
      setFormError("ไม่พบร้านค้า");
      return;
    }

    const storeId = isCreateMode ? null : (store?._id || store?.id);
    if (!isCreateMode && !storeId) {
      setFormError("ไม่พบรหัสร้านค้า ไม่สามารถบันทึกข้อมูลได้");
      return;
    }

    // Store fields are sent as JSON with the snake_case column names used by
    // storeService. Empty values are omitted so existing data is not wiped.
    const payload = {
      name: editForm.name.trim(),
      address: {
        street: editForm.address?.street?.trim() || "",
        district: editForm.address?.district?.trim() || "",
        province: editForm.address?.province?.trim() || "",
        postalCode: editForm.address?.postalCode?.trim() || "",
      },
      categories: editForm.categories || [],
      opening_hours: editForm.openingHours || {},
    };
    const coordinates = editForm.address?.coordinates;
    if (coordinates?.lat != null && coordinates?.lng != null) {
      payload.address.coordinates = { lat: Number(coordinates.lat), lng: Number(coordinates.lng) };
    }
    if (editForm.description?.trim()) payload.description = editForm.description.trim();
    if (editForm.phone?.trim()) payload.phone = editForm.phone.trim();
    if (editForm.email?.trim()) payload.email = editForm.email.trim().toLowerCase();
    const deliveryFee = String(editForm.deliveryFee ?? "").trim();
    if (deliveryFee !== "") payload.delivery_fee = deliveryFee;
    const minimumOrder = String(editForm.minimumOrder ?? "").trim();
    if (minimumOrder !== "") payload.minimum_order = minimumOrder;
    const estimatedDeliveryTime = String(editForm.estimatedDeliveryTime ?? "").trim();
    if (estimatedDeliveryTime !== "") payload.estimated_delivery_time = estimatedDeliveryTime;

    setSaving(true);
    try {
      const response = isCreateMode
        ? await storeAPI.createStore(payload, mode)
        : await storeAPI.updateStore(storeId, payload, mode);
      let savedStore = response?.data || response;

      // Logo/cover are uploaded through their own endpoints; PUT /stores/:id
      // has no multer and only accepts JSON.
      const uploadErrors = [];
      const savedStoreId = savedStore?._id || savedStore?.id || storeId;

      if (editForm.logoFile) {
        if (!savedStoreId) {
          uploadErrors.push("ไม่พบรหัสร้านค้าสำหรับอัปโหลดโลโก้");
        } else {
          try {
            const uploaded = await storeAPI.uploadStoreLogo(savedStoreId, editForm.logoFile, mode);
            const url = uploaded?.data?.url;
            if (url) savedStore = { ...savedStore, logo: url, logo_url: url };
          } catch (err) {
            uploadErrors.push(`โลโก้ไม่สำเร็จ (${err.message || "อัปโหลดไม่สำเร็จ"})`);
          }
        }
      }

      if (editForm.coverFile) {
        if (!savedStoreId) {
          uploadErrors.push("ไม่พบรหัสร้านค้าสำหรับอัปโหลดรูปปก");
        } else {
          try {
            const uploaded = await storeAPI.uploadStoreCover(savedStoreId, editForm.coverFile, mode);
            const url = uploaded?.data?.url;
            if (url) savedStore = { ...savedStore, coverImage: url, cover_image_url: url };
          } catch (err) {
            uploadErrors.push(`รูปปกไม่สำเร็จ (${err.message || "อัปโหลดไม่สำเร็จ"})`);
          }
        }
      }

      const nextStore = savedStore || store || null;

      if (uploadErrors.length > 0) {
        // Data was stored but at least one image failed: never report full success.
        setLogoPreview(nextStore?.logo || nextStore?.logo_url || null);
        setCoverPreview(nextStore?.coverImage || nextStore?.cover_image_url || null);
        setFormError(`บันทึกข้อมูลร้านค้าแล้ว แต่${uploadErrors.join(" และ ")} กรุณาลองอัปโหลดรูปอีกครั้ง`);
        if (onSaved && nextStore) onSaved(nextStore);
        return;
      }

      setEditForm((prev) => ({ ...prev, logoFile: null, coverFile: null }));
      setLogoPreview(nextStore?.logo || nextStore?.logo_url || null);
      setCoverPreview(nextStore?.coverImage || nextStore?.cover_image_url || null);
      setFormSuccess(isCreateMode ? "สร้างร้านค้าเรียบร้อยแล้ว" : "บันทึกข้อมูลร้านค้าเรียบร้อยแล้ว");
      if (onSaved && nextStore) onSaved(nextStore);
      closeTimerRef.current = setTimeout(() => onClose(), 1000);
    } catch (err) {
      setFormError(err.message || "บันทึกข้อมูลไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="seller-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={isCreateMode ? "สร้างร้านค้าของคุณ" : "แก้ไขโปรไฟล์ร้านค้า"}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) closeModal();
      }}
    >
      <div className="seller-modal">
        <div className="seller-modal-header">
          <h2>{isCreateMode ? "สร้างร้านค้าของคุณ" : "แก้ไขโปรไฟล์ร้านค้า"}</h2>
          <button
            type="button"
            className="seller-modal-close"
            onClick={closeModal}
            aria-label="ปิด"
          >
            ×
          </button>
        </div>

        {formError && (
          <div className="alert alert-error" role="alert">
            <AlertIcon /> {formError}
          </div>
        )}
        {formSuccess && (
          <div className="alert alert-success" role="alert">
            <CheckIcon /> {formSuccess}
          </div>
        )}

        <form onSubmit={handleSubmit} className="seller-modal-form">
          <div className="seller-image-uploads">
            <div className="seller-image-upload">
              <label className="seller-image-label">โลโก้ร้านค้า</label>
              <div className="seller-image-preview">
                {logoPreview ? (
                  <img src={logoPreview} alt="Logo preview" />
                ) : (
                  <div className="seller-image-placeholder">
                    <CameraIcon />
                    <span>คลิกเพื่ออัปโหลด</span>
                  </div>
                )}
              </div>
              <input
                type="file"
                ref={fileInputRef}
                accept="image/*"
                onChange={handleLogoChange}
                className="seller-file-input"
                id="logo-upload"
              />
              <label htmlFor="logo-upload" className="btn btn-outline seller-upload-btn">
                <CameraIcon /> เลือกไฟล์
              </label>
              <p className="seller-image-hint">แนะนำขนาด 200x200px, ไม่เกิน 5MB</p>
            </div>

            <div className="seller-image-upload">
              <label className="seller-image-label">รูปปก (Cover Image)</label>
              <div className="seller-image-preview cover">
                {coverPreview ? (
                  <img src={coverPreview} alt="Cover preview" />
                ) : (
                  <div className="seller-image-placeholder">
                    <CameraIcon />
                    <span>คลิกเพื่ออัปโหลด</span>
                  </div>
                )}
              </div>
              <input
                type="file"
                ref={coverFileInputRef}
                accept="image/*"
                onChange={handleCoverChange}
                className="seller-file-input"
                id="cover-upload"
              />
              <label htmlFor="cover-upload" className="btn btn-outline seller-upload-btn">
                <CameraIcon /> เลือกไฟล์
              </label>
              <p className="seller-image-hint">แนะนำขนาด 1200x400px, ไม่เกิน 5MB</p>
            </div>
          </div>

          <fieldset className="seller-fieldset">
            <legend>ข้อมูลพื้นฐาน</legend>
            <div className="form-group">
              <label className="form-label" htmlFor="store-name">ชื่อร้านค้า <span className="required">*</span></label>
              <input
                id="store-name"
                name="name"
                type="text"
                className="form-input"
                value={editForm.name || ""}
                onChange={handleInputChange}
                autoComplete="organization"
                required
                disabled={saving}
              />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="store-description">คำอธิบายร้านค้า</label>
              <textarea
                id="store-description"
                name="description"
                className="form-input"
                rows="3"
                value={editForm.description || ""}
                onChange={handleInputChange}
                autoComplete="off"
                disabled={saving}
              />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label" htmlFor="store-phone">โทรศัพท์ {isCreateMode && <span className="required">*</span>}</label>
                <input
                  id="store-phone"
                  name="phone"
                  type="tel"
                  className="form-input"
                  value={editForm.phone || ""}
                  onChange={handleInputChange}
                  autoComplete="tel"
                  required={isCreateMode}
                  disabled={saving}
                />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="store-email">อีเมล</label>
                <input
                  id="store-email"
                  name="email"
                  type="email"
                  className="form-input"
                  value={editForm.email || ""}
                  onChange={handleInputChange}
                  autoComplete="email"
                  disabled={saving}
                />
              </div>
            </div>
          </fieldset>

          <fieldset className="seller-fieldset">
            <legend>ที่อยู่ร้านค้า</legend>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label" htmlFor="store-street">ที่อยู่/ถนน {isCreateMode && <span className="required">*</span>}</label>
                <input
                  id="store-street"
                  name="address.street"
                  type="text"
                  className="form-input"
                  value={editForm.address?.street || ""}
                  onChange={handleInputChange}
                  autoComplete="street-address"
                  required={isCreateMode}
                  disabled={saving}
                />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="store-postalCode">รหัสไปรษณีย์ {isCreateMode && <span className="required">*</span>}</label>
                <input
                  id="store-postalCode"
                  name="address.postalCode"
                  type="text"
                  className="form-input"
                  value={editForm.address?.postalCode || ""}
                  onChange={handleInputChange}
                  autoComplete="postal-code"
                  required={isCreateMode}
                  disabled={saving}
                />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label" htmlFor="store-district">ตำบล/แขวง {isCreateMode && <span className="required">*</span>}</label>
                <input
                  id="store-district"
                  name="address.district"
                  type="text"
                  className="form-input"
                  value={editForm.address?.district || ""}
                  onChange={handleInputChange}
                  required={isCreateMode}
                  disabled={saving}
                />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="store-province">อำเภอ/เขต/จังหวัด {isCreateMode && <span className="required">*</span>}</label>
                <input
                  id="store-province"
                  name="address.province"
                  type="text"
                  className="form-input"
                  value={editForm.address?.province || ""}
                  onChange={handleInputChange}
                  required={isCreateMode}
                  disabled={saving}
                />
              </div>
            </div>
          </fieldset>

          <fieldset className="seller-fieldset">
            <legend>พิกัดร้านค้าบนแผนที่</legend>
            <StoreLocationMap
              value={editForm.address?.coordinates || null}
              onChange={(coordinates) =>
                setEditForm((prev) => ({
                  ...prev,
                  address: { ...prev.address, coordinates },
                }))
              }
              storeName={editForm.name}
              height={260}
            />
          </fieldset>

          <fieldset className="seller-fieldset">
            <legend>หมวดหมู่สินค้า</legend>
            <div className="form-group">
              <label className="form-label" htmlFor="store-categories">หมวดหมู่ (คั่นด้วยเครื่องหมายจุลภาค)</label>
              <input
                id="store-categories"
                type="text"
                className="form-input"
                value={editForm.categories?.join(", ") || ""}
                onChange={handleCategoriesChange}
                placeholder="เช่น อาหาร, เครื่องดื่ม, ของหวาน"
                disabled={saving}
              />
              <p className="form-hint">ตัวอย่าง: อาหาร, เครื่องดื่ม, ของหวาน, อาหารทะเล</p>
            </div>
          </fieldset>

          <fieldset className="seller-fieldset">
            <legend>ช่วงเวลาเปิดทำการ</legend>
            <div className="seller-hours-form">
              {days.map((day) => {
                const hours = editForm.openingHours?.[day] || { open: "", close: "", isClosed: false };
                return (
                  <div key={day} className="seller-hour-form-row">
                    <label className="seller-hour-form-label">
                      <input
                        type="checkbox"
                        name={`openingHours.${day}.isClosed`}
                        checked={hours.isClosed}
                        onChange={(e) =>
                          setEditForm((prev) => ({
                            ...prev,
                            openingHours: {
                              ...prev.openingHours,
                              [day]: { ...hours, isClosed: e.target.checked },
                            },
                          }))
                        }
                        disabled={saving}
                      />
                      <span>{dayLabels[day]}</span>
                    </label>
                    {!hours.isClosed && (
                      <div className="seller-hour-form-times">
                        <input
                          type="time"
                          name={`openingHours.${day}.open`}
                          className="form-input"
                          value={hours.open}
                          onChange={handleInputChange}
                          disabled={saving}
                          placeholder="เปิด"
                        />
                        <span>ถึง</span>
                        <input
                          type="time"
                          name={`openingHours.${day}.close`}
                          className="form-input"
                          value={hours.close}
                          onChange={handleInputChange}
                          disabled={saving}
                          placeholder="ปิด"
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </fieldset>

          <fieldset className="seller-fieldset">
            <legend>การจัดส่ง</legend>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label" htmlFor="store-deliveryFee">ค่าจัดส่ง (บาท)</label>
                <input
                  id="store-deliveryFee"
                  name="deliveryFee"
                  type="number"
                  className="form-input"
                  value={editForm.deliveryFee || ""}
                  onChange={handleInputChange}
                  min="0"
                  step="1"
                  disabled={saving}
                />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="store-minimumOrder">ยอดสั่งซื้อขั้นต่ำ (บาท)</label>
                <input
                  id="store-minimumOrder"
                  name="minimumOrder"
                  type="number"
                  className="form-input"
                  value={editForm.minimumOrder || ""}
                  onChange={handleInputChange}
                  min="0"
                  step="1"
                  disabled={saving}
                />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="store-estimatedDeliveryTime">เวลาจัดส่งประมาณ (นาที)</label>
                <input
                  id="store-estimatedDeliveryTime"
                  name="estimatedDeliveryTime"
                  type="number"
                  className="form-input"
                  value={editForm.estimatedDeliveryTime || ""}
                  onChange={handleInputChange}
                  min="1"
                  step="1"
                  disabled={saving}
                />
              </div>
            </div>
          </fieldset>

          <div className="seller-modal-actions">
            <button type="button" className="btn btn-outline" onClick={closeModal} disabled={saving}>
              <CancelIcon /> ยกเลิก
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? (
                <>
                  <span className="spinner" /> กำลังบันทึก...
                </>
              ) : (
                <>
                  <SaveIcon /> {isCreateMode ? "สร้างร้านค้า" : "บันทึกข้อมูลร้านค้า"}
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}