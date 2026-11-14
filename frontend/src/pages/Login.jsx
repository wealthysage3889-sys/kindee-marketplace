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

export default function Login() {
  const { customer, loading: authLoading, login, logout, loginWithGoogle, loginWithFacebook, loginWithLine } = useAuth();
  const [form, setForm] = useState({ email: "", password: "" });
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState("");
  const [info, setInfo] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [socialConfig, setSocialConfig] = useState(null);
  const navigate = useNavigate();
  const location = useLocation();
  const lineHandled = useRef(false);

  useEffect(() => {
    let active = true;
    authAPI.getSocialConfig().then((res) => { if (active) setSocialConfig(res?.data || null); }).catch(() => {});
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (authLoading || !customer.user) return;
    if (["admin", "owner"].includes(customer.user.role)) { logout("customer"); navigate("/selladmin/login", { replace: true }); return; }
    navigate("/", { replace: true });
  }, [customer.user, authLoading, navigate, logout]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const code = params.get("code");
    const state = params.get("state");
    if (code && state === "line_login" && !lineHandled.current) {
      lineHandled.current = true;
      setLoading(true); setMessage("");
      loginWithLine(code, window.location.origin + "/login", "customer")
        .then((data) => {
          if (["admin", "owner"].includes(data.user.role)) { logout("customer"); navigate("/selladmin/login", { replace: true }); }
          else navigate("/", { replace: true });
        })
        .catch((err) => { setMessage(err.message || "เข้าสู่ระบบด้วย LINE ไม่สำเร็จ"); navigate("/login", { replace: true }); })
        .finally(() => setLoading(false));
    }
  }, [location.search, loginWithLine, logout, navigate]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
    setErrors((prev) => ({ ...prev, [name]: "" }));
  };

  const validate = () => {
    const next = {}; const identifier = form.email.trim();
    if (!identifier) next.email = "กรุณากรอกเบอร์โทรศัพท์หรืออีเมล";
    else if (identifier.includes("@")) { if (!EMAIL_RE.test(identifier)) next.email = "รูปแบบอีเมลไม่ถูกต้อง"; }
    else if (!/^[0-9+\-\s]{8,20}$/.test(identifier)) next.email = "กรุณากรอกเบอร์โทรศัพท์ให้ถูกต้อง";
    if (!form.password) next.password = "กรุณากรอกรหัสผ่าน";
    setErrors(next); return Object.keys(next).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault(); if (!validate()) return;
    setLoading(true); setMessage(""); setInfo("");
    try {
      const data = await login(form.email.trim(), form.password, "customer");
      if (["admin", "owner"].includes(data.user.role)) { logout("customer"); navigate("/selladmin/login", { replace: true }); return; }
      navigate("/");
    } catch (err) { setMessage(err?.data?.message || err.message || "เข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง"); }
    finally { setLoading(false); }
  };

  // Google credential flow via GIS
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
        } catch (err) { setMessage(err.message || "เข้าสู่ระบบด้วย Google ไม่สำเร็จ"); }
        finally { setLoading(false); }
      },
    });
    // prompt one-tap/popup via button-render alternative: use prompt
    window.google.accounts.id.prompt((notification) => {
      if (notification.isNotDisplayed() || notification.isSkippedMoment()) {
        // fallback: render a temporary hidden button and click? easier to show message
        setInfo("ไม่สามารถแสดงหน้าต่าง Google ได้ กรุณาตรวจสอบการตั้งค่า Authorized origins ใน Google Cloud Console");
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
          } catch (err) { setMessage(err.message || "เข้าสู่ระบบด้วย Facebook ไม่สำเร็จ"); }
          finally { setLoading(false); }
        } else {
          setMessage("การเข้าสู่ระบบด้วย Facebook ถูกยกเลิก");
        }
      }, { scope: "public_profile,email" });
    } catch (err) { setMessage(err.message || "Facebook login ไม่สำเร็จ"); }
  };

  const handleLine = () => {
    if (!socialConfig?.line?.channelId) return;
    setMessage(""); setInfo("");
    const redirectUri = window.location.origin + "/login";
    const state = "line_login";
    const params = new URLSearchParams({
      response_type: "code",
      client_id: socialConfig.line.channelId,
      redirect_uri: redirectUri,
      state,
      scope: "profile openid email",
    });
    window.location.href = `https://access.line.me/oauth2/v2.1/authorize?${params.toString()}`;
  };

  const hasSocial = socialConfig && ["google","facebook","line"].some((k) => {
    const c = socialConfig[k]; return c?.enabled && ((k==="google"&&c.clientId)||(k==="facebook"&&c.appId)||(k==="line"&&c.channelId));
  });

  return (
    <div className="auth-container">
      <div className="auth-card">
        <div className="auth-brand">
          <div className="auth-logo-mark">K</div>
          <div className="auth-brand-name">Kindee Marketplace</div>
        </div>
        <h1 className="auth-title">เข้าสู่ระบบ</h1>
        <p className="auth-subtitle">ยินดีต้อนรับกลับ</p>

        {message && <div className="alert alert-error">{message}</div>}
        {info && <div className="alert alert-info">{info}</div>}

        <form onSubmit={handleSubmit} noValidate>
          <div className="form-group">
            <label className="form-label" htmlFor="login-identifier">เบอร์โทรศัพท์/อีเมล</label>
            <input id="login-identifier" name="email" type="text" inputMode="email" className={`form-input ${errors.email ? "error" : ""}`} placeholder="name@example.com" value={form.email} onChange={handleChange} autoComplete="username" />
            {errors.email && <div className="form-hint form-hint-error">{errors.email}</div>}
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="login-password">รหัสผ่าน</label>
            <div className="form-input-affix">
              <input id="login-password" name="password" type={showPassword ? "text" : "password"} className={`form-input ${errors.password ? "error" : ""}`} placeholder="••••••••" value={form.password} onChange={handleChange} autoComplete="current-password" />
              <button type="button" className="form-input-toggle" onClick={() => setShowPassword((v) => !v)} aria-label={showPassword ? "ซ่อนรหัสผ่าน" : "แสดงรหัสผ่าน"}><EyeIcon open={showPassword} /></button>
            </div>
            {errors.password && <div className="form-hint form-hint-error">{errors.password}</div>}
          </div>
          <button type="submit" className="btn auth-submit" disabled={loading}>{loading ? (<><span className="spinner"></span>กำลังเข้าสู่ระบบ...</>) : "เข้าสู่ระบบ"}</button>
        </form>

        {hasSocial && (
          <>
            <div className="auth-divider"><span>หรือเข้าสู่ระบบด้วย</span></div>
            <SocialAuth config={socialConfig} onGoogle={handleGoogle} onFacebook={handleFacebook} onLine={handleLine} disabled={loading} />
          </>
        )}

        <div className="auth-switch">ยังไม่มีบัญชี? <Link to="/register">สมัครสมาชิก</Link></div>
      </div>
    </div>
  );
}
