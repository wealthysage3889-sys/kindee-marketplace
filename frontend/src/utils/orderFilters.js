export const ORDER_STATUS_LABELS = {
  pending: "รอดำเนินการ",
  confirmed: "ยืนยันแล้ว",
  preparing: "กำลังเตรียม",
  ready_for_pickup: "พร้อมรับสินค้า",
  picked_up: "รับสินค้าแล้ว",
  in_transit: "กำลังจัดส่ง",
  delivered: "จัดส่งสำเร็จ",
  cancelled: "ยกเลิก",
  refunded: "คืนเงิน",
  failed: "ล้มเหลว",
};

export const PAYMENT_STATUS_LABELS = {
  pending: "รอชำระ",
  awaiting_review: "รอตรวจสอบ",
  paid: "ชำระแล้ว",
  failed: "ชำระไม่สำเร็จ",
  refunded: "คืนเงินแล้ว",
  partially_refunded: "คืนเงินบางส่วน",
};

const PAYMENT_METHOD_LABELS = {
  cod: "ชำระเงินปลายทาง",
  kbzpay: "KBZPay",
  promptpay: "PromptPay",
  transfer: "โอนเงิน",
  card: "บัตรเครดิต",
  wallet: "กระเป๋าเงิน",
};

export const ORDER_FILTERS = [
  { key: "all", label: "ทั้งหมด" },
  { key: "topay", label: "ที่ต้องชำระ" },
  { key: "toship", label: "ที่ต้องจัดส่ง" },
  { key: "toreceive", label: "ที่ต้องได้รับ" },
  { key: "toreview", label: "รับสินค้าแล้ว" },
];

export const ORDER_FILTER_KEYS = ORDER_FILTERS.map((filter) => filter.key);

// Fulfilment workflow for the parent order. A status may only move to one of
// the listed next states, so the UI never offers (and the backend never
// accepts) an illegal jump such as pending -> delivered. This mirrors
// ORDER_STATUS_TRANSITIONS in backend/services/orderService.js. Payment status
// is intentionally excluded: changing the order status never confirms payment.
export const ORDER_STATUS_TRANSITIONS = {
  pending: ["confirmed", "cancelled"],
  confirmed: ["preparing", "cancelled"],
  preparing: ["ready_for_pickup", "cancelled"],
  ready_for_pickup: ["picked_up", "cancelled"],
  picked_up: ["in_transit", "cancelled"],
  in_transit: ["delivered", "refunded"],
  delivered: ["refunded"],
  cancelled: ["refunded"],
  refunded: [],
};

export const getAllowedOrderStatusTransitions = (status) =>
  ORDER_STATUS_TRANSITIONS[status] || [];

const CANCELLED_STATUSES = ["cancelled", "refunded"];
// "ที่ต้องจัดส่ง": orders still waiting for the store to accept them. Mirrors
// ACCEPTABLE_STATUSES on /selladmin/orders — the store has not yet pressed
// "รับออเดอร์", so the order has not left the pending state.
const PENDING_STATUSES = ["pending"];
// "ที่ต้องได้รับ": orders the store has accepted and is fulfilling, up to (but
// not including) delivered. Mirrors DELIVERABLE_STATUSES on /selladmin/orders,
// so the moment the store accepts (pending -> confirmed) the order moves here.
const IN_FULFILMENT_STATUSES = [
  "confirmed",
  "preparing",
  "ready_for_pickup",
  "picked_up",
  "in_transit",
];

export const orderStatusLabel = (status) => ORDER_STATUS_LABELS[status] || status || "-";

export const sortOrdersByNewest = (orders) =>
  [...(Array.isArray(orders) ? orders : [])].sort((a, b) => {
    const aTime = Date.parse(a?.created_at) || 0;
    const bTime = Date.parse(b?.created_at) || 0;
    return bTime - aTime;
  });

export const getStoreOrderStatusDisplay = (parentStatus, storeOrderStatus) => {
  if (parentStatus === "delivered") {
    return { label: "ตรวจสอบแล้ว", statusClass: "status-verified" };
  }

  const normalizedStatus = storeOrderStatus || "unknown";
  return {
    label: orderStatusLabel(normalizedStatus),
    statusClass: `status-${normalizedStatus}`,
  };
};

// Order statuses meaning the store has accepted the order (past "pending").
// When a KBZPay slip is still awaiting review after acceptance, the badge
// reads "ตรวจสอบแล้ว" without changing the underlying payment_status.
const ACCEPTED_ORDER_STATUSES = [
  "confirmed",
  "preparing",
  "ready_for_pickup",
  "picked_up",
  "in_transit",
  "delivered",
];

const PAYMENT_STATUS_CLASSES = {
  pending: "pay-pending",
  awaiting_review: "pay-awaiting_review",
  paid: "pay-paid",
  failed: "pay-failed",
  refunded: "pay-refunded",
  partially_refunded: "pay-partially_refunded",
  verified: "pay-verified",
};

export const getPaymentStatusDisplay = (paymentStatus, orderStatus, paymentMethod) => {
  let label;
  let statusClass;

  // Cancelled/refunded/failed orders don't need payment
  if (["cancelled", "refunded", "failed"].includes(orderStatus)) {
    label = "ไม่ต้องชำระ";
    statusClass = PAYMENT_STATUS_CLASSES.refunded;
    return { label, statusClass };
  }

  // COD orders
  if (paymentMethod === "cod") {
    if (orderStatus === "delivered" && paymentStatus === "paid") {
      label = "เก็บเงินแล้ว";
      statusClass = PAYMENT_STATUS_CLASSES.paid;
    } else {
      label = "รอชำระปลายทาง";
      statusClass = PAYMENT_STATUS_CLASSES.pending;
    }
    return { label, statusClass };
  }

  // KBZPay and other slip-based methods
  if (paymentMethod === "kbzpay" || paymentMethod === "promptpay" || paymentMethod === "transfer") {
    if (paymentStatus === "paid") {
      label = "ชำระแล้ว";
      statusClass = PAYMENT_STATUS_CLASSES.paid;
    } else if (paymentStatus === "awaiting_review" && orderStatus && ACCEPTED_ORDER_STATUSES.includes(orderStatus)) {
      label = "ตรวจสอบแล้ว";
      statusClass = PAYMENT_STATUS_CLASSES.verified;
    } else if (paymentStatus === "awaiting_review") {
      label = "รอตรวจสอบสลิป";
      statusClass = PAYMENT_STATUS_CLASSES.awaiting_review;
    } else if (paymentStatus === "expired") {
      label = "หมดอายุ";
      statusClass = PAYMENT_STATUS_CLASSES.failed;
    } else if (paymentStatus === "failed") {
      label = PAYMENT_STATUS_LABELS.failed;
      statusClass = PAYMENT_STATUS_CLASSES.failed;
    } else if (paymentStatus === "refunded" || paymentStatus === "partially_refunded") {
      label = PAYMENT_STATUS_LABELS[paymentStatus];
      statusClass = PAYMENT_STATUS_CLASSES[paymentStatus];
    } else {
      label = "รอชำระ";
      statusClass = PAYMENT_STATUS_CLASSES.pending;
    }
    return { label, statusClass };
  }

  // Fallback to generic labels
  label = PAYMENT_STATUS_LABELS[paymentStatus] || paymentStatus || "-";
  statusClass = PAYMENT_STATUS_CLASSES[paymentStatus] || `pay-${paymentStatus}`;
  return { label, statusClass };
};

export const paymentStatusLabel = (paymentStatus, orderStatus, paymentMethod) =>
  getPaymentStatusDisplay(paymentStatus, orderStatus, paymentMethod).label;

export const paymentMethodLabel = (method) => PAYMENT_METHOD_LABELS[method] || method || "-";

const storeStatuses = (order) =>
  (Array.isArray(order?.store_orders) ? order.store_orders : [])
    .map((storeOrder) => storeOrder?.status)
    .filter(Boolean);

const isCancelled = (order) =>
  CANCELLED_STATUSES.includes(order?.status);

const hasAnyDeliveredStoreOrder = (order) => {
  const statuses = storeStatuses(order);
  if (statuses.length > 0) return statuses.some((status) => status === "delivered");
  return order?.status === "delivered";
};

const areAllStoreOrdersDelivered = (order) => {
  const statuses = storeStatuses(order);
  if (statuses.length > 0) return statuses.every((status) => status === "delivered");
  return order?.status === "delivered";
};

// For customer-facing filters (toship, toreceive), prioritize the PARENT order status
// because it represents the overall order state. The store_order statuses are
// per-store fulfillment states and may lag behind (e.g., parent=confirmed but
// store_order=pending). Once the parent moves past "pending", the order belongs
// in "toreceive" (ที่ต้องได้รับ), not "toship" (ที่ต้องจัดส่ง).
const getEffectiveStatusForCustomerFilter = (order) => {
  const parentStatus = order?.status;
  const storeOrderStatuses = storeStatuses(order);
  
  // If parent order has progressed past "pending", use parent status
  // This handles the case where store accepted (pending -> confirmed) but
  // individual store_orders haven't been updated yet.
  if (parentStatus && parentStatus !== "pending") {
    return parentStatus;
  }
  
  // If parent is pending (or no parent status), fall back to store_order statuses
  // Use the most advanced store_order status as representative
  if (storeOrderStatuses.length > 0) {
    // Return the first non-pending status if any, otherwise pending
    const nonPending = storeOrderStatuses.find(s => s !== "pending");
    return nonPending || "pending";
  }
  
  return parentStatus || "pending";
};

export const matchesOrderFilter = (order, filter) => {
  if (!order) return false;
  if (filter === "all" || !filter) return true;
  if (isCancelled(order)) return false;

  const parentDelivered = order?.status === "delivered";

  switch (filter) {
    case "topay":
      return order.payment_status === "pending" && order.payment_method !== "cod";
    case "toship":
      if (parentDelivered) return false;
      // Only show orders where the effective status is still "pending"
      // (store has not yet accepted the order)
      return getEffectiveStatusForCustomerFilter(order) === "pending";
    case "toreceive":
      if (parentDelivered) return false;
      if (hasAnyDeliveredStoreOrder(order)) return false;
      // Show orders where the effective status is in fulfilment (confirmed onwards)
      const effectiveStatus = getEffectiveStatusForCustomerFilter(order);
      return IN_FULFILMENT_STATUSES.includes(effectiveStatus);
    case "toreview":
      if (parentDelivered) return true;
      return areAllStoreOrdersDelivered(order);
    default:
      return true;
  }
};

export const countOrdersByFilter = (orders) => {
  const uniqueOrders = new Map();
  (Array.isArray(orders) ? orders : []).forEach((order) => {
    if (order?.id) uniqueOrders.set(order.id, order);
  });

  const list = Array.from(uniqueOrders.values());
  const counts = {};
  ORDER_FILTERS.forEach(({ key }) => {
    counts[key] = list.filter((order) => matchesOrderFilter(order, key)).length;
  });
  return counts;
};

export const getReadDeliveredStorageKey = (userId) => `kindee:account:readDelivered:${userId ?? "anonymous"}`;

export const getReadDeliveredOrderIds = (userId) => {
  try {
    const raw = window.localStorage.getItem(getReadDeliveredStorageKey(userId));
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
};

export const markDeliveredOrdersRead = (userId, orderIds) => {
  const current = getReadDeliveredOrderIds(userId);
  (Array.isArray(orderIds) ? orderIds : []).forEach((id) => {
    if (id) current.add(id);
  });
  try {
    window.localStorage.setItem(getReadDeliveredStorageKey(userId), JSON.stringify([...current]));
  } catch {
    // ignore storage failures
  }
  return current;
};

export const countUnreadDeliveredOrders = (orders, userId) => {
  const deliveredIds = (Array.isArray(orders) ? orders : [])
    .filter((order) => matchesOrderFilter(order, "toreview"))
    .map((order) => order?.id)
    .filter(Boolean);
  const read = getReadDeliveredOrderIds(userId);
  return deliveredIds.filter((id) => !read.has(id)).length;
};
