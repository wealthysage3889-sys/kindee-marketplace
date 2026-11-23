import { useEffect, useState, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import { adminAPI } from "../api";
import { formatCurrency, formatDate } from "../utils/helpers";
import "./AdminOrders.css";

const SLIP_STATUS_LABELS = {
  uploaded: "รอตรวจสอบ",
  approved: "อนุมัติแล้ว",
  rejected: "ปฏิเสธแล้ว",
};

export default function AdminPaymentSlips() {
  const [slips, setSlips] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchSlips = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const params = { limit: 50 };
      const result = await adminAPI.getPaymentSlips(params);
      const data = result?.data || result;
      const list = data?.slips || data?.data || [];
      setSlips(Array.isArray(list) ? list : []);
    } catch (err) {
      setError(err.message || "ไม่สามารถโหลดสลิปการชำระเงินได้");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSlips();
  }, [fetchSlips]);

  const handleApprove = async (slipId) => {
    if (!window.confirm("ยืนยันอนุมัติสลิปนี้หรือไม่")) return;
    try {
      await adminAPI.approvePaymentSlip(slipId);
      await fetchSlips();
    } catch (err) {
      alert(err.message || "อนุมัติสลิปไม่สำเร็จ");
    }
  };

  const handleReject = async (slipId) => {
    const reason = window.prompt("กรุณาระบุสาเหตุการปฏิเสธ:");
    if (reason === null) return;
    try {
      await adminAPI.rejectPaymentSlip(slipId, reason.trim() || null);
      await fetchSlips();
    } catch (err) {
      alert(err.message || "ปฏิเสธสลิปไม่สำเร็จ");
    }
  };

  const slipStatusCounts = slips.reduce((acc, s) => {
    acc[s.slip_status] = (acc[s.slip_status] || 0) + 1;
    return acc;
  }, {});

  if (loading) {
    return (
      <div className="page admin-orders-page">
        <div className="admin-orders-header">
          <h1>ตรวจสอบสลิปการชำระเงิน</h1>
        </div>
        <p className="loading-state">กำลังโหลดสลิปการชำระเงิน...</p>
      </div>
    );
  }

  return (
    <div className="page admin-orders-page">
      <div className="admin-orders-header">
        <h1>ตรวจสอบสลิปการชำระเงิน</h1>
        <div className="admin-orders-stats">
          {Object.entries(SLIP_STATUS_LABELS).map(([key, label]) => (
            <span
              key={key}
              className={`stat-chip status-${key}`}
            >
              {label} <span>({slipStatusCounts[key] || 0})</span>
            </span>
          ))}
        </div>
      </div>

      {error && <div className="alert alert-error" role="alert">{error}</div>}

      <div className="admin-orders-toolbar">
        <Link to="/selladmin/orders" className="btn btn-outline">กลับสู่จัดการคำสั่งซื้อ</Link>
      </div>

      {!error && slips.length === 0 && (
        <div className="empty-state">
          <p>ไม่พบสลิปการชำระเงิน</p>
        </div>
      )}

      {!error && slips.length > 0 && (
        <div className="admin-orders-table">
          <table>
            <thead>
              <tr>
                <th>เลขที่ออเดอร์</th>
                <th>ลูกค้า</th>
                <th>สลิปไฟล์</th>
                <th>จำนวนเงิน</th>
                <th>สถานะสลิป</th>
                <th>อัปโหลดเมื่อ</th>
                <th className="admin-orders-th-action">การดำเนินการ</th>
              </tr>
            </thead>
            <tbody>
              {slips.map((slip) => (
                <tr key={slip.id} className="admin-orders-row">
                  <td>
                    <Link to={`/orders/${slip.order_id}`} className="admin-orders-number">
                      #{slip.order?.order_number || "-"}
                    </Link>
                  </td>
                  <td>
                    <div className="admin-orders-customer">
                      <span>{slip.customer?.name || "-"}</span>
                      {slip.customer?.phone && <span className="admin-orders-phone">{slip.customer.phone}</span>}
                    </div>
                  </td>
                  <td>
                    <div className="slip-preview">
                      <img
                        src={slip.slip_view_url || slip.slip_url}
                        alt="สป"
                        className="slip-preview-img"
                        onError={(e) => { e.target.src = "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjE1MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjZTRlNGU0Ii8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZpbGw9IiM5OTkiIGRvbWluYW50LWJhc2VsaW5lPSJtaQ=="; }}
                      />
                      <div className="slip-filename">{slip.slip_filename}</div>
                    </div>
                  </td>
                  <td>{slip.amount_thb != null ? formatCurrency(slip.amount_thb) + " THB" : "-"}</td>
                  <td>
                    <span className={`slip-badge slip-${slip.slip_status}`}>
                      {SLIP_STATUS_LABELS[slip.slip_status] || slip.slip_status}
                    </span>
                  </td>
                  <td>{slip.created_at ? formatDate(slip.created_at) : "-"}</td>
                  <td className="admin-orders-td-action">
                    {slip.slip_status === "uploaded" && (
                      <>
                        <button
                          onClick={() => handleApprove(slip.id)}
                          className="btn btn-outline btn-small"
                          style={{ color: "#4caf50" }}
                        >
                          อนุมัติ
                        </button>
                        <button
                          onClick={() => handleReject(slip.id)}
                          className="btn btn-outline btn-small"
                          style={{ color: "#f44336" }}
                        >
                          ปฏิเสธ
                        </button>
                      </>
                    )}
                    {slip.slip_status !== "uploaded" && (
                      <span className="badge">ดำเนินการแล้ว</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
