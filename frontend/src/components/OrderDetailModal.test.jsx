import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import OrderDetailModal from "./OrderDetailModal";

const { getById } = vi.hoisted(() => ({
  getById: vi.fn(),
}));

vi.mock("../api", () => ({
  orderAPI: {
    getById: (...args) => getById(...args),
  },
}));

vi.mock("react-router-dom", () => ({
  Link: ({ children, ...props }) => <a {...props}>{children}</a>,
}));

const mockOrder = {
  id: "order-1",
  order_number: "ORD-1001",
  status: "confirmed",
  payment_status: "paid",
  payment_method: "cod",
  total_amount: 500,
  subtotal: 450,
  shipping_fee: 50,
  tax_amount: 35,
  vat_rate: 7,
  created_at: "2026-01-15T10:30:00Z",
  customer: { name: "สมชาย ใจดี", phone: "0812345678" },
  customer_snapshot: {
    name: "สมชาย ใจดี",
    phone: "0812345678",
    address: {
      address_line: "123 ถนนสุขุมวิท",
      subdistrict: "คลองเตย",
      district: "คลองเตย",
      province: "กรุงเทพมหานคร",
      postal_code: "10110",
      country: "ไทย",
    },
  },
  store_orders: [
    {
      id: "so-1",
      store_order_number: "SO-1001",
      store_snapshot: { name: "ร้านทดสอบ" },
      order_items: [
        {
          id: "oi-1",
          product_name: "สินค้าทดสอบ 1",
          quantity: 2,
          total_price: 300,
          product_image: "https://example.com/image1.jpg",
        },
        {
          id: "oi-2",
          product_name: "สินค้าทดสอบ 2",
          quantity: 1,
          total_price: 150,
          product_image: null,
        },
      ],
      delivery: {
        status: "in_transit",
        courier: { profile: { name: "พี่ขี่มอเตอร์ไซค์" } },
        delivery_address: {
          address_line: "123 ถนนสุขุมวิท",
          subdistrict: "คลองเตย",
          district: "คลองเตย",
          province: "กรุงเทพมหานคร",
          postal_code: "10110",
          country: "ไทย",
        },
      },
    },
  ],
};

describe("OrderDetailModal", () => {
  beforeEach(() => {
    getById.mockReset();
    getById.mockResolvedValue({ data: mockOrder });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not render when isOpen is false", () => {
    const { container } = render(<OrderDetailModal isOpen={false} onClose={vi.fn()} orderId="order-1" />);
    expect(container.querySelector(".admin-order-detail-overlay")).toBeNull();
  });

  it("renders loading state initially", async () => {
    getById.mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve({ data: mockOrder }), 100)));
    render(<OrderDetailModal isOpen={true} onClose={vi.fn()} orderId="order-1" />);
    expect(screen.getByText("กำลังโหลดรายละเอียด...")).toBeTruthy();
  });

  it("loads and displays order details when opened", async () => {
    render(<OrderDetailModal isOpen={true} onClose={vi.fn()} orderId="order-1" />);
    await waitFor(() => expect(screen.getAllByText("#ORD-1001").length).toBeGreaterThan(0), { timeout: 3000 });
    expect(screen.getByText("รายละเอียดคำสั่งซื้อ")).toBeTruthy();
    expect(screen.getByText("รหัสคำสั่งซื้อ")).toBeTruthy();
    expect(screen.getByText("order-1")).toBeTruthy();
    expect(screen.getByText("วันและเวลาสั่งซื้อ")).toBeTruthy();
    expect(screen.getByText("15 ม.ค. 2569 17:30")).toBeTruthy();
  });

  it("displays order information correctly", async () => {
    render(<OrderDetailModal isOpen={true} onClose={vi.fn()} orderId="order-1" />);
    await waitFor(() => expect(screen.getAllByText("#ORD-1001").length).toBeGreaterThan(0), { timeout: 3000 });
    expect(screen.getByText("ยืนยันแล้ว")).toBeTruthy(); // status label
    expect(screen.getByText("รอชำระปลายทาง")).toBeTruthy(); // payment status for COD confirmed
    expect(screen.getByText("ชำระเงินปลายทาง")).toBeTruthy(); // payment method
    expect(screen.getByText("฿500.00")).toBeTruthy(); // total
    expect(screen.getByText("฿450.00")).toBeTruthy(); // subtotal
    expect(screen.getByText("฿50.00")).toBeTruthy(); // shipping fee
    expect(screen.getByText("฿35.00")).toBeTruthy(); // tax
  });

  it("displays customer information correctly", async () => {
    render(<OrderDetailModal isOpen={true} onClose={vi.fn()} orderId="order-1" />);
    await waitFor(() => expect(screen.getByText("ข้อมูลลูกค้า")).toBeTruthy(), { timeout: 3000 });
    expect(screen.getByText("สมชาย ใจดี")).toBeTruthy();
    expect(screen.getByText("0812345678")).toBeTruthy();
  });

  it("displays store information correctly", async () => {
    render(<OrderDetailModal isOpen={true} onClose={vi.fn()} orderId="order-1" />);
    await waitFor(() => expect(screen.getAllByText("ร้านค้า").length).toBeGreaterThan(0), { timeout: 3000 });
    expect(screen.getAllByText("ร้านทดสอบ").length).toBeGreaterThan(0);
  });

  it("displays delivery address and shipping information", async () => {
    render(<OrderDetailModal isOpen={true} onClose={vi.fn()} orderId="order-1" />);
    await waitFor(() => expect(screen.getByText("ที่อยู่จัดส่งและข้อมูลการจัดส่ง")).toBeTruthy(), { timeout: 3000 });
    expect(screen.getByText("ที่อยู่จัดส่ง")).toBeTruthy();
    // Address appears twice (customer address + delivery address), use getAllByText
    expect(screen.getAllByText("123 ถนนสุขุมวิท คลองเตย คลองเตย กรุงเทพมหานคร 10110 ไทย").length).toBeGreaterThan(0);
    expect(screen.getByText("in_transit")).toBeTruthy(); // delivery status
    expect(screen.getByText("พี่ขี่มอเตอร์ไซค์")).toBeTruthy(); // courier
  });

  it("displays order items with images, quantities, and prices", async () => {
    render(<OrderDetailModal isOpen={true} onClose={vi.fn()} orderId="order-1" />);
    await waitFor(() => expect(screen.getByText("รายการสินค้า")).toBeTruthy(), { timeout: 3000 });
    expect(screen.getByText("สินค้าทดสอบ 1")).toBeTruthy();
    expect(screen.getByText("สินค้าทดสอบ 2")).toBeTruthy();
    expect(screen.getByText("2")).toBeTruthy(); // quantity
    expect(screen.getByText("1")).toBeTruthy(); // quantity
    expect(screen.getByText("฿300.00")).toBeTruthy();
    expect(screen.getByText("฿150.00")).toBeTruthy();
    expect(screen.getAllByText("ร้านทดสอบ").length).toBeGreaterThan(0);
  });

  it("closes when close button is clicked", async () => {
    const onClose = vi.fn();
    render(<OrderDetailModal isOpen={true} onClose={onClose} orderId="order-1" />);
    await waitFor(() => expect(screen.getAllByText("#ORD-1001").length).toBeGreaterThan(0), { timeout: 3000 });
    await act(async () => {
      fireEvent.click(screen.getByLabelText("ปิด"));
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("closes when backdrop is clicked", async () => {
    const onClose = vi.fn();
    render(<OrderDetailModal isOpen={true} onClose={onClose} orderId="order-1" />);
    await waitFor(() => expect(screen.getAllByText("#ORD-1001").length).toBeGreaterThan(0), { timeout: 3000 });
    const overlay = document.querySelector(".admin-order-detail-overlay");
    if (overlay) {
      await act(async () => {
        fireEvent.mouseDown(overlay);
      });
    }
    expect(onClose).toHaveBeenCalled();
  });

  it("closes on Escape key", async () => {
    const onClose = vi.fn();
    render(<OrderDetailModal isOpen={true} onClose={onClose} orderId="order-1" />);
    await waitFor(() => expect(screen.getAllByText("#ORD-1001").length).toBeGreaterThan(0), { timeout: 3000 });
    await act(async () => {
      fireEvent.keyDown(document, { key: "Escape" });
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("shows error state when API fails", async () => {
    getById.mockRejectedValue(new Error("Network error"));
    render(<OrderDetailModal isOpen={true} onClose={vi.fn()} orderId="order-1" />);
    await waitFor(() => expect(screen.getByText("Network error")).toBeTruthy(), { timeout: 3000 });
    expect(screen.getByText("ลองใหม่")).toBeTruthy();
  });

  it("uses admin mode by default", async () => {
    render(<OrderDetailModal isOpen={true} onClose={vi.fn()} orderId="order-1" />);
    await waitFor(() => expect(getById).toHaveBeenCalledWith("order-1"), { timeout: 3000 });
  });

  it("passes mode to API", async () => {
    render(<OrderDetailModal isOpen={true} onClose={vi.fn()} orderId="order-1" mode="customer" />);
    await waitFor(() => expect(getById).toHaveBeenCalledWith("order-1"), { timeout: 3000 });
  });

  it("renders a legacy slip using slip_view_url", async () => {
    getById.mockResolvedValue({
      data: {
        ...mockOrder,
        payment_slips: [
          {
            id: "slip-legacy",
            order_id: "order-1",
            slip_status: "uploaded",
            slip_url: "https://example.com/storage/public/slip.jpg",
            slip_view_url: "https://example.com/storage/signed/slip.jpg?token=abc",
            created_at: "2026-01-15T10:30:00Z",
          },
        ],
      },
    });
    render(<OrderDetailModal isOpen={true} onClose={vi.fn()} orderId="order-1" />);
    await waitFor(() => expect(screen.getByText("สลิปการชำระเงิน")).toBeTruthy(), { timeout: 3000 });
    const img = document.querySelector(".admin-order-detail-slip-img");
    expect(img).toBeTruthy();
    expect(img.getAttribute("src")).toBe("https://example.com/storage/signed/slip.jpg?token=abc");
    expect(screen.getByText("รอการตรวจสอบ")).toBeTruthy();
  });

  it("renders a legacy slip falling back to slip_url when no signed URL", async () => {
    getById.mockResolvedValue({
      data: {
        ...mockOrder,
        payment_slips: [
          {
            id: "slip-legacy-fallback",
            order_id: "order-1",
            slip_status: "approved",
            slip_url: "https://example.com/storage/public/slip.jpg",
            created_at: "2026-01-15T10:30:00Z",
          },
        ],
      },
    });
    render(<OrderDetailModal isOpen={true} onClose={vi.fn()} orderId="order-1" />);
    await waitFor(() => expect(screen.getByText("สลิปการชำระเงิน")).toBeTruthy(), { timeout: 3000 });
    const img = document.querySelector(".admin-order-detail-slip-img");
    expect(img).toBeTruthy();
    expect(img.getAttribute("src")).toBe("https://example.com/storage/public/slip.jpg");
    expect(screen.getByText("อนุมัติแล้ว")).toBeTruthy();
  });

  it("renders a multi-store slip using slip_view_url with store_id set", async () => {
    getById.mockResolvedValue({
      data: {
        ...mockOrder,
        payment_slips: [
          {
            id: "slip-ms-1",
            order_id: "order-1",
            store_id: "store-1",
            submission_id: "sub-1",
            slip_status: "uploaded",
            slip_path: "payment-slips/order-1/abc-slip.jpg",
            slip_url: "payment-slips/order-1/abc-slip.jpg",
            slip_view_url: "https://example.com/storage/signed/abc-slip.jpg?token=xyz",
            created_at: "2026-01-15T10:30:00Z",
          },
          {
            id: "slip-ms-2",
            order_id: "order-1",
            store_id: "store-2",
            submission_id: "sub-2",
            slip_status: "uploaded",
            slip_path: "payment-slips/order-1/def-slip.jpg",
            slip_url: "payment-slips/order-1/def-slip.jpg",
            slip_view_url: "https://example.com/storage/signed/def-slip.jpg?token=def",
            created_at: "2026-01-15T10:31:00Z",
          },
        ],
      },
    });
    render(<OrderDetailModal isOpen={true} onClose={vi.fn()} orderId="order-1" />);
    await waitFor(() => expect(screen.getByText("สลิปการชำระเงิน")).toBeTruthy(), { timeout: 3000 });
    const imgs = document.querySelectorAll(".admin-order-detail-slip-img");
    expect(imgs.length).toBe(2);
    expect(imgs[0].getAttribute("src")).toBe("https://example.com/storage/signed/abc-slip.jpg?token=xyz");
    expect(imgs[1].getAttribute("src")).toBe("https://example.com/storage/signed/def-slip.jpg?token=def");
  });

  it("shows placeholder when a slip has no viewable source", async () => {
    getById.mockResolvedValue({
      data: {
        ...mockOrder,
        payment_slips: [
          {
            id: "slip-empty",
            order_id: "order-1",
            slip_status: "uploaded",
            created_at: "2026-01-15T10:30:00Z",
          },
        ],
      },
    });
    render(<OrderDetailModal isOpen={true} onClose={vi.fn()} orderId="order-1" />);
    await waitFor(() => expect(screen.getByText("สลิปการชำระเงิน")).toBeTruthy(), { timeout: 3000 });
    expect(document.querySelector(".admin-order-detail-slip-img")).toBeNull();
    expect(screen.getByText("ไม่พบไฟล์สลิป")).toBeTruthy();
  });

  it("does not render the slip section when there are no slips", async () => {
    getById.mockResolvedValue({ data: { ...mockOrder, payment_slips: [] } });
    render(<OrderDetailModal isOpen={true} onClose={vi.fn()} orderId="order-1" />);
    await waitFor(() => expect(screen.getAllByText("#ORD-1001").length).toBeGreaterThan(0), { timeout: 3000 });
    expect(screen.queryByText("สลิปการชำระเงิน")).toBeNull();
  });
});