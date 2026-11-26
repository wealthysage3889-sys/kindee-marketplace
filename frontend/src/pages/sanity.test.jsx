import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const orderCreate = vi.fn();
vi.mock("react-router-dom", () => ({
  useNavigate: () => vi.fn(),
  useLocation: () => ({ pathname: "/cart", search: "", state: null }),
}));
vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({ user: { name: "T", phone: "+66812345678" }, isAuthenticated: true }),
}));
const CART = { items: [{ id: "p1", name: "A", price: 1000, quantity: 1, storeId: "s1" }], totalPrice: 1000, totalCount: 1, clear: vi.fn() };
vi.mock("../context/CartContext", () => ({ useCart: () => CART }));
vi.mock("html2canvas", () => ({ default: vi.fn() }));
vi.mock("../api", () => ({
  orderAPI: { create: (...a) => orderCreate(...a), cancel: (...a) => ({}), submitStorePaymentSlips: (...a) => ({}) },
  storeAPI: { getById: (...a) => ({ data: { id: "s1", name: "ร้าน A", deliveryFee: 20 } }), getKbzpaySettings: (...a) => ({ success: true, data: null }) },
  settingsAPI: { getByKey: (...a) => ({ data: { value: "145" } }) },
  addressAPI: { getAddresses: (...a) => ({ data: [] }) },
}));
import Checkout from "./Checkout";

describe("sanity", () => {
  beforeEach(() => {
    orderCreate.mockReset();
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: { getCurrentPosition: vi.fn((s) => s({ coords: { latitude: 16, longitude: 96 } })) },
    });
  });
  it("renders kbzpay confirm step", async () => {
    render(<Checkout initialStep={3} initialPaymentMethod="kbzpay" orderSummary={{ totalShippingFee: 20, totalTax: 0, totalAmount: 5019, vatRate: 7 }} />);
    expect(await screen.findByText(/1 THB = 145\.00 MMK/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "ยืนยันสั่งซื้อ" })).toBeTruthy();
  });
});
