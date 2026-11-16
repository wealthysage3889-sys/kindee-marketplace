import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function ProtectedRoute({ children, allowedRoles, mode = "customer" }) {
  const { customer, admin, loading } = useAuth();
  const session = mode === "admin" ? admin : customer;
  const { isAuthenticated, user } = session;
  const location = useLocation();

  if (loading) return null;

  if (!isAuthenticated) {
    const loginPath = mode === "admin" ? "/selladmin/login" : "/login";
    return <Navigate to={loginPath} replace state={{ from: location }} />;
  }

  // Admin namespace is only ever populated by AdminLogin, but the role is read
  // from profiles.role (via /auth/profile). Guard every admin route so a token
  // whose role is not admin/owner can never reach /selladmin even if it lands in
  // the admin localStorage namespace.
  const isAdmin = ["admin", "owner"].includes(user?.role);

  if (mode === "admin") {
    if (!isAdmin) {
      return <Navigate to="/selladmin/login" replace />;
    }
    return children;
  }

  if (allowedRoles) {
    const isSeller = user?.role === "seller";
    const isCourier = user?.role === "courier";
    const hasRole = allowedRoles.some(role => {
      if (role === "admin") return isAdmin;
      if (role === "seller") return isSeller;
      if (role === "courier") return isCourier;
      if (role === "owner") return user?.role === "owner";
      return false;
    });

    if (!hasRole) {
      return <Navigate to="/" replace />;
    }
  }

  return children;
}
