import { useState, useEffect, useCallback } from "react";
import { productAPI } from "../api/product";

const IMAGE_COUNT = 3;

const fieldLabels = {
  name: "ชื่อสินค้า",
  price: "ราคา",
  discountPrice: "ราคาส่วนลด",
  category: "หมวดหมู่",
  description: "รายละเอียด",
  stock: "จำนวนคงคลัง",
};

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

  const fetchProducts = useCallback(async () => {
    try {
      setLoading(true);
      const response = await productAPI.getProducts({}, "admin");
      // Backend returns { success: true, data: products[], ... }
      const productList = response?.data || response?.products || response || [];
      setProducts(Array.isArray(productList) ? productList : []);
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
      price: product.price || "",
      discountPrice: product.discountPrice || "",
      category: product.category || "",
      description: product.description || "",
      stock: product.stock || "",
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

    // Validate images: at least 1 image (existing or new)
    const hasExistingImages = existingImages.length > 0;
    const hasNewImages = images.some((file) => file !== null);
    if (!hasExistingImages && !hasNewImages) {
      setFormError("กรุณาอัปโหลดรูปสินค้าอย่างน้อย 1 รูป");
      return;
    }

    const data = new FormData();
    data.append("name", form.name);
    data.append("price", form.price);
    if (form.discountPrice) data.append("discountPrice", form.discountPrice);
    data.append("category", form.category);
    data.append("description", form.description);
    data.append("stock", form.stock);
    
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
      setFormError(err.message || (isEditing ? "แก้ไขสินค้าไม่สำเร็จ" : "เพิ่มสินค้าไม่สำเร็จ"));
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

  const handleDelete = (productId) => {
    if (window.confirm("ต้องการลบสินค้านี้ใช่หรือไม่?")) {
      productAPI.deleteProduct(productId, "admin").then(fetchProducts);
    }
  };

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
                <th>รูปภาพ</th>
                <th>ชื่อสินค้า</th>
                <th>หมวดหมู่</th>
                <th>ราคา</th>
                <th>สต็อก</th>
                <th>สถานะ</th>
                <th>การจัดการ</th>
              </tr>
            </thead>
            <tbody>
              {Array.isArray(products) && products.map((product, index) => (
                <tr key={product._id || product.id || index}>
                  <td className="id-cell">{index + 1}</td>
                  <td>
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
                  <td>
                    <div className="product-name-cell">{product.name}</div>
                  </td>
                  <td>{product.category || "-"}</td>
                  <td>{formatPrice(product.price)}</td>
                  <td>{product.stock ?? "-"}</td>
                  <td>
                    <span className={`status-badge ${product.isActive !== false ? "status-active" : "status-inactive"}`}>
                      {product.isActive !== false ? "เปิดขาย" : "ปิดขาย"}
                    </span>
                  </td>
                  <td className="actions-cell">
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
                      onClick={() => handleDelete(product._id || product.id)}
                    >
                      ลบ
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
    </div>
  );
}