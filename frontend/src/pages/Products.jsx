import { useState, useEffect, useNavigate } from "react";
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

export default function Products() {
  const navigate = useNavigate();
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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

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

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    setSuccess("");

    const required = ["name", "price", "category", "description", "stock"];
    for (const key of required) {
      if (!form[key]) {
        setError(`กรุณากรอก${fieldLabels[key]}`);
        return;
      }
    }

    const data = new FormData();
    data.append("name", form.name);
    data.append("price", form.price);
    if (form.discountPrice) data.append("discountPrice", form.discountPrice);
    data.append("category", form.category);
    data.append("description", form.description);
    data.append("stock", form.stock);
    images.forEach((file) => {
      if (file) data.append("images", file);
    });

    setLoading(true);
    try {
      await productAPI.createProduct(data);
      setSuccess("เพิ่มสินค้าสำเร็จ");
      setTimeout(() => navigate("/seller/products"), 1200);
    } catch (err) {
      setError(err.message || "เพิ่มสินค้าไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page">
      <div className="admin-layout">
        <main className="main-content">
          <h1>เพิ่มสินค้าใหม่</h1>
          {error && <div className="form-error" role="alert">{error}</div>}
          {success && <div className="form-success" role="status">{success}</div>}
          <form onSubmit={handleSubmit} className="product-form" noValidate>
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

            <div className="form-group">
              <label className="form-label">{fieldLabels.price}</label>
              <input
                className="form-input"
                type="number"
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
                min="0"
                step="0.01"
                value={form.discountPrice}
                onChange={handleInput("discountPrice")}
                placeholder="ราคาพิเศษ (ถ้ามี)"
              />
            </div>

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
              <label className="form-label">{fieldLabels.description}</label>
              <textarea
                className="form-input"
                value={form.description}
                onChange={handleInput("description")}
                placeholder="เขียนรายละเอียดสินค้า"
                rows="4"
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label">{fieldLabels.stock}</label>
              <input
                className="form-input"
                type="number"
                min="0"
                value={form.stock}
                onChange={handleInput("stock")}
                placeholder="จำนวนสินค้าคงคลัง"
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label">รูปภาพสินค้า (สูงสุด 3 รูป)</label>
              <div className="image-grid">
                {Array.from({ length: IMAGE_COUNT }).map((_, index) => (
                  <div key={index} className="image-slot">
                    {previews[index] ? (
                      <>
                        <img src={previews[index]} alt={`รูปที่ ${index + 1}`} className="image-preview" />
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

            <button
              type="submit"
              className="btn"
              disabled={loading}
            >
              {loading ? "กำลังอัปโหลด..." : "บันทึกสินค้า"}
            </button>
          </form>
          <div className="form-actions">
            <button type="button" className="btn-outline" onClick={() => navigate("/seller/products")}>ยกเลิก</button>
          </div>
        </main>
      </div>
    </div>
  );
}
