// Helpers for the existing-order payment popup. Everything here is read-only:
// no order creation, no cart mutation and no payment/stock updates.

const EXCLUDED_ORDER_STATUSES = ["cancelled", "refunded"];

const roundMoney = (value) => {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return 0;
  return Math.round((amount + Number.EPSILON) * 100) / 100;
};

export const isPendingPaymentOrder = (order) =>
  Boolean(order) &&
  order.payment_status === "pending" &&
  !EXCLUDED_ORDER_STATUSES.includes(order.status);

export const getPendingPaymentOrders = (orders) =>
  (Array.isArray(orders) ? orders : []).filter(isPendingPaymentOrder);

// KBZPay orders are charged in MMK and carry amount_mmk. Any other order
// (including COD) is charged in THB with total_amount.
export const getOrderPaymentCurrency = (order) => {
  const amountMmk = Number(order?.amount_mmk);
  if (order?.payment_method === "kbzpay" && Number.isFinite(amountMmk) && amountMmk > 0) {
    return "MMK";
  }
  return "THB";
};

export const getOrderPaymentAmount = (order, currency = getOrderPaymentCurrency(order)) =>
  currency === "MMK" ? roundMoney(order?.amount_mmk) : roundMoney(order?.total_amount);

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
