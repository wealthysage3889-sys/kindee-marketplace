import { createBrowserRouter, RouterProvider, Outlet } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import { SocketProvider } from "./context/SocketContext";
import { CartProvider } from "./context/CartContext";
import CustomerNavbar from "./components/CustomerNavbar";
import AdminNavbar from "./components/AdminNavbar";
import Home from "./pages/Home";
import ProductDetail from "./pages/ProductDetail";
import Login from "./pages/Login";
import Register from "./pages/Register";
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
import ChatRoom from "./pages/ChatRoom";
import SellAdminMessages from "./pages/SellAdminMessages";
import SellAdminChatRoom from "./pages/SellAdminChatRoom";
import ProtectedRoute from "./components/ProtectedRoute";

const router = createBrowserRouter([
  {
    path: "/",
    element: (
      <div className="app customer-layout">
        <CustomerNavbar />
        <main className="main-content">
          <Outlet />
        </main>
      </div>
    ),
    children: [
      { index: true, element: <Home /> },
      { path: "home", element: <Home /> },
      { path: "login", element: <Login /> },
      { path: "register", element: <Register /> },
      { path: "products/:id", element: <ProductDetail /> },
      { path: "stores", element: <Stores /> },
      { path: "stores/:id", element: <StoreProfile /> },
      { path: "messages", element: <Messages /> },
      { path: "messages/:storeId", element: <ChatRoom /> },
      { path: "cart", element: <Cart /> },
      { path: "account", element: <Account /> },
      { path: "seller", element: <ProtectedRoute allowedRoles={["seller", "admin", "owner"]}><SellerDashboard /></ProtectedRoute> },
      { path: "seller/products", element: <ProtectedRoute allowedRoles={["seller", "admin", "owner"]}><div className="page">สินค้าของฉัน</div></ProtectedRoute> },
      { path: "seller/add-product", element: <ProtectedRoute allowedRoles={["seller", "admin", "owner"]}><Products /></ProtectedRoute> },
    ],
  },
  {
    path: "/selladmin",
    element: (
      <div className="app admin-layout">
        <AdminNavbar />
        <main className="main-content">
          <Outlet />
        </main>
      </div>
    ),
    children: [
      { index: true, element: <ProtectedRoute mode="admin"><AdminDashboard /></ProtectedRoute> },
      { path: "login", element: <AdminLogin /> },
      {
        path: "users",
        element: <ProtectedRoute mode="admin"><Users /></ProtectedRoute>,
      },
      {
        path: "products",
        element: <ProtectedRoute mode="admin"><AdminProducts /></ProtectedRoute>,
      },
      {
        path: "reports",
        element: <ProtectedRoute mode="admin"><div className="page">reports</div></ProtectedRoute>,
      },
      {
        path: "messages",
        element: <ProtectedRoute mode="admin"><SellAdminMessages /></ProtectedRoute>,
      },
      {
        path: "messages/:storeId/:customerId?",
        element: <ProtectedRoute mode="admin"><SellAdminChatRoom /></ProtectedRoute>,
      },
      {
        path: "account",
        element: <ProtectedRoute mode="admin"><AdminAccount /></ProtectedRoute>,
      },
    ],
  },
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
