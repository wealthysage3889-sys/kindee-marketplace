import { useAuth } from "../context/AuthContext";
import AdminOrders from "./AdminOrders";
import SellerOrders from "./SellerOrders";

// `/selladmin/orders` is shared by two roles:
// - Platform admin/owner (admin namespace) -> global order list via
//   GET /api/orders/admin/all (admin-only, unchanged).
// - Store owner (seller in the customer namespace) -> their own store orders via
//   GET /api/orders/store/:storeId (ownership enforced server-side).
// ProtectedRoute (mode="seller-or-admin") guarantees only these two roles reach
// this component, so the selection here is purely which dataset to render.
export default function SellAdminOrders() {
  const { admin } = useAuth();
  const isPlatformAdmin = admin?.isAuthenticated && ["admin", "owner"].includes(admin?.user?.role);

  return isPlatformAdmin ? <AdminOrders /> : <SellerOrders />;
}