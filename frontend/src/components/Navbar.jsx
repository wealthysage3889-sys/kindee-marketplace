import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

const ROLE_LABEL = {
  customer: "ลูกค้า",
  seller: "ผู้ขาย",
};

function getMenu(role, handleLogout) {
  if (!role) {
    return [
      { to: "/home", label: "หน้าแรก" },
      { to: "/login", label: "เข้าสู่ระบบ" },
      { to: "/register", label: "สมัครสมาชิก" },
    ];
  }
  if (role === "seller") {
    return [
      { to: "/home", label: "หน้าแรก" },
      { to: "/seller", label: "จัดการร้านค้า" },
      { to: "/seller/products", label: "สินค้าของฉัน" },
      { to: "/seller/add-product", label: "เพิ่มสินค้า" },
      { label: "ออกจากระบบ", onClick: handleLogout },
    ];
  }
  return [
    { to: "/home", label: "หน้าแรก" },
    { label: "ออกจากระบบ", onClick: handleLogout },
  ];
}

export default function Navbar() {
  const { customer, logout } = useAuth();
  const navigate = useNavigate();
  const user = customer?.user;

  const handleLogout = () => {
    logout("customer");
    navigate("/login");
  };

  const role = user?.role;
  const menu = getMenu(role, handleLogout);

  return (
    <nav className="navbar">
      <div className="navbar-container">
        <Link to="/" className="navbar-brand">
          Kindee
        </Link>
        <div className="navbar-menu">
          {menu.map((item, i) =>
            item.onClick ? (
              <button
                key={item.to || i}
                type="button"
                className="navbar-link navbar-button"
                onClick={item.onClick}
              >
                {item.label}
              </button>
            ) : (
              <Link key={item.to || i} to={item.to} className="navbar-link">
                {item.label}
              </Link>
            )
          )}
          {user && (
            <div className="navbar-user">
              <span>{user.name}</span>
            </div>
          )}
        </div>
      </div>
    </nav>
  );
}
