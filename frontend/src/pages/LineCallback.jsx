import { useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { validateLineState } from "../utils/lineState";

// Unified LINE OAuth callback page.
//
// Both /login and /register now redirect to LINE with redirect_uri =
// `${origin}/oauth/line/callback`, so this single page handles the return.
//
// The state value stored before redirect encodes the originating flow
// ("login" | "register"). We validate the returned state against the stored
// one for BOTH flows (only one can match, since each flow stores its own
// state key), determine the flow, then exchange the code via loginWithLine.
export default function LineCallback() {
  const { loginWithLine } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const code = params.get("code");
    const state = params.get("state");

    if (!code) {
      setMessage("LINE authorization code ไม่พบ");
      setLoading(false);
      return;
    }

    // Determine which flow initiated the redirect. The state is validated
    // against the stored value for the given flow; only one flow can match.
    let flow = null;
    for (const candidate of ["login", "register"]) {
      if (validateLineState(candidate, state)) {
        flow = candidate;
        break;
      }
    }

    if (!flow) {
      setMessage("เข้าสู่ระบบด้วย LINE ไม่ถูกต้อง (ไม่พบ state หรือ state ไม่ถูกต้อง)");
      setLoading(false);
      return;
    }

    // Use the SAME redirect_uri that was sent to LINE in the authorize URL.
    const redirectUri = window.location.origin + "/oauth/line/callback";

    setLoading(true);
    setMessage("");
    loginWithLine(code, redirectUri, "customer")
      .then(() => {
        let target = "/";
        try {
          const stored = sessionStorage.getItem("kindee:postLoginRedirect");
          if (stored && stored.startsWith("/") && !stored.startsWith("//")) target = stored;
          sessionStorage.removeItem("kindee:postLoginRedirect");
        } catch {}
        navigate(target, { replace: true });
      })
      .catch((err) => {
        try { sessionStorage.removeItem("kindee:postLoginRedirect"); } catch {}
        setMessage(err.message || "เข้าสู่ระบบด้วย LINE ไม่สำเร็จ");
        setLoading(false);
      });
    // loginWithLine is stable (useCallback); intentionally depend on location.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search, loginWithLine, navigate]);

  return (
    <div className="auth-container">
      <div className="auth-card">
        <div className="auth-brand">
          <div className="auth-logo-mark">K</div>
          <div className="auth-brand-name">Kindee Marketplace</div>
        </div>
        {loading ? (
          <p className="auth-subtitle">กำลังเข้าสู่ระบบด้วย LINE...</p>
        ) : (
          <>
            <h1 className="auth-title">เข้าสู่ระบบไม่สำเร็จ</h1>
            <p className="auth-subtitle">{message || "กรุณาลองใหม่อีกครั้ง"}</p>
            <a href="/login" className="btn" style={{ marginTop: 16, display: "inline-block" }}>
              กลับไปหน้าเข้าสู่ระบบ
            </a>
          </>
        )}
      </div>
    </div>
  );
}