// Helpers for the existing-order payment popup. Everything here is read-only:
// no order creation, no cart mutation and no payment/stock updates.

const EXCLUDED_ORDER_STATUSES = ["cancelled", "refunded"];

export const roundMoney = (value) => {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return 0;
  return Math.round((amount + Number.EPSILON) * 100) / 100;
};

const pick = (o, ...keys) => {
  for (const k of keys) {
    if (o && o[k] !== undefined && o[k] !== null) return o[k];
  }
  return undefined;
};

export const isPendingPaymentOrder = (order) => {
  if (!order) return false;
  const paymentStatus = pick(order, "payment_status", "paymentStatus");
  const status = pick(order, "status", "order_status", "orderStatus");
  return paymentStatus === "pending" && !EXCLUDED_ORDER_STATUSES.includes(status);
};

export const getPendingPaymentOrders = (orders) =>
  (Array.isArray(orders) ? orders : []).filter(isPendingPaymentOrder);

// The customer order list (GET /orders -> getCustomerOrders) returns each
// store_order WITHOUT a flat `store_id` column. The store reference lives at
// `store_order.store` (id, name, ...), and some other endpoints nest it under
// `store_snapshot`. These resolvers centralise that lookup so the order modal
// and the payment popup always agree on which store an order belongs to and
// therefore which KBZPay settings to load.
export const getStoreOrders = (order) =>
  pick(order, "store_orders", "storeOrders") || [];

const firstDefined = (...values) => {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
};

export const resolveStoreOrderStoreId = (storeOrder) => {
  if (!storeOrder) return undefined;
  const direct = firstDefined(pick(storeOrder, "store_id", "storeId"));
  if (direct !== undefined) return direct;

  const store = pick(storeOrder, "store", "storeInfo");
  if (store && typeof store === "object") {
    const id = firstDefined(pick(store, "id", "store_id", "storeId"));
    if (id !== undefined) return id;
  }

  const snapshot = pick(storeOrder, "store_snapshot", "storeSnapshot");
  if (snapshot && typeof snapshot === "object") {
    const id = firstDefined(pick(snapshot, "store_id", "storeId", "id"));
    if (id !== undefined) return id;
  }

  return undefined;
};

export const resolveStoreOrderStoreName = (storeOrder) => {
  if (!storeOrder) return "";
  const snapshot = pick(storeOrder, "store_snapshot", "storeSnapshot");
  const store = pick(storeOrder, "store", "storeInfo");
  return (
    firstDefined(
      snapshot && typeof snapshot === "object" ? pick(snapshot, "name") : undefined,
      store && typeof store === "object" ? pick(store, "name") : undefined
    ) || ""
  );
};

// KBZPay orders are charged in MMK and carry amount_mmk. Any other order
// (including COD) is charged in THB with total_amount.
export const getOrderPaymentCurrency = (order) => {
  const paymentMethod = pick(order, "payment_method", "paymentMethod");
  const amountMmk = Number(pick(order, "amount_mmk", "amountMmk"));
  if (paymentMethod === "kbzpay" && Number.isFinite(amountMmk) && amountMmk > 0) {
    return "MMK";
  }
  return "THB";
};

export const getOrderPaymentAmount = (order, currency = getOrderPaymentCurrency(order)) =>
  currency === "MMK"
    ? roundMoney(pick(order, "amount_mmk", "amountMmk"))
    : roundMoney(pick(order, "total_amount", "totalAmount", "amount"));

const CURRENCY_SORT = { THB: 0, MMK: 1 };

export const buildPendingPaymentSummary = (orders) => {
  const groups = new Map();

  getPendingPaymentOrders(orders).forEach((order) => {
    const currency = getOrderPaymentCurrency(order);
    if (!groups.has(currency)) {
      groups.set(currency, { currency, orders: [], total: 0 });
    }
    const group = groups.get(currency);
    const amount = getOrderPaymentAmount(order, currency);
    group.orders.push({ order, amount });
    group.total = roundMoney(group.total + amount);
  });

  const list = Array.from(groups.values())
    .map((group) => ({ ...group, orderCount: group.orders.length }))
    .sort(
      (a, b) =>
        (CURRENCY_SORT[a.currency] ?? Number.MAX_SAFE_INTEGER) -
        (CURRENCY_SORT[b.currency] ?? Number.MAX_SAFE_INTEGER)
    );

  return {
    orderCount: list.reduce((sum, group) => sum + group.orderCount, 0),
    groups: list,
  };
};
