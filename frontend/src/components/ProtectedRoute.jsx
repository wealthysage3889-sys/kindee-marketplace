import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function ProtectedRoute({ children, allowedRoles, mode = "customer" }) {
  const { isAuthenticated, isAdmin, isSeller, isCourier, loading, user } = useAuth();
  const location = useLocation();

  if (loading) return null;

  if (!isAuthenticated) {
    const loginPath = mode === "admin" ? "/selladmin/login" : "/login";
    return <Navigate to={loginPath} replace state={{ from: location }} />;
  }

  if (allowedRoles) {
    const hasRole = allowedRoles.some(role => {
      if (role === "admin") return isAdmin;
      if (role === "seller") return isSeller;
      if (role === "courier") return isCourier;
      if (role === "owner") return isAdmin && user?.role === "owner";
      return false;
    });
    
    if (!hasRole) {
      // If admin mode and not allowed, send to admin login
      if (mode === "admin") {
        return <Navigate to="/selladmin/login" replace />;
      }
      return <Navigate to="/" replace />;
    }
  }

  return children;
}