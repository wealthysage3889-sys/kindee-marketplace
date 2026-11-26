import { describe, it, expect } from "vitest";
import {
  ORDER_STATUS_TRANSITIONS,
  countOrdersByFilter,
  getAllowedOrderStatusTransitions,
  getStoreOrderStatusDisplay,
  matchesOrderFilter,
  orderStatusLabel,
  paymentStatusLabel,
  sortOrdersByNewest,
} from "./orderFilters";

describe("orderFilters — order status transitions (shared with backend)", () => {
  it("pending only advances to confirmed or cancelled", () => {
    expect(getAllowedOrderStatusTransitions("pending").sort()).toEqual(["cancelled", "confirmed"]);
  });

  it("never offers skipping steps from pending", () => {
    const fromPending = ORDER_STATUS_TRANSITIONS.pending;
    expect(fromPending).not.toContain("delivered");
    expect(fromPending).not.toContain("refunded");
    expect(fromPending).not.toContain("picked_up");
  });

  it("in_transit can be delivered or refunded", () => {
    expect(getAllowedOrderStatusTransitions("in_transit").sort()).toEqual(["delivered", "refunded"]);
  });

  it("terminal statuses (delivered/cancelled/refunded) have no next step beyond refund where sensible", () => {
    expect(getAllowedOrderStatusTransitions("refunded")).toEqual([]);
    expect(getAllowedOrderStatusTransitions("delivered")).toEqual(["refunded"]);
  });

  it("unknown status yields no transitions", () => {
    expect(getAllowedOrderStatusTransitions("nonsense")).toEqual([]);
  });

  it("orderStatusLabel maps known statuses to Thai labels", () => {
    expect(orderStatusLabel("pending")).toBe("รอดำเนินการ");
    expect(orderStatusLabel("in_transit")).toBe("กำลังจัดส่ง");
  });

  it("delivered parent orders show a verified store status with matching styling", () => {
    expect(getStoreOrderStatusDisplay("delivered", "pending")).toEqual({
      label: "ตรวจสอบแล้ว",
      statusClass: "status-verified",
    });
  });

  it("unfinished parent orders keep the real store status", () => {
    expect(getStoreOrderStatusDisplay("in_transit", "pending")).toEqual({
      label: "รอดำเนินการ",
      statusClass: "status-pending",
    });
    expect(getStoreOrderStatusDisplay("pending", "preparing")).toEqual({
      label: "กำลังเตรียม",
      statusClass: "status-preparing",
    });
  });
});

describe("orderFilters — paymentStatusLabel", () => {
  it("shows 'เก็บเงินแล้ว' for COD delivered with paid status", () => {
    expect(paymentStatusLabel("paid", "delivered", "cod")).toBe("เก็บเงินแล้ว");
  });

  it("shows 'รอชำระปลายทาง' for COD not yet delivered", () => {
    expect(paymentStatusLabel("pending", "confirmed", "cod")).toBe("รอชำระปลายทาง");
    expect(paymentStatusLabel("pending", "in_transit", "cod")).toBe("รอชำระปลายทาง");
    expect(paymentStatusLabel("pending", "pending", "cod")).toBe("รอชำระปลายทาง");
  });

  it("shows 'ชำระแล้ว' for KBZPay delivered with paid status (not 'เก็บเงินแล้ว')", () => {
    expect(paymentStatusLabel("paid", "delivered", "kbzpay")).toBe("ชำระแล้ว");
  });

  it("shows 'ตรวจสอบแล้ว' for KBZPay delivered with awaiting_review", () => {
    expect(paymentStatusLabel("awaiting_review", "delivered", "kbzpay")).toBe("ตรวจสอบแล้ว");
    expect(paymentStatusLabel("awaiting_review", "confirmed", "kbzpay")).toBe("ตรวจสอบแล้ว");
  });

  it("shows 'รอตรวจสอบสลิป' for KBZPay not yet delivered", () => {
    expect(paymentStatusLabel("awaiting_review", "pending", "kbzpay")).toBe("รอตรวจสอบสลิป");
  });

  it("shows standard labels for other payment methods", () => {
    expect(paymentStatusLabel("paid", "delivered", "transfer")).toBe("ชำระแล้ว");
    expect(paymentStatusLabel("failed", "delivered", "promptpay")).toBe("ชำระไม่สำเร็จ");
    expect(paymentStatusLabel("refunded", "cancelled", "card")).toBe("ไม่ต้องชำระ");
  });

  it("falls back to raw status when unknown", () => {
    expect(paymentStatusLabel("unknown_status", "delivered", "cod")).toBe("รอชำระปลายทาง");
  });
});

describe("orderFilters — customer order filters", () => {
  it("toreview includes orders where parent is delivered OR all store orders are delivered", () => {
    const deliveredParent = {
      id: "delivered-parent",
      status: "delivered",
      store_orders: [{ status: "pending" }],
    };
    const allStoresDelivered = {
      id: "all-stores-delivered",
      status: "in_transit",
      store_orders: [{ status: "delivered" }, { status: "delivered" }],
    };
    const mixedStores = {
      id: "mixed-stores",
      status: "in_transit",
      store_orders: [{ status: "delivered" }, { status: "picked_up" }],
    };
    const noStoreOrdersDelivered = {
      id: "no-stores-delivered",
      status: "in_transit",
      store_orders: [],
    };

    expect(matchesOrderFilter(deliveredParent, "toreview")).toBe(true);
    expect(matchesOrderFilter(allStoresDelivered, "toreview")).toBe(true);
    expect(matchesOrderFilter(mixedStores, "toreview")).toBe(false);
    expect(matchesOrderFilter(noStoreOrdersDelivered, "toreview")).toBe(false);
    expect(matchesOrderFilter({ id: "transit", status: "in_transit", store_orders: [] }, "toreview")).toBe(false);
  });

  it("toreview badge counts delivered orders only", () => {
    const orders = [
      { id: "d1", status: "delivered", created_at: "2026-11-21T10:00:00Z", store_orders: [] },
      { id: "p1", status: "pending", created_at: "2026-11-21T09:00:00Z", store_orders: [] },
      { id: "d2", status: "delivered", created_at: "2026-11-20T10:00:00Z", store_orders: [] },
    ];

    expect(countOrdersByFilter(orders).toreview).toBe(2);
  });

  it("toreceive excludes orders with ANY delivered store order", () => {
    const parentDelivered = {
      id: "parent-delivered",
      status: "delivered",
      store_orders: [{ status: "picked_up" }],
    };
    const oneStoreDelivered = {
      id: "one-store-delivered",
      status: "in_transit",
      store_orders: [{ status: "delivered" }, { status: "picked_up" }],
    };
    const allStoresDelivered = {
      id: "all-stores-delivered",
      status: "in_transit",
      store_orders: [{ status: "delivered" }, { status: "delivered" }],
    };
    const confirmed = {
      id: "confirmed",
      status: "confirmed",
      store_orders: [{ status: "confirmed" }],
    };
    const preparing = {
      id: "preparing",
      status: "preparing",
      store_orders: [{ status: "preparing" }],
    };
    const readyForPickup = {
      id: "ready-for-pickup",
      status: "ready_for_pickup",
      store_orders: [{ status: "ready_for_pickup" }],
    };
    const inTransitOnly = {
      id: "in-transit-only",
      status: "in_transit",
      store_orders: [{ status: "picked_up" }, { status: "in_transit" }],
    };
    const noStoreOrders = {
      id: "no-store-orders",
      status: "in_transit",
      store_orders: [],
    };

    expect(matchesOrderFilter(parentDelivered, "toreceive")).toBe(false);
    expect(matchesOrderFilter(oneStoreDelivered, "toreceive")).toBe(false);
    expect(matchesOrderFilter(allStoresDelivered, "toreceive")).toBe(false);
    // The store accepted the order (pending -> confirmed) so it now belongs here.
    expect(matchesOrderFilter(confirmed, "toreceive")).toBe(true);
    expect(matchesOrderFilter(preparing, "toreceive")).toBe(true);
    expect(matchesOrderFilter(readyForPickup, "toreceive")).toBe(true);
    expect(matchesOrderFilter(inTransitOnly, "toreceive")).toBe(true);
    expect(matchesOrderFilter(noStoreOrders, "toreceive")).toBe(true);
    // pending is NOT yet accepted -> stays in toship, not toreceive.
    expect(matchesOrderFilter({ id: "pending", status: "pending", store_orders: [{ status: "pending" }] }, "toreceive")).toBe(false);
  });

  it("toreceive badge counts accepted-but-not-delivered orders", () => {
    const orders = [
      { id: "r1", status: "confirmed", created_at: "2026-11-21T10:00:00Z", store_orders: [{ status: "confirmed" }] },
      { id: "r2", status: "in_transit", created_at: "2026-11-21T09:00:00Z", store_orders: [{ status: "in_transit" }] },
      { id: "p1", status: "pending", created_at: "2026-11-21T08:00:00Z", store_orders: [{ status: "pending" }] },
      { id: "d1", status: "delivered", created_at: "2026-11-20T10:00:00Z", store_orders: [{ status: "delivered" }] },
      { id: "mixed", status: "in_transit", created_at: "2026-11-19T10:00:00Z", store_orders: [{ status: "delivered" }, { status: "picked_up" }] },
    ];

    expect(countOrdersByFilter(orders).toreceive).toBe(2);
  });

  it("an order moves from toship to toreceive when the store accepts (pending -> confirmed)", () => {
    const asObject = (status) => ({ id: status, status, store_orders: [{ status }] });

    // Before acceptance: only in toship.
    expect(matchesOrderFilter(asObject("pending"), "toship")).toBe(true);
    expect(matchesOrderFilter(asObject("pending"), "toreceive")).toBe(false);

    // After the store accepts: leaves toship, enters toreceive.
    ["confirmed", "preparing", "ready_for_pickup", "picked_up", "in_transit"].forEach((status) => {
      expect(matchesOrderFilter(asObject(status), "toship")).toBe(false);
      expect(matchesOrderFilter(asObject(status), "toreceive")).toBe(true);
    });

    // After delivery: leaves toreceive, enters toreview.
    expect(matchesOrderFilter(asObject("delivered"), "toreceive")).toBe(false);
    expect(matchesOrderFilter(asObject("delivered"), "toreview")).toBe(true);
  });

  it("no order appears in both toship and toreceive", () => {
    const orders = [
      { id: "p1", status: "pending", created_at: "2026-11-21T10:00:00Z", store_orders: [{ status: "pending" }] },
      { id: "c1", status: "confirmed", created_at: "2026-11-21T09:00:00Z", store_orders: [{ status: "confirmed" }] },
      { id: "r1", status: "in_transit", created_at: "2026-11-21T08:00:00Z", store_orders: [{ status: "in_transit" }] },
      { id: "d1", status: "delivered", created_at: "2026-11-20T10:00:00Z", store_orders: [{ status: "delivered" }] },
    ];

    const toshipIds = orders.filter((o) => matchesOrderFilter(o, "toship")).map((o) => o.id);
    const toreceiveIds = orders.filter((o) => matchesOrderFilter(o, "toreceive")).map((o) => o.id);
    const intersection = toshipIds.filter((id) => toreceiveIds.includes(id));

    expect(intersection).toEqual([]);
    expect(toshipIds).toEqual(["p1"]);
    expect(toreceiveIds.sort()).toEqual(["c1", "r1"]);
  });

  it("no order appears in both toreceive and toreview", () => {
    const orders = [
      { id: "d1", status: "delivered", created_at: "2026-11-21T10:00:00Z", store_orders: [{ status: "delivered" }] },
      { id: "r1", status: "in_transit", created_at: "2026-11-21T09:00:00Z", store_orders: [{ status: "picked_up" }] },
      { id: "mixed", status: "in_transit", created_at: "2026-11-20T10:00:00Z", store_orders: [{ status: "delivered" }, { status: "picked_up" }] },
    ];

    const toreceiveIds = orders.filter((o) => matchesOrderFilter(o, "toreceive")).map((o) => o.id);
    const toreviewIds = orders.filter((o) => matchesOrderFilter(o, "toreview")).map((o) => o.id);
    const intersection = toreceiveIds.filter((id) => toreviewIds.includes(id));

    expect(intersection).toEqual([]);
  });

  it("toship excludes delivered parent orders even when store orders are pre-shipment", () => {
    const deliveredParentPreShipStore = {
      id: "delivered-parent-pre-ship-store",
      status: "delivered",
      store_orders: [{ status: "pending" }, { status: "preparing" }],
    };
    const deliveredParentPreShipStoreSingle = {
      id: "delivered-parent-pre-ship-store-single",
      status: "delivered",
      store_orders: [{ status: "ready_for_pickup" }],
    };
    const deliveredNoStoreOrders = {
      id: "delivered-no-store-orders",
      status: "delivered",
      store_orders: [],
    };
    const pendingPreShip = {
      id: "pending-pre-ship",
      status: "pending",
      store_orders: [{ status: "pending" }],
    };
    const preparing = {
      id: "preparing",
      status: "preparing",
      store_orders: [{ status: "preparing" }],
    };

    expect(matchesOrderFilter(deliveredParentPreShipStore, "toship")).toBe(false);
    expect(matchesOrderFilter(deliveredParentPreShipStoreSingle, "toship")).toBe(false);
    expect(matchesOrderFilter(deliveredNoStoreOrders, "toship")).toBe(false);
    expect(matchesOrderFilter(pendingPreShip, "toship")).toBe(true);
    // Once the store accepts (pending -> confirmed/preparing/...), the order is no
    // longer "ที่ต้องจัดส่ง" — it belongs to "ที่ต้องได้รับ".
    expect(matchesOrderFilter(preparing, "toship")).toBe(false);
    expect(matchesOrderFilter({ id: "confirmed", status: "confirmed", store_orders: [{ status: "confirmed" }] }, "toship")).toBe(false);
    expect(matchesOrderFilter({ id: "ready", status: "ready_for_pickup", store_orders: [{ status: "ready_for_pickup" }] }, "toship")).toBe(false);
    expect(matchesOrderFilter({ id: "in-transit", status: "in_transit", store_orders: [] }, "toship")).toBe(false);
  });

  it("toship badge counts only pending orders (waiting for the store to accept)", () => {
    const orders = [
      { id: "s1", status: "pending", created_at: "2026-11-21T10:00:00Z", store_orders: [{ status: "pending" }] },
      { id: "s2", status: "preparing", created_at: "2026-11-21T09:00:00Z", store_orders: [{ status: "preparing" }] },
      { id: "c1", status: "confirmed", created_at: "2026-11-21T08:00:00Z", store_orders: [{ status: "confirmed" }] },
      { id: "d1", status: "delivered", created_at: "2026-11-20T10:00:00Z", store_orders: [{ status: "pending" }] },
      { id: "d2", status: "delivered", created_at: "2026-11-19T10:00:00Z", store_orders: [] },
      { id: "t1", status: "in_transit", created_at: "2026-11-18T10:00:00Z", store_orders: [{ status: "in_transit" }] },
    ];

    expect(countOrdersByFilter(orders).toship).toBe(1);
  });

  it("no order appears in both toship and toreview", () => {
    const orders = [
      { id: "d1", status: "delivered", created_at: "2026-11-21T10:00:00Z", store_orders: [{ status: "pending" }] },
      { id: "d2", status: "delivered", created_at: "2026-11-21T09:00:00Z", store_orders: [] },
      { id: "s1", status: "pending", created_at: "2026-11-21T10:00:00Z", store_orders: [{ status: "pending" }] },
    ];

    const toshipIds = orders.filter((o) => matchesOrderFilter(o, "toship")).map((o) => o.id);
    const toreviewIds = orders.filter((o) => matchesOrderFilter(o, "toreview")).map((o) => o.id);
    const intersection = toshipIds.filter((id) => toreviewIds.includes(id));

    expect(intersection).toEqual([]);
  });

  it("sorts orders from newest to oldest without mutating the source", () => {
    const orders = [
      { id: "old", created_at: "2026-11-01T10:00:00Z" },
      { id: "new", created_at: "2026-11-21T10:00:00Z" },
      { id: "middle", created_at: "2026-11-11T10:00:00Z" },
    ];

    expect(sortOrdersByNewest(orders).map((order) => order.id)).toEqual(["new", "middle", "old"]);
    expect(orders.map((order) => order.id)).toEqual(["old", "new", "middle"]);
  });
});