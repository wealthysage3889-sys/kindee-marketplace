import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { getToken } from "../api/auth";

export default function AdminLogin() {
  const { isAdmin, loading: authLoading, initializing: authInitializing, login, logout } = useAuth();
  const [form, setForm] = useState({ email: "", password: "" });
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    // Wait for the session check before redirecting. `isAdmin` already requires
    // both the admin token and an admin/owner role, so this page and
    // ProtectedRoute always agree.
    if (authInitializing || authLoading) return;
    if (!isAdmin) return;
    // Guard against a stale React state right after logout: if the token is
    // already gone from storage, there is nothing to return to.
    if (!getToken("admin")) return;
    navigate("/selladmin", { replace: true });
  }, [isAdmin, authLoading, authInitializing, navigate]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
    setErrors((prev) => ({ ...prev, [name]: "" }));
  };

  const validate = () => {
    const next = {};
    if (!form.email) next.email = "กรุณากรอกอีเมล";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email))
      next.email = "กรุณากรอกอีเมลให้ถูกต้อง";
    if (!form.password) next.password = "กรุณากรอกรหัสผ่าน";
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validate()) return;
    setLoading(true);
    setMessage("");
    try {
      const data = await login(form.email, form.password, "admin");
      if (!["admin", "owner"].includes(data.user?.role)) {
        await logout("admin");
        setMessage("บัญชีนี้ไม่มีสิทธิ์เข้าสู่ระบบแอดมิน (ต้องมี role admin/owner ในฐานข้อมูล)");
        return;
      }
      // The success redirect is handled by the effect above once the admin
      // session state lands, so there is exactly one navigation.
    } catch (err) {
      if (err?.data?.message) {
        setMessage(err.data.message);
      } else {
        setMessage("เข้าสู่ระบบแอดมินไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-card">
        <div className="auth-header">
          <div className="brand">Kindee Admin</div>
          <div className="tagline">เข้าสู่ระบบแอดมิน</div>
        </div>
        {message && <div className="alert alert-error">{message}</div>}
        <form onSubmit={handleSubmit} noValidate>
          <div className="form-group">
            <label className="form-label">อีเมล</label>
            <input
              name="email"
              type="email"
              className={`form-input ${errors.email ? "error" : ""}`}
              placeholder="admin@example.com"
              value={form.email}
              onChange={handleChange}
              autoComplete="email"
            />
            {errors.email && (
              <div className="form-hint" style={{ color: "#dc2626" }}>
                {errors.email}
              </div>
            )}
          </div>
          <div className="form-group">
            <label className="form-label">รหัสผ่าน</label>
            <input
              name="password"
              type="password"
              className={`form-input ${errors.password ? "error" : ""}`}
              placeholder="••••••••"
              value={form.password}
              onChange={handleChange}
              autoComplete="current-password"
            />
            {errors.password && (
              <div className="form-hint" style={{ color: "#dc2626" }}>
                {errors.password}
              </div>
            )}
          </div>
          <button type="submit" className="btn" disabled={loading}>
            {loading ? (
              <>
                <span className="spinner"></span>
                กำลังเข้าสู่ระบบ...
              </>
            ) : (
              "เข้าสู่ระบบแอดมิน"
            )}
          </button>
        </form>
        <div className="link-text">
          ลูกค้าเข้าสู่ระบบ?{" "}
          <Link to="/login">เข้าสู่ระบบลูกค้า</Link>
        </div>
      </div>
    </div>
  );
}
