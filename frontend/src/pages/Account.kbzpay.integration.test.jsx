import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";

// --- Real-world fixtures (mirror GET /orders -> getCustomerOrders shape) -----
// store_orders do NOT carry a flat store_id; the store id is at store.id.
const STORE_ID = "9f1c2b7a-kindee-admin-shop";
const STORE_NAME = "Kindee Admin Shop";

const API_SETTINGS = {
  storeId: STORE_ID,
  storeName: STORE_NAME,
  accountName: "sai tun aye",
  phoneNumber: "09789299668",
  receiverName: "sai tun aye",
  qrUrl: "https://kindee.example/storage/qr-kindee.png",
  enabled: true,
};

const ORDER_NOS = [
  "ORD20261121000003",
  "ORD20261121000002",
  "ORD20261121000001",
  "ORD20261120000005",
  "ORD20261120000004",
  "ORD20261120000003",
];
const AMOUNTS = [17798, 10018, 1020, 4026, 5019, 59194];

const kbzpayOrder = (id, orderNo, amountMmk) => ({
  id,
  order_number: orderNo,
  status: "pending",
  payment_status: "pending",
  payment_method: "kbzpay",
  total_amount: 999, // THB
  amount_mmk: amountMmk,
  created_at: "2026-11-21T10:00:00Z",
  store_orders: [
    {
      id: `so-${id}`,
      store_order_number: `SO-${id}`,
      status: "pending",
      total_amount: 999,
      store: { id: STORE_ID, name: STORE_NAME, slug: "kindee-admin-shop", logo_url: null },
    },
  ],
});

const codOrder = {
  id: "order-cod",
  order_number: "ORD-COD-1",
  status: "pending",
  payment_status: "pending",
  payment_method: "cod",
  total_amount: 500,
  amount_mmk: null,
  created_at: "2026-11-21T09:00:00Z",
  store_orders: [
    {
      id: "so-cod",
      store_order_number: "SO-COD",
      status: "pending",
      total_amount: 500,
      store: { id: STORE_ID, name: STORE_NAME, slug: "kindee-admin-shop", logo_url: null },
    },
  ],
};

const deliveredParentOrder = {
  id: "order-delivered",
  order_number: "ORD-DELIVERED",
  status: "delivered",
  payment_status: "paid",
  payment_method: "kbzpay",
  total_amount: 500,
  amount_mmk: 12345,
  created_at: "2026-11-21T08:00:00Z",
  store_orders: [
    {
      id: "so-delivered",
      store_order_number: "SO-DELIVERED",
      status: "pending",
      total_amount: 500,
      store: { id: STORE_ID, name: STORE_NAME, slug: "kindee-admin-shop", logo_url: null },
    },
  ],
};

const newerDeliveredParentOrder = {
  ...deliveredParentOrder,
  id: "order-delivered-new",
  order_number: "ORD-DELIVERED-NEW",
  created_at: "2026-11-21T11:00:00Z",
  store_orders: [
    {
      ...deliveredParentOrder.store_orders[0],
      id: "so-delivered-new",
      store_order_number: "SO-DELIVERED-NEW",
    },
  ],
};

const inTransitOrder = {
  id: "order-in-transit",
  order_number: "ORD-IN-TRANSIT",
  status: "in_transit",
  payment_status: "paid",
  payment_method: "kbzpay",
  total_amount: 500,
  amount_mmk: 12345,
  created_at: "2026-11-21T12:00:00Z",
  store_orders: [
    {
      id: "so-in-transit",
      store_order_number: "SO-IN-TRANSIT",
      status: "in_transit",
      total_amount: 500,
      store: { id: STORE_ID, name: STORE_NAME, slug: "kindee-admin-shop", logo_url: null },
    },
  ],
};

const ORDERS = [
  ...ORDER_NOS.map((no, i) => kbzpayOrder(`order-${i + 1}`, no, AMOUNTS[i])),
  codOrder,
];

// --- Module mocks -----------------------------------------------------------
// Declared with vi.hoisted so the vi.mock factories (hoisted above imports)
// can reference them safely.
const { getMyOrders, getKbzpaySettings } = vi.hoisted(() => ({
  getMyOrders: vi.fn(),
  getKbzpaySettings: vi.fn(),
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    customer: {
      user: { id: "cust-1", name: "Test Customer", email: "c@example.com", role: "customer" },
      isAuthenticated: true,
      token: "customer-token",
    },
    logout: vi.fn(),
  }),
}));

vi.mock("../context/SocketContext", () => ({
  useSocket: () => ({ on: vi.fn(), off: vi.fn() }),
}));

vi.mock("../api", () => ({
  orderAPI: {
    getMyOrders: (...args) => getMyOrders(...args),
    getWallet: vi.fn().mockResolvedValue({ data: {} }),
    getFinance: vi.fn().mockResolvedValue({ data: {} }),
  },
  addressAPI: {
    getAddresses: vi.fn().mockResolvedValue({ data: { addresses: [] } }),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    setDefault: vi.fn(),
  },
}));

vi.mock("../api/product", () => ({
  storeAPI: {
    getKbzpaySettings: (...args) => getKbzpaySettings(...args),
  },
}));

// Avoid pulling leaflet into jsdom; StoreLocationMap is only used by the
// address form, which this test never opens.
vi.mock("../components/StoreLocationMap", () => ({
  default: () => null,
}));

import Account from "./Account";

const openTopayModal = async () => {
  fireEvent.click(screen.getByText("ที่ต้องชำระ"));
  // The order number appears in both the order card and the payment summary.
  await screen.findAllByText("#ORD20261121000003");
};

describe("Account -> Order Modal -> KBZPay Popup integration", () => {
  beforeEach(() => {
    getMyOrders.mockReset();
    getKbzpaySettings.mockReset();
    getMyOrders.mockResolvedValue({ data: { orders: ORDERS, pagination: {} } });
    getKbzpaySettings.mockResolvedValue({ success: true, data: API_SETTINGS });
  });

  it("โหลด Orders จาก Account แล้วส่งผ่าน Modal ไป Popup ครบทั้ง 6 รายการ", async () => {
    render(<Account />);
    await openTopayModal();

    // Modal แสดง KBZPay pending ครบ (COD ถูกกรองออกจาก 'ที่ต้องชำระ')
    expect(screen.getAllByText("#ORD20261121000003").length).toBeGreaterThan(0);
    expect(screen.queryByText("#ORD-COD-1")).toBeNull();

    // กดชำระเงินทันที -> เรียก settings API ด้วย store.id จากออเดอร์
    fireEvent.click(screen.getByText("ชำระเงินทันที"));

    // Popup เปิดขึ้นพร้อมข้อมูลจริง
    await screen.findByText("รวม 6 รายการจาก 1 ร้านค้า");
    expect(getKbzpaySettings).toHaveBeenCalledWith(STORE_ID, "customer");

    const dialog = screen.getByRole("dialog");
    // COD ไม่ถูกนำมาแสดงเป็น KBZPay
    expect(within(dialog).queryByText("#ORD-COD-1")).toBeNull();
    // ยอดรวม MMK 97,075
    expect(dialog.textContent).toContain("97,075");
    // ข้อมูลบัญชีจาก API
    expect(within(dialog).getAllByText("sai tun aye").length).toBe(2);
    expect(within(dialog).getByText("09789299668")).toBeTruthy();
    expect(within(dialog).getByAltText(`QR Code ${STORE_NAME}`)).toBeTruthy();
    // ยอดรวมของร้านถูกลบออกแล้ว (kbzpay-store-total) - เหลือยอดรวมที่ kbzpay-popup-summary ใน footer เท่านั้น
    expect(dialog.querySelector(".kbzpay-store-total")).toBeNull();
    // ไม่มีส่วน currency-group และ order-numbers ที่แก้ไขออกแล้ว
    expect(dialog.querySelector(".kbzpay-currency-group")).toBeNull();
    expect(dialog.querySelector(".kbzpay-order-numbers")).toBeNull();
    // มีส่วนแนบสลิปสำหรับส่งสลิป
    expect(dialog.querySelector(".kbzpay-slip-upload")).toBeTruthy();
  });

  it("ไม่แสดง Modal ว่างเมื่อไม่มี KBZPay pending order จริง", async () => {
    getMyOrders.mockResolvedValue({
      data: {
        orders: [codOrder],
        pagination: {},
      },
    });
    render(<Account />);
    // เปิด modal 'ที่ต้องชำระ' — COD ถูกแยกออก จึงไม่มีออเดอร์ในหมวดนี้
    fireEvent.click(screen.getByText("ที่ต้องชำระ"));
    await waitFor(() => {
      expect(screen.queryByText('ไม่พบคำสั่งซื้อในหมวด "ที่ต้องชำระ"')).toBeNull();
    });
    // ไม่มีปุ่มชำระเงินและไม่มี popup
    expect(screen.queryByText("ชำระเงินทันที")).toBeNull();
  });

  const openTopay = async () => {
    fireEvent.click(screen.getByText("ที่ต้องชำระ"));
    await screen.findAllByText(/#ORD/);
  };

  const modalContainer = () => {
    const el = document.querySelector(".modal-container");
    if (!el) throw new Error("order modal container not rendered");
    return el;
  };

  it("แสดงยอด Order แต่ละรายการเป็น MMK (ยอดที่บันทึกตอนสร้าง) ไม่ใช่ THB", async () => {
    render(<Account />);
    await openTopay();
    const dialog = modalContainer();
    const totals = dialog.querySelectorAll(".modal-order-total strong");
    expect(totals.length).toBe(6);
    totals.forEach((el) => {
      // KBZPay ทุกรายการต้องแสดงสกุลเงิน MMK
      expect(el.textContent).toMatch(/MMK/);
      expect(el.textContent).not.toBe("-");
    });
    // ยอดแต่ละรายการตรงกับ amount_mmk ที่บันทึกไว้ตอนสร้าง Order
    expect(dialog.textContent).toContain("17,798");
    expect(dialog.textContent).toContain("MMK");
  });

  it("ยอดรวมสรุปเป็น MMK = ผลรวมของ amount_mmk ไม่ใช่ผลรวม total_amount (THB)", async () => {
    render(<Account />);
    await openTopay();
    const dialog = modalContainer();
    // 17798+10018+1020+4026+5019+59194 = 97,075 MMK
    expect(dialog.textContent).toContain("97,075");
    expect(dialog.textContent).toContain("MMK");
    // ยอดรวมของ total_amount (THB) = 999*6 = 5,994 ต้องไม่รั่วไหลเข้ายอดรวม MMK
    const grandTotal = dialog.querySelector(".modal-summary-grand-total strong");
    expect(grandTotal.textContent).toMatch(/MMK/);
    expect(grandTotal.textContent).toContain("97,075");
  });

  it("วิธีชำระอื่นยังคงแสดงยอด THB เดิม (ไม่กระทบวิธีอื่น)", async () => {
    getMyOrders.mockResolvedValue({
      data: {
        orders: [
          kbzpayOrder("order-k", "ORD-K", 10000),
          { ...codOrder, id: "order-p", order_number: "ORD-P", payment_method: "promptpay", total_amount: 500, amount_mmk: null },
        ],
        pagination: {},
      },
    });
    render(<Account />);
    await openTopay();
    const dialog = modalContainer();
    // KBZPay แสดง MMK ยอด amount_mmk
    expect(dialog.textContent).toContain("10,000");
    expect(dialog.textContent).toContain("MMK");
    // PromptPay แสดง THB ยอด total_amount เดิม
    expect(dialog.textContent).toContain("500.00");
  });

  it("KBZPay order ที่ไม่มี amount_mmk ไม่สร้างยอด MMK ขึ้นมา (ใช้ THB แทน)", async () => {
    getMyOrders.mockResolvedValue({
      data: { orders: [kbzpayOrder("order-n", "ORD-N", null)], pagination: {} },
    });
    render(<Account />);
    await openTopay();
    const dialog = modalContainer();
    // ไม่ต้องมีคำว่า MMK ปรากฏ (ห้ามสร้างยอด MMK ขึ้นมาเอง)
    expect(dialog.textContent).not.toContain("MMK");
  });

  it("delivered parent orders show ตรวจสอบแล้ว at store level while unfinished orders keep their real status", async () => {
    getMyOrders.mockResolvedValue({
      data: { orders: [deliveredParentOrder, codOrder], pagination: {} },
    });
    const { unmount } = render(<Account />);
    fireEvent.click(screen.getByText("ดูทั้งหมด"));
    await screen.findAllByText("#ORD-DELIVERED");

    const deliveredCard = screen.getByText("#ORD-DELIVERED").closest(".modal-order-card");
    const deliveredStoreStatus = within(deliveredCard).getByText("ตรวจสอบแล้ว");
    expect(deliveredStoreStatus.classList.contains("status-verified")).toBe(true);
    expect(deliveredStoreStatus.classList.contains("status-pending")).toBe(false);
    expect(deliveredCard.querySelector(".modal-store-status").textContent).toBe("ตรวจสอบแล้ว");

    const pendingCard = screen.getAllByText("#ORD-COD-1")
      .map((el) => el.closest(".modal-order-card"))
      .find(Boolean);
    const pendingStoreStatus = pendingCard.querySelector(".modal-store-status");
    expect(pendingStoreStatus.textContent).toBe("รอดำเนินการ");
    expect(pendingStoreStatus.classList.contains("status-pending")).toBe(true);

    unmount();
    render(<Account />);
    fireEvent.click(screen.getByText("ดูทั้งหมด"));
    await screen.findAllByText("#ORD-DELIVERED");
    const reloadedCard = screen.getByText("#ORD-DELIVERED").closest(".modal-order-card");
    expect(reloadedCard.querySelector(".modal-store-status").textContent).toBe("ตรวจสอบแล้ว");
    expect(reloadedCard.querySelector(".modal-store-status").classList.contains("status-verified")).toBe(true);
  });

  it("รับสินค้าแล้ว modal lists only delivered orders newest first with the correct badge", async () => {
    getMyOrders.mockResolvedValue({
      data: {
        orders: [deliveredParentOrder, newerDeliveredParentOrder, codOrder],
        pagination: {},
      },
    });
    const { unmount } = render(<Account />);
    const tile = screen.getByText("รับสินค้าแล้ว").closest(".acct-tile");
    await waitFor(() => {
      expect(tile.querySelector(".acct-tile-badge")?.textContent).toBe("2");
    });

    fireEvent.click(tile);
    await screen.findAllByText("#ORD-DELIVERED-NEW");

    const orderNumbers = [...document.querySelectorAll(".modal-order-card .modal-order-number")]
      .map((el) => el.textContent);
    expect(orderNumbers).toEqual(["#ORD-DELIVERED-NEW", "#ORD-DELIVERED"]);
    expect(screen.queryByText("#ORD-COD-1")).toBeNull();

    const card = screen.getByText("#ORD-DELIVERED-NEW").closest(".modal-order-card");
    expect(card.textContent).toContain(STORE_NAME);
    expect(card.textContent).toContain("ตรวจสอบแล้ว");
    expect(card.textContent).toContain("KBZPay");
    expect(card.textContent).toContain("ชำระแล้ว");
    expect(card.textContent).toContain("12,345.00");
    expect(card.textContent).toContain("MMK");

    unmount();
    render(<Account />);
    fireEvent.click(screen.getByText("รับสินค้าแล้ว"));
    await screen.findAllByText("#ORD-DELIVERED-NEW");
    const reloadedOrderNumbers = [...document.querySelectorAll(".modal-order-card .modal-order-number")]
      .map((el) => el.textContent);
    expect(reloadedOrderNumbers).toEqual(["#ORD-DELIVERED-NEW", "#ORD-DELIVERED"]);
  });

  it("รับสินค้าแล้ว modal shows an empty state when no delivered orders exist", async () => {
    getMyOrders.mockResolvedValue({
      data: { orders: [codOrder], pagination: {} },
    });
    render(<Account />);
    fireEvent.click(screen.getByText("รับสินค้าแล้ว"));

    expect(await screen.findByText("ยังไม่มีออเดอร์ที่รับสินค้าแล้ว")).toBeTruthy();
    expect(document.querySelector(".modal-order-card")).toBeNull();
  });

  it("ที่ต้องได้รับ modal (toreceive) ไม่แสดงออเดอร์ delivered แม้ store_order ยังอยู่สถานะก่อนจัดส่ง", async () => {
    getMyOrders.mockResolvedValue({
      data: {
        orders: [deliveredParentOrder, newerDeliveredParentOrder, inTransitOrder, codOrder],
        pagination: {},
      },
    });
    render(<Account />);

    const tile = screen.getByText("ที่ต้องได้รับ").closest(".acct-tile");
    await waitFor(() => {
      expect(tile.querySelector(".acct-tile-badge")?.textContent).toBe("1");
    });

    fireEvent.click(tile);
    await screen.findAllByText("#ORD-IN-TRANSIT");

    expect(screen.queryByText("#ORD-DELIVERED")).toBeNull();
    expect(screen.queryByText("#ORD-DELIVERED-NEW")).toBeNull();
    expect(screen.queryByText("#ORD-COD-1")).toBeNull();
  });

  it("ที่ต้องได้รับ และ รับสินค้าแล้ว modal ไม่มีออเดอร์ซ้ำกัน และ badge ตรงกับจำนวน .modal-order_card", async () => {
    getMyOrders.mockResolvedValue({
      data: {
        orders: [deliveredParentOrder, newerDeliveredParentOrder, inTransitOrder, codOrder],
        pagination: {},
      },
    });
    render(<Account />);

    const cardNumbers = (container) =>
      [...container.querySelectorAll(".modal-order-card .modal-order-number")].map(
        (el) => el.textContent
      );

    // ที่ต้องได้รับ (toreceive): เฉพาะออเดอร์ที่อยู่ระหว่างจัดส่ง
    const toReceiveTile = screen.getByText("ที่ต้องได้รับ").closest(".acct-tile");
    await waitFor(() => {
      expect(toReceiveTile.querySelector(".acct-tile-badge")?.textContent).toBe("1");
    });
    fireEvent.click(toReceiveTile);
    await screen.findAllByText("#ORD-IN-TRANSIT");
    const toReceiveContainer = document.querySelector(".modal-container");
    const toReceiveNumbers = cardNumbers(toReceiveContainer);
    expect(toReceiveNumbers).toEqual(["#ORD-IN-TRANSIT"]);
    expect(Number(toReceiveTile.querySelector(".acct-tile-badge").textContent)).toBe(
      toReceiveContainer.querySelectorAll(".modal-order-card").length
    );

    // รับสินค้าแล้ว (toreview): เฉพาะออเดอร์ delivered
    const toReviewTile = screen.getByText("รับสินค้าแล้ว").closest(".acct-tile");
    await waitFor(() => {
      expect(toReviewTile.querySelector(".acct-tile-badge")?.textContent).toBe("2");
    });
    fireEvent.click(toReviewTile);
    await screen.findAllByText("#ORD-DELIVERED-NEW");
    const toReviewContainer = document.querySelector(".modal-container");
    const toReviewNumbers = cardNumbers(toReviewContainer);
    expect(toReviewNumbers).toEqual(["#ORD-DELIVERED-NEW", "#ORD-DELIVERED"]);
    expect(Number(toReviewTile.querySelector(".acct-tile-badge").textContent)).toBe(
      toReviewContainer.querySelectorAll(".modal-order-card").length
    );

    // ไม่มีออเดอร์ซ้ำกันระหว่างสองหมวด
    expect(toReceiveNumbers.filter((n) => toReviewNumbers.includes(n))).toEqual([]);
  });
});