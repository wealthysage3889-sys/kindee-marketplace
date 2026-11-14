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
      setUsers(res.data || res.users || []);
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
    setSaving((prev) => new Set(prev).add(user._id));
    try {
      await adminAPI.updateUserRole(user._id, role);
      setUsers((prev) =>
        prev.map((u) => (u._id === user._id ? { ...u, role } : u))
      );
      setAlert({ type: "success", message: `เปลี่ยนสิทธิ์ ${user.name} เป็น ${ROLE_LABELS[role]} เรียบร้อยแล้ว` });
    } catch (err) {
      setAlert({ type: "error", message: err.message || "เปลี่ยนสิทธิ์ไม่สำเร็จ" });
    } finally {
      setSaving((prev) => {
        const next = new Set(prev);
        next.delete(user._id);
        return next;
      });
    }
  };

  const handleDelete = async (user) => {
    if (!window.confirm(`คุณต้องการลบผู้ใช้ "${user.name}" หรือไม่? การกระทำนี้ยกเลิกไม่ได้`)) return;
    setDeleting((prev) => new Set(prev).add(user._id));
    try {
      await adminAPI.deleteUser(user._id);
      setUsers((prev) => prev.filter((u) => u._id !== user._id));
      setAlert({ type: "success", message: `ลบผู้ใช้ "${user.name}" เรียบร้อยแล้ว` });
    } catch (err) {
      setAlert({ type: "error", message: err.message || "ลบผู้ใช้ไม่สำเร็จ" });
    } finally {
      setDeleting((prev) => {
        const next = new Set(prev);
        next.delete(user._id);
        return next;
      });
    }
  };

  const closeAlert = () => setAlert(null);

  if (loading) {
    return (
      <div className="page">
        <h1>จัดการผู้ใช้</h1>
        <div style={{ textAlign: "center", padding: "40px 0", color: "var(--text-muted)" }}>
          กำลังโหลดรายชื่อผู้ใช้...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page">
        <h1>จัดการผู้ใช้</h1>
        <div className="alert alert-error">{error}</div>
        <button className="btn" onClick={fetchUsers}>ลองใหม่</button>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="users-header">
        <h1>จัดการผู้ใช้</h1>
        <p>ดูรายชื่อผู้ใช้งาน เปลี่ยนสิทธิ์ หรือลบบัญชีผู้ใช้</p>
      </div>

      {alert && (
        <div className={`alert alert-${alert.type}`} onClick={closeAlert} style={{ cursor: "pointer" }}>
          {alert.message}
        </div>
      )}

      <div className="users-table-wrap">
        <table className="users-table">
          <thead>
            <tr>
              <th>#</th>
              <th>ชื่อ</th>
              <th>อีเมล</th>
              <th>โทรศัพท์</th>
              <th>สิทธิ์</th>
              <th>สถานะ</th>
              <th>การกระทำ</th>
            </tr>
          </thead>
          <tbody>
            {users.length === 0 ? (
              <tr>
                <td colSpan={7} className="empty-cell">ไม่พบข้อมูลผู้ใช้งาน</td>
              </tr>
            ) : (
              users.map((user) => (
                <tr key={user._id}>
                  <td className="id-cell">{users.indexOf(user) + 1}</td>
                  <td>
                    <div className="user-name">{user.name || "ไม่ระบุชื่อ"}</div>
                    <div className="user-id">{user._id}</div>
                  </td>
                  <td>{user.email}</td>
                  <td>{user.phone || "—"}</td>
                  <td>
                    <select
                      value={user.role}
                      onChange={(e) => handleRoleChange(user, e.target.value)}
                      disabled={
                        saving.has(user._id) ||
                        (user.role === "owner" && currentUser?.role !== "owner") ||
                        user._id === currentUserId
                      }
                      className="role-select"
                    >
                      {Object.entries(ROLE_LABELS)
                        .filter(([key]) => currentUser?.role === "owner" || key !== "owner")
                        .map(([key, label]) => (
                          <option key={key} value={key}>
                            {label}
                          </option>
                        ))}
                    </select>
                  </td>
                  <td>
                    <span
                      className={`status-badge ${user.isActive ? "status-active" : "status-inactive"}`}
                    >
                      {user.isActive ? "ใช้งาน" : "หยุดใช้งาน"}
                    </span>
                  </td>
                  <td className="actions-cell">
                    <button
                      className="btn-delete"
                      onClick={() => handleDelete(user)}
                      disabled={deleting.has(user._id)}
                    >
                      {deleting.has(user._id) ? "ลบอยู่..." : "ลบ"}
                    </button>
                  </td>
                </tr>
              )
            ))}
          </tbody>
        </table>
      </div>

      <div className="users-back">
        <Link to="/selladmin" className="btn-outline" style={{ width: "auto", display: "inline-block" }}>
          กลับหน้าจัดการ
        </Link>
      </div>
    </div>
  );
}
