import { describe, it, expect } from "vitest";
import {
  groupOrdersForDelivery,
  normalizeAddressPart,
  buildAddressKey,
  getCustomerId,
  getGroupTotal,
  hasMixedStatuses,
  hasMixedPaymentStatuses,
} from "./orderGrouping";

const ADDR = {
  name: "ลูกค้า ก",
  phone: "0801111111",
  address: "123/45 Moo 1",
  district: "Phra Nakhon",
  province: "Bangkok",
  postalCode: "10200",
};

function order(overrides = {}) {
  return {
    id: "o-1",
    order_number: "ORD-1",
    status: "pending",
    payment_status: "pending",
    payment_method: "kbzpay",
    total_amount: 100,
    created_at: "2026-01-01T00:00:00Z",
    customer_id: "cust-1",
    customer: { id: "cust-1", name: "ลูกค้า ก", phone: "0801111111" },
    customer_snapshot: { address: ADDR },
    store_orders: [{ id: "so-1", store: { id: "store-1", name: "ร้าน A" } }],
    ...overrides,
  };
}

describe("normalizeAddressPart", () => {
  it("collapses whitespace, strips punctuation and lowercases", () => {
    expect(normalizeAddressPart(" 123/45  Moo 1 ")).toBe("12345moo1");
    expect(normalizeAddressPart("Phra Nakhon")).toBe("phranakhon");
    expect(normalizeAddressPart(null)).toBe("");
    expect(normalizeAddressPart(undefined)).toBe("");
  });
});

describe("buildAddressKey", () => {
  it("treats spacing/case-only differences as equal", () => {
    const a = buildAddressKey({ ...ADDR, address: "123/45 Moo 1" });
    const b = buildAddressKey({ ...ADDR, address: " 123/45  moo 1 " });
    expect(a).toBe(b);
  });

  it("treats genuinely different addresses as different", () => {
    const a = buildAddressKey(ADDR);
    const b = buildAddressKey({ ...ADDR, address: "999/9 Moo 9", province: "Chiang Mai" });
    expect(a).not.toBe(b);
  });

  it("returns empty string for missing address", () => {
    expect(buildAddressKey(null)).toBe("");
    expect(buildAddressKey({})).toBe("");
  });
});

describe("getCustomerId", () => {
  it("prefers customer_id, then customer.id, never name/phone", () => {
    expect(getCustomerId({ customer_id: "c1", customer: { id: "c2", name: "X" } })).toBe("c1");
    expect(getCustomerId({ customer: { id: "c2", name: "X" } })).toBe("c2");
    expect(getCustomerId({ customer: { name: "X", phone: "080" } })).toBe(null);
  });
});

describe("groupOrdersForDelivery", () => {
  it("merges same customer + address + store across checkouts", () => {
    const { groups } = groupOrdersForDelivery([
      order({ id: "o-1", order_number: "ORD-A", total_amount: 100 }),
      order({ id: "o-2", order_number: "ORD-B", total_amount: 250, created_at: "2026-01-02T00:00:00Z" }),
    ]);
    expect(groups.length).toBe(1);
    expect(groups[0].isGroup).toBe(true);
    expect(groups[0].orders.length).toBe(2);
    // Newest is headline.
    expect(groups[0].primaryOrder.order_number).toBe("ORD-B");
    expect(getGroupTotal(groups[0])).toBe(350);
  });

  it("separates different addresses for the same customer", () => {
    const { groups } = groupOrdersForDelivery([
      order({ id: "o-1" }),
      order({ id: "o-2", customer_snapshot: { address: { ...ADDR, address: "999/9" } } }),
    ]);
    expect(groups.length).toBe(2);
  });

  it("separates different customers with the same address", () => {
    const { groups } = groupOrdersForDelivery([
      order({ id: "o-1", customer_id: "c1", customer: { id: "c1" } }),
      order({ id: "o-2", customer_id: "c2", customer: { id: "c2" } }),
    ]);
    expect(groups.length).toBe(2);
  });

  it("keeps COD separate even with identical customer/address/store", () => {
    const { groups } = groupOrdersForDelivery([
      order({ id: "o-1", payment_method: "kbzpay" }),
      order({ id: "o-2", payment_method: "cod" }),
    ]);
    expect(groups.length).toBe(2);
    expect(groups.every(g => !g.isGroup)).toBe(true);
  });

  it("does not merge delivered with in-progress", () => {
    const { groups } = groupOrdersForDelivery([
      order({ id: "o-1", status: "pending" }),
      order({ id: "o-2", status: "delivered", payment_status: "paid" }),
    ]);
    expect(groups.length).toBe(2);
  });

  it("does not merge cancelled with in-progress", () => {
    const { groups } = groupOrdersForDelivery([
      order({ id: "o-1", status: "confirmed" }),
      order({ id: "o-2", status: "cancelled" }),
    ]);
    expect(groups.length).toBe(2);
  });

  it("separates orders drawing from different store sets", () => {
    const { groups } = groupOrdersForDelivery([
      order({ id: "o-1", store_orders: [{ id: "so-1", store: { id: "store-1", name: "A" } }] }),
      order({ id: "o-2", store_orders: [{ id: "so-2", store: { id: "store-2", name: "B" } }] }),
    ]);
    expect(groups.length).toBe(2);
  });

  it("reports orders with incomplete data instead of guessing a group", () => {
    const { groups, incomplete } = groupOrdersForDelivery([
      order({ id: "o-1", customer_snapshot: {} }), // no address
      order({ id: "o-2", customer_id: null, customer: null, customer_snapshot: { address: ADDR } }), // no customer
    ]);
    // Each incomplete order is its own standalone row.
    expect(groups.length).toBe(2);
    expect(incomplete.length).toBe(2);
    const reasons = incomplete.flatMap(i => i.reasons);
    expect(reasons).toContain("missing_delivery_address");
    expect(reasons).toContain("missing_customer_id");
  });

  it("detects mixed status and mixed payment status within a group", () => {
    const { groups } = groupOrdersForDelivery([
      order({ id: "o-1", status: "pending", payment_status: "pending" }),
      order({ id: "o-2", status: "confirmed", payment_status: "paid" }),
    ]);
    expect(groups.length).toBe(1);
    expect(hasMixedStatuses(groups[0])).toBe(true);
    expect(hasMixedPaymentStatuses(groups[0])).toBe(true);
  });

  it("returns no mixed flags for a single-order group", () => {
    const { groups } = groupOrdersForDelivery([order({ id: "o-1" })]);
    expect(hasMixedStatuses(groups[0])).toBe(false);
    expect(hasMixedPaymentStatuses(groups[0])).toBe(false);
  });
});