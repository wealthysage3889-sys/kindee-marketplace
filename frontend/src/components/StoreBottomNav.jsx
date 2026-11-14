import { NavLink, useParams } from "react-router-dom";

const StoreIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 9h18l-1-5H4L3 9Z" />
    <path d="M5 9v11h14V9" />
    <path d="M9 20v-6h6v6" />
  </svg>
);

const ChatIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4v8Z" />
    <path d="M8 9h8M8 13h5" />
  </svg>
);

const STORE_MENU_ITEMS = [
  { to: "/stores", label: "สินค้าทั้งหมด", Icon: StoreIcon },
  { to: "/messages", label: "แชทเลย", Icon: ChatIcon },
];

export default function StoreBottomNav() {
  const { id } = useParams();

  return (
    <nav className="store-bottom-nav" aria-label="เมนูสำหรับร้านค้า">
      <div className="store-bottom-nav-menu">
        {STORE_MENU_ITEMS.map(({ to, label, Icon }) => {
          const isStoreLink = to === "/stores";
          return (
            <NavLink
              key={to}
              to={isStoreLink ? `/stores/${id}` : `/messages?fromStore=${id}&openStore=${id}`}
              end={isStoreLink}
              className={({ isActive }) => `store-nav-item${isActive ? " active" : ""}`}
            >
              <Icon />
              <span>{label}</span>
            </NavLink>
          );
        })}
      </div>
    </nav>
  );
}
