import { NavLink, useMatch } from "react-router-dom";

const HomeIcon = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m3 11 9-8 9 8"/><path d="M5 10v10h14V10"/><path d="M9 20v-6h6v6"/></svg>;
const StoreIcon = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 9h18l-1-5H4L3 9Z"/><path d="M5 9v11h14V9"/><path d="M9 20v-6h6v6"/></svg>;
const ChatIcon = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4v8Z"/><path d="M8 9h8M8 13h5"/></svg>;
const CartIcon = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="9" cy="20" r="1"/><circle cx="19" cy="20" r="1"/><path d="M3 4h2l2.4 11.2a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.6L21 8H6"/></svg>;
const AccountIcon = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>;

const MENU_ITEMS = [
  { to: "/", label: "หน้าแรก", Icon: HomeIcon, end: true },
  { to: "/stores", label: "ร้านค้า", Icon: StoreIcon },
  { to: "/messages", label: "ข้อความ", Icon: ChatIcon },
  { to: "/cart", label: "รถเข็น", Icon: CartIcon },
  { to: "/account", label: "บัญชี", Icon: AccountIcon },
];

export default function CustomerNavbar() {
  const isProductDetail = useMatch("/products/:id");
  const isStoreProfile = useMatch("/stores/:id");
  const isChatRoom = useMatch("/messages/:conversationId");

  if (isProductDetail || isStoreProfile || isChatRoom) return null;

  return (
    <nav className="customer-bottom-nav" aria-label="เมนูหลักของลูกค้า">
      <div className="customer-bottom-nav-menu">
        {MENU_ITEMS.map(({ to, label, Icon, end }) => (
          <NavLink key={to} to={to} end={end} className={({ isActive }) => `customer-nav-item${isActive ? " active" : ""}`}>
            <Icon />
            <span>{label}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  );
}