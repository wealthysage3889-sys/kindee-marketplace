import { createBrowserRouter, RouterProvider, Outlet, Navigate } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import { SocketProvider } from "./context/SocketContext";
import { CartProvider } from "./context/CartContext";
import IncomingCallHandler from "./components/IncomingCallHandler";
import CustomerNavbar from "./components/CustomerNavbar";
import AdminNavbar from "./components/AdminNavbar";
import CourierNavbar from "./components/CourierNavbar";
import Home from "./pages/Home";
import ProductDetail from "./pages/ProductDetail";
import Login from "./pages/Login";
import Register from "./pages/Register";
import LineCallback from "./pages/LineCallback";
import AdminLogin from "./pages/AdminLogin";
import SellerDashboard from "./pages/SellerDashboard";
import AdminDashboard from "./pages/AdminDashboard";
import Users from "./pages/Users";
import Account from "./pages/Account";
import AdminAccount from "./pages/AdminAccount";
import Cart from "./pages/Cart";
import Stores from "./pages/Stores";
import StoreProfile from "./pages/StoreProfile";
import Products from "./pages/Products";
import AdminProducts from "./pages/AdminProducts";
import Messages from "./pages/Messages";
import ChatRoom from "./components/ChatRoom";
import SellAdminMessages from "./pages/SellAdminMessages";
import SellAdminChatRoom from "./pages/SellAdminChatRoom";
import ProtectedRoute from "./components/ProtectedRoute";
import Checkout from "./pages/Checkout";
import OrderTracking from "./pages/OrderTracking";
import OrderHistory from "./pages/OrderHistory";
import CourierDashboard from "./pages/CourierDashboard";
import CallHistory from "./pages/CallHistory";
import NotificationsCenter from "./components/NotificationsCenter";

const router = createBrowserRouter([
  {
    path: "/",
    element: (
      <IncomingCallHandler>
        <div className="app customer-layout">
          <CustomerNavbar />
          <main className="main-content">
            <Outlet />
          </main>
        </div>
      </IncomingCallHandler>
    ),
    children: [
      { index: true, element: <Home /> },
      { path: "home", element: <Home /> },
      { path: "login", element: <Login /> },
      { path: "register", element: <Register /> },
      { path: "oauth/line/callback", element: <LineCallback /> },
      { path: "products/:id", element: <ProductDetail /> },
      { path: "stores", element: <Stores /> },
      { path: "stores/:id", element: <StoreProfile /> },
      { path: "messages", element: <ProtectedRoute><Messages /></ProtectedRoute> },
      { path: "messages/:conversationId", element: <ProtectedRoute><ChatRoom mode="customer" /></ProtectedRoute> },
      { path: "cart", element: <ProtectedRoute><Cart /></ProtectedRoute> },
      { path: "checkout", element: <ProtectedRoute><Checkout /></ProtectedRoute> },
      { path: "orders", element: <ProtectedRoute><OrderHistory /></ProtectedRoute> },
      { path: "orders/:id", element: <ProtectedRoute><OrderTracking /></ProtectedRoute> },
      { path: "notifications", element: <ProtectedRoute><NotificationsCenter /></ProtectedRoute> },
      { path: "call-history", element: <ProtectedRoute><CallHistory /></ProtectedRoute> },
      { path: "account", element: <ProtectedRoute><Account /></ProtectedRoute> },
      { path: "seller", element: <ProtectedRoute allowedRoles={["seller", "admin", "owner"]}><SellerDashboard /></ProtectedRoute> },
      { path: "seller/products", element: <ProtectedRoute allowedRoles={["seller", "admin", "owner"]}><Products /></ProtectedRoute> },
      { path: "seller/add-product", element: <ProtectedRoute allowedRoles={["seller", "admin", "owner"]}><Products /></ProtectedRoute> },
      { path: "courier", element: <ProtectedRoute allowedRoles={["courier"]}><CourierDashboard /></ProtectedRoute> },
    ],
  },
  {
    path: "/selladmin",
    element: (
      <IncomingCallHandler>
        <div className="app admin-layout">
          <AdminNavbar />
          <main className="main-content">
            <Outlet />
          </main>
        </div>
      </IncomingCallHandler>
    ),
    children: [
      { index: true, element: <ProtectedRoute mode="admin"><AdminDashboard /></ProtectedRoute> },
      { path: "login", element: <AdminLogin /> },
      { path: "users", element: <ProtectedRoute mode="admin"><Users /></ProtectedRoute> },
      { path: "products", element: <ProtectedRoute mode="admin"><AdminProducts /></ProtectedRoute> },
      { path: "reports", element: <ProtectedRoute mode="admin"><div className="page">reports</div></ProtectedRoute> },
      { path: "messages", element: <ProtectedRoute mode="admin"><SellAdminMessages /></ProtectedRoute> },
      { path: "messages/:conversationId", element: <ProtectedRoute mode="admin"><ChatRoom mode="admin" /></ProtectedRoute> },
      { path: "account", element: <ProtectedRoute mode="admin"><AdminAccount /></ProtectedRoute> },
    ],
  },
  // Legacy alias
  { path: "/admin", element: <Navigate to="/selladmin" replace /> },
  {
    path: "/courier",
    element: (
      <IncomingCallHandler>
        <div className="app courier-layout">
          <CourierNavbar />
          <main className="main-content">
            <Outlet />
          </main>
        </div>
      </IncomingCallHandler>
    ),
    children: [
      { index: true, element: <ProtectedRoute allowedRoles={["courier"]}><CourierDashboard /></ProtectedRoute> },
    ],
  },
  // Catch-all redirect
  { path: "*", element: <Navigate to="/" replace /> }
]);

export default function App() {
  return (
    <AuthProvider>
      <SocketProvider>
        <CartProvider>
          <RouterProvider router={router} />
        </CartProvider>
      </SocketProvider>
    </AuthProvider>
  );
}