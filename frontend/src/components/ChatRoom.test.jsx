import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import ChatRoom from "./ChatRoom";

const {
  getConversation,
  getMessages,
  markAsRead,
  sendMessage,
} = vi.hoisted(() => ({
  getConversation: vi.fn(),
  getMessages: vi.fn(),
  markAsRead: vi.fn(),
  sendMessage: vi.fn(),
}));

const { getById } = vi.hoisted(() => ({
  getById: vi.fn(),
}));

const { getSignedUrl } = vi.hoisted(() => ({
  getSignedUrl: vi.fn(),
}));

vi.mock("../api", () => ({
  chatAPI: {
    getConversation: (...args) => getConversation(...args),
    getMessages: (...args) => getMessages(...args),
    markAsRead: (...args) => markAsRead(...args),
    sendMessage: (...args) => sendMessage(...args),
  },
  callAPI: {
    initiate: vi.fn(),
  },
  uploadAPI: {
    uploadChatAttachment: vi.fn(),
    getSignedUrl: (...args) => getSignedUrl(...args),
  },
  orderAPI: {
    getById: (...args) => getById(...args),
  },
  normalizeAttachment: vi.fn((a) => a),
}));

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    customer: { isAuthenticated: true, user: { id: "user-1", name: "ผู้ใช้ ทดสอบ" } },
    admin: null,
  }),
}));

vi.mock("../context/SocketContext", () => ({
  useSocket: () => ({
    connected: true,
    joinConversation: vi.fn(),
    leaveConversation: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
  }),
}));

vi.mock("../utils/ringtone", () => ({
  ringtone: {
    start: vi.fn(),
    stop: vi.fn(),
    isActive: vi.fn(() => false),
    getActiveCallId: vi.fn(() => null),
    unlock: vi.fn(() => Promise.resolve()),
  },
}));

vi.mock("../utils/ringback", () => ({
  ringback: {
    start: vi.fn(),
    stop: vi.fn(),
    isActive: vi.fn(() => false),
    getActiveCallId: vi.fn(() => null),
    unlock: vi.fn(() => Promise.resolve()),
  },
}));

const mockConversation = {
  id: "conv-1",
  type: "store_customer",
  store: { id: "store-1", name: "ร้านทดสอบ", logo_url: null },
  members: [
    { profile_id: "user-1", profile: { id: "user-1", name: "ผู้ใช้ ทดสอบ", avatar_url: null } },
    { profile_id: "customer-1", profile: { id: "customer-1", name: "ลูกค้า ทดสอบ", avatar_url: null } },
  ],
  store_order: { id: "so-1", store_order_number: "SO-1001" },
};

const mockOrderMessage = {
  id: "msg-1",
  type: "order_update",
  content: "คำสั่งซื้อใหม่",
  created_at: "2026-01-15T10:30:00Z",
  sender_id: "customer-1",
  sender: { id: "customer-1", name: "ลูกค้า ทดสอบ", avatar_url: null },
  metadata: {
    kind: "order_chat",
    order_id: "order-1",
    store_order_number: "SO-1001",
    headline: "คำสั่งซื้อใหม่",
    items: [
      { product_name: "สินค้าทดสอบ", quantity: 2 },
    ],
    total_amount: 500,
    shipping_fee: 50,
    payment_method: "cod",
    payment_method_label: "ชำระเงินปลายทาง",
    order_status: "confirmed",
    order_status_label: "ยืนยันแล้ว",
    payment_status: "pending",
    payment_status_label: "รอชำระปลายทาง",
    ordered_at: "2026-01-15T10:30:00Z",
  },
};

describe("ChatRoom - Order Detail Popup", () => {
  beforeEach(() => {
    getConversation.mockReset();
    getMessages.mockReset();
    markAsRead.mockReset();
    sendMessage.mockReset();
    getById.mockReset();
    getConversation.mockResolvedValue({ data: mockConversation });
    getMessages.mockResolvedValue({ data: [mockOrderMessage] });
    markAsRead.mockResolvedValue({});
    getById.mockResolvedValue({ data: {
      id: "order-1",
      order_number: "ORD-1001",
      status: "confirmed",
      payment_status: "pending",
      payment_method: "cod",
      total_amount: 500,
      created_at: "2026-01-15T10:30:00Z",
      customer: { name: "ลูกค้า ทดสอบ", phone: "0812345678" },
      store_orders: [],
    }});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const renderChatRoom = () => {
    return render(
      <BrowserRouter>
        <ChatRoom conversationId="conv-1" mode="customer" />
      </BrowserRouter>
    );
  };

  it("renders order card with 'ดูรายละเอียดคำสั่งซื้อ' button", async () => {
    renderChatRoom();
    await waitFor(() => expect(screen.getByText("ดูรายละเอียดคำสั่งซื้อ →")).toBeTruthy(), { timeout: 5000 });
    // Use getAllByText to handle StrictMode double-render
    await waitFor(() => expect(screen.getAllByText(/SO-1001/).length).toBeGreaterThan(0), { timeout: 5000 });
    await waitFor(() => expect(screen.getByText("สินค้าทดสอบ")).toBeTruthy(), { timeout: 5000 });
  }, 10000);

  it("opens OrderDetailModal when order card link is clicked", async () => {
    renderChatRoom();
    await waitFor(() => expect(screen.getByText("ดูรายละเอียดคำสั่งซื้อ →")).toBeTruthy(), { timeout: 5000 });
    
    await act(async () => {
      fireEvent.click(screen.getByText("ดูรายละเอียดคำสั่งซื้อ →"));
    });
    
    await waitFor(() => expect(screen.getByText("รายละเอียดคำสั่งซื้อ")).toBeTruthy(), { timeout: 5000 });
    await waitFor(() => expect(screen.getAllByText("#ORD-1001").length).toBeGreaterThan(0), { timeout: 5000 });
  }, 10000);

  it("loads correct order ID from message metadata", async () => {
    renderChatRoom();
    await waitFor(() => expect(screen.getByText("ดูรายละเอียดคำสั่งซื้อ →")).toBeTruthy(), { timeout: 5000 });
    
    await act(async () => {
      fireEvent.click(screen.getByText("ดูรายละเอียดคำสั่งซื้อ →"));
    });
    
    await waitFor(() => expect(getById).toHaveBeenCalledWith("order-1"), { timeout: 5000 });
  }, 10000);

  it("closes modal when close button is clicked", async () => {
    renderChatRoom();
    await waitFor(() => expect(screen.getByText("ดูรายละเอียดคำสั่งซื้อ →")).toBeTruthy(), { timeout: 5000 });
    
    await act(async () => {
      fireEvent.click(screen.getByText("ดูรายละเอียดคำสั่งซื้อ →"));
    });
    await waitFor(() => expect(screen.getByText("รายละเอียดคำสั่งซื้อ")).toBeTruthy(), { timeout: 5000 });
    
    await act(async () => {
      fireEvent.click(screen.getByLabelText("ปิด"));
    });
    
    await waitFor(() => expect(screen.queryByText("รายละเอียดคำสั่งซื้อ")).toBeNull(), { timeout: 5000 });
  }, 10000);

  it("closes modal when Escape key is pressed", async () => {
    renderChatRoom();
    await waitFor(() => expect(screen.getByText("ดูรายละเอียดคำสั่งซื้อ →")).toBeTruthy(), { timeout: 5000 });
    
    await act(async () => {
      fireEvent.click(screen.getByText("ดูรายละเอียดคำสั่งซื้อ →"));
    });
    await waitFor(() => expect(screen.getByText("รายละเอียดคำสั่งซื้อ")).toBeTruthy(), { timeout: 5000 });
    
    await act(async () => {
      fireEvent.keyDown(document, { key: "Escape" });
    });
    
    await waitFor(() => expect(screen.queryByText("รายละเอียดคำสั่งซื้อ")).toBeNull(), { timeout: 5000 });
  }, 10000);

  it("stays on chat page when modal is closed (chat not reset)", async () => {
    renderChatRoom();
    await waitFor(() => expect(screen.getByText("ดูรายละเอียดคำสั่งซื้อ →")).toBeTruthy(), { timeout: 5000 });
    
    // Verify chat messages are still visible (the order card badge contains the text)
    expect(screen.getByText("📦 คำสั่งซื้อใหม่")).toBeTruthy();
    
    await act(async () => {
      fireEvent.click(screen.getByText("ดูรายละเอียดคำสั่งซื้อ →"));
    });
    await waitFor(() => expect(screen.getByText("รายละเอียดคำสั่งซื้อ")).toBeTruthy(), { timeout: 5000 });
    
    await act(async () => {
      fireEvent.click(screen.getByLabelText("ปิด"));
    });
    
    // Chat should still be visible
    await waitFor(() => expect(screen.getByText("📦 คำสั่งซื้อใหม่")).toBeTruthy(), { timeout: 5000 });
  }, 10000);

  it("shows loading state while fetching order details", async () => {
    getById.mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve({ data: {
      id: "order-1",
      order_number: "ORD-1001",
      status: "confirmed",
      payment_status: "pending",
      payment_method: "cod",
      total_amount: 500,
      created_at: "2026-01-15T10:30:00Z",
      customer: { name: "ลูกค้า ทดสอบ" },
      store_orders: [],
    }}), 100)));
    
    renderChatRoom();
    await waitFor(() => expect(screen.getByText("ดูรายละเอียดคำสั่งซื้อ →")).toBeTruthy(), { timeout: 5000 });
    
    await act(async () => {
      fireEvent.click(screen.getByText("ดูรายละเอียดคำสั่งซื้อ →"));
    });
    
    // Should show loading state
    expect(screen.getByText("กำลังโหลดรายละเอียด...")).toBeTruthy();
    
    await waitFor(() => expect(screen.getAllByText("#ORD-1001").length).toBeGreaterThan(0), { timeout: 5000 });
  }, 10000);

  it("shows error state when API fails", async () => {
    getById.mockRejectedValue(new Error("Not found"));
    
    renderChatRoom();
    await waitFor(() => expect(screen.getByText("ดูรายละเอียดคำสั่งซื้อ →")).toBeTruthy(), { timeout: 5000 });
    
    await act(async () => {
      fireEvent.click(screen.getByText("ดูรายละเอียดคำสั่งซื้อ →"));
    });
    
    await waitFor(() => expect(screen.getByText("Not found")).toBeTruthy(), { timeout: 5000 });
  }, 10000);
});

// ---------------------------------------------------------------------------
// Chat image attachments (regression)
// ---------------------------------------------------------------------------
// chat-attachments is a private bucket served via signed URLs that expire. An
// old message persists an expired URL; when it fails to load the client must
// re-sign it from the embedded { bucket, path } so old AND new images render.
describe("ChatRoom - chat image attachments", () => {
  const expiredUrl =
    "https://test.supabase.co/storage/v1/object/sign/chat-attachments/chat-attachments/conv-1/2026/11/shot.png?token=expired";
  const freshUrl =
    "https://test.supabase.co/storage/v1/object/sign/chat-attachments/chat-attachments/conv-1/2026/11/shot.png?token=fresh";

  const imageMessage = {
    id: "msg-img",
    type: "image",
    content: "",
    created_at: "2026-01-15T10:30:00Z",
    sender_id: "customer-1",
    sender: { id: "customer-1", name: "ลูกค้า ทดสอบ", avatar_url: null },
    attachments: [
      {
        id: "att-1",
        file_url: expiredUrl,
        file_name: "shot.png",
        file_size: 2048,
        mime_type: "image/png",
      },
    ],
  };

  beforeEach(() => {
    getConversation.mockReset();
    getMessages.mockReset();
    markAsRead.mockReset();
    sendMessage.mockReset();
    getById.mockReset();
    getSignedUrl.mockReset();
    getConversation.mockResolvedValue({ data: mockConversation });
    getMessages.mockResolvedValue({ data: [imageMessage] });
    markAsRead.mockResolvedValue({});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("re-signs an expired chat image URL on load error", async () => {
    getSignedUrl.mockResolvedValue({ data: { signedUrl: freshUrl } });

    render(
      <BrowserRouter>
        <ChatRoom conversationId="conv-1" mode="customer" />
      </BrowserRouter>
    );

    const img = await screen.findByAltText("shot.png");
    expect(img.getAttribute("src")).toBe(expiredUrl);

    await act(async () => {
      fireEvent.error(img);
    });

    await waitFor(() => expect(img.getAttribute("src")).toBe(freshUrl));
    expect(getSignedUrl).toHaveBeenCalledWith(
      "chat-attachments",
      "chat-attachments/conv-1/2026/11/shot.png",
      3600,
      "customer"
    );
  }, 10000);

  it("keeps a working image URL untouched (no re-sign on success)", async () => {
    render(
      <BrowserRouter>
        <ChatRoom conversationId="conv-1" mode="customer" />
      </BrowserRouter>
    );

    const img = await screen.findByAltText("shot.png");
    // No error event fired -> no refresh attempted.
    expect(getSignedUrl).not.toHaveBeenCalled();
    expect(img.getAttribute("src")).toBe(expiredUrl);
  }, 10000);
});