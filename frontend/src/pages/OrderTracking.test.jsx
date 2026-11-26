import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import OrderTracking from "./OrderTracking";

const { getById, submitStorePaymentSlips } = vi.hoisted(() => ({
  getById: vi.fn(),
  submitStorePaymentSlips: vi.fn(),
}));

const { getKbzpaySettings } = vi.hoisted(() => ({
  getKbzpaySettings: vi.fn(),
}));

vi.mock("react-router-dom", () => ({
  useParams: () => ({ id: "order-1" }),
  useNavigate: () => vi.fn(),
}));

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({ user: { id: "cust-1", name: "Test Customer", role: "customer" } }),
}));

vi.mock("../context/SocketContext", () => ({
  useSocket: () => ({ on: vi.fn(), off: vi.fn() }),
}));

vi.mock("react-leaflet", () => ({
  MapContainer: ({ children }) => <div data-testid="map-container">{children}</div>,
  TileLayer: () => null,
  Marker: () => null,
  Popup: ({ children }) => <div>{children}</div>,
  Polyline: () => null,
}));

vi.mock("../api", () => ({
  orderAPI: {
    getById: (...args) => getById(...args),
    submitStorePaymentSlips: (...args) => submitStorePaymentSlips(...args),
  },
  deliveryAPI: {},
}));

vi.mock("../api/product", () => ({
  storeAPI: {
    getKbzpaySettings: (...args) => getKbzpaySettings(...args),
  },
}));

const STORE_ID = "store-1";
const STORE_NAME = "ร้านทดสอบ";

const API_SETTINGS = {
  storeId: STORE_ID,
  storeName: STORE_NAME,
  accountName: "sai tun aye",
  phoneNumber: "09789299668",
  receiverName: "sai tun aye",
  qrUrl: "https://kindee.example/storage/qr-kindee.png",
  enabled: true,
};

const pngFile = () => new File([new Uint8Array([1, 2, 3])], "slip.png", { type: "image/png" });

const kbzpayOrder = (overrides = {}) => ({
  id: "order-1",
  order_number: "ORD-001",
  status: "pending",
  payment_status: "pending",
  payment_method: "kbzpay",
  total_amount: 5019,
  amount_mmk: 727755,
  subtotal: 4800,
  shipping_fee: 200,
  tax_amount: 19,
  vat_rate: 7,
  discount_amount: 0,
  created_at: "2026-11-21T10:00:00Z",
  customer_snapshot: { name: "ลูกค้า", phone: "0812345678", address: "123 ถนนทดสอบ" },
  store_orders: [
    {
      id: "so-1",
      store_order_number: "SO-1",
      status: "pending",
      total_amount: 5019,
      store: { id: STORE_ID, name: STORE_NAME, slug: "test-shop", logo_url: null },
      store_snapshot: { name: STORE_NAME },
      order_items: [],
    },
  ],
  payment_slips: [],
  ...overrides,
});

// คลิกปุ่มชำระเงินทันทีแล้วรอให้ Popup โหลดข้อมูลร้านค้าจนแสดงบัญชีครบถ้วน
const openKbzpayPopup = async () => {
  fireEvent.click(screen.getByRole("button", { name: "ชำระเงินทันที" }));
  await waitFor(() => expect(screen.getByText("09789299668")).toBeTruthy());
};

beforeEach(() => {
  getById.mockReset();
  submitStorePaymentSlips.mockReset();
  getKbzpaySettings.mockReset();
  vi.restoreAllMocks();
  globalThis.URL.createObjectURL = vi.fn(() => "blob:mock-preview");
  globalThis.URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("OrderTracking — KBZPay slip submission", () => {
  it("Order KBZPay สถานะ pending แสดงปุ่มชำระเงินทันที", async () => {
    getById.mockResolvedValue({ data: kbzpayOrder() });
    render(<OrderTracking />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "ชำระเงินทันที" })).toBeTruthy()
    );
  });

  it("กดปุ่มแล้วเปิด Popup พร้อมข้อมูลร้านค้าและยอดของ Order นั้น", async () => {
    getKbzpaySettings.mockResolvedValue({ success: true, data: API_SETTINGS });
    getById.mockResolvedValue({ data: kbzpayOrder() });
    render(<OrderTracking />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "ชำระเงินทันที" })).toBeTruthy()
    );
    await openKbzpayPopup();

    expect(screen.getByText("ข้อมูลรับชำระเงิน KBZPay")).toBeTruthy();
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(STORE_NAME)).toBeTruthy();
    expect(within(dialog).getByText("09789299668")).toBeTruthy();
    expect(within(dialog).getAllByText("sai tun aye").length).toBe(2);
    expect(within(dialog).getByAltText(`QR Code ${STORE_NAME}`)).toBeTruthy();
    expect(dialog.textContent).toContain("MMK");
    expect(dialog.textContent).toContain("727,755.00");
  });

  it("ส่งเฉพาะ Order ID ของหน้านี้ ไม่ส่งออเดอร์อื่น", async () => {
    submitStorePaymentSlips.mockResolvedValue({ success: true });
    getKbzpaySettings.mockResolvedValue({ success: true, data: API_SETTINGS });
    getById.mockResolvedValue({ data: kbzpayOrder() });
    render(<OrderTracking />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "ชำระเงินทันที" })).toBeTruthy()
    );
    await openKbzpayPopup();
    const input = screen.getByLabelText("เลือกไฟล์สลิป");
    fireEvent.change(input, { target: { files: [pngFile()] } });
    fireEvent.click(screen.getByRole("button", { name: "ตกลง" }));

    await waitFor(() => expect(submitStorePaymentSlips).toHaveBeenCalledTimes(1));
    const [storeId, orderIds, file] = submitStorePaymentSlips.mock.calls[0];
    expect(storeId).toBe(STORE_ID);
    expect(orderIds).toEqual(["order-1"]);
    expect(file).toBeInstanceOf(File);
  });

  it("ไม่แนบสลิปแล้วกดตกลงต้องเตือน และไม่เรียก API (Popup หลักยังเปิดอยู่)", async () => {
    getKbzpaySettings.mockResolvedValue({ success: true, data: API_SETTINGS });
    getById.mockResolvedValue({ data: kbzpayOrder() });
    render(<OrderTracking />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "ชำระเงินทันที" })).toBeTruthy()
    );
    await openKbzpayPopup();
    fireEvent.click(screen.getByRole("button", { name: "ตกลง" }));

    expect(screen.getByText("กรุณาชำระเงินก่อน แล้วนำสลิปมาแนบ แล้วกดตกลงใหม่")).toBeTruthy();
    expect(submitStorePaymentSlips).not.toHaveBeenCalled();
    expect(screen.getByText("ข้อมูลรับชำระเงิน KBZPay")).toBeTruthy();
  });

  it("ส่งสำเร็จแล้วสถานะเป็น awaiting_review และหน้า Tracking Refresh", async () => {
    let loadCount = 0;
    getById.mockImplementation(async () => {
      loadCount += 1;
      if (loadCount === 1) return { data: kbzpayOrder() };
      return { data: kbzpayOrder({ payment_status: "awaiting_review" }) };
    });
    submitStorePaymentSlips.mockResolvedValue({ success: true });
    getKbzpaySettings.mockResolvedValue({ success: true, data: API_SETTINGS });
    render(<OrderTracking />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "ชำระเงินทันที" })).toBeTruthy()
    );
    await openKbzpayPopup();
    const input = screen.getByLabelText("เลือกไฟล์สลิป");
    fireEvent.change(input, { target: { files: [pngFile()] } });
    fireEvent.click(screen.getByRole("button", { name: "ตกลง" }));

    await waitFor(() =>
      expect(screen.getByText("ส่งสลิปเรียบร้อยแล้ว รอร้านค้าตรวจสอบ")).toBeTruthy()
    );
    await waitFor(() => expect(screen.getByText("รอตรวจสอบสลิป")).toBeTruthy());
    expect(loadCount).toBe(2);
  });

  it("ส่งไม่สำเร็จ Popup ต้องยังเปิดอยู่ และไม่แสดงข้อความสำเร็จ", async () => {
    submitStorePaymentSlips.mockRejectedValue(new Error("อัปโหลดสลิปไม่สำเร็จ"));
    getKbzpaySettings.mockResolvedValue({ success: true, data: API_SETTINGS });
    getById.mockResolvedValue({ data: kbzpayOrder() });
    render(<OrderTracking />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "ชำระเงินทันที" })).toBeTruthy()
    );
    await openKbzpayPopup();
    const input = screen.getByLabelText("เลือกไฟล์สลิป");
    fireEvent.change(input, { target: { files: [pngFile()] } });
    fireEvent.click(screen.getByRole("button", { name: "ตกลง" }));

    await waitFor(() => expect(screen.getByText("อัปโหลดสลิปไม่สำเร็จ")).toBeTruthy());
    expect(screen.getByRole("button", { name: "ตกลง" })).toBeTruthy();
    expect(screen.queryByText("ส่งสลิปเรียบร้อยแล้ว รอร้านค้าตรวจสอบ")).toBeNull();
  });

  it("Order COD / วิธีชำระเงินอื่นไม่แสดงปุ่ม KBZPay", async () => {
    getById.mockResolvedValue({
      data: kbzpayOrder({ payment_method: "cod", payment_status: "pending", status: "pending", amount_mmk: null }),
    });
    render(<OrderTracking />);
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "ชำระเงินทันที" })).toBeNull()
    );
    expect(screen.getByText("ชำระเงินปลายทาง")).toBeTruthy();
  });

  it("Order ที่ชำระแล้วหรือรอตรวจสอบไม่แสดงปุ่มชำระเงิน", async () => {
    getById.mockResolvedValue({
      data: kbzpayOrder({ payment_status: "paid", status: "confirmed", amount_mmk: 727755 }),
    });
    render(<OrderTracking />);
    expect(screen.queryByRole("button", { name: "ชำระเงินทันที" })).toBeNull();

    getById.mockResolvedValue({
      data: kbzpayOrder({ payment_status: "awaiting_review", status: "pending", amount_mmk: 727755 }),
    });
    render(<OrderTracking />);
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "ชำระเงินทันที" })).toBeNull()
    );
  });

  it("วิธีชำระเงินแสดงชื่อถูกต้องสำหรับ KBZPay", async () => {
    getById.mockResolvedValue({ data: kbzpayOrder({ payment_method: "kbzpay" }) });
    render(<OrderTracking />);
    await waitFor(() => expect(screen.getByText("KBZPay Wallet (Myanmar)")).toBeTruthy());
    expect(screen.queryByText("โอนเงิน")).toBeNull();
  });

  it("วิธีชำระเงินอื่นแสดงชื่อตามจริง (COD / PromptPay)", async () => {
    getById.mockResolvedValue({ data: kbzpayOrder({ payment_method: "cod", amount_mmk: null }) });
    render(<OrderTracking />);
    await waitFor(() => expect(screen.getByText("ชำระเงินปลายทาง")).toBeTruthy());

    getById.mockResolvedValue({ data: kbzpayOrder({ payment_method: "promptpay", amount_mmk: null }) });
    render(<OrderTracking />);
    await waitFor(() => expect(screen.getByText("PromptPay")).toBeTruthy());
  });
});
