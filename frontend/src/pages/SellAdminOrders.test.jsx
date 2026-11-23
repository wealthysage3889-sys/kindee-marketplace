import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import SellAdminOrders from "./SellAdminOrders";

// Shared hoisted mocks for the two leaf datasets this route can render.
const {
  getAllOrders,
  updateOrderStatus,
  getStoresByOwner,
  getStoreOrders,
  updateStoreOrderStatus,
  getStoreOrderHistory,
  getPaymentSlips,
} = vi.hoisted(() => ({
  getAllOrders: vi.fn(),
  updateOrderStatus: vi.fn(),
  getStoresByOwner: vi.fn(),
  getStoreOrders: vi.fn(),
  updateStoreOrderStatus: vi.fn(),
  getStoreOrderHistory: vi.fn(),
  getPaymentSlips: vi.fn(),
}));

// Mutable auth so each test can pick the admin vs store-owner branch.
let authState = { admin: null, customer: null };
vi.mock("../context/AuthContext", () => ({
  useAuth: () => authState,
}));

vi.mock("../context/SocketContext", () => ({
  useSocket: () => ({ on: vi.fn(), off: vi.fn() }),
}));

vi.mock("../api", () => ({
  orderAPI: {
    getAllOrders: (...a) => getAllOrders(...a),
    getById: vi.fn().mockResolvedValue({ data: null }),
    updateStoreOrderStatus: (...a) => updateStoreOrderStatus(...a),
    getStoreOrders: (...a) => getStoreOrders(...a),
    getStoreOrderHistory: (...a) => getStoreOrderHistory(...a),
  },
  adminAPI: {
    updateOrderStatus: (...a) => updateOrderStatus(...a),
    getPaymentSlips: (...a) => getPaymentSlips(...a),
  },
}));

vi.mock("../api/product", () => ({
  storeAPI: {
    getStoresByOwner: (...a) => getStoresByOwner(...a),
  },
}));

vi.mock("react-router-dom", () => ({
  Link: ({ children, ...props }) => <a {...props}>{children}</a>,
}));

function adminOrder(overrides = {}) {
  return {
    id: "order-1",
    order_number: "ORD-1001",
    status: "pending",
    payment_status: "paid",
    total_amount: 500,
    created_at: "2026-01-01T00:00:00Z",
    customer: { name: "Alice", phone: "080" },
    store_orders: [{ id: "so-1", store: { name: "ร้าน A" } }],
    ...overrides,
  };
}

function storeOrder(overrides = {}) {
  return {
    id: "so-1",
    store_order_number: "SO-1",
    status: "pending",
    total_amount: 500,
    order: { order_number: "ORD-1", payment_status: "paid", customer_snapshot: { name: "ลูกค้า ก" } },
    order_items: [{ id: "oi-1", product_name: "สินค้า ก", quantity: 1, total_price: 500 }],
    ...overrides,
  };
}

describe("/selladmin/orders route (SellAdminOrders) — admin branch", () => {
  beforeEach(() => {
    getAllOrders.mockReset();
    updateOrderStatus.mockReset();
    updateOrderStatus.mockResolvedValue({ data: {} });
    getPaymentSlips.mockReset();
    getPaymentSlips.mockResolvedValue({ data: { slips: [] } });
    vi.spyOn(window, "prompt").mockReturnValue("");
    authState = {
      admin: { isAuthenticated: true, user: { role: "admin" } },
      customer: { isAuthenticated: false, user: null },
    };
  });

  it("renders the AdminOrders DOM with the .admin-orders-status-select dropdown", async () => {
    getAllOrders.mockResolvedValue({ data: { orders: [adminOrder({ status: "pending" })] } });
    const { container } = render(<SellAdminOrders />);
    await screen.findByText("#ORD-1001");
    // The actual dropdown class rendered at this URL.
    const select = container.querySelector(".admin-orders-status-select");
    expect(select).toBeTruthy();
    expect(within(select).getByText("รับออเดอร์")).toBeTruthy();
    expect(within(select).getByText("ยกเลิก")).toBeTruthy();
  });

  it("renders exactly 4 summary chips in .admin-orders-stats", async () => {
    getAllOrders.mockResolvedValue({ data: { orders: [adminOrder({ status: "pending" })] } });
    const { container } = render(<SellAdminOrders />);
    await screen.findByText("#ORD-1001");
    const chips = container.querySelectorAll(".admin-orders-stats .stat-chip");
    expect(chips.length).toBe(4);
    const texts = Array.from(chips).map((c) => c.textContent);
    expect(texts.some((t) => t.includes("รอรับออเดอร์"))).toBe(true);
    expect(texts.some((t) => t.includes("รับออเดอร์แล้ว"))).toBe(true);
    expect(texts.some((t) => t.includes("จัดส่งสำเร็จ"))).toBe(true);
    expect(texts.some((t) => t.includes("ยกเลิก"))).toBe(true);
  });

  it("pending -> รับออเดอร์ calls confirmed then re-fetches", async () => {
    getAllOrders.mockResolvedValue({ data: { orders: [adminOrder({ status: "pending" })] } });
    const { container } = render(<SellAdminOrders />);
    await screen.findByText("#ORD-1001");
    const select = container.querySelector(".admin-orders-status-select");
    fireEvent.change(select, { target: { value: "confirmed" } });
    await waitFor(() => expect(updateOrderStatus).toHaveBeenCalledWith("order-1", "confirmed", undefined));
  });

  it("after รับออเดอร์ (confirmed) the dropdown shows ส่งเสร็จ", async () => {
    getAllOrders.mockResolvedValue({ data: { orders: [adminOrder({ status: "confirmed" })] } });
    const { container } = render(<SellAdminOrders />);
    await screen.findByText("#ORD-1001");
    const select = container.querySelector(".admin-orders-status-select");
    const options = within(select).getAllByRole("option").map((o) => o.getAttribute("value"));
    expect(options).toEqual(["", "delivered"]);
    expect(within(select).getByText("ส่งเสร็จ")).toBeTruthy();
  });

  it("ส่งเสร็จ (delivered) chains hops and ends delivered with no dropdown", async () => {
    getAllOrders.mockResolvedValue({ data: { orders: [adminOrder({ status: "confirmed" })] } });
    const { container } = render(<SellAdminOrders />);
    await screen.findByText("#ORD-1001");
    const select = container.querySelector(".admin-orders-status-select");
    fireEvent.change(select, { target: { value: "delivered" } });
    await waitFor(() => expect(updateOrderStatus.mock.calls.length).toBe(5));
    expect(updateOrderStatus.mock.calls.map((c) => c[1])).toEqual([
      "preparing", "ready_for_pickup", "picked_up", "in_transit", "delivered",
    ]);
  });

  it("delivered order shows จัดส่งสำเร็จ and no dropdown", async () => {
    getAllOrders.mockResolvedValue({ data: { orders: [adminOrder({ status: "delivered" })] } });
    const { container } = render(<SellAdminOrders />);
    await screen.findByText("#ORD-1001");
    expect(screen.getAllByText("จัดส่งสำเร็จ").length).toBeGreaterThanOrEqual(1);
    expect(container.querySelector(".admin-orders-status-select")).toBeNull();
  });

  it("cancelled / refunded / failed orders have no forward dropdown", async () => {
    for (const status of ["cancelled", "refunded", "failed"]) {
      getAllOrders.mockReset();
      getPaymentSlips.mockReset();
      getPaymentSlips.mockResolvedValue({ data: { slips: [] } });
      getAllOrders.mockResolvedValue({ data: { orders: [adminOrder({ status, order_number: `ORD-${status}` })] } });
      const { container, unmount } = render(<SellAdminOrders />);
      await screen.findByText(`#ORD-${status}`);
      expect(container.querySelector(".admin-orders-status-select")).toBeNull();
      unmount();
    }
  });
});

describe("/selladmin/orders route (SellAdminOrders) — store owner branch", () => {
  beforeEach(() => {
    getStoresByOwner.mockReset();
    getStoreOrders.mockReset();
    updateStoreOrderStatus.mockReset();
    getStoreOrderHistory.mockReset();
    updateStoreOrderStatus.mockResolvedValue({ data: {} });
    getStoreOrderHistory.mockResolvedValue({ data: [] });
    getStoresByOwner.mockResolvedValue({ data: [{ id: "store-1", name: "ร้านทดสอบ" }] });
    vi.spyOn(window, "prompt").mockReturnValue("");
    authState = {
      admin: { isAuthenticated: false, user: null },
      customer: { isAuthenticated: true, user: { _id: "owner-1", id: "owner-1" } },
    };
  });

  it("renders the SellerOrders DOM (no admin dropdown) for a store owner", async () => {
    getStoreOrders.mockResolvedValue({ data: { storeOrders: [storeOrder({ status: "pending" })] } });
    const { container } = render(<SellAdminOrders />);
    await screen.findByText("SO-1");
    expect(container.querySelector(".admin-orders-status-select")).toBeNull();
    expect(screen.getByRole("button", { name: "รับออเดอร์" })).toBeTruthy();
  });

  it("store owner pending shows รับออเดอร์; accepted shows ส่งเสร็จ", async () => {
    getStoreOrders.mockResolvedValue({ data: { storeOrders: [storeOrder({ status: "confirmed" })] } });
    render(<SellAdminOrders />);
    await screen.findByText("SO-1");
    expect(screen.getByRole("button", { name: "ส่งเสร็จ" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "รับออเดอร์" })).toBeNull();
  });

  it("store owner delivered shows จัดส่งสำเร็จ and no buttons", async () => {
    getStoreOrders.mockResolvedValue({ data: { storeOrders: [storeOrder({ status: "delivered" })] } });
    render(<SellAdminOrders />);
    await screen.findByText("SO-1");
    expect(screen.getByText("จัดส่งสำเร็จ")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "รับออเดอร์" })).toBeNull();
    expect(screen.queryByRole("button", { name: "ส่งเสร็จ" })).toBeNull();
  });
});