import { useGoogleLogin } from "@react-oauth/google";

const GoogleIcon = () => (
  <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
    <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.5 30.2 0 24 0 14.6 0 6.4 5.4 2.5 13.3l7.8 6.1C12.2 13.2 17.6 9.5 24 9.5Z" />
    <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-2.8-.4-4.1H24v9h12.7c-.3 2.1-1.6 5.2-4.6 7.3l7.6 5.9c4.5-4.2 6.8-10.3 6.8-18.1Z" />
    <path fill="#FBBC05" d="M10.3 28.6A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.2.8-4.6l-7.8-6.1A24 24 0 0 0 0 24c0 3.9.9 7.5 2.5 10.7l7.8-6.1Z" />
    <path fill="#34A853" d="M24 48c6.2 0 11.5-2 15.3-5.6l-7.6-5.9c-2 1.4-4.7 2.4-7.7 2.4-6.4 0-11.8-3.7-13.7-9.4l-7.8 6.1C6.4 42.6 14.6 48 24 48Z" />
  </svg>
);

export default function GoogleSignInButton({ onCredential, onError, label = "ลงชื่อเข้าใช้ด้วย Google", disabled = false }) {
  const signIn = useGoogleLogin({
    onSuccess: (credential) => {
      onCredential(credential);
    },
    onError,
    ux_mode: "popup",
  });

  return (
    <button type="button" onClick={signIn} disabled={disabled} className="auth-social-btn">
      <GoogleIcon />
      <span>{label}</span>
    </button>
  );
}
