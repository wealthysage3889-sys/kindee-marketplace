import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function RequireAdmin({ children }) {
  const { admin, loading } = useAuth();
  const location = useLocation();

  if (loading) return null;

  if (!admin?.user || !["admin", "owner"].includes(admin.user.role)) {
    return <Navigate to="/" replace state={{ from: location }} />;
  }

  return <>{children}</>;
}