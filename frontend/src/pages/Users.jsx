import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { adminAPI } from "../api/admin";
import { useAuth } from "../context/AuthContext";

const ROLE_LABELS = {
  customer: "ลูกค้า",
  seller: "ผู้ขาย",
  admin: "แอดมิน",
  owner: "เจ้าของระบบ",
};

const ROLE_COLORS = {
  customer: "#6b7280",
  seller: "#ee4d2d",
  admin: "#dc2626",
  owner: "#7c3aed",
};

export default function Users() {
  const { admin } = useAuth();
  const currentUser = admin?.user;
  const currentUserId = currentUser?.id || currentUser?._id;
  const [users, setUsers] = useState([]);
  const [pagination, setPagination] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(new Set());
  const [deleting, setDeleting] = useState(new Set());
  const [alert, setAlert] = useState(null);

  const fetchUsers = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminAPI.getUsers();
      const payload = res?.data;
      const list = Array.isArray(payload)
        ? payload
        : payload?.users || res?.users || [];
      setUsers(list);
      setPagination(payload?.pagination || res?.pagination || null);
    } catch (err) {
      setError(err.message || "ดึงรายชื่อผู้ใช้ไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleRoleChange = async (user, role) => {
    if (user.role === role) return;
    setSaving((prev) => new Set(prev).add(user.id));
    try {
      await adminAPI.updateUserRole(user.id, role);
      setUsers((prev) =>
        prev.map((u) => (u.id === user.id ? { ...u, role } : u))
      );
      setAlert({ type: "success", message: `เปลี่ยนสิทธิ์ ${user.name} เป็น ${ROLE_LABELS[role]} เรียบร้อยแล้ว` });
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

  const handleDelete = async (user) => {
    if (!window.confirm(`คุณต้องการลบผู้ใช้ "${user.name}" หรือไม่? การกระทำนี้ยกเลิกไม่ได้`)) return;
    setDeleting((prev) => new Set(prev).add(user.id));
    try {
      await adminAPI.deleteUser(user.id);
      setUsers((prev) => prev.filter((u) => u.id !== user.id));
      setAlert({ type: "success", message: `ลบผู้ใช้ "${user.name}" เรียบร้อยแล้ว` });
    } catch (err) {
      setAlert({ type: "error", message: err.message || "ลบผู้ใช้ไม่สำเร็จ" });
    } finally {
      setDeleting((prev) => {
        const next = new Set(prev);
        next.delete(user.id);
        return next;
      });
    }
  };

  const closeAlert = () => setAlert(null);

  if (loading) {
    return (
      <div className="page users-page">
        <h1>จัดการผู้ใช้</h1>
        <div style={{ textAlign: "center", padding: "40px 0", color: "var(--text-muted)" }}>
          กำลังโหลดรายชื่อผู้ใช้...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page users-page">
        <h1>จัดการผู้ใช้</h1>
        <div className="alert alert-error">{error}</div>
        <button className="btn" onClick={fetchUsers}>ลองใหม่</button>
      </div>
    );
  }

  const isOwner = currentUser?.role === "owner";
  const availableRoles = Object.entries(ROLE_LABELS)
    .filter(([key]) => isOwner || key !== "owner")
    .map(([key, label]) => ({ key, label }));

  return (
    <div className="page users-page">
      <div className="users-header">
        <div className="users-header-main">
          <h1>จัดการผู้ใช้</h1>
          <p>ดูรายชื่อผู้ใช้งาน เปลี่ยนสิทธิ์ หรือลบบัญชีผู้ใช้</p>
        </div>
      </div>

      {alert && (
        <div className={`alert alert-${alert.type} users-alert`} onClick={closeAlert}>
          {alert.message}
        </div>
      )}

      <div className="users-list-container">
        {/* Desktop Table View */}
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
                  <td colSpan={7} className="empty-cell">ไม่พบข้อมูลผู้ใช้งาน</td>
                </tr>
              ) : (
                (Array.isArray(users) ? users : []).map((user, index) => (
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
                    <td className="col-role">
                      <select
                        value={user.role}
                        onChange={(e) => handleRoleChange(user, e.target.value)}
                        disabled={
                          saving.has(user.id) ||
                          (user.role === "owner" && !isOwner) ||
                          user.id === currentUserId
                        }
                        className="role-select"
                        aria-label={`เปลี่ยนสิทธิ์ ${user.name}`}
                      >
                        {availableRoles.map(({ key, label }) => (
                          <option key={key} value={key}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="col-status">
                      <span
                        className={`status-badge ${user.is_active ? "status-active" : "status-inactive"}`}
                      >
                        {user.is_active ? "ใช้งาน" : "หยุดใช้งาน"}
                      </span>
                    </td>
                    <td className="actions-cell col-actions">
                      <button
                        className="btn-delete"
                        onClick={() => handleDelete(user)}
                        disabled={deleting.has(user.id)}
                        aria-label={`ลบผู้ใช้ ${user.name}`}
                      >
                        {deleting.has(user.id) ? "ลบอยู่..." : "ลบ"}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile Card View */}
        <div className="users-card-view" role="list" aria-label="บัตรรายชื่อผู้ใช้">
          {users.length === 0 ? (
            <div className="empty-cell">ไม่พบข้อมูลผู้ใช้งาน</div>
          ) : (
            (Array.isArray(users) ? users : []).map((user, index) => (
              <article key={user.id} className="user-card" role="listitem">
                <div className="user-card-header">
                  <div className="user-card-index">{index + 1}</div>
                  <div className="user-card-main">
                    <span className="user-card-name">{user.name || "ไม่ระบุชื่อ"}</span>
                    <span className="user-card-id" title={user.id}>{user.id}</span>
                  </div>
                  <span
                    className={`user-card-status ${user.is_active ? "status-active" : "status-inactive"}`}
                  >
                    {user.is_active ? "ใช้งาน" : "หยุดใช้งาน"}
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
                    <select
                      value={user.role}
                      onChange={(e) => handleRoleChange(user, e.target.value)}
                      disabled={
                        saving.has(user.id) ||
                        (user.role === "owner" && !isOwner) ||
                        user.id === currentUserId
                      }
                      className="role-select user-card-role-select"
                      aria-label={`เปลี่ยนสิทธิ์ ${user.name}`}
                    >
                      {availableRoles.map(({ key, label }) => (
                        <option key={key} value={key}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="user-card-actions">
                  <button
                    className="btn-delete user-card-delete"
                    onClick={() => handleDelete(user)}
                    disabled={deleting.has(user.id)}
                    aria-label={`ลบผู้ใช้ ${user.name}`}
                  >
                    {deleting.has(user.id) ? "ลบอยู่..." : "ลบ"}
                  </button>
                </div>
              </article>
            ))
          )}
        </div>
      </div>
    </div>
  );
}