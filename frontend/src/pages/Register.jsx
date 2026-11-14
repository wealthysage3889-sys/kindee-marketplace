import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { authAPI } from "../api/auth";
import SocialAuth from "../components/SocialAuth";

const EyeIcon = ({ open }) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {open ? (<><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></>) : (<><path d="M9.9 4.2A9.6 9.6 0 0 1 12 4c6.5 0 10 7 10 7a17 17 0 0 1-3 3.9" /><path d="M6.6 6.6A16.7 16.7 0 0 0 2 11s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6" /><path d="m2 2 20 20" /></>)}
  </svg>
);
const ArrowLeftIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 6-6 6 6 6" /></svg>
);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function loadFacebookSdk(appId) {
  return new Promise((resolve, reject) => {
    if (window.FB) { window.FB.init({ appId, cookie: false, xfbml: false, version: "v19.0" }); resolve(window.FB); return; }
    window.fbAsyncInit = function () { window.FB.init({ appId, cookie: false, xfbml: false, version: "v19.0" }); resolve(window.FB); };
    const id = "facebook-jssdk";
    if (document.getElementById(id)) { const t = setInterval(() => { if (window.FB) { clearInterval(t); resolve(window.FB); } }, 50); setTimeout(() => { clearInterval(t); if (!window.FB) reject(new Error("โหลด Facebook SDK ไม่สำเร็จ")); }, 8000); return; }
    const js = document.createElement("script"); js.id = id; js.src = "https://connect.facebook.net/en_US/sdk.js"; js.async = true; js.defer = true; js.onerror = () => reject(new Error("โหลด Facebook SDK ไม่สำเร็จ")); document.body.appendChild(js);
  });
}

export default function Register() {
  const { register, loginWithGoogle, loginWithFacebook, loginWithLine, logout } = useAuth();
  const [step, setStep] = useState(1);
  const [emailOrPhone, setEmailOrPhone] = useState("");
  const [form, setForm] = useState({ name: "", email: "", password: "", phone: "", address: "", role: "customer" });
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState("");
  const [info, setInfo] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [socialConfig, setSocialConfig] = useState(null);
  const navigate = useNavigate();
  const location = useLocation();
  const lineHandled = useRef(false);

  const isEmail = emailOrPhone.includes("@");

  useEffect(() => {
    let active = true;
    authAPI.getSocialConfig().then((res) => { if (active) setSocialConfig(res?.data || null); }).catch(() => {});
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const code = params.get("code");
    const state = params.get("state");
    if (code && state === "line_register" && !lineHandled.current) {
      lineHandled.current = true;
      setLoading(true); setMessage("");
      loginWithLine(code, window.location.origin + "/register", "customer")
        .then((data) => {
          if (["admin", "owner"].includes(data.user.role)) { logout("customer"); navigate("/selladmin/login", { replace: true }); }
          else navigate("/", { replace: true });
        })
        .catch((err) => { setMessage(err.message || "สมัครด้วย LINE ไม่สำเร็จ"); navigate("/register", { replace: true }); })
        .finally(() => setLoading(false));
    }
  }, [location.search, loginWithLine, logout, navigate]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
    setErrors((prev) => ({ ...prev, [name]: "" }));
  };

  const handleStepOne = (e) => {
    e.preventDefault();
    const id = emailOrPhone.trim();
    if (!id) { setErrors({ identifier: "กรุณากรอกเบอร์โทรศัพท์หรืออีเมล" }); return; }
    if (id.includes("@")) { if (!EMAIL_RE.test(id)) { setErrors({ identifier: "รูปแบบอีเมลไม่ถูกต้อง" }); return; } }
    else if (!/^[0-9+\-\s]{8,20}$/.test(id)) { setErrors({ identifier: "กรุณากรอกเบอร์โทรศัพท์ให้ถูกต้อง" }); return; }
    setErrors({}); setMessage(""); setInfo("");
    setForm((prev) => ({ ...prev, email: id.includes("@") ? id : "", phone: id.includes("@") ? "" : id }));
    setStep(2);
  };

  const validateDetails = () => {
    const next = {};
    if (!form.name.trim()) next.name = "กรุณากรอกชื่อ";
    if (!form.email.trim()) next.email = "กรุณากรอกอีเมล";
    else if (!EMAIL_RE.test(form.email.trim())) next.email = "กรุณากรอกอีเมลให้ถูกต้อง";
    if (!form.password) next.password = "กรุณากรอกรหัสผ่าน";
    else if (form.password.length < 6) next.password = "รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร";
    setErrors(next); return Object.keys(next).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault(); if (!validateDetails()) return;
    setLoading(true); setMessage(""); setInfo("");
    try {
      await register({ name: form.name.trim(), email: form.email.trim(), password: form.password, phone: form.phone.trim(), address: form.address.trim(), role: form.role });
      navigate("/");
    } catch (err) { setMessage(err?.data?.message || err.message || "สมัครสมาชิกไม่สำเร็จ กรุณาลองใหม่อีกครั้ง"); }
    finally { setLoading(false); }
  };

  const handleGoogle = async () => {
    if (!socialConfig?.google?.clientId) return;
    setMessage(""); setInfo("");
    const clientId = socialConfig.google.clientId;
    if (!window.google?.accounts?.id) {
      await new Promise((resolve, reject) => {
        const s = document.createElement("script"); s.src = "https://accounts.google.com/gsi/client"; s.async = true; s.defer = true; s.onload = resolve; s.onerror = () => reject(new Error("โหลด Google SDK ไม่สำเร็จ")); document.head.appendChild(s);
      }).catch((e) => { setMessage(e.message); });
    }
    if (!window.google?.accounts?.id) return;
    window.google.accounts.id.initialize({
      client_id: clientId,
      callback: async (response) => {
        if (!response?.credential) { setMessage("ไม่สามารถรับข้อมูลจาก Google ได้"); return; }
        setLoading(true);
        try {
          const data = await loginWithGoogle(response.credential, "customer");
          if (["admin", "owner"].includes(data.user.role)) { logout("customer"); navigate("/selladmin/login", { replace: true }); return; }
          navigate("/");
        } catch (err) { setMessage(err.message || "สมัครด้วย Google ไม่สำเร็จ"); }
        finally { setLoading(false); }
      },
    });
    window.google.accounts.id.prompt((notification) => {
      if (notification.isNotDisplayed() || notification.isSkippedMoment()) {
        setInfo("ไม่สามารถแสดงหน้าต่าง Google ได้ กรุณาตรวจสอบ Authorized origins ใน Google Cloud Console");
      }
    });
  };

  const handleFacebook = async () => {
    if (!socialConfig?.facebook?.appId) return;
    setMessage(""); setInfo("");
    try {
      const FB = await loadFacebookSdk(socialConfig.facebook.appId);
      FB.login(async (response) => {
        if (response.status === "connected" && response.authResponse?.accessToken) {
          setLoading(true);
          try {
            const data = await loginWithFacebook(response.authResponse.accessToken, "customer");
            if (["admin", "owner"].includes(data.user.role)) { logout("customer"); navigate("/selladmin/login", { replace: true }); return; }
            navigate("/");
          } catch (err) { setMessage(err.message || "สมัครด้วย Facebook ไม่สำเร็จ"); }
          finally { setLoading(false); }
        } else { setMessage("การสมัครด้วย Facebook ถูกยกเลิก"); }
      }, { scope: "public_profile,email" });
    } catch (err) { setMessage(err.message || "Facebook login ไม่สำเร็จ"); }
  };

  const handleLine = () => {
    if (!socialConfig?.line?.channelId) return;
    setMessage(""); setInfo("");
    const redirectUri = window.location.origin + "/register";
    const params = new URLSearchParams({ response_type: "code", client_id: socialConfig.line.channelId, redirect_uri: redirectUri, state: "line_register", scope: "profile openid email" });
    window.location.href = `https://access.line.me/oauth2/v2.1/authorize?${params.toString()}`;
  };

  const backToStepOne = () => { setStep(1); setErrors({}); setMessage(""); setInfo(""); };
  const hasSocial = socialConfig && ["google","facebook","line"].some((k) => {
    const c = socialConfig[k]; return c?.enabled && ((k==="google"&&c.clientId)||(k==="facebook"&&c.appId)||(k==="line"&&c.channelId));
  });

  return (
    <div className="auth-container">
      <div className="auth-card">
        <div className="auth-brand"><div className="auth-logo-mark">K</div><div className="auth-brand-name">Kindee Marketplace</div></div>
        <h1 className="auth-title">{step === 1 ? "สมัครสมาชิก" : "กรอกข้อมูลของคุณ"}</h1>
        <p className="auth-subtitle">{step === 1 ? "สร้างบัญชีใหม่เพื่อเริ่มช้อปปิ้ง" : "เกือบเสร็จแล้ว กรอกรายละเอียดเพิ่มเติม"}</p>

        {message && <div className="alert alert-error">{message}</div>}
        {info && <div className="alert alert-info">{info}</div>}

        {step === 1 ? (
          <>
            <form onSubmit={handleStepOne} noValidate>
              <div className="form-group">
                <label className="form-label" htmlFor="register-identifier">เบอร์โทรศัพท์หรืออีเมล</label>
                <input id="register-identifier" type="text" inputMode="email" className={`form-input ${errors.identifier ? "error" : ""}`} placeholder="name@example.com" value={emailOrPhone} onChange={(e) => setEmailOrPhone(e.target.value)} autoComplete="username" />
                {errors.identifier && <div className="form-hint form-hint-error">{errors.identifier}</div>}
              </div>
              <button type="submit" className="btn auth-submit">ถัดไป</button>
            </form>

            {hasSocial && (
              <>
                <div className="auth-divider"><span>หรือสมัครด้วย</span></div>
                <SocialAuth config={socialConfig} onGoogle={handleGoogle} onFacebook={handleFacebook} onLine={handleLine} disabled={loading} />
              </>
            )}

            <div className="auth-switch">มีบัญชีอยู่แล้ว? <Link to="/login">เข้าสู่ระบบ</Link></div>
          </>
        ) : (
          <>
            <div className="auth-identifier-chip">
              <span className="auth-identifier-label">สมัครด้วย</span>
              <span className="auth-identifier-value">{emailOrPhone.trim()}</span>
              <button type="button" className="auth-identifier-change" onClick={backToStepOne}>เปลี่ยน</button>
            </div>
            <form onSubmit={handleSubmit} noValidate>
              <div className="form-group">
                <label className="form-label" htmlFor="register-name">ชื่อ-นามสกุล</label>
                <input id="register-name" name="name" type="text" className={`form-input ${errors.name ? "error" : ""}`} placeholder="สมชาย ใจดี" value={form.name} onChange={handleChange} autoComplete="name" />
                {errors.name && <div className="form-hint form-hint-error">{errors.name}</div>}
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="register-email">อีเมล</label>
                <input id="register-email" name="email" type="email" className={`form-input ${errors.email ? "error" : ""}`} placeholder="name@example.com" value={form.email} onChange={handleChange} autoComplete="email" readOnly={isEmail} />
                {errors.email && <div className="form-hint form-hint-error">{errors.email}</div>}
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="register-password">รหัสผ่าน</label>
                <div className="form-input-affix">
                  <input id="register-password" name="password" type={showPassword ? "text" : "password"} className={`form-input ${errors.password ? "error" : ""}`} placeholder="อย่างน้อย 6 ตัวอักษร" value={form.password} onChange={handleChange} autoComplete="new-password" />
                  <button type="button" className="form-input-toggle" onClick={() => setShowPassword((v) => !v)} aria-label={showPassword ? "ซ่อนรหัสผ่าน" : "แสดงรหัสผ่าน"}><EyeIcon open={showPassword} /></button>
                </div>
                {errors.password && <div className="form-hint form-hint-error">{errors.password}</div>}
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="register-phone">เบอร์โทรศัพท์ (ไม่บังคับ)</label>
                <input id="register-phone" name="phone" type="tel" className="form-input" placeholder="081-234-5678" value={form.phone} onChange={handleChange} autoComplete="tel" readOnly={!isEmail && !!emailOrPhone} />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="register-address">ที่อยู่ (ไม่บังคับ)</label>
                <input id="register-address" name="address" type="text" className="form-input" placeholder="ถนน/ซอย ตำบล อำเภอ จังหวัด" value={form.address} onChange={handleChange} autoComplete="street-address" />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="register-role">ประเภทบัญชี</label>
                <select id="register-role" name="role" className="form-input" value={form.role} onChange={handleChange}>
                  <option value="customer">ลูกค้า</option>
                  <option value="seller">ผู้ขาย</option>
                </select>
              </div>
              <button type="submit" className="btn auth-submit" disabled={loading}>{loading ? (<><span className="spinner"></span>กำลังสมัครสมาชิก...</>) : "สมัครสมาชิก"}</button>
            </form>
            <button type="button" className="auth-back-btn" onClick={backToStepOne}><ArrowLeftIcon />ย้อนกลับ</button>
            <div className="auth-switch">มีบัญชีอยู่แล้ว? <Link to="/login">เข้าสู่ระบบ</Link></div>
          </>
        )}
      </div>
    </div>
  );
}
