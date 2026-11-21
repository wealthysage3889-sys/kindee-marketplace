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
  { key: "toreview", label: "ให้คะแนน" },
];

export const ORDER_FILTER_KEYS = ORDER_FILTERS.map((filter) => filter.key);

const CANCELLED_STATUSES = ["cancelled", "refunded"];
const PRE_SHIPMENT_STATUSES = ["pending", "confirmed", "preparing", "ready_for_pickup"];
const IN_DELIVERY_STATUSES = ["picked_up", "in_transit"];

export const orderStatusLabel = (status) => ORDER_STATUS_LABELS[status] || status || "-";

export const paymentStatusLabel = (status) => PAYMENT_STATUS_LABELS[status] || status || "-";

export const paymentMethodLabel = (method) => PAYMENT_METHOD_LABELS[method] || method || "-";

const storeStatuses = (order) =>
  (Array.isArray(order?.store_orders) ? order.store_orders : [])
    .map((storeOrder) => storeOrder?.status)
    .filter(Boolean);

const isCancelled = (order) =>
  CANCELLED_STATUSES.includes(order?.status);

const matchesAnyStatus = (order, statuses) => {
  const statuses_ = storeStatuses(order);
  if (statuses_.length > 0) return statuses_.some((status) => statuses.includes(status));
  return statuses.includes(order?.status);
};

const areAllDelivered = (order) => {
  const statuses = storeStatuses(order);
  if (statuses.length > 0) return statuses.every((status) => status === "delivered");
  return order?.status === "delivered";
};

export const matchesOrderFilter = (order, filter) => {
  if (!order) return false;
  if (filter === "all" || !filter) return true;
  if (isCancelled(order)) return false;

  switch (filter) {
    case "topay":
      return order.payment_status === "pending" && order.payment_method !== "cod";
    case "toship":
      return matchesAnyStatus(order, PRE_SHIPMENT_STATUSES);
    case "toreceive":
      return matchesAnyStatus(order, IN_DELIVERY_STATUSES) && !areAllDelivered(order);
    case "toreview":
      return areAllDelivered(order);
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
