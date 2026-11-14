import { GoogleOAuthProvider } from "@react-oauth/google";

export default function GoogleAuthWrapper({ children }) {
  // Keep provider mounted for hook context; actual clientId configured per-login via GIS.
  return (
    <GoogleOAuthProvider clientId={import.meta.env.VITE_GOOGLE_CLIENT_ID || "placeholder.apps.googleusercontent.com"}>
      {children}
    </GoogleOAuthProvider>
  );
}
