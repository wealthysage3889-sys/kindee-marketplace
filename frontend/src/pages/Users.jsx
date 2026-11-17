import { useState, useEffect, useCallback, useRef } from "react";
import { adminAPI } from "../api/admin";
import { useAuth } from "../context/AuthContext";

const ROLE_LABELS = {
  customer: "ลูกค้า",
  seller: "ผู้ขาย",
  admin: "แอดมิน",
  owner: "เจ้าของระบบ",
};

const STATUS_FILTERS = [
  { key: "active", label: "เปิดใช้งาน" },
  { key: "inactive", label: "ปิดใช้งาน" },
  { key: "all", label: "ทั้งหมด" },
];

const STATUS_MODE_LABELS = {
  active: "บัญชีที่เปิดใช้งาน",
  inactive: "บัญชีที่ปิดใช้งาน",
  all: "บัญชีทั้งหมด",
};

export default function Users() {
  const { admin } = useAuth();
  const currentUser = admin?.user;
  const currentUserId = currentUser?.id || currentUser?._id;
  const isOwner = currentUser?.role === "owner";

  const [users, setUsers] = useState([]);
  const [total, setTotal] = useState(0);
  const [statusFilter, setStatusFilter] = useState("active");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(new Set());
  const [deleting, setDeleting] = useState(new Set());
  const [toggling, setToggling] = useState(new Set());
  const [alert, setAlert] = useState(null);
  const [confirmUser, setConfirmUser] = useState(null);
  const [confirmAction, setConfirmAction] = useState(null); // "activate" | "deactivate" | "delete"
  const [confirmSaving, setConfirmSaving] = useState(false);
  const [confirmError, setConfirmError] = useState(null);

  const queryRef = useRef({ statusFilter, search });
  queryRef.current = { statusFilter, search };

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { statusFilter: sf, search: s } = queryRef.current;
      const params = {};
      if (sf === "active") params.isActive = "true";
      else if (sf === "inactive") params.isActive = "false";
      if (s) params.search = s;

      const res = await adminAPI.getUsers(params);
      const payload = res?.data;
      const list = Array.isArray(payload)
        ? payload
        : payload?.users || res?.users || [];
      setUsers(list);
      const count = payload?.pagination?.total ?? res?.pagination?.total ?? (Array.isArray(list) ? list.length : 0);
      setTotal(typeof count === "number" ? count : list.length);
      return list;
    } catch (err) {
      setError(err.message || "ดึงรายชื่อผู้ใช้ไม่สำเร็จ");
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    fetchUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, search]);

  useEffect(() => {
    const handle = setTimeout(() => {
      setSearch(searchInput.trim());
    }, 350);
    return () => clearTimeout(handle);
  }, [searchInput]);

  const handleRoleChange = async (user, role) => {
    if (user.role === role) return;
    setSaving((prev) => new Set(prev).add(user.id));
    try {
      await adminAPI.updateUserRole(user.id, role);
      setUsers((prev) =>
        prev.map((u) => (u.id === user.id ? { ...u, role } : u))
      );
      setAlert({
        type: "success",
        message: `เปลี่ยนสิทธิ์ ${user.name || user.email} เป็น ${ROLE_LABELS[role]} เรียบร้อยแล้ว`,
      });
    } catch (err) {
      setAlert({ type: "error", message: err.message || "เปลี่ยนสิทธิ์ไม่สำเร็จ" });
    } finally {
      setSaving((prev) => {
        const next = new Set(prev);
        next.delete(user.id);
        return next;
      });
    }
  };

  const openStatusConfirm = (user, nextActive) => {
    setConfirmError(null);
    setConfirmAction(nextActive ? "activate" : "deactivate");
    setConfirmUser(user);
  };

  const openDeleteConfirm = (user) => {
    setConfirmError(null);
    setConfirmAction("delete");
    setConfirmUser(user);
  };

  const handleCancel = () => {
    setConfirmUser(null);
    setConfirmAction(null);
    setConfirmError(null);
  };

  const handleConfirm = async () => {
    if (!confirmUser) return;
    setConfirmSaving(true);
    setConfirmError(null);

    if (confirmAction === "delete") {
      setDeleting((prev) => new Set(prev).add(confirmUser.id));
      try {
        const res = await adminAPI.deleteUser(confirmUser.id);
        const result = res?.data || res;
        await fetchUsers();
        const action = result?.action;
        const refs = Array.isArray(result?.references) ? result.references : [];
        let message = result?.message || result?.reason || `ลบบัญชี "${confirmUser.name || confirmUser.email}" เรียบร้อยแล้ว`;
        if (action === "deactivated" && refs.length > 0) {
          const refText = refs
            .map((r) => `${r.label || r.table}${r.count ? ` (${r.count})` : ""}`)
            .join(", ");
          message = `${message}${refText ? ` [ข้อมูลที่เกี่ยวข้อง: ${refText}]` : ""}`;
        }
        setAlert({
          type: action === "deactivated" ? "warning" : "success",
          message,
        });
        setConfirmUser(null);
        setConfirmAction(null);
      } catch (err) {
        const data = err?.data || {};
        const refs = Array.isArray(data?.references) ? data.references : Array.isArray(data?.data?.references) ? data.data.references : [];
        let msg = err.message || "ลบบัญชีไม่สำเร็จ";
        if (refs.length > 0) {
          const refText = refs
            .map((r) => `${r.label || r.table}${r.count ? ` (${r.count})` : ""}`)
            .join(", ");
          msg = `${msg}${refText ? ` [ข้อมูลที่เกี่ยวข้อง: ${refText}]` : ""}`;
        }
        setConfirmError(msg);
      } finally {
        setDeleting((prev) => {
          const next = new Set(prev);
          next.delete(confirmUser.id);
          return next;
        });
        setConfirmSaving(false);
      }
      return;
    }

    const nextActive = confirmAction === "activate";
    setToggling((prev) => new Set(prev).add(confirmUser.id));
    try {
      await adminAPI.setUserActive(confirmUser.id, nextActive);
      await fetchUsers();
      setAlert({
        type: "success",
        message: `${nextActive ? "เปิดใช้งาน" : "ปิดใช้งาน"}บัญชี "${confirmUser.name || confirmUser.email}" เรียบร้อยแล้ว`,
      });
      setConfirmUser(null);
      setConfirmAction(null);
    } catch (err) {
      setConfirmError(err.message || "เปลี่ยนสถานะผู้ใช้ไม่สำเร็จ");
    } finally {
      setToggling((prev) => {
        const next = new Set(prev);
        next.delete(confirmUser.id);
        return next;
      });
      setConfirmSaving(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Escape" && confirmUser && !confirmSaving) {
      handleCancel();
    }
  };

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confirmUser, confirmSaving]);

  const closeAlert = () => setAlert(null);

  const isSelf = (user) => user.id === currentUserId;
  const canManage = (user) => !isSelf(user) && !(user.role === "owner" && !isOwner);

  const renderStatusToggle = (user) => {
    const disabled =
      confirmSaving ||
      toggling.has(user.id) ||
      deleting.has(user.id) ||
      isSelf(user) ||
      (user.role === "owner" && !isOwner);
    const label = toggling.has(user.id)
      ? "กำลังบันทึก..."
      : user.is_active
        ? "เปิดใช้งาน"
        : "ปิดใช้งาน";
    return (
      <button
        type="button"
        className={`status-toggle ${user.is_active ? "status-toggle-active" : "status-toggle-inactive"}`}
        onClick={() => openStatusConfirm(user, !user.is_active)}
        disabled={disabled}
        aria-label={`${user.is_active ? "ปิด" : "เปิด"}ใช้งานบัญชี ${user.name || user.email}`}
        title={
          isSelf(user)
            ? "ไม่สามารถเปลี่ยนสถานะบัญชีของตัวเองได้"
            : `${user.is_active ? "ปิด" : "เปิด"}ใช้งานบัญชี ${user.name || user.email}`
        }
      >
        <span className="status-toggle-dot" aria-hidden="true" />
        <span className="status-toggle-label">{label}</span>
      </button>
    );
  };

  const renderRoleSelect = (user) => {
    const availableRoles = Object.entries(ROLE_LABELS)
      .filter(([key]) => isOwner || key !== "owner")
      .map(([key, label]) => ({ key, label }));
    return (
      <select
        value={user.role}
        onChange={(e) => handleRoleChange(user, e.target.value)}
        disabled={
          saving.has(user.id) ||
          (user.role === "owner" && !isOwner) ||
          isSelf(user)
        }
        className="role-select"
        aria-label={`เปลี่ยนสิทธิ์ ${user.name || user.email}`}
      >
        {availableRoles.map(({ key, label }) => (
          <option key={key} value={key}>
            {label}
          </option>
        ))}
      </select>
    );
  };

  const renderDeleteButton = (user) => {
    if (!canManage(user)) return null;
    return (
      <button
        className="btn-delete"
        onClick={() => openDeleteConfirm(user)}
        disabled={confirmSaving || deleting.has(user.id) || toggling.has(user.id)}
        aria-label={`ลบบัญชี ${user.name || user.email}`}
        title="ลบบัญชีถาวร (สำหรับบัญชีทดสอบที่ไม่มีประวัติธุรกรรม)"
      >
        {deleting.has(user.id) ? "กำลังลบ..." : "ลบ"}
      </button>
    );
  };

  if (loading && users.length === 0) {
    return (
      <div className="page users-page">
        <h1>จัดการผู้ใช้</h1>
        <div style={{ textAlign: "center", padding: "40px 0", color: "var(--text-muted)" }}>
          กำลังโหลดรายชื่อผู้ใช้...
        </div>
      </div>
    );
  }

  return (
    <div className="page users-page">
      <div className="users-header">
        <div className="users-header-main">
          <h1>จัดการผู้ใช้</h1>
          <p>ดูรายชื่อผู้ใช้งาน เปลี่ยนสิทธิ์ เปิด/ปิดใช้งาน หรือลบบัญชี (ลบจริงเฉพาะบัญชีที่ไม่มีประวัติธุรกรรมตามเงื่อนไขระบบ)</p>
        </div>
      </div>

      {alert && (
        <div className={`alert alert-${alert.type} users-alert`} onClick={closeAlert}>
          {alert.message}
        </div>
      )}

      {error && (
        <div className="alert alert-error users-alert" onClick={() => setError(null)}>
          {error}
        </div>
      )}

      <div className="users-toolbar">
        <div className="users-filter-tabs" role="tablist" aria-label="กรองตามสถานะ">
          {STATUS_FILTERS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={statusFilter === key}
              className={`users-filter-tab${statusFilter === key ? " active" : ""}`}
              onClick={() => setStatusFilter(key)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="users-search">
          <input
            type="text"
            className="users-search-input"
            placeholder="ค้นหาชื่อ อีเมล หรือเบอร์โทร"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            aria-label="ค้นหาผู้ใช้"
          />
          {searchInput && (
            <button
              type="button"
              className="users-search-clear"
              onClick={() => setSearchInput("")}
              aria-label="ล้างคำค้นหา"
            >
              ×
            </button>
          )}
        </div>
      </div>

      <div className="users-meta-row">
        <span>{STATUS_MODE_LABELS[statusFilter]}</span>
        <span>
          พบ {total} รายการ
          {search ? ` สำหรับ "${search}"` : ""}
        </span>
      </div>

      {confirmUser && (
        <div className="modal-backdrop" onClick={!confirmSaving ? handleCancel : undefined}>
          <div className="modal-container delete-confirm-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-body">
              <div className="delete-confirm-icon" aria-hidden="true">
                {confirmAction === "delete" ? (
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    <line x1="10" y1="11" x2="10" y2="17" />
                    <line x1="14" y1="11" x2="14" y2="17" />
                  </svg>
                ) : (
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    {confirmAction === "activate" ? (
                      <path d="M5 12h14M12 5l7 7-7 7" />
                    ) : (
                      <path d="M5 12h14M12 19 5 12l7-7" />
                    )}
                  </svg>
                )}
              </div>
              <h3 className="delete-confirm-title">
                {confirmAction === "delete"
                  ? "ยืนยันลบบัญชีถาวร"
                  : confirmAction === "activate"
                    ? "ยืนยันเปิดใช้งานบัญชี"
                    : "ยืนยันปิดใช้งานบัญชี"}
              </h3>
              <div className="delete-confirm-account">
                <span className="delete-confirm-name">{confirmUser.name || "ไม่ระบุชื่อ"}</span>
                <span className="delete-confirm-email">{confirmUser.email || "ไม่ระบุอีเมล"}</span>
              </div>
              <p className="delete-confirm-warning">
                {confirmAction === "delete"
                  ? `ต้องการลบบัญชี "${confirmUser.name || confirmUser.email}" ออกจากระบบใช่หรือไม่? ระบบจะตรวจสอบข้อมูลที่เชื่อมโยงก่อน: หากไม่มีประวัติคำสั่งซื้อ/ข้อความ/ธุรกรรม จะลบบัญชีออกจาก Supabase Auth และลบโปรไฟล์จริง หากมีข้อมูลธุรกิจที่ต้องรักษา ระบบจะไม่ลบประวัติคำสั่งซื้อ/ข้อความ/ธุรกรรม และจะแจ้งสาเหตุหรือจัดการข้อมูลส่วนบุคคลตามเงื่อนไขที่ปลอดภัย`
                  : confirmAction === "activate"
                    ? `เปิดใช้งานบัญชี "${confirmUser.name || "ไม่ระบุชื่อ"}" ใช่หรือไม่? ผู้ใช้จะสามารถล็อกอินเข้าสู่ระบบได้อีกครั้ง`
                    : `ปิดใช้งานบัญชี "${confirmUser.name || "ไม่ระบุชื่อ"}" ใช่หรือไม่? ผู้ใช้จะไม่สามารถล็อกอินเข้าสู่ระบบได้จนกว่าจะเปิดใช้งานใหม่`}
              </p>
              {confirmError && (
                <div className="delete-confirm-error" role="alert">{confirmError}</div>
              )}
              <div className="delete-confirm-actions">
                <button type="button" className="btn btn-outline" onClick={handleCancel} disabled={confirmSaving}>
                  ยกเลิก
                </button>
                <button
                  type="button"
                  className={confirmAction === "delete" ? "btn btn-delete-confirm" : "btn"}
                  onClick={handleConfirm}
                  disabled={confirmSaving}
                >
                  {confirmSaving
                    ? confirmAction === "delete"
                      ? "กำลังลบ..."
                      : "กำลังบันทึก..."
                    : confirmAction === "delete"
                      ? "ลบบัญชีถาวร"
                      : confirmAction === "activate"
                        ? "เปิดใช้งาน"
                        : "ปิดใช้งาน"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="users-list-container">
        <div className="users-table-view" role="region" aria-label="ตารางรายชื่อผู้ใช้" tabIndex={0}>
          <table className="users-table">
            <thead>
              <tr>
                <th className="col-index">#</th>
                <th className="col-name">ชื่อผู้ใช้</th>
                <th className="col-email">อีเมล</th>
                <th className="col-phone">โทรศัพท์</th>
                <th className="col-role">สิทธิ์</th>
                <th className="col-status">สถานะ</th>
                <th className="col-actions">การกระทำ</th>
              </tr>
            </thead>
            <tbody>
              {users.length === 0 ? (
                <tr>
                  <td colSpan={7} className="empty-cell">
                    {search ? "ไม่พบผู้ใช้ที่ตรงกับคำค้นหา" : "ไม่พบข้อมูลผู้ใช้งาน"}
                  </td>
                </tr>
              ) : (
                users.map((user, index) => (
                  <tr key={user.id}>
                    <td className="id-cell col-index">{index + 1}</td>
                    <td className="col-name">
                      <div className="user-cell-main" title={user.name || "ไม่ระบุชื่อ"}>
                        <span className="user-name">{user.name || "ไม่ระบุชื่อ"}</span>
                        <span className="user-id" title={user.id}>{user.id}</span>
                      </div>
                    </td>
                    <td className="col-email">
                      <span className="truncate-text" title={user.email || ""}>{user.email || "—"}</span>
                    </td>
                    <td className="col-phone">
                      <span className="truncate-text" title={user.phone || ""}>{user.phone || "—"}</span>
                    </td>
                    <td className="col-role">{renderRoleSelect(user)}</td>
                    <td className="col-status">{renderStatusToggle(user)}</td>
                    <td className="actions-cell col-actions">
                      <div className="users-actions">
                        {renderDeleteButton(user)}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="users-card-view" role="list" aria-label="บัตรรายชื่อผู้ใช้">
          {users.length === 0 ? (
            <div className="empty-cell">
              {search ? "ไม่พบผู้ใช้ที่ตรงกับคำค้นหา" : "ไม่พบข้อมูลผู้ใช้งาน"}
            </div>
          ) : (
            users.map((user, index) => (
              <article key={user.id} className="user-card" role="listitem">
                <div className="user-card-header">
                  <div className="user-card-index">{index + 1}</div>
                  <div className="user-card-main">
                    <span className="user-card-name">{user.name || "ไม่ระบุชื่อ"}</span>
                    <span className="user-card-id" title={user.id}>{user.id}</span>
                  </div>
                  <span
                    className={`user-card-status ${user.is_active ? "status-active" : "status-inactive"}`}
                    onClick={() => !isSelf(user) && openStatusConfirm(user, !user.is_active)}
                    role="button"
                    tabIndex={0}
                    aria-label={`${user.is_active ? "ปิด" : "เปิด"}ใช้งาน ${user.name || user.email}`}
                    onKeyDown={(e) => {
                      if ((e.key === "Enter" || e.key === " ") && !isSelf(user)) {
                        e.preventDefault();
                        openStatusConfirm(user, !user.is_active);
                      }
                    }}
                  >
                    {toggling.has(user.id) ? "กำลังบันทึก..." : user.is_active ? "เปิดใช้งาน" : "ปิดใช้งาน"}
                  </span>
                </div>
                <div className="user-card-details">
                  <div className="user-card-detail">
                    <span className="user-card-detail-label">อีเมล</span>
                    <span className="user-card-detail-value truncate-text" title={user.email || ""}>{user.email || "—"}</span>
                  </div>
                  <div className="user-card-detail">
                    <span className="user-card-detail-label">โทรศัพท์</span>
                    <span className="user-card-detail-value truncate-text" title={user.phone || ""}>{user.phone || "—"}</span>
                  </div>
                  <div className="user-card-detail">
                    <span className="user-card-detail-label">สิทธิ์</span>
                    {renderRoleSelect(user)}
                  </div>
                </div>
                {renderDeleteButton(user) && (
                  <div className="user-card-actions">{renderDeleteButton(user)}</div>
                )}
              </article>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
