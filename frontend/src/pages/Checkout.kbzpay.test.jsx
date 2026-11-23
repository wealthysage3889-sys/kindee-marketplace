import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

// Mock URL.createObjectURL/revokeObjectURL (not available in jsdom) used by
// KBZPayPaymentPopup.setPreviewFor when selecting slip files.
Object.defineProperty(globalThis.URL, "createObjectURL", {
  writable: true,
  configurable: true,
  value: vi.fn(() => "blob:mock-url"),
});
Object.defineProperty(globalThis.URL, "revokeObjectURL", {
  writable: true,
  configurable: true,
  value: vi.fn(),
});

const {
  orderCreate,
  orderCancel,
  submitStorePaymentSlips,
  navigateMock,
  cartClearMock,
  kbzpaySettingsMock,
} = vi.hoisted(() => ({
  orderCreate: vi.fn(),
  orderCancel: vi.fn(),
  submitStorePaymentSlips: vi.fn(),
  navigateMock: vi.fn(),
  cartClearMock: vi.fn(),
  kbzpaySettingsMock: vi.fn((sid) =>
    Promise.resolve({ success: true, data: { storeId: sid, storeName: "ร้าน " + sid, accountName: "test acc", phoneNumber: "0900000000", receiverName: "test receiver", qrUrl: "https://example/qr.png", enabled: true } })
  ),
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => navigateMock,
  useLocation: () => ({ pathname: "/cart", search: "", state: null }),
}));

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    user: { name: "Test User", phone: "+66812345678" },
    isAuthenticated: true,
  }),
}));

const CART = {
  items: [
    { id: "p1", name: "Product A", price: 1000, quantity: 2, storeId: "s1" },
    { id: "p2", name: "Product B", price: 500, quantity: 1, storeId: "s2" },
  ],
  totalPrice: 2500,
  totalCount: 3,
  clear: cartClearMock,
};

vi.mock("../context/CartContext", () => ({
  useCart: () => CART,
}));

vi.mock("html2canvas", () => ({ default: vi.fn() }));

// โมดูลระดับสำหรับควบคุมอัตราแลกเปลี่ยนและการตั้งค่าร้านค้า (ใช้ inline factory
// จึงไม่ถูก vitest restoreMocks ล้างค่า ร่วมกับ vi.fn() ที่ตั้งไว้ในแต่ละ test)
let rateValue = "145";
let kbzpaySettingsValue = null;
function mockRate(value) {
  rateValue = String(value);
}
function mockSettings(data) {
  kbzpaySettingsValue = data;
}

const STORE_S1 = { id: "s1", name: "ร้าน A", deliveryFee: 20 };
const STORE_S2 = { id: "s2", name: "ร้าน B", deliveryFee: 30 };

const KBZPAY_SETTINGS = {
  s1: {
    storeId: "s1",
    storeName: "ร้าน A",
    accountName: "sai tun aye",
    phoneNumber: "09789299668",
    receiverName: "sai tun aye",
    qrUrl: "https://kindee.example/qr-a.png",
    enabled: true,
  },
  s2: {
    storeId: "s2",
    storeName: "ร้าน B",
    accountName: "other shop",
    phoneNumber: "0911111111",
    receiverName: "other receiver",
    qrUrl: "https://kindee.example/qr-b.png",
    enabled: true,
  },
};

const ORDER_SUMMARY = { totalShippingFee: 50, totalTax: 0, totalAmount: 2550, vatRate: 7 };

const pngFile = (name = "slip.png") =>
  new File([new Uint8Array([1, 2, 3])], name, { type: "image/png" });

// เคลียร์ microtask queue โดยไม่ใช้ setTimeout / waitFor (ทำให้ vitest ค้างในสภาพแวดล้อมนี้)
const flushPromises = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};

// ฟลัช microtask จากนั้นฟลัชอัปเดตสเตตของ React ภายใน act
const flushAndRender = async () => {
  await flushPromises();
  await act(() => {});
};

vi.mock("../api", () => ({
  orderAPI: {
    create: (...a) => orderCreate(...a),
    cancel: (...a) => orderCancel(...a),
    submitStorePaymentSlips: (...a) => submitStorePaymentSlips(...a),
  },
  storeAPI: {
    getById: (...a) => ({ data: a[0] === "s1" ? STORE_S1 : STORE_S2 }),
  },
  settingsAPI: {
    getByKey: (key) => {
      if (key === "exchange_rate_thb_mmk") return { data: { value: rateValue } };
      if (key === "vat_rate") return { data: { value: "7" } };
      throw new Error(`unexpected settings key ${key}`);
    },
  },
  addressAPI: { getAddresses: (...a) => ({ data: [] }) },
}));

vi.mock("../api/product", () => ({
  storeAPI: {
    getKbzpaySettings: kbzpaySettingsMock,
  },
}));

import Checkout from "./Checkout";

function renderCheckout(props = {}) {
  return render(
    <Checkout
      initialStep={3}
      initialPaymentMethod="kbzpay"
      orderSummary={ORDER_SUMMARY}
      kbzpaySettings={KBZPAY_SETTINGS}
      {...props}
    />
  );
}

async function openKbzpayPopup() {
  await flushAndRender();
  fireEvent.click(screen.getByRole("button", { name: "ยืนยันสั่งซื้อ" }));
  await flushPromises();
}

describe("Checkout KBZPay flow — order must not be created before slip success", () => {
  beforeEach(() => {
    orderCreate.mockReset();
    orderCancel.mockReset();
    submitStorePaymentSlips.mockReset();
    navigateMock.mockReset();
    cartClearMock.mockReset();
    kbzpaySettingsMock.mockImplementation((sid) =>
      Promise.resolve({ success: true, data: { storeId: sid, storeName: "ร้าน " + sid, accountName: "test acc", phoneNumber: "0900000000", receiverName: "test receiver", qrUrl: "https://example/qr.png", enabled: true } })
    );
    rateValue = "145";
    kbzpaySettingsValue = null;
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition: vi.fn((success) =>
          success({ coords: { latitude: 16, longitude: 96 } })
        ),
      },
    });
  });

  it("สคริป 1: เลือก KBZPay แล้วกด ยืนยันสั่งซื้อ ต้องเปิด Popup และยังไม่มีการเรียก API สร้าง Order", async () => {
    mockRate(145);
    mockSettings(KBZPAY_SETTINGS.s1);
    renderCheckout();

    await openKbzpayPopup();

    expect(orderCreate).not.toHaveBeenCalled();
    expect(orderCancel).not.toHaveBeenCalled();
    expect(submitStorePaymentSlips).not.toHaveBeenCalled();
  });

  it("สคริป 2: กด ตกลง โดยไม่แนบสลิป ต้องไม่สร้าง Order และแสดงข้อความแจ้งให้แนบสลิป", async () => {
    mockRate(145);
    mockSettings(KBZPAY_SETTINGS.s1);
    renderCheckout();

    await openKbzpayPopup();

    fireEvent.click(screen.getByRole("button", { name: "ตกลง" }));
    await flushAndRender();
    expect(screen.getByText("กรุณาชำระเงินก่อน แล้วนำสลิปมาแนบ แล้วกดตกลงใหม่")).toBeTruthy();

    expect(orderCreate).not.toHaveBeenCalled();
    expect(orderCancel).not.toHaveBeenCalled();
    expect(submitStorePaymentSlips).not.toHaveBeenCalled();
    expect(cartClearMock).not.toHaveBeenCalled();
    expect(screen.getByText("ข้อมูลรับชำระเงิน KBZPay")).toBeTruthy();
  });

  it("สคริป 3: แนบสลิปแล้วอัปโหลดล้มเหลว ต้องยกเลิก Order ไม่ให้เหลือ Order โดยไม่มีสลิป", async () => {
    mockRate(145);
    mockSettings(KBZPAY_SETTINGS.s1);
    submitStorePaymentSlips.mockRejectedValue(new Error("อัปโหลดสลิปไม่สำเร็จ"));
    orderCreate.mockResolvedValue({
      success: true,
      data: {
        id: "order-1",
        store_orders: [
          { id: "so-1", store_id: "s1", store: STORE_S1 },
          { id: "so-2", store_id: "s2", store: STORE_S2 },
        ],
      },
    });
    renderCheckout();

    await openKbzpayPopup();

    const inputs = screen.getAllByLabelText("เลือกไฟล์สลิป");
    fireEvent.change(inputs[0], { target: { files: [pngFile()] } });
    fireEvent.change(inputs[1], { target: { files: [pngFile()] } });

    fireEvent.click(screen.getByRole("button", { name: "ตกลง" }));
    await flushAndRender();

    expect(orderCreate).toHaveBeenCalledTimes(1);
    expect(submitStorePaymentSlips).toHaveBeenCalledTimes(2);
    // Rollback: ยกเลิก Order ที่สร้างแล้วเพราะอัปโหลดสลิปไม่สำเร็จ
    expect(orderCancel).toHaveBeenCalledTimes(1);
    expect(screen.getByText("อัปโหลดสลิปไม่สำเร็จ")).toBeTruthy();
    expect(cartClearMock).not.toHaveBeenCalled();
    expect(screen.getByText("ข้อมูลรับชำระเงิน KBZPay")).toBeTruthy();
  });

  it("สคริป 4: แนบสลิปและทำรายการสำเร็จ ต้องมี Order พร้อมสลิป และสถานะ awaiting_review (กำหนดโดย backend)", async () => {
    mockRate(145);
    mockSettings(KBZPAY_SETTINGS.s1);
    orderCreate.mockResolvedValue({
      success: true,
      data: {
        id: "order-1",
        store_orders: [
          { id: "so-1", store_id: "s1", store: STORE_S1 },
          { id: "so-2", store_id: "s2", store: STORE_S2 },
        ],
      },
    });
    submitStorePaymentSlips.mockResolvedValue({ success: true });
    renderCheckout();

    await openKbzpayPopup();

    const inputs = screen.getAllByLabelText("เลือกไฟล์สลิป");
    fireEvent.change(inputs[0], { target: { files: [pngFile()] } });
    fireEvent.change(inputs[1], { target: { files: [pngFile()] } });

    fireEvent.click(screen.getByRole("button", { name: "ตกลง" }));
    await flushAndRender();

    expect(orderCreate).toHaveBeenCalledTimes(1);
    expect(submitStorePaymentSlips).toHaveBeenCalledTimes(2);
    const calls = submitStorePaymentSlips.mock.calls;
    expect(calls[0][0]).toBe("s1");
    expect(calls[0][1]).toEqual(["order-1"]);
    expect(calls[1][0]).toBe("s2");
    expect(calls[1][1]).toEqual(["order-1"]);
    calls.forEach(([, , fileArg]) => expect(fileArg).toBeInstanceOf(File));
    expect(cartClearMock).toHaveBeenCalledTimes(1);
    expect(navigateMock).toHaveBeenCalledWith("/orders/order-1");
    expect(orderCancel).not.toHaveBeenCalled();
  });

  it("สคริป 8: Multi-store — ผูกสลิปกับ Order ของแต่ละร้านค้าได้ถูกต้อง", async () => {
    mockRate(145);
    mockSettings(KBZPAY_SETTINGS.s1);
    orderCreate.mockResolvedValue({
      success: true,
      data: {
        id: "order-multi",
        store_orders: [
          { id: "so-a", store_id: "s1", store: STORE_S1 },
          { id: "so-b", store_id: "s2", store: STORE_S2 },
        ],
      },
    });
    submitStorePaymentSlips.mockResolvedValue({ success: true });
    renderCheckout();

    await openKbzpayPopup();

    const inputs = screen.getAllByLabelText("เลือกไฟล์สลิป");
    expect(inputs.length).toBe(2);
    fireEvent.change(inputs[0], { target: { files: [pngFile("slip-a.png")] } });
    fireEvent.change(inputs[1], { target: { files: [pngFile("slip-b.png")] } });

    fireEvent.click(screen.getByRole("button", { name: "ตกลง" }));
    await flushAndRender();

    expect(orderCreate).toHaveBeenCalledTimes(1);
    expect(submitStorePaymentSlips).toHaveBeenCalledTimes(2);
    const calls = submitStorePaymentSlips.mock.calls;
    expect(calls[0][0]).toBe("s1");
    expect(calls[0][1]).toEqual(["order-multi"]);
    expect(calls[1][0]).toBe("s2");
    expect(calls[1][1]).toEqual(["order-multi"]);
    expect(orderCancel).not.toHaveBeenCalled();
    expect(cartClearMock).toHaveBeenCalledTimes(1);
  });

  it("สคริป 6: ปิด Popup ก่อนส่งสลิปสำเร็จ ต้องไม่มี Order ใหม่เกิดขึ้น", async () => {
    mockRate(145);
    mockSettings(KBZPAY_SETTINGS.s1);
    renderCheckout();

    await openKbzpayPopup();

    fireEvent.click(screen.getByRole("button", { name: "ปิด" }));
    await flushAndRender();

    expect(orderCreate).not.toHaveBeenCalled();
    expect(orderCancel).not.toHaveBeenCalled();
    expect(submitStorePaymentSlips).not.toHaveBeenCalled();
    expect(screen.queryByText("ข้อมูลรับชำระเงิน KBZPay")).toBeNull();
  });

  it("สคริป 9: ปิดแล้วเปิด Popup ใน Checkout รอบเดิม ไม่ยิง KBZPay settings ซ้ำ", async () => {
    mockRate(145);
    renderCheckout({ kbzpaySettings: undefined });

    await openKbzpayPopup();
    await flushAndRender();
    expect(screen.getAllByText("test acc").length).toBeGreaterThan(0);
    const callsAfterFirstOpen = kbzpaySettingsMock.mock.calls.length;
    expect(callsAfterFirstOpen).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "ปิด" }));
    await flushAndRender();
    fireEvent.click(screen.getByRole("button", { name: "ยืนยันสั่งซื้อ" }));
    await flushAndRender();

    expect(screen.getByText("ข้อมูลรับชำระเงิน KBZPay")).toBeTruthy();
    expect(kbzpaySettingsMock.mock.calls.length).toBe(callsAfterFirstOpen);
    expect(orderCreate).not.toHaveBeenCalled();
  });
});

describe("Checkout — วิธีชำระเงินอื่นยังคงทำงานตามเดิม", () => {
  beforeEach(() => {
    orderCreate.mockReset();
    cartClearMock.mockReset();
    kbzpaySettingsMock.mockImplementation((sid) =>
      Promise.resolve({ success: true, data: { storeId: sid, storeName: "ร้าน " + sid, accountName: "test acc", phoneNumber: "0900000000", receiverName: "test receiver", qrUrl: "https://example/qr.png", enabled: true } })
    );
    rateValue = "145";
    kbzpaySettingsValue = null;
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition: vi.fn((success) =>
          success({ coords: { latitude: 16, longitude: 96 } })
        ),
      },
    });
  });

  it("สคริป 7: COD ต้องสร้าง Order ปกติ ไม่เปิด KBZPay Popup", async () => {
    mockRate(145);
    orderCreate.mockResolvedValue({ success: true, data: { id: "order-cod" } });
    render(<Checkout initialStep={3} initialPaymentMethod="cod" orderSummary={ORDER_SUMMARY} />);
    fireEvent.click(screen.getByRole("button", { name: "ยืนยันสั่งซื้อ" }));
    await flushPromises();
    expect(orderCreate).toHaveBeenCalledTimes(1);
    expect(cartClearMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("ข้อมูลรับชำระเงิน KBZPay")).toBeNull();
  });
});
