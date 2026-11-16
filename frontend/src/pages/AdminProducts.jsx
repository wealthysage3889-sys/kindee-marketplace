import { useState, useEffect, useCallback } from "react";
import { productAPI } from "../api/product";
import { extractList } from "../utils/helpers";

const IMAGE_COUNT = 3;

const fieldLabels = {
  name: "ชื่อสินค้า",
  price: "ราคา",
  discountPrice: "ราคาส่วนลด",
  category: "หมวดหมู่",
  description: "รายละเอียด",
  stock: "จำนวนคงคลัง",
};

// "1,000.50" / "1000.50" -> 1000.5, "" -> null, invalid text -> NaN
const parseNumberInput = (value) => {
  const normalized = String(value ?? "").replace(/,/g, "").trim();
  if (normalized === "") return null;
  return Number(normalized);
};

const formatBaht = (value) =>
  `${Number(value).toLocaleString("th-TH", { maximumFractionDigits: 2 })} บาท`;

const errorMessage = (err, fallback) =>
  err?.data?.errors?.[0]?.message || err?.message || fallback;

export default function AdminProducts() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editingProductId, setEditingProductId] = useState(null);
  const [form, setForm] = useState({
    name: "",
    price: "",
    discountPrice: "",
    category: "",
    description: "",
    stock: "",
  });
  const [images, setImages] = useState(Array(IMAGE_COUNT).fill(null));
  const [previews, setPreviews] = useState(Array(IMAGE_COUNT).fill(null));
  const [existingImages, setExistingImages] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [formSuccess, setFormSuccess] = useState("");
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  const fetchProducts = useCallback(async () => {
    try {
      setLoading(true);
      const response = await productAPI.getProducts({}, "admin");
      // API responds { success: true, data: { products, pagination } }
      setProducts(extractList(response, "products"));
    } catch (err) {
      setError(err.message || "โหลดสินค้าไม่สำเร็จ");
      setProducts([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  useEffect(() => {
    return () => {
      previews.forEach((url) => {
        if (url) URL.revokeObjectURL(url);
      });
    };
  }, [previews]);

  const handleInput = (key) => (event) => {
    setForm((prev) => ({ ...prev, [key]: event.target.value }));
  };

  const handleImage = (index) => (event) => {
    const file = event.target.files?.[0] || null;
    setImages((prev) => {
      const next = [...prev];
      next[index] = file;
      return next;
    });
    setPreviews((prev) => {
      const next = [...prev];
      next[index] = file ? URL.createObjectURL(file) : null;
      return next;
    });
  };

  const removeImage = (index) => {
    setImages((prev) => {
      const next = [...prev];
      next[index] = null;
      return next;
    });
    setPreviews((prev) => {
      const next = [...prev];
      next[index] = null;
      return next;
    });
  };

  const removeExistingImage = (index) => {
    setExistingImages((prev) => prev.filter((_, i) => i !== index));
  };

  const resetForm = () => {
    setForm({
      name: "",
      price: "",
      discountPrice: "",
      category: "",
      description: "",
      stock: "",
    });
    setImages(Array(IMAGE_COUNT).fill(null));
    setPreviews(Array(IMAGE_COUNT).fill(null));
    setExistingImages([]);
    setFormError("");
    setFormSuccess("");
    setIsEditing(false);
    setEditingProductId(null);
  };

  const openCreateModal = () => {
    resetForm();
    setShowModal(true);
  };

  const openEditModal = (product) => {
    resetForm();
    setForm({
      name: product.name || "",
      price: product.price ?? "",
      // The API returns discount_price (snake_case); accept both spellings so
      // an existing discount is never shown as empty and then wiped on save.
      discountPrice: product.discountPrice ?? product.discount_price ?? "",
      category: product.category?.name || product.category || "",
      description: product.description || "",
      stock: product.stock ?? "",
    });
    setExistingImages(product.images || []);
    setPreviews(product.images || []);
    setIsEditing(true);
    setEditingProductId(product._id || product.id);
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    resetForm();
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setFormError("");
    setFormSuccess("");

    const required = ["name", "price", "category", "description", "stock"];
    for (const key of required) {
      if (!form[key]) {
        setFormError(`กรุณากรอก${fieldLabels[key]}`);
        return;
      }
    }

    const price = parseNumberInput(form.price);
    if (price === null || !Number.isFinite(price) || price < 0) {
      setFormError("กรุณากรอกราคาปกติเป็นตัวเลข 0 ขึ้นไป");
      return;
    }

    const stock = parseNumberInput(form.stock);
    if (stock === null || !Number.isInteger(stock) || stock < 0) {
      setFormError("กรุณากรอกจำนวนคงคลังเป็นเลขจำนวนเต็ม 0 ขึ้นไป");
      return;
    }

    // An empty discount field means "no discount"; otherwise it must be a
    // number lower than the regular price.
    const discountPrice = parseNumberInput(form.discountPrice);
    if (discountPrice !== null && (!Number.isFinite(discountPrice) || discountPrice <= 0)) {
      setFormError("ราคาส่วนลดต้องเป็นตัวเลขมากกว่า 0 และน้อยกว่าราคาปกติ หรือเว้นว่างไว้หากไม่มีส่วนลด");
      return;
    }
    if (discountPrice !== null && discountPrice >= price) {
      setFormError(
        `ราคาส่วนลดต้องน้อยกว่าราคาปกติ (ราคาปกติ ${formatBaht(price)} และราคาส่วนลด ${formatBaht(discountPrice)})`
      );
      return;
    }

    // Validate images: at least 1 image (existing or new)
    const hasExistingImages = existingImages.length > 0;
    const hasNewImages = images.some((file) => file !== null);
    if (!hasExistingImages && !hasNewImages) {
      setFormError("กรุณาอัปโหลดรูปสินค้าอย่างน้อย 1 รูป");
      return;
    }

    const data = new FormData();
    data.append("name", form.name);
    data.append("price", String(price));
    // While editing the discount is always sent, so clearing the field removes
    // an existing discount; on create it is omitted when left empty.
    if (isEditing || discountPrice !== null) {
      data.append("discountPrice", discountPrice === null ? "" : String(discountPrice));
    }
    data.append("category", form.category);
    data.append("description", form.description);
    data.append("stock", String(stock));
    
    // Keep existing images
    existingImages.forEach((img) => {
      data.append("existingImages", img);
    });
    
    // Add new images
    images.forEach((file) => {
      if (file) data.append("images", file);
    });

    setSubmitting(true);
    try {
      if (isEditing && editingProductId) {
        await productAPI.updateProduct(editingProductId, data, "admin");
        setFormSuccess("แก้ไขสินค้าสำเร็จ");
      } else {
        await productAPI.createProduct(data, "admin");
        setFormSuccess("เพิ่มสินค้าสำเร็จ");
      }
      setTimeout(() => {
        closeModal();
        fetchProducts();
      }, 1000);
    } catch (err) {
      setFormError(
        errorMessage(
          err,
          isEditing ? "แก้ไขสินค้าไม่สำเร็จ" : "เพิ่มสินค้าไม่สำเร็จ"
        )
      );
    } finally {
      setSubmitting(false);
    }
  };

  const formatPrice = (price) => {
    return new Intl.NumberFormat("th-TH", {
      style: "currency",
      currency: "THB",
    }).format(price);
  };

  const openDeleteModal = (product) => {
    setDeleteError("");
    setDeleteTarget(product);
  };

  const closeDeleteModal = () => {
    if (deleting) return;
    setDeleteTarget(null);
    setDeleteError("");
  };

  const confirmDelete = async () => {
    if (!deleteTarget || deleting) return;
    const productId = deleteTarget._id || deleteTarget.id;
    setDeleting(true);
    setDeleteError("");
    try {
      await productAPI.deleteProduct(productId, "admin");
      setDeleteTarget(null);
      await fetchProducts();
    } catch (err) {
      setDeleteError(errorMessage(err, "ลบสินค้าไม่สำเร็จ"));
    } finally {
      setDeleting(false);
    }
  };

  useEffect(() => {
    if (!deleteTarget) return undefined;

    const handleKeyDown = (event) => {
      if (event.key === "Escape" && !deleting) {
        setDeleteTarget(null);
        setDeleteError("");
      }
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [deleteTarget, deleting]);

  return (
    <div className="page">
      <div className="admin-products-header">
        <h1>จัดการสินค้า</h1>
        <button type="button" className="btn" onClick={openCreateModal}>
          + เพิ่มสินค้า
        </button>
      </div>

      {error && <div className="form-error" role="alert">{error}</div>}

      {loading ? (
        <div className="home-loading">กำลังโหลดสินค้า...</div>
      ) : !Array.isArray(products) || products.length === 0 ? (
        <div className="product-empty">ยังไม่มีสินค้าในระบบ</div>
      ) : (
        <div className="users-table-wrap">
          <table className="users-table">
            <thead>
              <tr>
                <th className="id-cell">#</th>
                <th className="col-image">รูปภาพ</th>
                <th className="col-name">ชื่อสินค้า</th>
                <th className="col-category">หมวดหมู่</th>
                <th className="col-price">ราคา</th>
                <th className="col-stock">สต็อก</th>
                <th className="col-status">สถานะ</th>
                <th className="col-actions">การจัดการ</th>
              </tr>
            </thead>
            <tbody>
              {Array.isArray(products) && products.map((product, index) => (
                <tr key={product._id || product.id || index}>
                  <td className="id-cell">{index + 1}</td>
                  <td className="col-image">
                    {product.images && product.images.length > 0 ? (
                      <img
                        src={product.images[0]}
                        alt={product.name}
                        className="product-thumb"
                      />
                    ) : (
                      <div className="product-thumb-placeholder">ไม่มีรูป</div>
                    )}
                  </td>
                  <td className="col-name">
                    <div className="product-name-cell">{product.name}</div>
                  </td>
                  <td className="col-category">{product.category?.name || product.category || "-"}</td>
                  <td className="col-price">{formatPrice(product.price)}</td>
                  <td className="col-stock">{product.stock ?? "-"}</td>
                  <td className="col-status">
                    <span className={`status-badge ${product.isActive !== false ? "status-active" : "status-inactive"}`}>
                      {product.isActive !== false ? "เปิดขาย" : "ปิดขาย"}
                    </span>
                  </td>
                  <td className="col-actions">
                    <button
                      type="button"
                      className="btn-edit"
                      onClick={() => openEditModal(product)}
                    >
                      แก้ไข
                    </button>
                    <button
                      type="button"
                      className="btn-delete"
                      onClick={() => openDeleteModal(product)}
                    >
                      ลบ
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="products-card-view">
            {products.map((product, index) => (
              <article
                key={product._id || product.id || index}
                className="product-card"
              >
                {product.images && product.images.length > 0 ? (
                  <img
                    src={product.images[0]}
                    alt={product.name}
                    className="product-card-image"
                  />
                ) : (
                  <div className="product-card-image product-card-image-placeholder">
                    ไม่มีรูป
                  </div>
                )}
                <div className="product-card-body">
                  <div className="product-card-index">สินค้าที่ {index + 1}</div>
                  <div className="product-card-name">{product.name}</div>
                  <div className="product-card-meta">
                    <span className="product-card-meta-item">
                      {product.category?.name || product.category || "-"}
                    </span>
                    <span className="product-card-meta-item">
                      สต็อก {product.stock ?? "-"}
                    </span>
                  </div>
                  <div className="product-card-price">
                    {formatPrice(product.price)}
                  </div>
                  <span
                    className={`status-badge ${
                      product.isActive !== false ? "status-active" : "status-inactive"
                    }`}
                  >
                    {product.isActive !== false ? "เปิดขาย" : "ปิดขาย"}
                  </span>
                </div>
                <div className="product-card-actions">
                  <button
                    type="button"
                    className="btn-edit"
                    onClick={() => openEditModal(product)}
                  >
                    แก้ไข
                  </button>
                  <button
                    type="button"
                    className="btn-delete"
                    onClick={() => openDeleteModal(product)}
                  >
                    ลบ
                  </button>
                </div>
              </article>
            ))}
          </div>
        </div>
      )}

      {showModal && (
        <div className="account-modal-overlay product-modal-overlay" onClick={closeModal}>
          <div className="account-modal product-modal" onClick={(e) => e.stopPropagation()}>
            <div className="account-modal-header">
              <h2>{isEditing ? "แก้ไขสินค้า" : "เพิ่มสินค้าใหม่"}</h2>
              <button type="button" className="account-modal-close" onClick={closeModal}>
                ×
              </button>
            </div>

            {formError && <div className="form-error" role="alert">{formError}</div>}
            {formSuccess && <div className="form-success" role="status">{formSuccess}</div>}

            <form onSubmit={handleSubmit} className="product-form account-modal-form" noValidate>
              <div className="form-group">
                <label className="form-label">{fieldLabels.name}</label>
                <input
                  className="form-input"
                  type="text"
                  value={form.name}
                  onChange={handleInput("name")}
                  placeholder="กรอกชื่อสินค้า"
                  required
                />
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">{fieldLabels.price}</label>
                  <input
                    className="form-input"
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.01"
                    value={form.price}
                    onChange={handleInput("price")}
                    placeholder="กรอกราคา"
                    required
                  />
                  <span className="form-hint">หน่วยเป็นบาท</span>
                </div>

                <div className="form-group">
                  <label className="form-label">{fieldLabels.discountPrice}</label>
                  <input
                    className="form-input"
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.01"
                    value={form.discountPrice}
                    onChange={handleInput("discountPrice")}
                    placeholder="ราคาพิเศษ (ถ้ามี)"
                  />
                  <span className="form-hint">เว้นว่างได้หากไม่มีส่วนลด และต้องน้อยกว่าราคาปกติ</span>
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">{fieldLabels.category}</label>
                  <input
                    className="form-input"
                    type="text"
                    value={form.category}
                    onChange={handleInput("category")}
                    placeholder="เช่น เสื้อผ้า อิเล็กทรอนิกส์"
                    required
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">{fieldLabels.stock}</label>
                  <input
                    className="form-input"
                    type="number"
                    inputMode="numeric"
                    min="0"
                    value={form.stock}
                    onChange={handleInput("stock")}
                    placeholder="จำนวนคงคลัง"
                    required
                  />
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">{fieldLabels.description}</label>
                <textarea
                  className="form-input"
                  value={form.description}
                  onChange={handleInput("description")}
                  placeholder="เขียนรายละเอียดสินค้า"
                  rows="2"
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">รูปภาพสินค้า (สูงสุด 3 รูป)</label>
                <div className="image-grid">
                  {/* Existing images */}
                  {existingImages.map((img, index) => (
                    <div key={`existing-${index}`} className="image-slot">
                      <img src={img} alt={`รูปที่ ${index + 1}`} className="image-preview" />
                      <button type="button" className="image-remove" onClick={() => removeExistingImage(index)}>ลบ</button>
                    </div>
                  ))}
                  {/* New image slots */}
                  {Array.from({ length: IMAGE_COUNT }).map((_, index) => (
                    <div key={`new-${index}`} className="image-slot">
                      {previews[index] && !existingImages[index] ? (
                        <>
                          <img src={previews[index]} alt={`รูปใหม่ ${index + 1}`} className="image-preview" />
                          <button type="button" className="image-remove" onClick={() => removeImage(index)}>ลบ</button>
                        </>
                      ) : (
                        <>
                          <label className="image-upload">
                            <input
                              type="file"
                              accept="image/*"
                              onChange={handleImage(index)}
                              className="image-input"
                            />
                            + รูปที่ {index + 1}
                          </label>
                        </>
                      )}
                    </div>
                  ))}
                </div>
                <span className="form-hint">เลือกไฟล์รูปภาพได้สูงสุด 3 รูป (JPG, PNG)</span>
              </div>

              <div className="account-modal-actions">
                <button type="button" className="btn-outline" onClick={closeModal}>ยกเลิก</button>
                <button type="submit" className="btn" disabled={submitting}>
                  {submitting ? "กำลังบันทึก..." : isEditing ? "บันทึกการแก้ไข" : "บันทึกสินค้า"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div className="account-modal-overlay" onClick={closeDeleteModal}>
          <div
            className="account-modal delete-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="account-modal-header">
              <h2 id="delete-modal-title">ยืนยันการลบสินค้า</h2>
              <button
                type="button"
                className="account-modal-close"
                onClick={closeDeleteModal}
                aria-label="ปิด"
                disabled={deleting}
              >
                ×
              </button>
            </div>

            {deleteError && <div className="form-error" role="alert">{deleteError}</div>}

            <div className="delete-product-info">
              {deleteTarget.images && deleteTarget.images.length > 0 ? (
                <img
                  src={deleteTarget.images[0]}
                  alt={deleteTarget.name}
                  className="delete-product-thumb"
                />
              ) : (
                <div className="delete-product-thumb delete-product-thumb-placeholder">ไม่มีรูป</div>
              )}
              <div className="delete-product-details">
                <div className="delete-product-name">{deleteTarget.name}</div>
                <div className="delete-product-meta">
                  {deleteTarget.category?.name || deleteTarget.category || "-"}
                </div>
                <div className="delete-product-price">{formatPrice(deleteTarget.price)}</div>
              </div>
            </div>

            <p className="delete-warning">
              คุณต้องการลบสินค้านี้ใช่หรือไม่? การดำเนินการนี้ไม่สามารถย้อนกลับได้
            </p>

            <div className="account-modal-actions">
              <button
                type="button"
                className="btn-outline"
                onClick={closeDeleteModal}
                disabled={deleting}
              >
                ยกเลิก
              </button>
              <button
                type="button"
                className="btn-delete-confirm"
                onClick={confirmDelete}
                disabled={deleting}
              >
                {deleting ? "กำลังลบ..." : "ยืนยันการลบ"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}