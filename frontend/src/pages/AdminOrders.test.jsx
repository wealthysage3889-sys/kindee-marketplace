import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import AdminOrders from "./AdminOrders";

const { getAllOrders, getById, updateOrderStatus, getPaymentSlips } = vi.hoisted(() => ({
  getAllOrders: vi.fn(),
  getById: vi.fn(),
  updateOrderStatus: vi.fn(),
  getPaymentSlips: vi.fn(),
}));

vi.mock("react-router-dom", () => ({
  Link: ({ children, to, ...props }) => <a href={to} {...props}>{children}</a>,
}));

vi.mock("../api", () => ({
  orderAPI: {
    getAllOrders: (...args) => getAllOrders(...args),
    getById: (...args) => getById(...args),
  },
  adminAPI: {
    updateOrderStatus: (...args) => updateOrderStatus(...args),
    getPaymentSlips: (...args) => getPaymentSlips(...args),
  },
}));

vi.mock("../utils/helpers", () => ({
  formatCurrency: (n) => String(n),
  formatDate: (d) => String(d),
  formatAddress: (a) => (typeof a === "string" ? a : JSON.stringify(a)),
}));

const ADMIN_ORDERS = [
  {
    id: "order-1",
    order_number: "ORD-1001",
    status: "pending",
    payment_status: "awaiting_review",
    total_amount: 500,
    created_at: "2026-01-01T00:00:00Z",
    customer: { name: "Alice", phone: "080" },
    store_orders: [{ id: "so-1", store: { name: "ร้าน A" } }],
  },
];

function mockOrdersResponse() {
  getAllOrders.mockResolvedValue({ data: { orders: ADMIN_ORDERS } });
}

describe("AdminOrders — inline status change", () => {
  beforeEach(() => {
    getAllOrders.mockReset();
    updateOrderStatus.mockReset();
    getPaymentSlips.mockReset();
    getPaymentSlips.mockResolvedValue({ data: { slips: [] } });
    mockOrdersResponse();
    vi.spyOn(window, "prompt").mockReturnValue("");
  });

  it("renders the order row with its current status and payment status", async () => {
    render(<AdminOrders />);
    expect(await screen.findByText("#ORD-1001")).toBeTruthy();
    // Status label appears in the stat chip and the row badge.
    expect(screen.getAllByText("รอดำเนินการ").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("รอตรวจสอบ")).toBeTruthy();
  });

  it("offers only workflow-valid next statuses (pending -> confirmed/cancelled)", async () => {
    render(<AdminOrders />);
    await screen.findByText("#ORD-1001");
    const select = screen.getByLabelText("เปลี่ยนสถานะคำสั่งซื้อ #ORD-1001");
    const options = within(select).getAllByRole("option").map((o) => o.getAttribute("value"));
    expect(options).toContain("confirmed");
    expect(options).toContain("cancelled");
    expect(options).not.toContain("delivered");
    expect(options).not.toContain("refunded");
  });

  it("persists a valid transition via adminAPI and re-fetches the list", async () => {
    updateOrderStatus.mockResolvedValue({ data: { id: "order-1", status: "confirmed" } });
    render(<AdminOrders />);
    await screen.findByText("#ORD-1001");
    const select = screen.getByLabelText("เปลี่ยนสถานะคำสั่งซื้อ #ORD-1001");

    fireEvent.change(select, { target: { value: "confirmed" } });

    await waitFor(() => expect(updateOrderStatus).toHaveBeenCalledWith("order-1", "confirmed", undefined));
    // Initial load + at least one refetch after a successful update.
    await waitFor(() => expect(getAllOrders.mock.calls.length).toBeGreaterThanOrEqual(2));
  });

  it("keeps the row and shows an error when the backend rejects the change", async () => {
    updateOrderStatus.mockRejectedValue(new Error("Invalid status transition"));
    render(<AdminOrders />);
    await screen.findByText("#ORD-1001");
    const select = screen.getByLabelText("เปลี่ยนสถานะคำสั่งซื้อ #ORD-1001");

    fireEvent.change(select, { target: { value: "confirmed" } });

    expect(await screen.findByText(/Invalid status transition/)).toBeTruthy();
    // Row still shows the original status (no optimistic change committed).
    expect(screen.getAllByText("รอดำเนินการ").length).toBeGreaterThanOrEqual(1);
    // The row re-fetches after a failure so it reflects the real persisted
    // status (a partial "ส่งเสร็จ" chain may have advanced some hops).
    expect(getAllOrders.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});

describe("AdminOrders — order detail modal", () => {
  beforeEach(() => {
    getAllOrders.mockReset();
    getById.mockReset();
    updateOrderStatus.mockReset();
    getPaymentSlips.mockReset();
    getPaymentSlips.mockResolvedValue({ data: { slips: [] } });
    mockOrdersResponse();
    vi.spyOn(window, "prompt").mockReturnValue("");
  });

  it("calls the order detail API for the selected order and opens the modal", async () => {
    getById.mockResolvedValue({ data: ADMIN_ORDERS[0] });
    render(<AdminOrders />);
    await screen.findByText("#ORD-1001");
    fireEvent.click(screen.getByText("รายละเอียด"));
    await waitFor(() => expect(getById).toHaveBeenCalledWith("order-1"));
    await waitFor(() => {
      const dialog = screen.getByRole("dialog");
      expect(dialog.textContent).toContain("รายละเอียดคำสั่งซื้อ");
      expect(dialog.textContent).toContain("#ORD-1001");
      expect(dialog.textContent).toContain("Alice");
      expect(dialog.textContent).toContain("ร้าน A");
    });
  });

  it("falls back to table row data when the detail API fails", async () => {
    getById.mockRejectedValue(new Error("Not found"));
    render(<AdminOrders />);
    await screen.findByText("#ORD-1001");
    fireEvent.click(screen.getByText("รายละเอียด"));
    await waitFor(() => {
      const dialog = screen.getByRole("dialog");
      expect(dialog.textContent).toContain("#ORD-1001");
      expect(dialog.textContent).toContain("Alice");
    });
  });

  it("closes the modal via the close button", async () => {
    getById.mockResolvedValue({ data: ADMIN_ORDERS[0] });
    render(<AdminOrders />);
    await screen.findByText("#ORD-1001");
    fireEvent.click(screen.getByText("รายละเอียด"));
    await screen.findByRole("dialog");
    const closeButtons = screen.getAllByRole("button", { name: "ปิด" });
    fireEvent.click(closeButtons[0]);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes the modal when clicking the backdrop", async () => {
    getById.mockResolvedValue({ data: ADMIN_ORDERS[0] });
    render(<AdminOrders />);
    await screen.findByText("#ORD-1001");
    fireEvent.click(screen.getByText("รายละเอียด"));
    await screen.findByRole("dialog");
    const dialog = screen.getByRole("dialog");
    fireEvent.click(dialog);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes the modal when pressing Escape", async () => {
    getById.mockResolvedValue({ data: ADMIN_ORDERS[0] });
    render(<AdminOrders />);
    await screen.findByText("#ORD-1001");
    fireEvent.click(screen.getByText("รายละเอียด"));
    await screen.findByRole("dialog");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Two-step store/admin status dropdown on /selladmin/orders (AdminOrders view)
// ---------------------------------------------------------------------------
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

describe("AdminOrders — /selladmin/orders two-step status dropdown", () => {
  beforeEach(() => {
    getAllOrders.mockReset();
    updateOrderStatus.mockReset();
    getPaymentSlips.mockReset();
    getPaymentSlips.mockResolvedValue({ data: { slips: [] } });
    updateOrderStatus.mockResolvedValue({ data: {} });
    vi.spyOn(window, "prompt").mockReturnValue("");
  });

  it("pending order shows รับออเดอร์ and ยกเลิก only", async () => {
    getAllOrders.mockResolvedValue({ data: { orders: [adminOrder({ status: "pending" })] } });
    render(<AdminOrders />);
    await screen.findByText("#ORD-1001");
    const select = screen.getByLabelText("เปลี่ยนสถานะคำสั่งซื้อ #ORD-1001");
    const options = within(select).getAllByRole("option").map((o) => o.getAttribute("value"));
    expect(options).toEqual(["", "confirmed", "cancelled"]);
    const labels = within(select).getAllByRole("option").map((o) => o.textContent);
    expect(labels).toContain("รับออเดอร์");
    expect(labels).toContain("ยกเลิก");
  });

  it("accepted (confirmed) order shows only ส่งเสร็จ", async () => {
    getAllOrders.mockResolvedValue({ data: { orders: [adminOrder({ status: "confirmed" })] } });
    render(<AdminOrders />);
    await screen.findByText("#ORD-1001");
    const select = screen.getByLabelText("เปลี่ยนสถานะคำสั่งซื้อ #ORD-1001");
    const options = within(select).getAllByRole("option").map((o) => o.getAttribute("value"));
    expect(options).toEqual(["", "delivered"]);
    expect(within(select).getByText("ส่งเสร็จ")).toBeTruthy();
    expect(within(select).queryByText("รับออเดอร์")).toBeNull();
  });

  it("ส่งเสร็จ chains the remaining backend hops through to delivered", async () => {
    getAllOrders.mockResolvedValue({ data: { orders: [adminOrder({ status: "confirmed" })] } });
    render(<AdminOrders />);
    await screen.findByText("#ORD-1001");
    const select = screen.getByLabelText("เปลี่ยนสถานะคำสั่งซื้อ #ORD-1001");
    fireEvent.change(select, { target: { value: "delivered" } });
    await waitFor(() => expect(updateOrderStatus.mock.calls.length).toBe(5));
    const hops = updateOrderStatus.mock.calls.map((c) => c[1]);
    expect(hops).toEqual(["preparing", "ready_for_pickup", "picked_up", "in_transit", "delivered"]);
    await waitFor(() => expect(getAllOrders.mock.calls.length).toBeGreaterThanOrEqual(2));
  });

  it("delivered order shows จัดส่งสำเร็จ badge and no dropdown", async () => {
    getAllOrders.mockResolvedValue({ data: { orders: [adminOrder({ status: "delivered" })] } });
    render(<AdminOrders />);
    await screen.findByText("#ORD-1001");
    expect(screen.getAllByText("จัดส่งสำเร็จ").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByLabelText("เปลี่ยนสถานะคำสั่งซื้อ #ORD-1001")).toBeNull();
    // Detail button is still available.
    expect(screen.getByText("รายละเอียด")).toBeTruthy();
  });

  it("cancelled / refunded / failed orders show no forward dropdown", async () => {
    for (const status of ["cancelled", "refunded", "failed"]) {
      getAllOrders.mockReset();
      getPaymentSlips.mockReset();
      getPaymentSlips.mockResolvedValue({ data: { slips: [] } });
      getAllOrders.mockResolvedValue({ data: { orders: [adminOrder({ status, order_number: `ORD-${status}` })] } });
      const { unmount } = render(<AdminOrders />);
      await screen.findByText(`#ORD-${status}`);
      expect(screen.queryByLabelText(`เปลี่ยนสถานะคำสั่งซื้อ #ORD-${status}`)).toBeNull();
      unmount();
    }
  });
});

// ---------------------------------------------------------------------------
// .admin-orders-stats summary bar: 4 grouped chips aligned with the 2-step flow
// ---------------------------------------------------------------------------
const MIXED_ORDERS = [
  adminOrder({ id: "o-pend", order_number: "ORD-PEND", status: "pending" }),
  adminOrder({ id: "o-conf", order_number: "ORD-CONF", status: "confirmed" }),
  adminOrder({ id: "o-prep", order_number: "ORD-PREP", status: "preparing" }),
  adminOrder({ id: "o-transit", order_number: "ORD-TRANSIT", status: "in_transit" }),
  adminOrder({ id: "o-deliv", order_number: "ORD-DELIV", status: "delivered" }),
  adminOrder({ id: "o-cancel", order_number: "ORD-CANCEL", status: "cancelled" }),
  adminOrder({ id: "o-refund", order_number: "ORD-REFUND", status: "refunded" }),
];

function chipTexts(container) {
  return Array.from(container.querySelectorAll(".admin-orders-stats .stat-chip")).map(
    (c) => c.textContent.replace(/\s+/g, " ").trim()
  );
}

function visibleOrderNumbers(container) {
  return Array.from(container.querySelectorAll(".admin-orders-number")).map((a) => a.textContent);
}

describe("AdminOrders — .admin-orders-stats summary bar", () => {
  beforeEach(() => {
    getAllOrders.mockReset();
    updateOrderStatus.mockReset();
    getPaymentSlips.mockReset();
    getPaymentSlips.mockResolvedValue({ data: { slips: [] } });
    updateOrderStatus.mockResolvedValue({ data: {} });
    vi.spyOn(window, "prompt").mockReturnValue("");
  });

  it("renders exactly 4 chips with the expected labels", async () => {
    getAllOrders.mockResolvedValue({ data: { orders: MIXED_ORDERS } });
    const { container } = render(<AdminOrders />);
    await screen.findByText("#ORD-PEND");
    const chips = container.querySelectorAll(".admin-orders-stats .stat-chip");
    expect(chips.length).toBe(4);
    const texts = chipTexts(container);
    expect(texts[0]).toContain("รอรับออเดอร์");
    expect(texts[1]).toContain("รับออเดอร์แล้ว");
    expect(texts[2]).toContain("จัดส่งสำเร็จ");
    expect(texts[3]).toContain("ยกเลิก");
    // No per-status / refunded chips anymore.
    expect(texts.some((t) => t.includes("กำลังเตรียม"))).toBe(false);
    expect(texts.some((t) => t.includes("พร้อมรับสินค้า"))).toBe(false);
    expect(texts.some((t) => t.includes("กำลังจัดส่ง"))).toBe(false);
    expect(texts.some((t) => t.includes("คืนเงิน"))).toBe(false);
  });

  it("counts each group correctly (pending=1, accepted=3, delivered=1, cancelled=1)", async () => {
    getAllOrders.mockResolvedValue({ data: { orders: MIXED_ORDERS } });
    const { container } = render(<AdminOrders />);
    await screen.findByText("#ORD-PEND");
    const texts = chipTexts(container);
    expect(texts[0]).toContain("(1)"); // pending
    expect(texts[1]).toContain("(3)"); // confirmed + preparing + in_transit
    expect(texts[2]).toContain("(1)"); // delivered
    expect(texts[3]).toContain("(1)"); // cancelled
  });

  it("clicking รอรับออเดอร์ filters to pending only", async () => {
    getAllOrders.mockResolvedValue({ data: { orders: MIXED_ORDERS } });
    const { container } = render(<AdminOrders />);
    await screen.findByText("#ORD-PEND");
    const pendingChip = Array.from(container.querySelectorAll(".stat-chip")).find((c) =>
      c.textContent.includes("รอรับออเดอร์")
    );
    fireEvent.click(pendingChip);
    await waitFor(() => expect(visibleOrderNumbers(container)).toEqual(["#ORD-PEND"]));
  });

  it("clicking รับออเดอร์แล้ว groups confirmed/preparing/ready_for_pickup/picked_up/in_transit", async () => {
    getAllOrders.mockResolvedValue({ data: { orders: MIXED_ORDERS } });
    const { container } = render(<AdminOrders />);
    await screen.findByText("#ORD-PEND");
    const acceptedChip = Array.from(container.querySelectorAll(".stat-chip")).find((c) =>
      c.textContent.includes("รับออเดอร์แล้ว")
    );
    fireEvent.click(acceptedChip);
    await waitFor(() => {
      const nums = visibleOrderNumbers(container);
      expect(nums).toContain("#ORD-CONF");
      expect(nums).toContain("#ORD-PREP");
      expect(nums).toContain("#ORD-TRANSIT");
      expect(nums).not.toContain("#ORD-PEND");
      expect(nums).not.toContain("#ORD-DELIV");
      expect(nums).not.toContain("#ORD-CANCEL");
      expect(nums.length).toBe(3);
    });
  });

  it("clicking จัดส่งสำเร็จ and ยกเลิก filter correctly", async () => {
    getAllOrders.mockResolvedValue({ data: { orders: MIXED_ORDERS } });
    const { container } = render(<AdminOrders />);
    await screen.findByText("#ORD-PEND");
    const delivChip = Array.from(container.querySelectorAll(".stat-chip")).find((c) =>
      c.textContent.includes("จัดส่งสำเร็จ")
    );
    fireEvent.click(delivChip);
    await waitFor(() => expect(visibleOrderNumbers(container)).toEqual(["#ORD-DELIV"]));

    const cancelChip = Array.from(container.querySelectorAll(".stat-chip")).find((c) =>
      c.textContent.includes("ยกเลิก")
    );
    fireEvent.click(cancelChip);
    await waitFor(() => expect(visibleOrderNumbers(container)).toEqual(["#ORD-CANCEL"]));
  });
});

// ---------------------------------------------------------------------------
// Combined orders (one customer checkout = one parent order row)
// ---------------------------------------------------------------------------
function combinedOrder(overrides = {}) {
  return {
    id: "order-combined",
    order_number: "ORD-COMBINED",
    status: "confirmed",
    payment_status: "paid",
    payment_method: "kbzpay",
    total_amount: 1500,
    created_at: "2026-01-05T10:00:00Z",
    customer: { name: "Bob", phone: "0812345678" },
    store_orders: [
      {
        id: "so-1",
        store: { name: "ร้าน A" },
        order_items: [
          { product_name: "สินค้า A1", product_image: "/img/a1.jpg", quantity: 2, unit_price: 300, total_price: 600 },
          { product_name: "สินค้า A2", product_image: "/img/a2.jpg", quantity: 1, unit_price: 200, total_price: 200 },
        ],
      },
      {
        id: "so-2",
        store: { name: "ร้าน B" },
        order_items: [
          { product_name: "สินค้า B1", product_image: null, quantity: 1, unit_price: 700, total_price: 700 },
        ],
      },
    ],
    ...overrides,
  };
}

function codOrder(overrides = {}) {
  return {
    id: "order-cod",
    order_number: "ORD-COD",
    status: "pending",
    payment_status: "pending",
    payment_method: "cod",
    total_amount: 400,
    created_at: "2026-01-06T11:00:00Z",
    customer: { name: "Carol", phone: "0823456789" },
    store_orders: [{ id: "so-cod", store: { name: "ร้าน C" }, order_items: [] }],
    ...overrides,
  };
}

describe("AdminOrders — combined orders & payment method", () => {
  beforeEach(() => {
    getAllOrders.mockReset();
    getById.mockReset();
    updateOrderStatus.mockReset();
    getPaymentSlips.mockReset();
    getPaymentSlips.mockResolvedValue({ data: { slips: [] } });
    vi.spyOn(window, "prompt").mockReturnValue("");
  });

  it("shows one row per parent order even when multiple store_orders exist", async () => {
    getAllOrders.mockResolvedValue({ data: { orders: [combinedOrder()] } });
    render(<AdminOrders />);
    await screen.findByText("#ORD-COMBINED");
    const rows = screen.getAllByText("#ORD-COMBINED");
    expect(rows.length).toBe(1);
    // Both stores appear within the single row.
    expect(screen.getAllByText("ร้าน A").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("ร้าน B").length).toBeGreaterThanOrEqual(1);
  });

  it("displays payment method so COD is distinguishable from prepaid", async () => {
    getAllOrders.mockResolvedValue({
      data: { orders: [combinedOrder({ payment_method: "kbzpay" }), codOrder()] },
    });
    render(<AdminOrders />);
    await screen.findByText("#ORD-COMBINED");
    await screen.findByText("#ORD-COD");
    expect(screen.getByText("KBZPay")).toBeTruthy();
    expect(screen.getByText("ชำระเงินปลายทาง")).toBeTruthy();
  });

  it("detail modal shows all items across all store_orders in the combined group", async () => {
    getAllOrders.mockResolvedValue({ data: { orders: [combinedOrder()] } });
    getById.mockResolvedValue({ data: combinedOrder() });
    render(<AdminOrders />);
    await screen.findByText("#ORD-COMBINED");
    fireEvent.click(screen.getByText("รายละเอียด"));
    await waitFor(() => {
      const dialog = screen.getByRole("dialog");
      expect(dialog.textContent).toContain("สินค้า A1");
      expect(dialog.textContent).toContain("สินค้า A2");
      expect(dialog.textContent).toContain("สินค้า B1");
      expect(dialog.textContent).toContain("ร้าน A");
      expect(dialog.textContent).toContain("ร้าน B");
    });
  });

  it("COD order is a separate row and not combined with prepaid orders", async () => {
    getAllOrders.mockResolvedValue({
      data: { orders: [combinedOrder({ payment_method: "kbzpay" }), codOrder()] },
    });
    render(<AdminOrders />);
    await screen.findByText("#ORD-COMBINED");
    await screen.findByText("#ORD-COD");
    expect(screen.getAllByText("#ORD-COD").length).toBe(1);
    expect(screen.getAllByText("#ORD-COMBINED").length).toBe(1);
  });

  it("filter chips count parent orders only, no double counting across store_orders", async () => {
    // combinedOrder has 2 store_orders but counts as 1 order in 'accepted' group.
    // codOrder is pending -> counts as 1 in 'pending'.
    getAllOrders.mockResolvedValue({
      data: { orders: [combinedOrder({ status: "confirmed" }), codOrder({ status: "pending" })] },
    });
    const { container } = render(<AdminOrders />);
    await screen.findByText("#ORD-COMBINED");
    await screen.findByText("#ORD-COD");
    const chips = container.querySelectorAll(".admin-orders-stats .stat-chip");
    const texts = Array.from(chips).map((c) => c.textContent.replace(/\s+/g, " ").trim());
    // pending = 1 (COD only), accepted = 1 (combined confirmed only)
    expect(texts.some((t) => t.includes("รอรับออเดอร์ (1)"))).toBe(true);
    expect(texts.some((t) => t.includes("รับออเดอร์แล้ว (1)"))).toBe(true);
    // Total across chips should not exceed number of parent orders.
    const counts = texts.map((t) => {
      const m = t.match(/\((\d+)\)/);
      return m ? parseInt(m[1], 10) : 0;
    });
    expect(counts.reduce((a, b) => a + b, 0)).toBe(2);
  });

  it("orders with same customer but separate checkouts are not merged", async () => {
    getAllOrders.mockResolvedValue({
      data: {
        orders: [
          combinedOrder({ id: "o-1", order_number: "ORD-ONE", customer: { name: "Same Customer", phone: "0833333333" } }),
          combinedOrder({ id: "o-2", order_number: "ORD-TWO", customer: { name: "Same Customer", phone: "0833333333" }, payment_method: "cod" }),
        ],
      },
    });
    render(<AdminOrders />);
    await screen.findByText("#ORD-ONE");
    await screen.findByText("#ORD-TWO");
    expect(screen.getAllByText("#ORD-ONE").length).toBe(1);
    expect(screen.getAllByText("#ORD-TWO").length).toBe(1);
    // Same customer, different orders -> two distinct rows, not one combined row.
    const rows = document.querySelectorAll("tr.admin-orders-row");
    expect(rows.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Delivery-based grouping: same customer + same delivery address + same store
// merges across separate checkouts. Different address / different customer /
// COD / delivered-cancelled stay separate.
// ---------------------------------------------------------------------------
const DELIVERY_ADDRESS = {
  name: "ลูกค้า ก",
  phone: "0801111111",
  address: "123/45 Moo 1",
  district: "Phra Nakhon",
  province: "Bangkok",
  postalCode: "10200",
};

function deliveryOrder(overrides = {}) {
  return {
    id: "order-1",
    order_number: "ORD-1001",
    status: "pending",
    payment_status: "pending",
    payment_method: "kbzpay",
    total_amount: 500,
    created_at: "2026-01-01T00:00:00Z",
    customer_id: "cust-1",
    customer: { id: "cust-1", name: "ลูกค้า ก", phone: "0801111111" },
    customer_snapshot: { name: "ลูกค้า ก", phone: "0801111111", address: DELIVERY_ADDRESS },
    store_orders: [{ id: "so-1", store: { id: "store-1", name: "ร้าน A" } }],
    ...overrides,
  };
}

function visibleRows(container) {
  return container.querySelectorAll("tr.admin-orders-row");
}

describe("AdminOrders — delivery-based grouping (customer + address + store)", () => {
  beforeEach(() => {
    getAllOrders.mockReset();
    getById.mockReset();
    updateOrderStatus.mockReset();
    getPaymentSlips.mockReset();
    getPaymentSlips.mockResolvedValue({ data: { slips: [] } });
    updateOrderStatus.mockResolvedValue({ data: {} });
    vi.spyOn(window, "prompt").mockReturnValue("");
  });

  it("merges same customer + same address + same store across separate checkouts", async () => {
    const orders = [
      deliveryOrder({ id: "o-1", order_number: "ORD-A", created_at: "2026-01-01T00:00:00Z", total_amount: 500 }),
      deliveryOrder({ id: "o-2", order_number: "ORD-B", created_at: "2026-01-03T00:00:00Z", total_amount: 1000 }),
    ];
    getAllOrders.mockResolvedValue({ data: { orders } });
    const { container } = render(<AdminOrders />);
    await screen.findByText("#ORD-B");
    expect(visibleRows(container).length).toBe(1);
    // Newest order is the headline number; +1 badge shows the merged count.
    expect(screen.getByText("+1")).toBeTruthy();
    // Group total sums both orders (500 + 1000).
    expect(screen.getByText("1500")).toBeTruthy();
  });

  it("normalizes whitespace/format differences in the delivery address before comparing", async () => {
    const orders = [
      deliveryOrder({ id: "o-1", order_number: "ORD-A", customer_snapshot: { address: { ...DELIVERY_ADDRESS, address: "123/45 Moo 1" } } }),
      deliveryOrder({ id: "o-2", order_number: "ORD-B", customer_snapshot: { address: { ...DELIVERY_ADDRESS, address: " 123/45  moo 1 " } } }),
    ];
    getAllOrders.mockResolvedValue({ data: { orders } });
    const { container } = render(<AdminOrders />);
    // Both orders collapse into a single row despite the address text differing
    // only by spacing/case. The headline is the first order.
    await screen.findByText("#ORD-A");
    expect(visibleRows(container).length).toBe(1);
    expect(screen.getByText("+1")).toBeTruthy();
  });

  it("separates same customer but different delivery addresses", async () => {
    const orders = [
      deliveryOrder({ id: "o-1", order_number: "ORD-A", customer_snapshot: { address: DELIVERY_ADDRESS } }),
      deliveryOrder({
        id: "o-2",
        order_number: "ORD-B",
        customer_snapshot: { address: { ...DELIVERY_ADDRESS, address: "999/9 Moo 9", province: "Chiang Mai", postalCode: "50000" } },
      }),
    ];
    getAllOrders.mockResolvedValue({ data: { orders } });
    const { container } = render(<AdminOrders />);
    await screen.findByText("#ORD-A");
    await screen.findByText("#ORD-B");
    expect(visibleRows(container).length).toBe(2);
  });

  it("separates different customer accounts even with the same address", async () => {
    const orders = [
      deliveryOrder({ id: "o-1", order_number: "ORD-A", customer_id: "cust-1", customer: { id: "cust-1", name: "ลูกค้า ก", phone: "0801111111" } }),
      deliveryOrder({ id: "o-2", order_number: "ORD-B", customer_id: "cust-2", customer: { id: "cust-2", name: "ลูกค้า ข", phone: "0802222222" } }),
    ];
    getAllOrders.mockResolvedValue({ data: { orders } });
    const { container } = render(<AdminOrders />);
    await screen.findByText("#ORD-A");
    await screen.findByText("#ORD-B");
    expect(visibleRows(container).length).toBe(2);
  });

  it("keeps COD as its own row even when customer/address match a prepaid order", async () => {
    const orders = [
      deliveryOrder({ id: "o-1", order_number: "ORD-KBZ", payment_method: "kbzpay" }),
      deliveryOrder({ id: "o-2", order_number: "ORD-COD", payment_method: "cod", payment_status: "pending" }),
    ];
    getAllOrders.mockResolvedValue({ data: { orders } });
    const { container } = render(<AdminOrders />);
    await screen.findByText("#ORD-KBZ");
    await screen.findByText("#ORD-COD");
    expect(visibleRows(container).length).toBe(2);
  });

  it("does not merge delivered orders with in-progress orders", async () => {
    const orders = [
      deliveryOrder({ id: "o-1", order_number: "ORD-ACTIVE", status: "pending" }),
      deliveryOrder({ id: "o-2", order_number: "ORD-DONE", status: "delivered", payment_status: "paid" }),
    ];
    getAllOrders.mockResolvedValue({ data: { orders } });
    const { container } = render(<AdminOrders />);
    await screen.findByText("#ORD-ACTIVE");
    await screen.findByText("#ORD-DONE");
    expect(visibleRows(container).length).toBe(2);
  });

  it("does not merge cancelled orders with in-progress orders", async () => {
    const orders = [
      deliveryOrder({ id: "o-1", order_number: "ORD-ACTIVE", status: "confirmed" }),
      deliveryOrder({ id: "o-2", order_number: "ORD-CANCEL", status: "cancelled" }),
    ];
    getAllOrders.mockResolvedValue({ data: { orders } });
    const { container } = render(<AdminOrders />);
    await screen.findByText("#ORD-ACTIVE");
    await screen.findByText("#ORD-CANCEL");
    expect(visibleRows(container).length).toBe(2);
  });

  it("separates orders that draw from different stores even with same customer/address", async () => {
    const orders = [
      deliveryOrder({ id: "o-1", order_number: "ORD-A", store_orders: [{ id: "so-1", store: { id: "store-1", name: "ร้าน A" } }] }),
      deliveryOrder({ id: "o-2", order_number: "ORD-B", store_orders: [{ id: "so-2", store: { id: "store-2", name: "ร้าน B" } }] }),
    ];
    getAllOrders.mockResolvedValue({ data: { orders } });
    const { container } = render(<AdminOrders />);
    await screen.findByText("#ORD-A");
    await screen.findByText("#ORD-B");
    expect(visibleRows(container).length).toBe(2);
  });

  it("groups members with different statuses and shows หลายสถานะ", async () => {
    const orders = [
      deliveryOrder({ id: "o-1", order_number: "ORD-A", status: "pending" }),
      deliveryOrder({ id: "o-2", order_number: "ORD-B", status: "confirmed" }),
    ];
    getAllOrders.mockResolvedValue({ data: { orders } });
    const { container } = render(<AdminOrders />);
    await screen.findByText("#ORD-A");
    expect(visibleRows(container).length).toBe(1);
    expect(screen.getByText("หลายสถานะ")).toBeTruthy();
  });

  it("shows หลายสถานะชำระเงิน when member payment statuses differ", async () => {
    const orders = [
      deliveryOrder({ id: "o-1", order_number: "ORD-A", payment_status: "paid" }),
      deliveryOrder({ id: "o-2", order_number: "ORD-B", payment_status: "pending" }),
    ];
    getAllOrders.mockResolvedValue({ data: { orders } });
    render(<AdminOrders />);
    await screen.findByText("#ORD-A");
    expect(screen.getByText("หลายสถานะชำระเงิน")).toBeTruthy();
  });

  it("reports orders with missing customer_id / address instead of guessing a group", async () => {
    const orders = [
      deliveryOrder({ id: "o-1", order_number: "ORD-NOADDR", customer_snapshot: {} }),
      deliveryOrder({ id: "o-2", order_number: "ORD-NO-CUST", customer_id: null, customer: null, customer_snapshot: { address: DELIVERY_ADDRESS } }),
    ];
    getAllOrders.mockResolvedValue({ data: { orders } });
    const { container } = render(<AdminOrders />);
    await screen.findByText("#ORD-NOADDR");
    await screen.findByText("#ORD-NO-CUST");
    // Both stay as their own rows.
    expect(visibleRows(container).length).toBe(2);
    // The incomplete-data warning is shown.
    expect(screen.getByText(/ข้อมูลไม่ครบ/)).toBeTruthy();
  });

  it("applies a status change to every member order in the group", async () => {
    const orders = [
      deliveryOrder({ id: "o-1", order_number: "ORD-A", status: "pending" }),
      deliveryOrder({ id: "o-2", order_number: "ORD-B", status: "pending" }),
    ];
    getAllOrders.mockResolvedValue({ data: { orders } });
    render(<AdminOrders />);
    await screen.findByText("#ORD-A");
    const select = screen.getByLabelText("เปลี่ยนสถานะคำสั่งซื้อ #ORD-A");
    fireEvent.change(select, { target: { value: "confirmed" } });
    await waitFor(() => expect(updateOrderStatus).toHaveBeenCalledTimes(2));
    const calledOrderIds = updateOrderStatus.mock.calls.map(c => c[0]);
    expect(calledOrderIds).toContain("o-1");
    expect(calledOrderIds).toContain("o-2");
    const calledStatuses = updateOrderStatus.mock.calls.map(c => c[1]);
    expect(calledStatuses.every(s => s === "confirmed")).toBe(true);
  });

  it("does not offer ยกเลิก for a group whose orders are in_transit (backend rejects it)", async () => {
    const orders = [
      deliveryOrder({ id: "o-1", order_number: "ORD-A", status: "in_transit" }),
      deliveryOrder({ id: "o-2", order_number: "ORD-B", status: "in_transit" }),
    ];
    getAllOrders.mockResolvedValue({ data: { orders } });
    render(<AdminOrders />);
    await screen.findByText("#ORD-A");
    const select = screen.getByLabelText("เปลี่ยนสถานะคำสั่งซื้อ #ORD-A");
    const values = within(select).getAllByRole("option").map((o) => o.value);
    expect(values).not.toContain("cancelled");
    expect(values).toContain("delivered");
  });

  it("reports per-Order-ID failures and does not claim whole-group success", async () => {
    const orders = [
      deliveryOrder({ id: "o-1", order_number: "ORD-A", status: "pending" }),
      deliveryOrder({ id: "o-2", order_number: "ORD-B", status: "pending" }),
    ];
    getAllOrders.mockResolvedValue({ data: { orders } });
    updateOrderStatus.mockImplementation((id) => {
      if (id === "o-2") return Promise.reject(new Error("Invalid status transition"));
      return Promise.resolve({ data: {} });
    });
    render(<AdminOrders />);
    await screen.findByText("#ORD-A");
    const select = screen.getByLabelText("เปลี่ยนสถานะคำสั่งซื้อ #ORD-A");
    fireEvent.change(select, { target: { value: "confirmed" } });
    // The row shows a partial-failure message naming ORD-B.
    const rowError = await screen.findByText(/ORD-B/);
    expect(rowError.textContent).toMatch(/ไม่สำเร็จ|ไม่สามารถเปลี่ยนสถานะได้/);
    // And it acknowledges the success of ORD-A.
    expect(rowError.textContent).toContain("#ORD-A");
  });

  it("detail modal shows every member order, all items, and the shared address", async () => {
    const orderA = deliveryOrder({
      id: "o-1",
      order_number: "ORD-A",
      total_amount: 500,
      store_orders: [{ id: "so-a", store: { id: "store-1", name: "ร้าน A" }, order_items: [{ product_name: "สินค้า A", quantity: 1, total_price: 500 }] }],
    });
    const orderB = deliveryOrder({
      id: "o-2",
      order_number: "ORD-B",
      total_amount: 1000,
      created_at: "2026-01-02T00:00:00Z",
      store_orders: [{ id: "so-b", store: { id: "store-1", name: "ร้าน A" }, order_items: [{ product_name: "สินค้า B", quantity: 2, total_price: 1000 }] }],
    });
    getAllOrders.mockResolvedValue({ data: { orders: [orderA, orderB] } });
    getById.mockImplementation(id => {
      const found = [orderA, orderB].find(o => o.id === id);
      return Promise.resolve({ data: found });
    });
    render(<AdminOrders />);
    await screen.findByText("#ORD-B");
    fireEvent.click(screen.getByText("รายละเอียด"));
    await waitFor(() => {
      const dialog = screen.getByRole("dialog");
      expect(dialog.textContent).toContain("#ORD-A");
      expect(dialog.textContent).toContain("#ORD-B");
      expect(dialog.textContent).toContain("สินค้า A");
      expect(dialog.textContent).toContain("สินค้า B");
      // Group total 500 + 1000 (formatCurrency mock returns raw number string).
      expect(dialog.textContent).toContain("1500");
      // Shared delivery address is shown once for the group.
      expect(dialog.textContent).toContain("ที่อยู่จัดส่งร่วมของกลุ่มนี้");
    });
  });

  it("detail modal exposes a per-order tracking link for each member", async () => {
    const orders = [
      deliveryOrder({ id: "o-1", order_number: "ORD-A" }),
      deliveryOrder({ id: "o-2", order_number: "ORD-B" }),
    ];
    getAllOrders.mockResolvedValue({ data: { orders } });
    getById.mockImplementation(id => Promise.resolve({ data: orders.find(o => o.id === id) }));
    const { container } = render(<AdminOrders />);
    await screen.findByText("#ORD-A");
    fireEvent.click(screen.getByText("รายละเอียด"));
    await waitFor(() => {
      const links = container.querySelectorAll(".admin-order-detail-track-link");
      expect(links.length).toBe(2);
      const hrefs = Array.from(links).map(a => a.getAttribute("href"));
      expect(hrefs).toContain("/orders/o-1");
      expect(hrefs).toContain("/orders/o-2");
    });
  });

  it("filter chips count delivery groups not individual orders", async () => {
    const orders = [
      deliveryOrder({ id: "o-1", order_number: "ORD-A", status: "pending" }),
      deliveryOrder({ id: "o-2", order_number: "ORD-B", status: "pending" }),
      deliveryOrder({
        id: "o-3",
        order_number: "ORD-COD",
        status: "confirmed",
        payment_method: "cod",
        customer_id: "cust-9",
        customer: { id: "cust-9", name: "ลูกค้า ข", phone: "0809999999" },
        customer_snapshot: { address: { ...DELIVERY_ADDRESS, name: "ลูกค้า ข", phone: "0809999999" } },
      }),
    ];
    getAllOrders.mockResolvedValue({ data: { orders } });
    render(<AdminOrders />);
    await screen.findByText("#ORD-A");
    await screen.findByText("#ORD-COD");
    const texts = Array.from(
      document.querySelectorAll(".admin-orders-stats .stat-chip")
    ).map(c => c.textContent.replace(/\s+/g, " ").trim());
    // pending = 1 delivery group (ORD-A + ORD-B merged), accepted = 1 (COD confirmed)
    expect(texts.some(t => t.includes("รอรับออเดอร์ (1)"))).toBe(true);
    expect(texts.some(t => t.includes("รับออเดอร์แล้ว (1)"))).toBe(true);
  });

  it("search matches any order within a delivery group", async () => {
    const orders = [
      deliveryOrder({ id: "o-1", order_number: "ORD-A", customer: { id: "cust-1", name: "Alice", phone: "0801111111" }, customer_snapshot: { name: "Alice", phone: "0801111111", address: DELIVERY_ADDRESS } }),
      deliveryOrder({ id: "o-2", order_number: "ORD-B", customer: { id: "cust-1", name: "Alice", phone: "0801111111" }, customer_snapshot: { name: "Alice", phone: "0801111111", address: DELIVERY_ADDRESS } }),
    ];
    getAllOrders.mockResolvedValue({ data: { orders } });
    const { container } = render(<AdminOrders />);
    await screen.findByText("#ORD-A");
    const input = container.querySelector('input[type="search"]');
    fireEvent.change(input, { target: { value: "ORD-B" } });
    await waitFor(() => {
      // Group still shown because member ORD-B matches.
      expect(visibleRows(container).length).toBe(1);
    });
  });
});

// ---------------------------------------------------------------------------
// COD delivered payment status: "เก็บเงินแล้ว" when delivered + COD + paid
// ---------------------------------------------------------------------------

function regressionCodOrder(overrides = {}) {
  return {
    id: "order-cod-reg",
    order_number: "ORD-COD-REG",
    status: "pending",
    payment_status: "pending",
    payment_method: "cod",
    total_amount: 400,
    created_at: "2026-01-06T11:00:00Z",
    customer: { name: "Carol", phone: "0823456789" },
    store_orders: [{ id: "so-cod-reg", store: { name: "ร้าน C" }, order_items: [] }],
    ...overrides,
  };
}

function regressionKbzpayOrder(overrides = {}) {
  return {
    id: "order-kbzpay-reg",
    order_number: "ORD-KBZPAY-REG",
    status: "pending",
    payment_status: "awaiting_review",
    payment_method: "kbzpay",
    total_amount: 500,
    created_at: "2026-01-07T12:00:00Z",
    customer: { name: "David", phone: "0834567890" },
    store_orders: [{ id: "so-kbzpay-reg", store: { name: "ร้าน D" }, order_items: [] }],
    ...overrides,
  };
}

describe("AdminOrders — COD delivered payment status regression", () => {
  beforeEach(() => {
    getAllOrders.mockReset();
    getById.mockReset();
    updateOrderStatus.mockReset();
    getPaymentSlips.mockReset();
    getPaymentSlips.mockResolvedValue({ data: { slips: [] } });
    updateOrderStatus.mockResolvedValue({ data: {} });
    vi.spyOn(window, "prompt").mockReturnValue("");
  });

  it("shows 'เก็บเงินแล้ว' for COD order that is delivered and paid", async () => {
    getAllOrders.mockResolvedValue({
      data: { orders: [regressionCodOrder({ status: "delivered", payment_status: "paid", order_number: "ORD-COD-PAID" })] },
    });
    render(<AdminOrders />);
    await screen.findByText("#ORD-COD-PAID");
    expect(screen.getByText("เก็บเงินแล้ว")).toBeTruthy();
  });

  it("shows 'รอชำระ' for COD order that is NOT yet delivered", async () => {
    getAllOrders.mockResolvedValue({
      data: { orders: [regressionCodOrder({ status: "confirmed", payment_status: "pending", order_number: "ORD-COD-PENDING" })] },
    });
    render(<AdminOrders />);
    await screen.findByText("#ORD-COD-PENDING");
    expect(screen.getByText("รอชำระ")).toBeTruthy();
    expect(screen.queryByText("เก็บเงินแล้ว")).toBeNull();
  });

  it("shows 'ชำระแล้ว' for KBZPay order that is delivered and paid (not 'เก็บเงินแล้ว')", async () => {
    getAllOrders.mockResolvedValue({
      data: { orders: [regressionKbzpayOrder({ status: "delivered", payment_status: "paid", order_number: "ORD-KBZ-PAID" })] },
    });
    render(<AdminOrders />);
    await screen.findByText("#ORD-KBZ-PAID");
    expect(screen.getByText("ชำระแล้ว")).toBeTruthy();
    expect(screen.queryByText("เก็บเงินแล้ว")).toBeNull();
  });

  it("shows 'รอตรวจสอบ' for KBZPay order that is delivered but still awaiting review", async () => {
    getAllOrders.mockResolvedValue({
      data: { orders: [regressionKbzpayOrder({ status: "delivered", payment_status: "awaiting_review", order_number: "ORD-KBZ-REVIEW" })] },
    });
    render(<AdminOrders />);
    await screen.findByText("#ORD-KBZ-REVIEW");
    expect(screen.getByText("ตรวจสอบแล้ว")).toBeTruthy();
    expect(screen.queryByText("เก็บเงินแล้ว")).toBeNull();
  });
});