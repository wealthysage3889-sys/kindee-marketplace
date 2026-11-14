import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function ProtectedRoute({ children, allowedRoles, mode = "customer" }) {
  const { customer, admin, loading } = useAuth();
  const location = useLocation();
  const session = mode === "admin" ? admin : customer;

  if (loading) return null;

  const roles = allowedRoles || ["admin", "owner", "seller"];
  if (!session?.token || !session?.user || !roles.includes(session.user.role)) {
    const loginPath = mode === "admin" ? "/selladmin/login" : "/login";
    return <Navigate to={loginPath} replace state={{ from: location }} />;
  }

  return <>{children}</>;
}