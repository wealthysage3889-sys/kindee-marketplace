import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import PaymentSlipModal from "./PaymentSlipModal";

const { getById } = vi.hoisted(() => ({
  getById: vi.fn(),
}));

const { getSignedUrl } = vi.hoisted(() => ({
  getSignedUrl: vi.fn(),
}));

vi.mock("../api", () => ({
  orderAPI: {
    getById: (...args) => getById(...args),
  },
  uploadAPI: {
    getSignedUrl: (...args) => getSignedUrl(...args),
  },
}));

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    customer: null,
    admin: { token: "admin-token", user: { id: "admin-1", role: "admin" } },
  }),
}));

const slip = {
  id: "slip-1",
  order_id: "order-1",
  slip_status: "uploaded",
  slip_filename: "slip.jpg",
  slip_view_url: "https://example.com/storage/signed/slip.jpg?token=abc",
  slip_path: "payment-slips/order-1/slip.jpg",
  created_at: "2026-01-15T10:30:00Z",
};

const mockOrder = {
  id: "order-1",
  order_number: "ORD-1001",
  payment_slips: [slip],
};

describe("PaymentSlipModal", () => {
  beforeEach(() => {
    getById.mockReset();
    getSignedUrl.mockReset();
    getById.mockResolvedValue({ data: mockOrder });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not render when isOpen is false", () => {
    const { container } = render(<PaymentSlipModal isOpen={false} onClose={vi.fn()} orderId="order-1" />);
    expect(container.querySelector(".payment-slip-modal-overlay")).toBeNull();
  });

  it("renders nothing in non-admin mode", () => {
    render(<PaymentSlipModal isOpen={true} onClose={vi.fn()} orderId="order-1" mode="customer" />);
    expect(document.querySelector(".payment-slip-modal-overlay")).toBeNull();
  });

  it("shows loading state while fetching the order", async () => {
    getById.mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve({ data: mockOrder }), 30)));
    render(<PaymentSlipModal isOpen={true} onClose={vi.fn()} orderId="order-1" />);
    expect(screen.getByText("กำลังโหลดสลิป...")).toBeTruthy();
    await waitFor(() => expect(screen.getAllByText("#ORD-1001").length).toBeGreaterThan(0), { timeout: 3000 });
  });

  it("calls order API with admin mode and matching order id only", async () => {
    render(<PaymentSlipModal isOpen={true} onClose={vi.fn()} orderId="order-1" />);
    await waitFor(() => expect(screen.getAllByText("#ORD-1001").length).toBeGreaterThan(0), { timeout: 3000 });
    expect(getById).toHaveBeenCalledWith("order-1", "admin");
  });

  it("displays slip image, order number, and upload date/time", async () => {
    render(<PaymentSlipModal isOpen={true} onClose={vi.fn()} orderId="order-1" />);
    await waitFor(() => expect(screen.getAllByText("#ORD-1001").length).toBeGreaterThan(0), { timeout: 3000 });
    const img = document.querySelector(".payment-slip-modal-img");
    expect(img).toBeTruthy();
    expect(img.getAttribute("src")).toBe("https://example.com/storage/signed/slip.jpg?token=abc");
    expect(screen.getByText("เลขที่คำสั่งซื้อ")).toBeTruthy();
    expect(screen.getAllByText("#ORD-1001").length).toBeGreaterThan(0);
    expect(screen.getByText("อัปโหลดเมื่อ")).toBeTruthy();
    expect(screen.getByText("15 ม.ค. 2569 17:30")).toBeTruthy();
    expect(screen.getByText("สถานะสลิป")).toBeTruthy();
  });

  it("displays slip status label when provided", async () => {
    getById.mockResolvedValue({
      data: { ...mockOrder, payment_slips: [{ ...slip, slip_status_label: "รอการตรวจสอบ" }] },
    });
    render(<PaymentSlipModal isOpen={true} onClose={vi.fn()} orderId="order-1" />);
    await waitFor(() => expect(screen.getByText("รอการตรวจสอบ")).toBeTruthy(), { timeout: 3000 });
  });

  it("closes when close button is clicked", async () => {
    const onClose = vi.fn();
    render(<PaymentSlipModal isOpen={true} onClose={onClose} orderId="order-1" />);
    await waitFor(() => expect(screen.getAllByText("#ORD-1001").length).toBeGreaterThan(0), { timeout: 3000 });
    await act(async () => {
      fireEvent.click(screen.getByLabelText("ปิด"));
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("closes when backdrop is clicked", async () => {
    const onClose = vi.fn();
    render(<PaymentSlipModal isOpen={true} onClose={onClose} orderId="order-1" />);
    await waitFor(() => expect(screen.getAllByText("#ORD-1001").length).toBeGreaterThan(0), { timeout: 3000 });
    const overlay = document.querySelector(".payment-slip-modal-overlay");
    if (overlay) {
      await act(async () => {
        fireEvent.mouseDown(overlay);
      });
    }
    expect(onClose).toHaveBeenCalled();
  });

  it("closes on Escape key", async () => {
    const onClose = vi.fn();
    render(<PaymentSlipModal isOpen={true} onClose={onClose} orderId="order-1" />);
    await waitFor(() => expect(screen.getAllByText("#ORD-1001").length).toBeGreaterThan(0), { timeout: 3000 });
    await act(async () => {
      fireEvent.keyDown(document, { key: "Escape" });
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("shows message when the order has no slip", async () => {
    getById.mockResolvedValue({ data: { ...mockOrder, payment_slips: [] } });
    render(<PaymentSlipModal isOpen={true} onClose={vi.fn()} orderId="order-1" />);
    await waitFor(() => expect(screen.getByText("ไม่พบไฟล์สลิปสำหรับคำสั่งซื้อนี้")).toBeTruthy(), { timeout: 3000 });
    expect(document.querySelector(".payment-slip-modal-img")).toBeNull();
  });

  it("ignores slips bound to a different order", async () => {
    getById.mockResolvedValue({
      data: {
        id: "order-1",
        order_number: "ORD-1001",
        payment_slips: [{ ...slip, order_id: "other-order" }],
      },
    });
    render(<PaymentSlipModal isOpen={true} onClose={vi.fn()} orderId="order-1" />);
    await waitFor(() => expect(screen.getByText("ไม่พบไฟล์สลิปสำหรับคำสั่งซื้อนี้")).toBeTruthy(), { timeout: 3000 });
    expect(document.querySelector(".payment-slip-modal-img")).toBeNull();
  });

  it("shows error and retry button when loading fails", async () => {
    getById.mockRejectedValue(new Error("โหลดข้อมูลไม่สำเร็จ"));
    render(<PaymentSlipModal isOpen={true} onClose={vi.fn()} orderId="order-1" />);
    await waitFor(() => expect(screen.getByText("โหลดข้อมูลไม่สำเร็จ")).toBeTruthy(), { timeout: 3000 });
    expect(screen.getByText("ลองใหม่")).toBeTruthy();
  });

  it("retries loading the order when retry is clicked", async () => {
    let callCount = 0;
    getById.mockImplementation(async () => {
      callCount += 1;
      if (callCount === 1) throw new Error("fail");
      return { data: mockOrder };
    });
    render(<PaymentSlipModal isOpen={true} onClose={vi.fn()} orderId="order-1" />);
    await waitFor(() => expect(screen.getByText("fail")).toBeTruthy(), { timeout: 3000 });
    expect(screen.getByText("ลองใหม่")).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByText("ลองใหม่"));
    });
    await waitFor(() => expect(screen.getAllByText("#ORD-1001").length).toBeGreaterThan(0), { timeout: 3000 });
    expect(getById).toHaveBeenCalledTimes(2);
  });

  it("refreshes the signed URL when the slip image fails to load", async () => {
    getSignedUrl.mockResolvedValue({ data: { signedUrl: "https://example.com/fresh/slip.jpg?token=xyz" } });
    render(<PaymentSlipModal isOpen={true} onClose={vi.fn()} orderId="order-1" />);
    await waitFor(() => expect(screen.getAllByText("#ORD-1001").length).toBeGreaterThan(0), { timeout: 3000 });
    const img = document.querySelector(".payment-slip-modal-img");
    await act(async () => {
      fireEvent.error(img);
    });
    await waitFor(() => expect(getSignedUrl).toHaveBeenCalled(), { timeout: 3000 });
    expect(img.getAttribute("src")).toBe("https://example.com/fresh/slip.jpg?token=xyz");
  });

  it("shows load failure message when signed URL refresh fails", async () => {
    getSignedUrl.mockRejectedValue(new Error("refresh failed"));
    render(<PaymentSlipModal isOpen={true} onClose={vi.fn()} orderId="order-1" />);
    await waitFor(() => expect(screen.getAllByText("#ORD-1001").length).toBeGreaterThan(0), { timeout: 3000 });
    const img = document.querySelector(".payment-slip-modal-img");
    await act(async () => {
      fireEvent.error(img);
    });
    await waitFor(() => expect(screen.getByText("โหลดรูปสลิปไม่สำเร็จ")).toBeTruthy(), { timeout: 3000 });
  });
});
