import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function ProtectedRoute({ children, allowedRoles, mode = "customer" }) {
  const { customer, admin, loading, initializing } = useAuth();
  const session = mode === "admin" ? admin : customer;
  const { isAuthenticated, user } = session;
  const location = useLocation();

  // Do not decide anything until persisted sessions have been checked against
  // the server. Redirecting during initialization is what produced the
  // login <-> protected-page loop on refresh.
  if (initializing || loading) return null;

  // Never render <Navigate> to the page we are already on: that is a no-op
  // re-render loop in React Router.
  const redirectTo = (path, state) => {
    if (location.pathname === path) return null;
    return <Navigate to={path} replace state={state} />;
  };

  // Shared order-management route for the Sell Admin area: it must serve both the
  // platform admin (admin namespace) and the store owner (seller in the customer
  // namespace). This check spans BOTH namespaces, so it runs before the
  // single-session `isAuthenticated` guard below (a platform admin has no
  // customer session). Authorization is still enforced server-side per endpoint
  // (/orders/admin/all stays admin-only, /orders/store/:storeId checks ownership).
  if (mode === "seller-or-admin") {
    const adminOk = admin?.isAuthenticated && ["admin", "owner"].includes(admin?.user?.role);
    const sellerOk = customer?.isAuthenticated && customer?.user?.role === "seller";
    if (adminOk || sellerOk) {
      return children;
    }
    // A signed-in non-seller has no business here; send everyone else to login.
    if (customer?.isAuthenticated) {
      return redirectTo("/");
    }
    return redirectTo("/selladmin/login");
  }

  if (!isAuthenticated) {
    const loginPath = mode === "admin" ? "/selladmin/login" : "/login";
    return redirectTo(loginPath, { from: location });
  }

  // Admin namespace is only ever populated by AdminLogin, but the role is read
  // from profiles.role (via /auth/profile). Guard every admin route so a token
  // whose role is not admin/owner can never reach /selladmin even if it lands in
  // the admin localStorage namespace.
  const isAdmin = ["admin", "owner"].includes(user?.role);

  if (mode === "admin") {
    if (!isAdmin) {
      return redirectTo("/selladmin/login");
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
      return redirectTo("/");
    }
  }

  return children;
}
