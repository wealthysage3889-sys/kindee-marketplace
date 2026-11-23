import { describe, it, expect } from "vitest";
import {
  getOrderPaymentCurrency,
  getOrderPaymentAmount,
  buildPendingPaymentSummary,
  roundMoney,
} from "./pendingPayments";

const kbzpayOrder = (overrides = {}) => ({
  id: "order-1",
  order_number: "ORD-1",
  status: "pending",
  payment_status: "pending",
  payment_method: "kbzpay",
  total_amount: 999, // THB (base currency stored on the order)
  amount_mmk: 45450, // MMK recorded at order creation time
  created_at: "2026-11-21T10:00:00Z",
  ...overrides,
});

const codOrder = (overrides = {}) => ({
  id: "order-cod",
  order_number: "ORD-COD",
  status: "pending",
  payment_status: "pending",
  payment_method: "cod",
  total_amount: 500,
  amount_mmk: null,
  created_at: "2026-11-21T09:00:00Z",
  ...overrides,
});

describe("pendingPayments currency resolution", () => {
  it("KBZPay order with stored amount_mmk uses MMK", () => {
    expect(getOrderPaymentCurrency(kbzpayOrder())).toBe("MMK");
  });

  it("KBZPay order without amount_mmk does not invent an MMK amount (falls back to THB)", () => {
    expect(getOrderPaymentCurrency(kbzpayOrder({ amount_mmk: null }))).toBe("THB");
    expect(getOrderPaymentCurrency(kbzpayOrder({ amount_mmk: 0 }))).toBe("THB");
  });

  it("non-KBZPay orders always use THB", () => {
    expect(getOrderPaymentCurrency(codOrder())).toBe("THB");
    expect(getOrderPaymentCurrency({ ...codOrder(), payment_method: "transfer" })).toBe("THB");
    expect(getOrderPaymentCurrency({ ...codOrder(), payment_method: "promptpay" })).toBe("THB");
  });

  it("KBZPay amount uses stored amount_mmk (not total_amount * rate)", () => {
    const order = kbzpayOrder({ amount_mmk: 45450 });
    expect(getOrderPaymentAmount(order, "MMK")).toBe(45450);
    // total_amount (THB) must NOT be used as the MMK amount
    expect(getOrderPaymentAmount(order, "MMK")).not.toBe(999);
  });

  it("THB amount uses total_amount", () => {
    expect(getOrderPaymentAmount(codOrder(), "THB")).toBe(500);
  });
});

describe("roundMoney (consistent rounding principle)", () => {
  it("rounds to 2 decimals", () => {
    expect(roundMoney(100.005)).toBe(100.01);
    expect(roundMoney(100.004)).toBe(100);
    expect(roundMoney(0)).toBe(0);
  });

  it("handles floating-point addition safely", () => {
    expect(roundMoney(0.1 + 0.2)).toBe(0.3);
  });

  it("returns 0 for non-finite values", () => {
    expect(roundMoney(null)).toBe(0);
    expect(roundMoney(undefined)).toBe(0);
    expect(roundMoney(NaN)).toBe(0);
    expect(roundMoney("")).toBe(0);
  });
});

describe("buildPendingPaymentSummary", () => {
  it("groups KBZPay orders in MMK and non-KBZPay orders in THB separately", () => {
    const summary = buildPendingPaymentSummary([
      kbzpayOrder({ id: "a", amount_mmk: 10000, total_amount: 200 }),
      kbzpayOrder({ id: "b", amount_mmk: 5000, total_amount: 100 }),
      codOrder({ id: "c", total_amount: 500 }),
      codOrder({ id: "d", total_amount: 250 }),
    ]);

    expect(summary.orderCount).toBe(4);
    const byCurrency = Object.fromEntries(summary.groups.map((g) => [g.currency, g]));
    expect(byCurrency.MMK.total).toBe(15000);
    expect(byCurrency.MMK.orderCount).toBe(2);
    expect(byCurrency.THB.total).toBe(750);
    expect(byCurrency.THB.orderCount).toBe(2);
  });

  it("does not double-convert: MMK total is the sum of stored amount_mmk", () => {
    const summary = buildPendingPaymentSummary([
      kbzpayOrder({ id: "a", amount_mmk: 10000, total_amount: 999 }),
      kbzpayOrder({ id: "b", amount_mmk: 20000, total_amount: 999 }),
    ]);
    const byCurrency = Object.fromEntries(summary.groups.map((g) => [g.currency, g]));
    expect(byCurrency.MMK.total).toBe(30000);
    // total_amount (999 + 999 = 1998) must not leak into the MMK total
    expect(byCurrency.MMK.total).not.toBe(1998);
  });

  it("excludes cancelled/refunded orders", () => {
    const summary = buildPendingPaymentSummary([
      kbzpayOrder({ id: "a", amount_mmk: 10000, status: "cancelled" }),
      kbzpayOrder({ id: "b", amount_mmk: 5000 }),
    ]);
    expect(summary.orderCount).toBe(1);
    expect(summary.groups[0].total).toBe(5000);
  });

  it("returns empty result when there are no pending orders", () => {
    const summary = buildPendingPaymentSummary([]);
    expect(summary.orderCount).toBe(0);
    expect(summary.groups).toEqual([]);
  });
});
