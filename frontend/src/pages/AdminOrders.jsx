import { useEffect, useState, useCallback, useMemo } from "react";
import { Link } from "react-router-dom";
import { orderAPI, adminAPI } from "../api";
import { formatCurrency, formatDate, formatAddress } from "../utils/helpers";
import { ORDER_STATUS_LABELS, paymentMethodLabel, paymentStatusLabel } from "../utils/orderFilters";
import {
  groupOrdersForDelivery,
  getGroupTotal,
  getGroupStoreNames,
  getGroupStatuses,
  hasMixedStatuses,
  hasMixedPaymentStatuses,
} from "../utils/orderGrouping";
import "./AdminOrders.css";

const STATUS_LABELS = ORDER_STATUS_LABELS;

// Human-readable reasons shown when an order cannot be safely grouped because
// the delivery account/address/store is incomplete.
const INCOMPLETE_REASON_LABELS = {
  missing_customer_id: "ไม่มีรหัสบัญชีลูกค้า (customer_id)",
  missing_delivery_address: "ไม่มีที่อยู่จัดส่งที่ใช้จับคู่ได้",
  missing_store: "ไม่มีข้อมูลร้านค้า",
  missing_order_id: "ไม่มีรหัสออเดอร์",
};

const FORWARD_CHAIN = [
  "pending",
  "confirmed",
  "preparing",
  "ready_for_pickup",
  "picked_up",
  "in_transit",
  "delivered",
];

const DELIVERABLE_STATUSES = [
  "confirmed",
  "preparing",
  "ready_for_pickup",
  "picked_up",
  "in_transit",
];

const CANCELLABLE_STATUSES = [
  "pending",
  "confirmed",
  "preparing",
  "ready_for_pickup",
  "picked_up",
];

const STATUS_GROUPS = [
  { key: "pending", label: "รอรับออเดอร์", statuses: ["pending"], chipClass: "status-pending" },
  { key: "accepted", label: "รับออเดอร์แล้ว", statuses: DELIVERABLE_STATUSES, chipClass: "status-accepted" },
  { key: "delivered", label: "จัดส่งสำเร็จ", statuses: ["delivered"], chipClass: "status-delivered" },
  { key: "cancelled", label: "ยกเลิก", statuses: ["cancelled"], chipClass: "status-cancelled" },
];

function getStatusActions(status) {
  if (status === "pending") {
    return [
      { value: "confirmed", label: "รับออเดอร์" },
      { value: "cancelled", label: "ยกเลิก" },
    ];
  }
  if (DELIVERABLE_STATUSES.includes(status)) {
    return [{ value: "delivered", label: "ส่งเสร็จ" }];
  }
  return [];
}

function getGroupStatusActions(orders) {
  if (!orders || orders.length === 0) return [];
  const statuses = orders.map(o => o.status);
  const hasPending = statuses.some(s => s === "pending");
  const hasDeliverable = statuses.some(s => DELIVERABLE_STATUSES.includes(s));
  const hasCancellable = statuses.some(s => CANCELLABLE_STATUSES.includes(s));
  const actions = [];
  if (hasPending) actions.push({ value: "confirmed", label: "รับออเดอร์" });
  if (hasDeliverable) actions.push({ value: "delivered", label: "ส่งเสร็จ" });
  if (hasCancellable) actions.push({ value: "cancelled", label: "ยกเลิก" });
  return actions;
}

export default function AdminOrders() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [search, setSearch] = useState("");
  const [actionLoading, setActionLoading] = useState({});
  const [rowError, setRowError] = useState({});
  const [detailGroupId, setDetailGroupId] = useState(null);
  const [details, setDetails] = useState([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");

  const fetchOrders = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const ordersResult = await orderAPI.getAllOrders({ limit: 50 });
      const ordersData = ordersResult?.data || ordersResult;
      const ordersList = ordersData?.orders || ordersData?.data || [];
      setOrders(Array.isArray(ordersList) ? ordersList : []);
    } catch (err) {
      setError(err.message || "ไม่สามารถโหลดรายการคำสั่งซื้อได้");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  const { groups, incomplete } = useMemo(() => groupOrdersForDelivery(orders), [orders]);

  const allGroupItems = useMemo(() => {
    const rows = [];
    for (const detail of details) {
      const storeOrders = Array.isArray(detail.store_orders) ? detail.store_orders : [];
      for (const so of storeOrders) {
        const items = Array.isArray(so.order_items) ? so.order_items : [];
        const storeName = so.store_snapshot?.name || so.store?.name || "ร้านค้า";
        for (const it of items) {
          rows.push({ ...it, __orderId: detail.id, __storeName: storeName });
        }
      }
    }
    return rows;
  }, [details]);

  const handleStatusChange = async (group, newStatus) => {
    if (!newStatus) return;
    let notes;
    if (newStatus === "cancelled" || newStatus === "refunded") {
      const label = newStatus === "cancelled" ? "ยกเลิก" : "คืนเงิน";
      const reason = window.prompt(`เหตุผลในการ${label} (ไม่บังคับ):`);
      notes = reason ? reason.trim() : "";
    }
    setActionLoading(p => ({ ...p, [group.id]: true }));
    setRowError(p => ({ ...p, [group.id]: "" }));

    // Apply the transition to every member order independently. A failure on
    // one order must not abort the rest, and must not be reported as a whole
    // group success. We collect per-order outcomes and surface exactly which
    // Order IDs succeeded and which failed.
    const succeeded = [];
    const failed = [];
    for (const order of group.orders) {
      let hops;
      if (newStatus === "delivered" && DELIVERABLE_STATUSES.includes(order.status)) {
        const currentIndex = FORWARD_CHAIN.indexOf(order.status);
        hops = currentIndex >= 0 ? FORWARD_CHAIN.slice(currentIndex + 1) : [];
      } else if (newStatus === "confirmed" && order.status === "pending") {
        hops = ["confirmed"];
      } else if (newStatus === "cancelled" && CANCELLABLE_STATUSES.includes(order.status)) {
        hops = ["cancelled"];
      } else {
        // Order is not in a state this action applies to; skip it without
        // counting it as either success or failure.
        continue;
      }
      try {
        for (const hop of hops) {
          // eslint-disable-next-line no-await-in-loop
          await adminAPI.updateOrderStatus(order.id, hop, hop === newStatus ? notes : undefined);
        }
        succeeded.push(order.order_number || order.id);
      } catch (err) {
        failed.push({ orderNumber: order.order_number || order.id, message: err.message });
      }
    }

    // Re-fetch so the table reflects the real persisted statuses (a partial
    // chain may have advanced some hops) before surfacing any error.
    await fetchOrders();

    if (failed.length > 0) {
      const failedText = failed
        .map(f => `#${f.orderNumber} (${f.message || "ไม่สำเร็จ"})`)
        .join(", ");
      const okText = succeeded.length > 0
        ? ` สำเร็จ: ${succeeded.map(n => `#${n}`).join(", ")}.`
        : "";
      setRowError(p => ({
        ...p,
        [group.id]: `ไม่สามารถเปลี่ยนสถานะได้บางออเดอร์ — ไม่สำเร็จ: ${failedText}.${okText}`,
      }));
    }

    setActionLoading(p => ({ ...p, [group.id]: false }));
  };

  const loadGroupDetail = useCallback(async (group) => {
    setDetailLoading(true);
    setDetailError("");
    try {
      const results = await Promise.all(
        group.orders.map(order =>
          orderAPI.getById(order.id, "admin")
            .then(r => r?.data || r)
            .catch(() => order)
        )
      );
      setDetails(results);
    } catch (err) {
      setDetailError(err.message || "ไม่สามารถโหลดรายละเอียดคำสั่งซื้อได้");
      setDetails(group.orders);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const openGroupDetail = useCallback((group) => {
    setDetailGroupId(group.id);
    setDetails([]);
    setDetailError("");
    setDetailLoading(true);
    loadGroupDetail(group);
  }, [loadGroupDetail]);

  const closeGroupDetail = useCallback((event) => {
    if (event) event.stopPropagation();
    setDetailGroupId(null);
    setDetails([]);
    setDetailError("");
    setDetailLoading(false);
  }, []);

  useEffect(() => {
    if (!detailGroupId) return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape") closeGroupDetail();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [detailGroupId, closeGroupDetail]);

  const activeGroup = STATUS_GROUPS.find(g => g.key === statusFilter) || null;

  const filtered = groups.filter(group => {
    if (!group.primaryOrder) return false;
    if (activeGroup && !activeGroup.statuses.includes(group.primaryOrder.status)) return false;
    const raw = search.trim();
    if (!raw) return true;
    const q = raw.toLowerCase();
    const normalizePhone = v => (v || "").replace(/\D/g, "");
    const qDigits = normalizePhone(raw);
    for (const order of group.orders) {
      const phoneDigits = normalizePhone(order.customer?.phone || "");
      const phoneVariants = phoneDigits
        ? [phoneDigits, phoneDigits.replace(/^0/, "66"), phoneDigits.replace(/^66/, "0")]
        : [];
      const phoneMatch =
        qDigits.length > 0 &&
        phoneVariants.some(v => v.includes(qDigits) || qDigits.includes(v));
      const numNorm = (order.order_number || "").toLowerCase().replace(/[^a-z0-9]/g, "");
      const qNorm = q.replace(/[^a-z0-9]/g, "");
      const name = (order.customer?.name || "").toLowerCase().trim();
      if (
        (qNorm && numNorm.includes(qNorm)) ||
        name.includes(q) ||
        phoneMatch ||
        (order.customer?.phone || "").toLowerCase().includes(q)
      ) {
        return true;
      }
    }
    return false;
  });

  const groupCounts = STATUS_GROUPS.reduce((acc, group) => {
    acc[group.key] = groups.filter(
      g => g.primaryOrder && group.statuses.includes(g.primaryOrder.status)
    ).length;
    return acc;
  }, {});

  if (loading) {
    return (
      <div className="page admin-orders-page">
        <div className="admin-orders-header">
          <h1>จัดการคำสั่งซื้อ</h1>
        </div>
        <p className="loading-state">กำลังโหลดคำสั่งซื้อ...</p>
      </div>
    );
  }

  const detailGroup = groups.find(g => g.id === detailGroupId);

  return (
    <div className="page admin-orders-page">
      <div className="admin-orders-header">
        <h1>จัดการคำสั่งซื้อ</h1>
        <div className="admin-orders-stats">
          {STATUS_GROUPS.map(group => (
            <span
              key={group.key}
              className={`stat-chip ${statusFilter === group.key ? "active" : ""} ${group.chipClass}`}
              onClick={() => setStatusFilter(statusFilter === group.key ? "" : group.key)}
            >
              {group.label} <span>({groupCounts[group.key] || 0})</span>
            </span>
          ))}
        </div>
      </div>

      {error && <div className="alert alert-error" role="alert">{error}</div>}

      {!error && incomplete.length > 0 && (
        <div className="alert alert-warning admin-orders-incomplete" role="status">
          <strong>พบออเดอร์ที่ข้อมูลไม่ครบ ไม่สามารถจัดกลุ่มตามที่อยู่จัดส่งได้ ({incomplete.length} รายการ)</strong>
          <ul>
            {incomplete.map(({ order, reasons }) => (
              <li key={order?.id || Math.random()}>
                {order?.order_number ? `#${order.order_number}` : (order?.id || "ไม่ทราบเลขออเดอร์")}
                {" — "}
                {reasons.map(r => INCOMPLETE_REASON_LABELS[r] || r).join(", ")}
              </li>
            ))}
          </ul>
          <span>ออเดอร์เหล่านี้แสดงเป็นรายการเดี่ยวเพื่อความปลอดภัย ไม่ถูกจับคู่กับรายการอื่น</span>
        </div>
      )}

      <div className="admin-orders-toolbar">
        <input
          type="search"
          placeholder="ค้นหาเลขที่ออเดอร์ / ลูกค้า / เบอร์โทร"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {!error && filtered.length === 0 && (
        <div className="empty-state">
          <p>{search.trim() ? "ไม่พบออเดอร์ที่ตรงกับคำค้นหา" : "ไม่พบคำสั่งซื้อในสถานะที่เลือก"}</p>
        </div>
      )}

      {!error && filtered.length > 0 && (
        <div className="admin-orders-table admin-orders-table--compact">
          <table>
            <thead>
              <tr>
                <th>เลขที่ออเดอร์</th>
                <th>ลูกค้า</th>
                <th>ร้านค้า</th>
                <th>สถานะ</th>
                <th>สถานะชำระเงิน</th>
                <th>ยอดรวม</th>
                <th>สั่งเมื่อ</th>
                <th className="admin-orders-th-action">การดำเนินการ</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(group => {
                const primary = group.primaryOrder;
                if (!primary) return null;
                const actions = group.isGroup
                  ? getGroupStatusActions(group.orders)
                  : getStatusActions(primary.status);
                const isActionLoading = actionLoading[group.id];
                const currentRowError = rowError[group.id];
                const total = group.isGroup ? getGroupTotal(group) : primary.total_amount;
                const storeNames = group.isGroup
                  ? getGroupStoreNames(group)
                  : (primary.store_orders || []).map(so => so.store?.name || "ร้านค้า");
                const groupStatuses = getGroupStatuses(group);
                const mixedStatuses = hasMixedStatuses(group);
                const mixedPayments = hasMixedPaymentStatuses(group);

                return (
                  <tr key={group.id} className="admin-orders-row">
                    <td>
                      <Link to={`/orders/${primary.id}`} className="admin-orders-number">
                        #{primary.order_number}
                      </Link>
                      {group.isGroup && (
                        <span className="admin-orders-group-badge" title={`${group.orders.length} ออเดอร์ในกลุ่มเดียวกัน`}>
                          +{group.orders.length - 1}
                        </span>
                      )}
                    </td>
                    <td>
                      <div className="admin-orders-customer">
                        <span>{primary.customer?.name || "-"}</span>
                        {primary.customer?.phone && (
                          <span className="admin-orders-phone">{primary.customer.phone}</span>
                        )}
                      </div>
                    </td>
                    <td>
                      {storeNames.map((name, idx) => (
                        <span key={idx} className="admin-orders-store">{name}</span>
                      ))}
                    </td>
                    <td>
                      <span className={`badge badge-${primary.status}`}>
                        {STATUS_LABELS[primary.status] || primary.status}
                      </span>
                      {mixedStatuses && (
                        <span className="admin-orders-mixed-indicator" title={groupStatuses.map(s => STATUS_LABELS[s] || s).join(", ")}>
                          หลายสถานะ
                        </span>
                      )}
                    </td>
                    <td>
                      <span className={`payment-badge payment-${primary.payment_status}`}>
                        {paymentStatusLabel(primary.payment_status, primary.status, primary.payment_method)}
                      </span>
                      {mixedPayments && (
                        <span className="admin-orders-mixed-indicator" title="สถานะชำระเงินของสมาชิกในกลุ่มไม่ตรงกัน">
                          หลายสถานะชำระเงิน
                        </span>
                      )}
                      {primary.payment_method && (
                        <span className="admin-orders-payment-method">
                          {paymentMethodLabel(primary.payment_method)}
                        </span>
                      )}
                    </td>
                    <td>{formatCurrency(total)}</td>
                    <td>{formatDate(primary.created_at)}</td>
                    <td className="admin-orders-td-action">
                      <div className="admin-orders-action-group">
                        {actions.length > 0 && (
                          <select
                            className="admin-orders-status-select"
                            value=""
                            disabled={isActionLoading}
                            onChange={e => handleStatusChange(group, e.target.value)}
                            aria-label={`เปลี่ยนสถานะคำสั่งซื้อ #${primary.order_number}`}
                          >
                            <option value="" disabled>
                              {isActionLoading ? "กำลังบันทึก..." : "เปลี่ยนสถานะ..."}
                            </option>
                            {actions.map(a => (
                              <option key={a.value} value={a.value}>{a.label}</option>
                            ))}
                          </select>
                        )}
                        <button
                          type="button"
                          className="btn btn-outline btn-small"
                          onClick={e => {
                            e.stopPropagation();
                            openGroupDetail(group);
                          }}
                          aria-label={`ดูรายละเอียดคำสั่งซื้อ #${primary.order_number}`}
                        >
                          รายละเอียด
                        </button>
                      </div>
                      {currentRowError && (
                        <div className="admin-orders-row-error" role="alert">{currentRowError}</div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {detailGroupId !== null && (
        <div
          className="admin-order-detail-overlay"
          onClick={closeGroupDetail}
          role="dialog"
          aria-modal="true"
          aria-labelledby="admin-order-detail-title"
        >
            <div className="admin-order-detail-panel" onClick={event => event.stopPropagation()}>
              <button type="button" className="admin-order-detail-close" onClick={closeGroupDetail} aria-label="ปิด">
              &times;
            </button>
            <header className="admin-order-detail-header">
              <h2 id="admin-order-detail-title">
                {details.length > 1
                  ? `รายละเอียดกลุ่มออเดอร์ (${details.length} ออเดอร์)`
                  : "รายละเอียดคำสั่งซื้อ"}
              </h2>
              {details.length === 1 && details[0]?.order_number && (
                <span className="admin-order-detail-order-no">#{details[0].order_number}</span>
              )}
              {details.length > 1 && (
                <span className="admin-order-detail-group-total">
                  {details.length} ออเดอร์ / {formatCurrency(getGroupTotal(detailGroup))}
                </span>
              )}
            </header>
            <div className="admin-order-detail-body">
              {detailLoading && (
                <div className="admin-order-detail-loading">กำลังโหลดรายละเอียด...</div>
              )}
              {detailError && details.length === 0 && (
                <div className="admin-order-detail-error" role="alert">
                  {detailError}
                  <button type="button" className="btn btn-outline btn-small" onClick={() => {
                    const group = groups.find(g => g.id === detailGroupId);
                    if (group) openGroupDetail(group);
                  }} style={{ marginTop: 8 }}>
                    ลองใหม่
                  </button>
                </div>
              )}
              {details.length > 0 && !detailLoading && (
                details.length === 1 ? (
                  renderOrderDetail(details[0])
                ) : (
                  <div className="admin-order-group-detail">
                    {(() => {
                      const sharedAddress = detailGroup?.orders
                        ?.map(o => o.customer_snapshot?.address)
                        .find(Boolean);
                      return sharedAddress ? (
                        <div className="admin-order-group-address">
                          <h3>ที่อยู่จัดส่งร่วมของกลุ่มนี้</h3>
                          <p>{formatAddress(sharedAddress)}</p>
                        </div>
                      ) : null;
                    })()}

                    {(() => {
                      const first = details[0];
                      if (!first) return null;
                      const customer = first?.customer || first?.customer_snapshot || {};
                      const storeOrders = Array.isArray(first.store_orders) ? first.store_orders : [];
                      const storeNames = storeOrders
                        .map(so => so.store_snapshot?.name || so.store?.name)
                        .filter(Boolean);
                      const delivery = first.store_orders?.[0]?.delivery || first.delivery;
                      return (
                        <div className="admin-order-group-customer">
                          <h3>ข้อมูลลูกค้า</h3>
                          <div className="admin-order-detail-row">
                            <span className="admin-order-detail-label">ชื่อลูกค้า</span>
                            <span className="admin-order-detail-value">{customer.name || "-"}</span>
                          </div>
                          {(customer.phone || first?.customer_snapshot?.phone) && (
                            <div className="admin-order-detail-row">
                              <span className="admin-order-detail-label">เบอร์โทรศัพท์</span>
                              <span className="admin-order-detail-value">
                                {customer.phone || first?.customer_snapshot?.phone}
                              </span>
                            </div>
                          )}
                          <div className="admin-order-detail-row">
                            <span className="admin-order-detail-label">ร้านค้า</span>
                            <span className="admin-order-detail-value">
                              {storeNames.length ? storeNames.join(" / ") : "-"}
                            </span>
                          </div>
                          {first.customer_snapshot?.address && (
                            <div className="admin-order-detail-row">
                              <span className="admin-order-detail-label">ที่อยู่ลูกค้า</span>
                              <span className="admin-order-detail-value">
                                {formatAddress(first.customer_snapshot.address)}
                              </span>
                            </div>
                          )}
                          <div className="admin-order-detail-row">
                            <span className="admin-order-detail-label">สถานะจัดส่ง</span>
                            <span className="admin-order-detail-value">
                              {delivery?.status || "-"}
                            </span>
                          </div>
                        </div>
                      );
                    })()}

                    {details.map((detail, index) => (
                      <div key={detail.id || index} className="admin-order-group-section">
                        <h3 className="admin-order-group-order-header">
                          ออเดอร์ที่ {index + 1}: #{detail.order_number || "-"}
                          <span className={`badge badge-${detail.status || "pending"}`} style={{ marginLeft: 8 }}>
                            {STATUS_LABELS[detail.status] || detail.status || "-"}
                          </span>
                          <span className={`payment-badge payment-${detail.payment_status || "pending"}`} style={{ marginLeft: 4 }}>
                            {paymentStatusLabel(detail.payment_status, detail.status, detail.payment_method)}
                          </span>
                          {detail.id && (
                            <Link
                              to={`/orders/${detail.id}`}
                              className="admin-order-detail-track-link"
                              style={{ marginLeft: "auto" }}
                            >
                              ดูรายละเอียด/Tracking ของออเดอร์นี้
                            </Link>
                          )}
                        </h3>
                        {renderOrderSlips(detail)}
                      </div>
                    ))}

                    <div className="admin-order-detail-section">
                      <h3>รายการสินค้า</h3>
                      {allGroupItems.length ? (
                        <table className="admin-order-detail-items-table">
                          <thead>
                            <tr>
                              <th style={{ width: 44 }}>รูป</th>
                              <th>สินค้า</th>
                              <th className="admin-order-detail-numeric">ร้านค้า</th>
                              <th className="admin-order-detail-numeric">จำนวน</th>
                              <th className="admin-order-detail-numeric">ราคา</th>
                            </tr>
                          </thead>
                          <tbody>
                            {allGroupItems.map((it, index) => (
                              <tr key={`${it.__orderId}-${index}`}>
                                <td>
                                  {it.product_image ? (
                                    <img
                                      className="admin-order-detail-item-img"
                                      src={it.product_image}
                                      alt={it.product_name || ""}
                                      loading="lazy"
                                    />
                                  ) : (
                                    <span className="admin-order-detail-item-img admin-order-detail-item-img-empty">
                                      -
                                    </span>
                                  )}
                                </td>
                                <td>{it.product_name || "-"}</td>
                                <td className="admin-order-detail-numeric">{it.__storeName}</td>
                                <td className="admin-order-detail-numeric">
                                  {it.quantity != null ? it.quantity : 1}
                                </td>
                                <td className="admin-order-detail-numeric">{formatCurrency(it.total_price)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      ) : (
                        <p>ไม่พบรายการสินค้า</p>
                      )}
                    </div>
                  </div>
                )
              )}
            </div>
            <div className="admin-order-detail-actions">
              <button type="button" className="btn btn-outline btn-small admin-order-detail-btn-close" onClick={closeGroupDetail}>
                ปิด
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const PAYMENT_METHOD_LABELS = {
  cod: "ชำระเงินปลายทาง",
  promptpay: "PromptPay",
  kbzpay: "KBZPay Wallet (Myanmar)",
  transfer: "โอนเงิน",
};

const SLIP_STATUS_LABELS = {
  uploaded: "รอการตรวจสอบ",
  approved: "อนุมัติแล้ว",
  rejected: "ปฏิเสธแล้ว",
};

function renderOrderSlips(o) {
  const slips = Array.isArray(o.payment_slips) ? o.payment_slips : [];
  if (slips.length === 0) return null;
  return (
    <div className="admin-order-detail-section">
      <h3>สลิปการชำระเงิน (KBZPay)</h3>
      {slips.map(s => (
        <div key={s.id || s.slip_filename} className="admin-order-detail-slip">
          {(s.slip_view_url || s.slip_url) ? (
            <img className="admin-order-detail-slip-img" src={s.slip_view_url || s.slip_url} alt={`สลิป ${s.slip_filename || ""}`} loading="lazy" />
          ) : (
            <div className="admin-order-detail-slip-placeholder">ไม่มีรูปสลิป</div>
          )}
          <div className="admin-order-detail-row">
            <span className="admin-order-detail-label">ไฟล์</span>
            <span className="admin-order-detail-value">{s.slip_filename || "-"}</span>
          </div>
          {s.amount_thb != null && (
            <div className="admin-order-detail-row">
              <span className="admin-order-detail-label">จำนวนเงิน</span>
              <span className="admin-order-detail-value">{formatCurrency(s.amount_thb)} THB</span>
            </div>
          )}
          <div className="admin-order-detail-row">
            <span className="admin-order-detail-label">สถานะสลิป</span>
            <span className={`slip-badge slip-${s.slip_status} admin-order-detail-value`}>
              {SLIP_STATUS_LABELS[s.slip_status] || s.slip_status || "-"}
            </span>
          </div>
          {s.reject_reason && (
            <div className="admin-order-detail-row">
              <span className="admin-order-detail-label">สาเหตุปฏิเสธ</span>
              <span className="admin-order-detail-value">{s.reject_reason}</span>
            </div>
          )}
          {s.created_at && (
            <div className="admin-order-detail-row">
              <span className="admin-order-detail-label">อัปโหลดเมื่อ</span>
              <span className="admin-order-detail-value">{formatDate(s.created_at)}</span>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function renderOrderDetail(o) {
  const orderNumber = o.order_number || "-";
  const customer = o.customer || o.customer_snapshot || {};
  const storeOrders = Array.isArray(o.store_orders) ? o.store_orders : [];
  const items = storeOrders.flatMap(so => (Array.isArray(so.order_items) ? so.order_items : []));
  const delivery = storeOrders[0]?.delivery || o.delivery;

  const storeNames = storeOrders
    .map(so => so.store_snapshot?.name || so.store?.name || "ร้านค้า")
    .filter(Boolean);

  const addressRows = [];
  if (o.customer_snapshot?.address) {
    addressRows.push({ label: "ที่อยู่ลูกค้า", value: formatAddress(o.customer_snapshot.address) });
  }
  if (delivery?.delivery_address) {
    addressRows.push({ label: "ที่อยู่จัดส่ง", value: formatAddress(delivery.delivery_address) });
  }
  if (delivery?.pickup_address) {
    addressRows.push({ label: "จุดรับสินค้า", value: formatAddress(delivery.pickup_address) });
  }

  return (
    <>
      <div className="admin-order-detail-grid">
        <div className="admin-order-detail-col">
          <h3>ข้อมูลคำสั่งซื้อ</h3>
          <div className="admin-order-detail-row">
            <span className="admin-order-detail-label">เลขที่ออเดอร์</span>
            <span className="admin-order-detail-value">#{orderNumber}</span>
          </div>
          <div className="admin-order-detail-row">
            <span className="admin-order-detail-label">รหัสคำสั่งซื้อ</span>
            <span className="admin-order-detail-value">{o.id || "-"}</span>
          </div>
          <div className="admin-order-detail-row">
            <span className="admin-order-detail-label">วันและเวลาสั่งซื้อ</span>
            <span className="admin-order-detail-value">{formatDate(o.created_at)}</span>
          </div>
          <div className="admin-order-detail-row">
            <span className="admin-order-detail-label">สถานะคำสั่งซื้อ</span>
            <span className={`badge badge-${o.status || "pending"} admin-order-detail-value`}>
              {STATUS_LABELS[o.status] || o.status || "-"}
            </span>
          </div>
          <div className="admin-order-detail-row">
            <span className="admin-order-detail-label">สถานะการชำระเงิน</span>
            <span className={`payment-badge payment-${o.payment_status || "pending"} admin-order-detail-value`}>
              {paymentStatusLabel(o.payment_status, o.status, o.payment_method)}
            </span>
          </div>
          <div className="admin-order-detail-row">
            <span className="admin-order-detail-label">วิธีชำระเงิน</span>
            <span className="admin-order-detail-value">{PAYMENT_METHOD_LABELS[o.payment_method] || o.payment_method || "-"}</span>
          </div>
          <div className="admin-order-detail-row">
            <span className="admin-order-detail-label">ยอดรวม</span>
            <span className="admin-order-detail-value">{formatCurrency(o.total_amount)}</span>
          </div>
          {o.subtotal != null && (
            <div className="admin-order-detail-row">
              <span className="admin-order-detail-label">ราคาสินค้ารวม</span>
              <span className="admin-order-detail-value">{formatCurrency(o.subtotal)}</span>
            </div>
          )}
          {o.shipping_fee != null && o.shipping_fee > 0 && (
            <div className="admin-order-detail-row">
              <span className="admin-order-detail-label">ค่าจัดส่ง</span>
              <span className="admin-order-detail-value">{formatCurrency(o.shipping_fee)}</span>
            </div>
          )}
          {o.tax_amount != null && o.tax_amount > 0 && (
            <div className="admin-order-detail-row">
              <span className="admin-order-detail-label">ภาษีมูลค่าเพิ่ม ({o.vat_rate ?? 7}%)</span>
              <span className="admin-order-detail-value">{formatCurrency(o.tax_amount)}</span>
            </div>
          )}
          {o.discount_amount != null && o.discount_amount > 0 && (
            <div className="admin-order-detail-row">
              <span className="admin-order-detail-label">ส่วนลด</span>
              <span className="admin-order-detail-value">-{formatCurrency(o.discount_amount)}</span>
            </div>
          )}
          {o.payment_method === "kbzpay" && o.amount_mmk != null && (
            <div className="admin-order-detail-row">
              <span className="admin-order-detail-label">ยอดรวม (MMK)</span>
              <span className="admin-order-detail-value">{formatCurrency(o.amount_mmk, "MMK")}</span>
            </div>
          )}
        </div>
        <div className="admin-order-detail-col">
          <h3>ข้อมูลลูกค้า</h3>
          <div className="admin-order-detail-row">
            <span className="admin-order-detail-label">ชื่อลูกค้า</span>
            <span className="admin-order-detail-value">{customer.name || "-"}</span>
          </div>
          {customer.phone && (
            <div className="admin-order-detail-row">
              <span className="admin-order-detail-label">เบอร์โทรศัพท์</span>
              <span className="admin-order-detail-value">{customer.phone}</span>
            </div>
          )}
          <h3>ร้านค้า</h3>
          {storeNames.length ? (
            storeNames.map((name, index) => (
              <div key={index} className="admin-order-detail-row">
                <span className="admin-order-detail-label">{storeNames.length > 1 ? `ร้านค้าที่ ${index + 1}` : "ร้านค้า"}</span>
                <span className="admin-order-detail-value">{name}</span>
              </div>
            ))
          ) : (
            <div className="admin-order-detail-row">
              <span className="admin-order-detail-label">ร้านค้า</span>
              <span className="admin-order-detail-value">-</span>
            </div>
          )}
          <h3>ที่อยู่จัดส่งและข้อมูลการจัดส่ง</h3>
          {addressRows.length ? (
            addressRows.map((row, index) => (
              <div key={index} className="admin-order-detail-row">
                <span className="admin-order-detail-label">{row.label}</span>
                <span className="admin-order-detail-value">{row.value}</span>
              </div>
            ))
          ) : (
            <div className="admin-order-detail-row">
              <span className="admin-order-detail-label">ที่อยู่</span>
              <span className="admin-order-detail-value">-</span>
            </div>
          )}
          {delivery ? (
            <>
              <div className="admin-order-detail-row">
                <span className="admin-order-detail-label">สถานะจัดส่ง</span>
                <span className="admin-order-detail-value">{delivery.status || "-"}</span>
              </div>
              {delivery.courier?.profile?.name && (
                <div className="admin-order-detail-row">
                  <span className="admin-order-detail-label">ผู้จัดส่ง</span>
                  <span className="admin-order-detail-value">{delivery.courier.profile.name}</span>
                </div>
              )}
            </>
          ) : (
            <div className="admin-order-detail-row">
              <span className="admin-order-detail-label">สถานะจัดส่ง</span>
              <span className="admin-order-detail-value">-</span>
            </div>
          )}
        </div>
      </div>

      <div className="admin-order-detail-section">
        <h3>รายการสินค้า</h3>
        {items.length ? (
          <table className="admin-order-detail-items-table">
            <thead>
              <tr>
                <th style={{ width: 44 }}>รูป</th>
                <th>สินค้า</th>
                <th className="admin-order-detail-numeric">ร้านค้า</th>
                <th className="admin-order-detail-numeric">จำนวน</th>
                <th className="admin-order-detail-numeric">ราคา</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, index) => {
                const so = storeOrders.find(s => Array.isArray(s.order_items) && s.order_items.includes(it));
                return (
                  <tr key={`${it.product_name || "item"}-${index}`}>
                    <td>
                      {it.product_image ? (
                        <img className="admin-order-detail-item-img" src={it.product_image} alt={it.product_name || ""} loading="lazy" />
                      ) : (
                        <span className="admin-order-detail-item-img admin-order-detail-item-img-empty">-</span>
                      )}
                    </td>
                    <td>{it.product_name || "-"}</td>
                    <td className="admin-order-detail-numeric">
                      {so ? so.store_snapshot?.name || so.store?.name || "ร้านค้า" : "-"}
                    </td>
                    <td className="admin-order-detail-numeric">{it.quantity != null ? it.quantity : 1}</td>
                    <td className="admin-order-detail-numeric">{formatCurrency(it.total_price)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <p>ไม่พบรายการสินค้า</p>
        )}
      </div>

      {renderOrderSlips(o)}
    </>
  );
}