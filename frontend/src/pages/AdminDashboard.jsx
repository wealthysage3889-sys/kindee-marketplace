import { Navigate, Link, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

const DashboardIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="7" height="7" />
    <rect x="14" y="3" width="7" height="7" />
    <rect x="14" y="14" width="7" height="7" />
    <rect x="3" y="14" width="7" height="7" />
  </svg>
);

const UsersIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);

const ProductsIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
    <line x1="3" y1="6" x2="21" y2="6" />
    <path d="M16 10a4 4 0 0 1-8 0" />
  </svg>
);

const ReportsIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="20" x2="18" y2="10" />
    <line x1="12" y1="20" x2="12" y2="4" />
    <line x1="6" y1="20" x2="6" y2="14" />
  </svg>
);

const MENU_ITEMS = [
  { to: "/selladmin", label: "หน้าจัดการ", Icon: DashboardIcon },
  { to: "/selladmin/users", label: "จัดการผู้ใช้", Icon: UsersIcon },
  { to: "/selladmin/products", label: "จัดการสินค้า", Icon: ProductsIcon },
  { to: "/selladmin/reports", label: "รายงาน", Icon: ReportsIcon },
];

export default function AdminDashboard() {
  const { admin } = useAuth();
  const user = admin?.user;
  const location = useLocation();

  if (!user || !["admin", "owner"].includes(user.role)) {
    return <Navigate to="/selladmin/login" replace state={{ from: location }} />;
  }

  return (
    <div className="page admin-dashboard-page">
      <section className="admin-dashboard-hero">
        <div className="admin-dashboard-hero-inner">
          <div className="admin-dashboard-info">
            <p className="admin-dashboard-kicker">จัดการระบบ</p>
            <h1 className="admin-dashboard-title">แดชบอร์ดผู้ดูแลระบบ</h1>
            <p className="admin-dashboard-sub">
              ควบคุมดูแลผู้ใช้ สินค้า รายงาน และการตั้งค่าระบบ
            </p>
          </div>
        </div>
      </section>

      <div className="admin-dashboard-grid">
        {MENU_ITEMS.map((item) => {
          const Icon = item.Icon;
          const isActive = location.pathname === item.to;
          return (
            <Link
              key={item.to}
              to={item.to}
              className={`admin-dashboard-card${isActive ? " active" : ""}`}
            >
              <span className="admin-dashboard-card-icon">
                <Icon />
              </span>
              <span className="admin-dashboard-card-label">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
