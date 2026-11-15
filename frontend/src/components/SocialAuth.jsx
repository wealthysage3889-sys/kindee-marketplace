const GoogleIcon = () => (
  <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
    <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.5 30.2 0 24 0 14.6 0 6.4 5.4 2.5 13.3l7.8 6.1C12.2 13.2 17.6 9.5 24 9.5Z" />
    <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-2.8-.4-4.1H24v9h12.7c-.3 2.1-1.6 5.2-4.6 7.3l7.6 5.9c4.5-4.2 6.8-10.3 6.8-18.1Z" />
    <path fill="#FBBC05" d="M10.3 28.6A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.2.8-4.6l-7.8-6.1A24 24 0 0 0 0 24c0 3.9.9 7.5 2.5 10.7l7.8-6.1Z" />
    <path fill="#34A853" d="M24 48c6.2 0 11.5-2 15.3-5.6l-7.6-5.9c-2 1.4-4.7 2.4-7.7 2.4-6.4 0-11.8-3.7-13.7-9.4l-7.8 6.1C6.4 42.6 14.6 48 24 48Z" />
  </svg>
);
const FacebookIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
    <path fill="#1877F2" d="M22 12.06C22 6.5 17.52 2 12 2S2 6.5 2 12.06c0 5 3.66 9.15 8.44 9.94v-7.03H7.9v-2.9h2.54V9.85c0-2.52 1.5-3.92 3.77-3.92 1.1 0 2.24.2 2.24.2v2.46h-1.26c-1.24 0-1.63.78-1.63 1.57v1.9h2.78l-.45 2.9h-2.33V22c4.78-.79 8.44-4.94 8.44-9.94Z" />
  </svg>
);
const LineIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
    <path fill="#06C755" d="M21.6 10.3c0-4.2-4.3-7.6-9.6-7.6S2.4 6.1 2.4 10.3c0 3.8 3.5 6.9 8.2 7.5.3.1.8.3.9.6.1.3.1.7 0 1l-.1.8c0 .2-.2.9.7.5.9-.4 4.8-2.8 6.5-4.8 1.2-1.3 2-2.9 2-4.6Z" />
    <path fill="#fff" d="M8.1 8.7H6.8v4.1h1.3zm.2 0h1.2l1.9 2.7V8.7h1.3v4.1h-1.2L9.6 10v2.8H8.3zm5.1 1.4h1.4v1.2h-1.4v.3h1.4v1.2h-2.7V8.7h2.7v1.2h-1.4zm2.9 2.7h-1.2V8.7h1.2z" />
  </svg>
);

const META = {
  google: { label: "Google", Icon: GoogleIcon },
  facebook: { label: "Facebook", Icon: FacebookIcon },
  line: { label: "LINE", Icon: LineIcon },
};

export default function SocialAuth({ config, onGoogle, onFacebook, onLine, disabled = false }) {
  if (!config) return null;
  const providers = ["google", "facebook", "line"].filter((k) => {
    const c = config[k];
    if (!c?.enabled) return false;
    if (k === "google") return !!c.clientId;
    if (k === "facebook") return !!c.appId;
    if (k === "line") return !!c.channelId;
    return false;
  });
  if (providers.length === 0) return null;

  const handle = (k) => {
    if (k === "google") onGoogle?.();
    else if (k === "facebook") onFacebook?.();
    else if (k === "line") onLine?.();
  };

  return (
    <div className="auth-social">
      {providers.map((k) => {
        const { label, Icon } = META[k];
        return (
          <button key={k} type="button" className="auth-social-btn" onClick={() => handle(k)} disabled={disabled}>
            <Icon />
            <span>{label}</span>
          </button>
        );
      })}
    </div>
  );
}