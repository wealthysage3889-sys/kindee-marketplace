import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import KBZPayPaymentPopup from "./KBZPayPaymentPopup";

// The popup submits slips through orderAPI when the footer "ตกลง" is clicked.
// Mock the API module so no network is involved; each test controls the
// resolved/rejected behaviour.
const { submitStorePaymentSlips } = vi.hoisted(() => ({
  submitStorePaymentSlips: vi.fn(),
}));

vi.mock("../api", () => ({
  orderAPI: {
    submitStorePaymentSlips: (...args) => submitStorePaymentSlips(...args),
  },
}));

// Fixtures mirror the REAL customer order payload returned by
// GET /orders (backend/services/orderService.js -> getCustomerOrders).
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

const kbzpaySettings = { [STORE_ID]: API_SETTINGS };

const ORDER_NOS = [
  "ORD20261121000003",
  "ORD20261121000002",
  "ORD20261121000001",
  "ORD20261120000005",
  "ORD20261120000004",
  "ORD20261120000003",
];
const AMOUNTS = [17798, 10018, 1020, 4026, 5019, 59194];

const customerOrder = ({
  id,
  orderNo,
  amountMmk,
  paymentMethod = "kbzpay",
  paymentStatus = "pending",
  status = "pending",
  storeId = STORE_ID,
  storeName = STORE_NAME,
}) => ({
  id,
  order_number: orderNo,
  status,
  payment_status: paymentStatus,
  payment_method: paymentMethod,
  total_amount: 999,
  amount_mmk: paymentMethod === "kbzpay" ? amountMmk : null,
  created_at: "2026-11-21T10:00:00Z",
  store_orders: [
    {
      id: `so-${id}`,
      store_order_number: `SO-${id}`,
      status,
      total_amount: 999,
      store: { id: storeId, name: storeName, slug: "kindee-admin-shop", logo_url: null },
    },
  ],
});

const sixOrders = ORDER_NOS.map((orderNo, i) =>
  customerOrder({ id: `order-${i + 1}`, orderNo, amountMmk: AMOUNTS[i] })
);

const pngFile = (name = "slip.png") => new File([new Uint8Array([1, 2, 3])], name, { type: "image/png" });

beforeEach(() => {
  submitStorePaymentSlips.mockReset();
  globalThis.URL.createObjectURL = vi.fn(() => "blob:mock-preview");
  globalThis.URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("KBZPayPaymentPopup (real API-shaped fixtures)", () => {
  it("แสดงหัวข้อ และมีส่วนแนบสลิปของร้านค้า (ไม่มีปุ่มส่งสลิปแยกต่อร้าน)", () => {
    const { container } = render(
      <KBZPayPaymentPopup open orders={sixOrders} kbzpaySettings={kbzpaySettings} />
    );
    expect(screen.getByText("รวม 6 รายการจาก 1 ร้านค้า")).toBeTruthy();
    expect(container.querySelector(".kbzpay-slip-upload")).toBeTruthy();
    expect(container.querySelector(".kbzpay-slip-submit")).toBeNull();
    expect(screen.queryByText("ส่งสลิป")).toBeNull();
  });

  it("ไม่มีส่วน kbzpay-order-numbers และไม่มีส่วน kbzpay-currency-group", () => {
    const { container } = render(
      <KBZPayPaymentPopup open orders={sixOrders} kbzpaySettings={kbzpaySettings} />
    );
    expect(container.querySelector(".kbzpay-order-numbers")).toBeNull();
    expect(container.querySelector(".kbzpay-order-number-list")).toBeNull();
    expect(container.querySelector(".kbzpay-currency-group")).toBeNull();
    expect(screen.queryByText(/Order Number ที่รวมอยู่ในการชำระครั้งนี้/)).toBeNull();
    expect(screen.queryByText(/จำนวนเงินที่ต้องโอน/)).toBeNull();
  });

  it("แสดงข้อมูลบัญชี KBZPay ของร้านจาก settings จริง", () => {
    const { container } = render(
      <KBZPayPaymentPopup open orders={sixOrders} kbzpaySettings={kbzpaySettings} />
    );
    expect(container.textContent).toContain(STORE_NAME);
    expect(screen.getAllByText("sai tun aye").length).toBe(2);
    expect(screen.getByText("09789299668")).toBeTruthy();
    const qrImg = screen.getByAltText(`QR Code ${STORE_NAME}`);
    expect(qrImg.getAttribute("src")).toBe("https://kindee.example/storage/qr-kindee.png");
  });

  it("แสดงสถานะเปิดรับชำระเมื่อ enabled = true", () => {
    render(<KBZPayPaymentPopup open orders={sixOrders} kbzpaySettings={kbzpaySettings} />);
    expect(screen.getByText("เปิดรับชำระ KBZPay")).toBeTruthy();
    expect(screen.queryByText("ปิดใช้งาน KBZPay")).toBeNull();
  });

  it("แจ้งเตือนเมื่อร้านปิดรับ KBZPay", () => {
    const disabled = { [STORE_ID]: { ...API_SETTINGS, enabled: false } };
    render(<KBZPayPaymentPopup open orders={sixOrders} kbzpaySettings={disabled} />);
    expect(screen.getByText("ปิดใช้งาน KBZPay")).toBeTruthy();
    expect(screen.getByText("ร้านค้านี้ปิดใช้งานการรับชำระผ่าน KBZPay")).toBeTruthy();
    expect(screen.queryByText("sai tun aye")).toBeNull();
  });

  it("แจ้งเตือนเมื่อร้าน enabled แต่ไม่มีข้อมูลบัญชีครบถ้วน", () => {
    const incomplete = {
      [STORE_ID]: { ...API_SETTINGS, accountName: null, phoneNumber: null, receiverName: null },
    };
    render(<KBZPayPaymentPopup open orders={sixOrders} kbzpaySettings={incomplete} />);
    expect(screen.getByText("ยังไม่ได้ตั้งค่าข้อมูลบัญชี KBZPay ให้ครบถ้วน")).toBeTruthy();
  });

  it("ไม่ปน COD / วิธีชำระอื่นในฐานะ KBZPay", () => {
    const codOrder = customerOrder({
      id: "order-cod",
      orderNo: "ORD-COD-1",
      amountMmk: 5000,
      paymentMethod: "cod",
    });
    render(
      <KBZPayPaymentPopup open orders={[...sixOrders, codOrder]} kbzpaySettings={kbzpaySettings} />
    );
    expect(screen.queryByText("#ORD-COD-1")).toBeNull();
    expect(screen.getByText("รวม 6 รายการจาก 1 ร้านค้า")).toBeTruthy();
  });

  it("Multi-store: แต่ละร้านแสดงบัญชีของตัวเองและมีส่วนแนบสลิปแยกกัน", () => {
    const OTHER_STORE = "other-store-id";
    const multiSettings = {
      [STORE_ID]: API_SETTINGS,
      [OTHER_STORE]: {
        storeId: OTHER_STORE,
        storeName: "Other Shop",
        accountName: "other shop",
        phoneNumber: "0911111111",
        receiverName: "other receiver",
        qrUrl: "https://kindee.example/qr-other.png",
        enabled: true,
      },
    };
    const order = {
      id: "order-multi",
      order_number: "ORD-MULTI",
      status: "pending",
      payment_status: "pending",
      payment_method: "kbzpay",
      total_amount: 999,
      amount_mmk: 5000,
      created_at: "2026-11-21T10:00:00Z",
      store_orders: [
        { id: "so-cur", store_order_number: "SO-CUR", status: "pending", total_amount: 999,
          store: { id: STORE_ID, name: STORE_NAME } },
        { id: "so-oth", store_order_number: "SO-OTH", status: "pending", total_amount: 999,
          store: { id: OTHER_STORE, name: "Other Shop" } },
      ],
    };
    const { container } = render(
      <KBZPayPaymentPopup open orders={[order]} kbzpaySettings={multiSettings} />
    );
    const groups = container.querySelectorAll(".kbzpay-store-group");
    expect(groups.length).toBe(2);
    const byName = {};
    groups.forEach((g) => { byName[g.querySelector(".kbzpay-store-name").textContent] = g; });
    expect(byName[STORE_NAME].textContent).toContain("sai tun aye");
    expect(byName[STORE_NAME].textContent).not.toContain("other shop");
    expect(byName["Other Shop"].textContent).toContain("other shop");
    // each store group has its own slip upload section (without a per-store submit button)
    expect(byName[STORE_NAME].querySelector(".kbzpay-slip-upload")).toBeTruthy();
    expect(byName["Other Shop"].querySelector(".kbzpay-slip-upload")).toBeTruthy();
    expect(byName[STORE_NAME].querySelector(".kbzpay-slip-submit")).toBeNull();
    expect(byName["Other Shop"].querySelector(".kbzpay-slip-submit")).toBeNull();
    expect(container.querySelectorAll('input[type="file"]').length).toBe(2);
  });

  it("ออเดอร์หลายใบในร้านเดียวกันรวมเป็นกลุ่มเดียว โดยไม่ซ้ำ key และไม่คูณยอด", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const firstOrder = customerOrder({
      id: "same-store-1",
      orderNo: "ORD-SAME-1",
      amountMmk: 1000,
    });
    firstOrder.store_orders.push({ ...firstOrder.store_orders[0], id: "so-duplicate" });
    const secondOrder = customerOrder({
      id: "same-store-2",
      orderNo: "ORD-SAME-2",
      amountMmk: 2000,
    });

    const { container } = render(
      <KBZPayPaymentPopup
        open
        orders={[firstOrder, secondOrder]}
        kbzpaySettings={kbzpaySettings}
      />
    );

    expect(container.querySelectorAll(".kbzpay-store-group")).toHaveLength(1);
    expect(screen.getByText("รวม 2 รายการจาก 1 ร้านค้า")).toBeTruthy();
    expect(container.textContent).toContain("3,000.00");
    expect(container.textContent).not.toContain("4,000.00");
    expect(
      errorSpy.mock.calls.some((args) => String(args[0]).includes("same key"))
    ).toBe(false);
  });

  it("Empty state เมื่อไม่มี KBZPay pending orders จริง", () => {
    const { container } = render(
      <KBZPayPaymentPopup open orders={[]} kbzpaySettings={kbzpaySettings} />
    );
    expect(screen.getByText("ไม่มีคำสั่งซื้อที่รอชำระเงินผ่าน KBZPay")).toBeTruthy();
    expect(container.querySelectorAll(".kbzpay-store-group").length).toBe(0);
  });

  it("state 'กำลังโหลดคำสั่งซื้อ' แยกจาก empty state", () => {
    render(<KBZPayPaymentPopup open orders={[]} ordersLoading kbzpaySettings={kbzpaySettings} />);
    expect(screen.getAllByText("กำลังโหลดคำสั่งซื้อ...").length).toBeGreaterThan(0);
    expect(screen.queryByText("ไม่มีคำสั่งซื้อที่รอชำระเงินผ่าน KBZPay")).toBeNull();
  });

  it("โหลด settings จาก API ด้วย store id ของออเดอร์ แล้วแสดงบัญชี", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({ success: true, data: API_SETTINGS }),
    });
    render(<KBZPayPaymentPopup open orders={sixOrders} />);
    expect(screen.getByText("กำลังโหลดข้อมูลรับชำระจากร้านค้า...")).toBeTruthy();
    await waitFor(() => expect(screen.getAllByText("sai tun aye").length).toBeGreaterThan(0));
    const calledUrl = globalThis.fetch.mock.calls.find((c) =>
      String(c[0]).includes(`/stores/${STORE_ID}/kbzpay-settings`)
    );
    expect(calledUrl).toBeTruthy();
  });

  it("เรนเดอร์ใหม่ด้วยออเดอร์ชุดเดิมไม่ยิง settings ซ้ำ (StrictMode รวมถึง effect ซ้ำ)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({ success: true, data: API_SETTINGS }),
    });
    globalThis.fetch = fetchMock;
    const tree = (orders) => (
      <React.StrictMode>
        <KBZPayPaymentPopup open orders={orders} />
      </React.StrictMode>
    );
    const { rerender } = render(tree(sixOrders));
    await waitFor(() => expect(screen.getAllByText("sai tun aye").length).toBeGreaterThan(0));

    rerender(tree([...sixOrders]));
    await waitFor(() => expect(screen.getAllByText("sai tun aye").length).toBeGreaterThan(0));

    const settingsCalls = fetchMock.mock.calls.filter((call) =>
      String(call[0]).includes(`/stores/${STORE_ID}/kbzpay-settings`)
    );
    expect(settingsCalls).toHaveLength(1);
  });

  it("checkout mode: checkoutStores ซ้ำ store เดิมต้องเป็นกลุ่มเดียวและไม่คูณยอด MMK", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const duplicateStore = {
      storeId: STORE_ID,
      storeName: STORE_NAME,
      currency: "MMK",
      amountMmk: 1234,
    };
    const { container } = render(
      <KBZPayPaymentPopup
        open
        checkoutMode
        checkoutStores={[duplicateStore, { ...duplicateStore }]}
        kbzpaySettings={kbzpaySettings}
      />
    );

    expect(container.querySelectorAll(".kbzpay-store-group")).toHaveLength(1);
    expect(container.textContent).toContain("1,234.00");
    expect(container.textContent).not.toContain("2,468.00");
    expect(
      errorSpy.mock.calls.some((args) => String(args[0]).includes("same key"))
    ).toBe(false);
  });

  it("ปิดแล้วเปิดใหม่ในรอบเดิมไม่ยิง settings ซ้ำ", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({ success: true, data: API_SETTINGS }),
    });
    globalThis.fetch = fetchMock;
    const tree = (open) => (
      <React.StrictMode>
        <KBZPayPaymentPopup open={open} orders={sixOrders} />
      </React.StrictMode>
    );
    const { rerender } = render(tree(true));
    await waitFor(() => expect(screen.getAllByText("sai tun aye").length).toBeGreaterThan(0));

    rerender(tree(false));
    rerender(tree(true));
    await waitFor(() => expect(screen.getAllByText("sai tun aye").length).toBeGreaterThan(0));

    const settingsCalls = fetchMock.mock.calls.filter((call) =>
      String(call[0]).includes(`/stores/${STORE_ID}/kbzpay-settings`)
    );
    expect(settingsCalls).toHaveLength(1);
  });

  it("โหลด settings หลายร้านแยกตาม storeId โดยไม่ยิงซ้ำ", async () => {
    const OTHER_STORE = "other-store-id";
    const otherSettings = {
      storeId: OTHER_STORE,
      storeName: "Other Shop",
      accountName: "other shop",
      phoneNumber: "0911111111",
      receiverName: "other receiver",
      qrUrl: "https://kindee.example/qr-other.png",
      enabled: true,
    };
    const fetchMock = vi.fn((url) =>
      Promise.resolve({
        status: 200,
        ok: true,
        json: async () => ({
          success: true,
          data: String(url).includes(OTHER_STORE) ? otherSettings : API_SETTINGS,
        }),
      })
    );
    globalThis.fetch = fetchMock;
    const order = {
      id: "order-multi-api",
      order_number: "ORD-MULTI-API",
      status: "pending",
      payment_status: "pending",
      payment_method: "kbzpay",
      total_amount: 999,
      amount_mmk: 5000,
      created_at: "2026-11-21T10:00:00Z",
      store_orders: [
        { id: "so-api-1", store: { id: STORE_ID, name: STORE_NAME } },
        { id: "so-api-2", store: { id: OTHER_STORE, name: "Other Shop" } },
      ],
    };

    render(
      <React.StrictMode>
        <KBZPayPaymentPopup open orders={[order]} />
      </React.StrictMode>
    );

    await waitFor(() => expect(screen.getByText("other shop")).toBeTruthy());
    const settingsCalls = fetchMock.mock.calls.filter((call) =>
      String(call[0]).includes("/kbzpay-settings")
    );
    expect(settingsCalls.filter((call) => String(call[0]).includes(STORE_ID))).toHaveLength(1);
    expect(settingsCalls.filter((call) => String(call[0]).includes(OTHER_STORE))).toHaveLength(1);
  });

  it("แสดง Error state เมื่อโหลด settings ไม่สำเร็จ", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    render(<KBZPayPaymentPopup open orders={sixOrders} />);
    await waitFor(() =>
      expect(screen.getByText("ไม่สามารถโหลดการตั้งค่าร้านค้าบางร้านได้")).toBeTruthy()
    );
  });

  it("เลือกไฟล์สลิปแล้วแสดงตัวอย่าง (ไม่มีปุ่มส่งสลิปแยกต่อร้าน)", () => {
    const { container } = render(
      <KBZPayPaymentPopup open orders={sixOrders} kbzpaySettings={kbzpaySettings} />
    );
    const input = container.querySelector('input[type="file"]');
    fireEvent.change(input, { target: { files: [pngFile()] } });
    const preview = container.querySelector(".kbzpay-slip-preview-img");
    expect(preview).toBeTruthy();
    expect(preview.getAttribute("src")).toBe("blob:mock-preview");
    expect(screen.queryByText("ส่งสลิป")).toBeNull();
  });

  it("ปฏิเสธไฟล์ที่ไม่ใช่ภาพ และไม่แสดงตัวอย่าง", () => {
    const { container } = render(
      <KBZPayPaymentPopup open orders={sixOrders} kbzpaySettings={kbzpaySettings} />
    );
    const input = container.querySelector('input[type="file"]');
    const pdf = new File([new Uint8Array([1])], "doc.pdf", { type: "application/pdf" });
    fireEvent.change(input, { target: { files: [pdf] } });
    expect(screen.getByText("รองรับเฉพาะไฟล์ PNG, JPG, JPEG, WEBP")).toBeTruthy();
    expect(container.querySelector(".kbzpay-slip-preview-img")).toBeNull();
  });

  it("ปฏิเสธไฟล์ที่ใหญ่เกิน 10MB", () => {
    const { container } = render(
      <KBZPayPaymentPopup open orders={sixOrders} kbzpaySettings={kbzpaySettings} />
    );
    const input = container.querySelector('input[type="file"]');
    const big = { name: "big.png", type: "image/png", size: 11 * 1024 * 1024 };
    fireEvent.change(input, { target: { files: [big] } });
    expect(screen.getByText("ไฟล์สลิปมีขนาดใหญ่เกิน 10MB")).toBeTruthy();
    expect(container.querySelector(".kbzpay-slip-preview-img")).toBeNull();
  });

  it("Footer button แสดงคำว่า 'ตกลง' (ไม่ใช่ 'ปิด')", () => {
    render(<KBZPayPaymentPopup open orders={sixOrders} kbzpaySettings={kbzpaySettings} />);
    expect(screen.getByText("ตกลง")).toBeTruthy();
    expect(screen.queryByText("ปิด")).toBeNull();
  });

  it("กด 'ตกลง' โดยไม่แนบสลิป ต้องแสดง Popup แจ้งเตือน และ Popup หลักยังเปิดอยู่ และไม่เรียก API", () => {
    const onClose = vi.fn();
    render(
      <KBZPayPaymentPopup open orders={sixOrders} kbzpaySettings={kbzpaySettings} onClose={onClose} />
    );
    fireEvent.click(screen.getByRole("button", { name: "ตกลง" }));
    expect(screen.getByText("แจ้งเตือน")).toBeTruthy();
    expect(screen.getByText("กรุณาชำระเงินก่อน แล้วนำสลิปมาแนบ แล้วกดตกลงใหม่")).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
    expect(submitStorePaymentSlips).not.toHaveBeenCalled();
  });

  it("กดปิด Popup แจ้งเตือน แล้ว Popup หลักยังเปิดอยู่", () => {
    const onClose = vi.fn();
    render(
      <KBZPayPaymentPopup open orders={sixOrders} kbzpaySettings={kbzpaySettings} onClose={onClose} />
    );
    fireEvent.click(screen.getByRole("button", { name: "ตกลง" }));
    const alertBtn = screen.getByText("ตกลง", { selector: '.kbzpay-alert-btn' });
    fireEvent.click(alertBtn);
    expect(screen.queryByText("แจ้งเตือน")).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("ยังไม่เลือกไฟล์สลิป กด 'ตกลง' แล้วต้องเตือน และ Popup หลักยังเปิดอยู่", () => {
    const onClose = vi.fn();
    const { container } = render(
      <KBZPayPaymentPopup open orders={sixOrders} kbzpaySettings={kbzpaySettings} onClose={onClose} />
    );
    expect(container.querySelector(".kbzpay-slip-preview-img")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "ตกลง" }));
    expect(screen.getByText("กรุณาชำระเงินก่อน แล้วนำสลิปมาแนบ แล้วกดตกลงใหม่")).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
    expect(submitStorePaymentSlips).not.toHaveBeenCalled();
  });

  it("ไฟล์สลิปไม่ผ่าน validation กด 'ตกลง' ไม่ได้ และ Popup หลักยังเปิดอยู่", () => {
    const onClose = vi.fn();
    const { container } = render(
      <KBZPayPaymentPopup open orders={sixOrders} kbzpaySettings={kbzpaySettings} onClose={onClose} />
    );
    const input = container.querySelector('input[type="file"]');
    const pdf = new File([new Uint8Array([1])], "doc.pdf", { type: "application/pdf" });
    fireEvent.change(input, { target: { files: [pdf] } });
    expect(screen.getByText("รองรับเฉพาะไฟล์ PNG, JPG, JPEG, WEBP")).toBeTruthy();
    expect(container.querySelector(".kbzpay-slip-preview-img")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "ตกลง" }));
    expect(screen.getByText("กรุณาชำระเงินก่อน แล้วนำสลิปมาแนบ แล้วกดตกลงใหม่")).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
    expect(submitStorePaymentSlips).not.toHaveBeenCalled();
  });

  it("เปลี่ยนไฟล์แล้วไฟล์ใหม่ไม่ผ่าน validation ต้องกลับไปเตือนเมื่อกด 'ตกลง'", () => {
    const onClose = vi.fn();
    const { container } = render(
      <KBZPayPaymentPopup open orders={sixOrders} kbzpaySettings={kbzpaySettings} onClose={onClose} />
    );
    const input = container.querySelector('input[type="file"]');
    fireEvent.change(input, { target: { files: [pngFile()] } });
    expect(container.querySelector(".kbzpay-slip-preview-img")).toBeTruthy();
    const pdf = new File([new Uint8Array([1])], "doc.pdf", { type: "application/pdf" });
    fireEvent.change(input, { target: { files: [pdf] } });
    expect(container.querySelector(".kbzpay-slip-preview-img")).toBeNull();
    expect(screen.getByText("รองรับเฉพาะไฟล์ PNG, JPG, JPEG, WEBP")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "ตกลง" }));
    expect(screen.getByText("กรุณาชำระเงินก่อน แล้วนำสลิปมาแนบ แล้วกดตกลงใหม่")).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("Multi-store: แนบสลิปไม่ครบทุกกลุ่มร้านค้า กด 'ตกลง' ไม่ได้ และไม่เรียก API", () => {
    const onClose = vi.fn();
    const OTHER_STORE = "other-store-id";
    const multiSettings = {
      [STORE_ID]: API_SETTINGS,
      [OTHER_STORE]: {
        storeId: OTHER_STORE,
        storeName: "Other Shop",
        accountName: "other shop",
        phoneNumber: "0911111111",
        receiverName: "other receiver",
        qrUrl: "https://kindee.example/qr-other.png",
        enabled: true,
      },
    };
    const order = {
      id: "order-multi",
      order_number: "ORD-MULTI",
      status: "pending",
      payment_status: "pending",
      payment_method: "kbzpay",
      total_amount: 999,
      amount_mmk: 5000,
      created_at: "2026-11-21T10:00:00Z",
      store_orders: [
        { id: "so-cur", store_order_number: "SO-CUR", status: "pending", total_amount: 999,
          store: { id: STORE_ID, name: STORE_NAME } },
        { id: "so-oth", store_order_number: "SO-OTH", status: "pending", total_amount: 999,
          store: { id: OTHER_STORE, name: "Other Shop" } },
      ],
    };
    const { container } = render(
      <KBZPayPaymentPopup open orders={[order]} kbzpaySettings={multiSettings} onClose={onClose} />
    );
    const inputs = container.querySelectorAll('input[type="file"]');
    expect(inputs.length).toBe(2);
    fireEvent.change(inputs[0], { target: { files: [pngFile()] } });
    expect(container.querySelectorAll(".kbzpay-slip-preview-img").length).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: "ตกลง" }));
    expect(screen.getByText("กรุณาชำระเงินก่อน แล้วนำสลิปมาแนบ แล้วกดตกลงใหม่")).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
    expect(submitStorePaymentSlips).not.toHaveBeenCalled();
  });

  it("ส่งสลิปสำเร็จ: กด 'ตกลง' เรียก API ต่อร้านค้า พร้อม orderIds และไฟล์ แล้วปิด Popup และเรียก onSubmitted", async () => {
    submitStorePaymentSlips.mockResolvedValue({ success: true });
    const onClose = vi.fn();
    const onSubmitted = vi.fn();
    const { container } = render(
      <KBZPayPaymentPopup
        open
        orders={sixOrders}
        kbzpaySettings={kbzpaySettings}
        onClose={onClose}
        onSubmitted={onSubmitted}
      />
    );
    fireEvent.change(container.querySelector('input[type="file"]'), { target: { files: [pngFile()] } });
    expect(screen.getByText("ตกลง")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "ตกลง" }));

    // Loading ขณะส่ง
    expect(screen.getByText("กำลังส่งสลิป...")).toBeTruthy();
    expect(screen.getByRole("button", { name: "กำลังส่งสลิป..." }).disabled).toBe(true);

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onSubmitted).toHaveBeenCalledTimes(1));

    // API called once with store id + all 6 order ids + file
    expect(submitStorePaymentSlips).toHaveBeenCalledTimes(1);
    const [storeIdArg, orderIdsArg, fileArg] = submitStorePaymentSlips.mock.calls[0];
    expect(storeIdArg).toBe(STORE_ID);
    expect(orderIdsArg.sort()).toEqual(["order-1", "order-2", "order-3", "order-4", "order-5", "order-6"]);
    expect(fileArg).toBeInstanceOf(File);
  });

  it("ส่งสลิปสำเร็จครบทุกกลุ่มร้านค้าแล้วจึงปิด Popup", async () => {
    submitStorePaymentSlips.mockResolvedValue({ success: true });
    const onClose = vi.fn();
    const OTHER_STORE = "other-store-id";
    const multiSettings = {
      [STORE_ID]: API_SETTINGS,
      [OTHER_STORE]: {
        storeId: OTHER_STORE,
        storeName: "Other Shop",
        accountName: "other shop",
        phoneNumber: "0911111111",
        receiverName: "other receiver",
        qrUrl: "https://kindee.example/qr-other.png",
        enabled: true,
      },
    };
    const order = {
      id: "order-multi",
      order_number: "ORD-MULTI",
      status: "pending",
      payment_status: "pending",
      payment_method: "kbzpay",
      total_amount: 999,
      amount_mmk: 5000,
      created_at: "2026-11-21T10:00:00Z",
      store_orders: [
        { id: "so-cur", store_order_number: "SO-CUR", status: "pending", total_amount: 999,
          store: { id: STORE_ID, name: STORE_NAME } },
        { id: "so-oth", store_order_number: "SO-OTH", status: "pending", total_amount: 999,
          store: { id: OTHER_STORE, name: "Other Shop" } },
      ],
    };
    const { container } = render(
      <KBZPayPaymentPopup open orders={[order]} kbzpaySettings={multiSettings} onClose={onClose} />
    );
    const inputs = container.querySelectorAll('input[type="file"]');
    fireEvent.change(inputs[0], { target: { files: [pngFile()] } });
    fireEvent.change(inputs[1], { target: { files: [pngFile()] } });
    fireEvent.click(screen.getByRole("button", { name: "ตกลง" }));
    // เรียก API ทั้ง 2 กลุ่มร้านค้า
    await waitFor(() => expect(submitStorePaymentSlips).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it("ส่งสลิปล้มเหลว: แสดงข้อผิดพลาด คง Popup ไว้ และไม่เรียก onClose / onSubmitted", async () => {
    submitStorePaymentSlips.mockRejectedValue(new Error("อัปโหลดสลิปไม่สำเร็จ"));
    const onClose = vi.fn();
    const onSubmitted = vi.fn();
    const { container } = render(
      <KBZPayPaymentPopup
        open
        orders={sixOrders}
        kbzpaySettings={kbzpaySettings}
        onClose={onClose}
        onSubmitted={onSubmitted}
      />
    );
    fireEvent.change(container.querySelector('input[type="file"]'), { target: { files: [pngFile()] } });
    fireEvent.click(screen.getByRole("button", { name: "ตกลง" }));

    await waitFor(() => expect(screen.getByText("อัปโหลดสลิปไม่สำเร็จ")).toBeTruthy());
    expect(screen.queryByText("ส่งสลิปเรียบร้อยแล้ว รอร้านค้าตรวจสอบ")).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    expect(onSubmitted).not.toHaveBeenCalled();
    // Popup ยังเปิดอยู่ สามารถลองส่งใหม่ได้
    fireEvent.click(screen.getByRole("button", { name: "ตกลง" }));
    expect(submitStorePaymentSlips).toHaveBeenCalledTimes(2);
  });

  it("ป้องกันการกดส่งซ้ำระหว่างประมวลผล (ส่งครั้งเดียว)", async () => {
    let resolveSubmit;
    submitStorePaymentSlips.mockReturnValue(new Promise((r) => { resolveSubmit = r; }));
    const { container } = render(
      <KBZPayPaymentPopup open orders={sixOrders} kbzpaySettings={kbzpaySettings} />
    );
    fireEvent.change(container.querySelector('input[type="file"]'), { target: { files: [pngFile()] } });
    fireEvent.click(screen.getByRole("button", { name: "ตกลง" }));
    expect(screen.getByText("กำลังส่งสลิป...").disabled).toBe(true);
    expect(submitStorePaymentSlips).toHaveBeenCalledTimes(1);
    resolveSubmit({ success: true });
    await waitFor(() => expect(submitStorePaymentSlips).toHaveBeenCalledTimes(1));
  });

  it("การปิด Popup โดย X โดยไม่ส่งสลิปต้องไม่เรียก API ส่งสลิป", () => {
    const onClose = vi.fn();
    const { container } = render(
      <KBZPayPaymentPopup open orders={sixOrders} kbzpaySettings={kbzpaySettings} onClose={onClose} />
    );
    fireEvent.change(container.querySelector('input[type="file"]'), { target: { files: [pngFile()] } });
    expect(container.querySelector(".kbzpay-slip-preview-img")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "ปิด" }));
    expect(onClose).toHaveBeenCalled();
    expect(submitStorePaymentSlips).not.toHaveBeenCalled();
  });
});
