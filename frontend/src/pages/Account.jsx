import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

const UserIcon = ({ size = 26 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </svg>
);

const WalletPayIcon = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H18a2 2 0 0 1 2 2v1" />
    <path d="M3 7.5V17a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-2" />
    <path d="M21 9.5h-4a2.5 2.5 0 0 0 0 5h4a1 1 0 0 0 1-1v-3a1 1 0 0 0-1-1Z" />
  </svg>
);

const BoxIcon = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 8 12 3 3 8v8l9 5 9-5Z" />
    <path d="m3 8 9 5 9-5" />
    <path d="M12 13v8" />
  </svg>
);

const TruckIcon = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 6h11v10H3z" />
    <path d="M14 9h4l3 3v4h-7z" />
    <circle cx="7" cy="18.5" r="1.6" />
    <circle cx="17.5" cy="18.5" r="1.6" />
  </svg>
);

const StarIcon = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m12 3 2.6 5.3 5.9.8-4.3 4.2 1 5.9-5.2-2.8-5.2 2.8 1-5.9L3.5 9.1l5.9-.8Z" />
  </svg>
);

const WalletIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M20 7H6a2 2 0 0 1 0-4h11v4" />
    <path d="M4 5v14a2 2 0 0 0 2 2h14V7H6a2 2 0 0 0-2 2" />
    <path d="M16.5 13.5h.01" />
  </svg>
);

const CardIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="2.5" y="5" width="19" height="14" rx="2.5" />
    <path d="M2.5 10h19" />
    <path d="M6.5 15h4" />
  </svg>
);

const BankIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 9.5 12 4l9 5.5" />
    <path d="M5 10v8M9.5 10v8M14.5 10v8M19 10v8" />
    <path d="M3 20.5h18" />
  </svg>
);

const ReceiptIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M6 2.5h12v19l-3-2-3 2-3-2-3 2Z" />
    <path d="M9 7.5h6M9 11.5h6M9 15.5h3" />
  </svg>
);

const ChevronRightIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m9 6 6 6-6 6" />
  </svg>
);

const LOGOUT_ICON = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <path d="m16 17 5-5-5-5" />
    <path d="M21 12H9" />
  </svg>
);

const PURCHASE_TILES = [
  { key: "topay", label: "ที่ต้องชำระ", Icon: WalletPayIcon, badge: 0 },
  { key: "toreceive", label: "ที่ต้องจัดส่ง", Icon: BoxIcon, badge: 0 },
  { key: "toship", label: "ที่ต้องได้รับ", Icon: TruckIcon, badge: 0 },
  { key: "toreview", label: "ให้คะแนน", Icon: StarIcon, badge: 0 },
];

const WALLET_ITEMS = [
  { key: "balance", label: "ยอดเงินคงเหลือ", Icon: WalletIcon },
  { key: "coins", label: "เหรียญโบนัส", Icon: StarIcon },
  { key: "voucher", label: "คูปองของฉัน", Icon: ReceiptIcon },
];

const FINANCE_ITEMS = [
  { key: "cards", label: "บัตรของฉัน", Icon: CardIcon },
  { key: "bank", label: "บัญชีธนาคาร", Icon: BankIcon },
  { key: "history", label: "ประวัติการเงิน", Icon: ReceiptIcon },
];

const ROLE_LABELS = {
  customer: "ลูกค้า",
  seller: "ผู้ขาย",
  admin: "แอดมิน",
  owner: "เจ้าของระบบ",
};

export default function Account() {
  const { customer, logout } = useAuth();
  const user = customer?.user;
  const navigate = useNavigate();
  const isLoggedIn = Boolean(user);

  const handleLogout = () => {
    logout("customer");
    navigate("/");
  };

  const handleLockedAction = () => {
    if (!isLoggedIn) navigate("/login");
  };

  const renderTile = ({ key, label, Icon, badge }) => (
    <button
      key={key}
      type="button"
      className="acct-tile"
      onClick={handleLockedAction}
    >
      <span className="acct-tile-icon">
        <Icon />
        {badge > 0 && <span className="acct-tile-badge">{badge}</span>}
      </span>
      <span className="acct-tile-label">{label}</span>
    </button>
  );

  const renderRowItem = ({ key, label, Icon }) => (
    <button key={key} type="button" className="acct-row-item" onClick={handleLockedAction}>
      <span className="acct-row-item-icon">
        <Icon />
      </span>
      <span className="acct-row-item-label">{label}</span>
      <span className="acct-row-item-chevron">
        <ChevronRightIcon />
      </span>
    </button>
  );

  return (
    <div className="page acct-page">
      <section className="acct-hero">
        <div className="acct-hero-inner">
          <div className="acct-profile">
            <div className="acct-avatar">
              {isLoggedIn ? (
                <span>{user?.name?.charAt(0)?.toUpperCase() || <UserIcon size={30} />}</span>
              ) : (
                <UserIcon size={34} />
              )}
            </div>
            <div className="acct-profile-text">
              {isLoggedIn ? (
                <>
                  <h1 className="acct-name">{user?.name || "ไม่ระบุชื่อ"}</h1>
                  <p className="acct-sub">{user?.email || "ไม่ระบุอีเมล"}</p>
                  <span className="acct-role">{ROLE_LABELS[user?.role] || "สมาชิก"}</span>
                </>
              ) : (
                <>
                  <h1 className="acct-name">ยินดีต้อนรับ</h1>
                  <p className="acct-sub">เข้าสู่ระบบเพื่อจัดการคำสั่งซื้อและบัญชีของคุณ</p>
                </>
              )}
            </div>
          </div>

          <div className="acct-hero-actions">
            {isLoggedIn ? (
              <button type="button" className="acct-btn acct-btn-ghost" onClick={handleLogout}>
                <span className="acct-btn-icon">{LOGOUT_ICON}</span>
                ออกจากระบบ
              </button>
            ) : (
              <>
                <Link to="/register" className="acct-btn acct-btn-ghost">
                  ลงทะเบียน
                </Link>
                <Link to="/login" className="acct-btn acct-btn-solid">
                  เข้าสู่ระบบ
                </Link>
              </>
            )}
          </div>
        </div>
      </section>

      <section className="acct-card">
        <header className="acct-card-head">
          <h2 className="acct-card-title">การซื้อของฉัน</h2>
          <button type="button" className="acct-link-more" onClick={handleLockedAction}>
            ดูทั้งหมด
            <ChevronRightIcon />
          </button>
        </header>
        <div className="acct-tiles">{PURCHASE_TILES.map(renderTile)}</div>
      </section>

      <div className="acct-two-col">
        <section className="acct-card">
          <header className="acct-card-head">
            <h2 className="acct-card-title">
              <span className="acct-title-icon"><WalletIcon /></span>
              My Wallet
            </h2>
          </header>
          <div className="acct-wallet-balance">
            <span className="acct-wallet-amount">฿0.00</span>
            <span className="acct-wallet-caption">ยอดเงินคงเหลือในกระเป๋าเงิน</span>
          </div>
          <div className="acct-row-list">{WALLET_ITEMS.map(renderRowItem)}</div>
        </section>

        <section className="acct-card">
          <header className="acct-card-head">
            <h2 className="acct-card-title">
              <span className="acct-title-icon"><CardIcon /></span>
              บริการทางการเงิน
            </h2>
          </header>
          <div className="acct-row-list">{FINANCE_ITEMS.map(renderRowItem)}</div>
        </section>
      </div>
    </div>
  );
}