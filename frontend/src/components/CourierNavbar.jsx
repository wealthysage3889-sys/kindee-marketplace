import { NavLink, useMatch } from "react-router-dom";

const DashboardIcon = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="16" width="7" height="5"/></svg>;
const HistoryIcon = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0Z"/></svg>;
const EarningsIcon = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7h6"/><path d="M5 21a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2"/></svg>;

const MENU_ITEMS = [
  { to: "/", label: "แดชบอร์ด", Icon: DashboardIcon, end: true },
  { to: "/history", label: "ประวัติ", Icon: HistoryIcon },
  { to: "/earnings", label: "รายได้", Icon: EarningsIcon },
];

export default function CourierNavbar() {
  return (
    <nav className="courier-bottom-nav" aria-label="เมนูหลักของผู้จัดส่ง">
      <div className="courier-bottom-nav-menu">
        {MENU_ITEMS.map(({ to, label, Icon, end }) => (
          <NavLink key={to} to={to} end={end} className={({ isActive }) => `courier-nav-item${isActive ? " active" : ""}`}>
            <Icon />
            <span>{label}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  );
}