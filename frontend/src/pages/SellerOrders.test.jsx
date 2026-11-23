import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import SellerOrders from "./SellerOrders";

const { getStoresByOwner, getStoreOrders, updateStoreOrderStatus, getStoreOrderHistory } = vi.hoisted(() => ({
  getStoresByOwner: vi.fn(),
  getStoreOrders: vi.fn(),
  updateStoreOrderStatus: vi.fn(),
  getStoreOrderHistory: vi.fn(),
}));

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({ customer: { user: { _id: "owner-1", id: "owner-1" } } }),
}));

vi.mock("../context/SocketContext", () => ({
  useSocket: () => ({ on: vi.fn(), off: vi.fn() }),
}));

vi.mock("../api/product", () => ({
  storeAPI: {
    getStoresByOwner: (...args) => getStoresByOwner(...args),
  },
}));

vi.mock("../api", () => ({
  orderAPI: {
    getStoreOrders: (...args) => getStoreOrders(...args),
    updateStoreOrderStatus: (...args) => updateStoreOrderStatus(...args),
    getStoreOrderHistory: (...args) => getStoreOrderHistory(...args),
  },
}));

const STORE = [{ id: "store-1", name: "ร้านทดสอบ" }];

function storeOrder(overrides = {}) {
  return {
    id: "so-1",
    store_order_number: "SO-1",
    status: "pending",
    total_amount: 500,
    order: {
      order_number: "ORD-1",
      payment_status: "paid",
      customer_snapshot: { name: "ลูกค้า ก" },
    },
    order_items: [{ id: "oi-1", product_name: "สินค้า ก", quantity: 1, total_price: 500 }],
    ...overrides,
  };
}

function mockList(...orders) {
  getStoreOrders.mockResolvedValue({ data: { storeOrders: orders } });
}

describe("SellerOrders — two-step store workflow", () => {
  beforeEach(() => {
    getStoresByOwner.mockReset();
    getStoreOrders.mockReset();
    updateStoreOrderStatus.mockReset();
    getStoreOrderHistory.mockReset();
    getStoresByOwner.mockResolvedValue({ data: STORE });
    getStoreOrderHistory.mockResolvedValue({ data: [] });
    updateStoreOrderStatus.mockResolvedValue({ data: {} });
    vi.spyOn(window, "prompt").mockReturnValue("");
  });

  it("shows รับออเดอร์ for a pending order and NOT ส่งเสร็จ", async () => {
    mockList(storeOrder({ status: "pending" }));
    render(<SellerOrders />);
    await screen.findByText("SO-1");
    expect(screen.getByRole("button", { name: "รับออเดอร์" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "ส่งเสร็จ" })).toBeNull();
  });

  it("accepting a pending order calls the confirmed transition and re-fetches", async () => {
    mockList(storeOrder({ status: "pending" }));
    render(<SellerOrders />);
    await screen.findByText("SO-1");
    fireEvent.click(screen.getByRole("button", { name: "รับออเดอร์" }));
    await waitFor(() =>
      expect(updateStoreOrderStatus).toHaveBeenCalledWith("so-1", "confirmed", "")
    );
    await waitFor(() => expect(getStoreOrders.mock.calls.length).toBeGreaterThanOrEqual(2));
  });

  it("shows ส่งเสร็จ (not รับออเดอร์) for an accepted, in-progress order", async () => {
    mockList(storeOrder({ status: "confirmed" }));
    render(<SellerOrders />);
    await screen.findByText("SO-1");
    expect(screen.getByRole("button", { name: "ส่งเสร็จ" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "รับออเดอร์" })).toBeNull();
  });

  it("ส่งเสร็จ walks every remaining backend hop through to delivered", async () => {
    mockList(storeOrder({ status: "in_transit" }));
    render(<SellerOrders />);
    await screen.findByText("SO-1");
    fireEvent.click(screen.getByRole("button", { name: "ส่งเสร็จ" }));
    await waitFor(() => expect(updateStoreOrderStatus).toHaveBeenCalledWith("so-1", "delivered", ""));
    await waitFor(() => expect(getStoreOrders.mock.calls.length).toBeGreaterThanOrEqual(2));
  });

  it("ส่งเสร็จ from confirmed chains the full remaining path", async () => {
    mockList(storeOrder({ status: "confirmed" }));
    render(<SellerOrders />);
    await screen.findByText("SO-1");
    fireEvent.click(screen.getByRole("button", { name: "ส่งเสร็จ" }));
    await waitFor(() => expect(updateStoreOrderStatus.mock.calls.length).toBe(5));
    const hops = updateStoreOrderStatus.mock.calls.map((c) => c[1]);
    expect(hops).toEqual(["preparing", "ready_for_pickup", "picked_up", "in_transit", "delivered"]);
  });

  it("shows the delivered success badge and no forward/reject buttons", async () => {
    mockList(storeOrder({ status: "delivered" }));
    render(<SellerOrders />);
    await screen.findByText("SO-1");
    expect(screen.getByText("จัดส่งสำเร็จ")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "รับออเดอร์" })).toBeNull();
    expect(screen.queryByRole("button", { name: "ส่งเสร็จ" })).toBeNull();
    expect(screen.queryByRole("button", { name: "ปฏิเสธ/ยกเลิก" })).toBeNull();
  });

  it("cancelled orders show no accept/deliver buttons", async () => {
    mockList(storeOrder({ status: "cancelled" }));
    render(<SellerOrders />);
    await screen.findByText("SO-1");
    expect(screen.queryByRole("button", { name: "รับออเดอร์" })).toBeNull();
    expect(screen.queryByRole("button", { name: "ส่งเสร็จ" })).toBeNull();
  });

  it("refunded orders show no accept/deliver buttons", async () => {
    mockList(storeOrder({ status: "refunded" }));
    render(<SellerOrders />);
    await screen.findByText("SO-1");
    expect(screen.queryByRole("button", { name: "รับออเดอร์" })).toBeNull();
    expect(screen.queryByRole("button", { name: "ส่งเสร็จ" })).toBeNull();
  });

  it("pending order also exposes the reject/cancel action", async () => {
    mockList(storeOrder({ status: "pending" }));
    render(<SellerOrders />);
    await screen.findByText("SO-1");
    expect(screen.getByRole("button", { name: "ปฏิเสธ/ยกเลิก" })).toBeTruthy();
  });

  it("does NOT expose reject/cancel once in_transit (backend forbids it)", async () => {
    mockList(storeOrder({ status: "in_transit" }));
    render(<SellerOrders />);
    await screen.findByText("SO-1");
    expect(screen.queryByRole("button", { name: "ปฏิเสธ/ยกเลิก" })).toBeNull();
    expect(screen.getByRole("button", { name: "ส่งเสร็จ" })).toBeTruthy();
  });

  it("surfaces an error and re-fetches when a deliver hop is rejected by the backend", async () => {
    updateStoreOrderStatus.mockRejectedValue(new Error("Invalid status transition"));
    mockList(storeOrder({ status: "confirmed" }));
    render(<SellerOrders />);
    await screen.findByText("SO-1");
    fireEvent.click(screen.getByRole("button", { name: "ส่งเสร็จ" }));
    expect(await screen.findByText("Invalid status transition")).toBeTruthy();
    await waitFor(() => expect(getStoreOrders.mock.calls.length).toBeGreaterThanOrEqual(2));
  });

  it("keeps search working across order number / customer / items", async () => {
    mockList(
      storeOrder({ id: "so-1", store_order_number: "SO-AAA", status: "pending", order: { order_number: "ORD-AAA", payment_status: "paid", customer_snapshot: { name: "สมชาย" } }, order_items: [{ id: "i1", product_name: "กล้อง", quantity: 1, total_price: 500 }] }),
      storeOrder({ id: "so-2", store_order_number: "SO-BBB", status: "pending", order: { order_number: "ORD-BBB", payment_status: "paid", customer_snapshot: { name: "สมหญิง" } }, order_items: [{ id: "i2", product_name: "โทรศัพท์", quantity: 1, total_price: 900 }] })
    );
    render(<SellerOrders />);
    await screen.findByText("SO-AAA");
    const search = screen.getByPlaceholderText("ค้นหาเลขที่/ลูกค้า/สินค้า");
    fireEvent.change(search, { target: { value: "สมหญิง" } });
    expect(await screen.findByText("SO-BBB")).toBeTruthy();
    expect(screen.queryByText("SO-AAA")).toBeNull();
  });
});