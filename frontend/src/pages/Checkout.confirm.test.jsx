import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

// The confirmation step (step 3) must show THB + MMK for KBZPay using the live
// THB→MMK rate, keep THB-only for other methods, and never invent an MMK amount
// when the rate failed to load.
//
// Checkout reaches step 3 through prop hooks (initialStep / initialPaymentMethod)
// so these tests render the confirmation step directly with a fixed order summary.

const { settingsGetByKey, storeGetById, addressGetAddresses, orderCreate } = vi.hoisted(() => ({
  settingsGetByKey: vi.fn(),
  storeGetById: vi.fn(),
  addressGetAddresses: vi.fn(),
  orderCreate: vi.fn(),
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => vi.fn(),
  useLocation: () => ({ pathname: "/checkout", search: "", state: null }),
}));

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    user: { name: "Test User", phone: "+66812345678" },
    isAuthenticated: true,
  }),
}));

const CART = {
  items: [{ id: "p1", name: "Test Product", price: 4999, quantity: 1, storeId: "s1" }],
  totalPrice: 4999,
  totalCount: 1,
  clear: vi.fn(),
};

vi.mock("../context/CartContext", () => ({
  useCart: () => CART,
}));

vi.mock("html2canvas", () => ({ default: vi.fn() }));

vi.mock("../api", () => ({
  addressAPI: { getAddresses: (...a) => addressGetAddresses(...a) },
  orderAPI: { create: (...a) => orderCreate(...a) },
  storeAPI: { getById: (...a) => storeGetById(...a) },
  settingsAPI: { getByKey: (...a) => settingsGetByKey(...a) },
}));

import Checkout from "./Checkout";

// Fixed order summary so the confirmation step does not depend on async store
// loading: subtotal 4999 (cart), shipping 20, VAT 0, grand total 5019.
const ORDER_SUMMARY = {
  totalShippingFee: 20,
  totalTax: 0,
  totalAmount: 5019,
  vatRate: 7,
};

// Mirrors backend roundMoney: Math.round((x + EPSILON) * 100) / 100
const roundMoney = (value) => {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return 0;
  return Math.round((amount + Number.EPSILON) * 100) / 100;
};

// th-TH number formatting identical to the component's formatMMK.
const mmk = (amount) =>
  `MMK ${new Intl.NumberFormat("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(roundMoney(amount))}`;

const thb = (amount) =>
  new Intl.NumberFormat("th-TH", {
    style: "currency",
    currency: "THB",
    minimumFractionDigits: 2,
  }).format(amount);

// A THB + MMK cell, e.g. "฿4,999.00 / MMK 724,855.00".
const dual = (thbAmount, rate) => `${thb(thbAmount)} / ${mmk(thbAmount * rate)}`;

function mockRate(value) {
  settingsGetByKey.mockImplementation(async (key) => {
    if (key === "exchange_rate_thb_mmk") {
      return { data: { value: String(value) } };
    }
    if (key === "vat_rate") {
      return { data: { value: "7" } };
    }
    throw new Error(`unexpected settings key ${key}`);
  });
}

function mockRateFailure() {
  settingsGetByKey.mockImplementation(async (key) => {
    if (key === "exchange_rate_thb_mmk") {
      throw new Error("settings unavailable");
    }
    if (key === "vat_rate") {
      return { data: { value: "7" } };
    }
    throw new Error(`unexpected settings key ${key}`);
  });
  // The API fallback must also fail so no stale/assumed rate is used.
  globalThis.fetch = vi.fn().mockRejectedValue(new Error("network down"));
}

beforeEach(() => {
  settingsGetByKey.mockReset();
  storeGetById.mockReset();
  addressGetAddresses.mockReset();
  orderCreate.mockReset();

  storeGetById.mockResolvedValue({ data: { id: "s1", deliveryFee: 20 } });
  addressGetAddresses.mockResolvedValue({ data: [] });

  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    value: {
      getCurrentPosition: vi.fn((success) =>
        success({ coords: { latitude: 16, longitude: 96 } })
      ),
    },
  });
});

describe("Checkout step 3 (order confirmation) — KBZPay MMK display", () => {
  it("KBZPay: รายการ/ราคาสินค้า/ค่าจัดส่ง/ภาษี แสดงเฉพาะ MMK, รวมทั้งสิ้นแสดงทั้งสองสกุล", async () => {
    mockRate(145);
    render(
      <Checkout
        initialStep={3}
        initialPaymentMethod="kbzpay"
        orderSummary={ORDER_SUMMARY}
      />
    );

    // Rate banner is shown with the same rate used for every amount.
    await screen.findByText(/1 THB = 145\.00 MMK/);

    // Per-item price: MMK only (item row + subtotal row both render 4999).
    expect(screen.getAllByText(mmk(4999 * 145)).length).toBe(2);
    // Subtotal / shipping / VAT: MMK only.
    expect(screen.getByText(mmk(20 * 145))).toBeTruthy();
    expect(screen.getByText(mmk(0 * 145))).toBeTruthy();

    // No bare THB cells for these rows (only the grand total shows ฿).
    expect(screen.queryByText(thb(4999))).toBeNull();
    expect(screen.queryByText(thb(20))).toBeNull();

    // Grand total keeps both currencies.
    expect(screen.getByText(dual(5019, 145))).toBeTruthy();

    // Payment method shows the real selection, not a wrong fallback.
    expect(screen.getByText("KBZPay Wallet (Myanmar)")).toBeTruthy();
    expect(screen.queryByText("โอนเงินผ่านธนาคาร")).toBeNull();
  });

  it("เปลี่ยนอัตราแลกเปลี่ยนแล้วหน้า Confirm ใช้อัตราใหม่", async () => {
    mockRate(150);
    render(
      <Checkout
        initialStep={3}
        initialPaymentMethod="kbzpay"
        orderSummary={ORDER_SUMMARY}
      />
    );

    await screen.findByText(/1 THB = 150\.00 MMK/);
    expect(screen.getByText(dual(5019, 150))).toBeTruthy();
    // The old 145 rate must not appear anywhere.
    expect(screen.queryByText(/145\.00/)).toBeNull();
  });

  it("ยอดรวม MMK ตรงกับกติกาการปัดเศษ (roundMoney) ของระบบ", async () => {
    mockRate(45.5);
    render(
      <Checkout
        initialStep={3}
        initialPaymentMethod="kbzpay"
        orderSummary={ORDER_SUMMARY}
      />
    );

    await screen.findByText(/1 THB = 45\.50 MMK/);
    // 5019 * 45.5 = 228364.5 -> MMK 228,364.50 (2 decimals, roundMoney rule).
    expect(screen.getByText(`${thb(5019)} / MMK 228,364.50`)).toBeTruthy();
  });

  it("แสดงอัตราแลกเปลี่ยนและเวลาอัปเดตในหน้าสรุป", async () => {
    mockRate(145);
    render(
      <Checkout
        initialStep={3}
        initialPaymentMethod="kbzpay"
        orderSummary={ORDER_SUMMARY}
      />
    );

    expect(await screen.findByText(/1 THB = 145\.00 MMK/)).toBeTruthy();
    expect(screen.getByText(/อัปเดตเมื่อ:/)).toBeTruthy();
  });

  it("ไม่แสดง MMK เมื่อเลือกวิธีชำระอื่น (COD)", async () => {
    const cases = [
      ["cod", "ชำระเงินปลายทาง"],
    ];
    for (const [method, label] of cases) {
      const { unmount } = render(
        <Checkout
          initialStep={3}
          initialPaymentMethod={method}
          orderSummary={ORDER_SUMMARY}
        />
      );
      // THB-only amounts are shown, no MMK amount anywhere.
      expect(screen.getByText(thb(5019))).toBeTruthy();
      expect(screen.queryByText(/MMK [\d,]/)).toBeNull();
      // Payment method label matches the real selection.
      expect(screen.getByText(label)).toBeTruthy();
      unmount();
    }
  });

  it("ไม่แสดงยอด MMK ที่ผิดพลาดเมื่อโหลดอัตราแลกเปลี่ยนไม่สำเร็จ และป้องกันการยืนยัน", async () => {
    mockRateFailure();
    render(
      <Checkout
        initialStep={3}
        initialPaymentMethod="kbzpay"
        orderSummary={ORDER_SUMMARY}
      />
    );

    // Clear error state is shown instead of a fabricated MMK amount.
    await screen.findByText(/Unable to fetch THB to MMK exchange rate/);
    // No MMK amount (only THB values remain).
    expect(screen.queryByText(/MMK [\d,]/)).toBeNull();
    expect(screen.getByText(thb(5019))).toBeTruthy();
    // Confirmation is blocked while the rate is invalid.
    const confirmBtn = screen.getByRole("button", { name: "ยืนยันสั่งซื้อ" });
    expect(confirmBtn.disabled).toBe(true);
  });
});