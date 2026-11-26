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

const { updateOrderStatus } = vi.hoisted(() => ({
  updateOrderStatus: vi.fn(),
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
  adminAPI: {
    updateOrderStatus: (...args) => updateOrderStatus(...args),
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
    
    await waitFor(() => expect(getById).toHaveBeenCalledWith("order-1", "customer"), { timeout: 5000 });
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
// ChatRoom - Order status change (ส่งเสร็จ) in selladmin mode
// ---------------------------------------------------------------------------
describe("ChatRoom - ส่งเสร็จออเดอร์ (สถานะชำระเงิน COD)", () => {
  const codInTransitMessage = {
    id: "msg-2",
    type: "order_update",
    content: "อัปเดตสถานะคำสั่งซื้อ",
    created_at: "2026-01-15T10:30:00Z",
    sender_id: "customer-1",
    sender: { id: "customer-1", name: "ลูกค้า ทดสอบ", avatar_url: null },
    metadata: {
      kind: "order_chat",
      order_id: "order-1",
      store_order_number: "SO-1001",
      headline: "อัปเดตสถานะคำสั่งซื้อ",
      items: [{ product_name: "สินค้าทดสอบ", quantity: 2 }],
      total_amount: 500,
      shipping_fee: 50,
      payment_method: "cod",
      payment_method_label: "ชำระเงินปลายทาง",
      order_status: "in_transit",
      order_status_label: "กำลังจัดส่ง",
      payment_status: "pending",
      payment_status_label: "รอชำระปลายทาง",
      ordered_at: "2026-01-15T10:30:00Z",
    },
  };

  const kbzpayInTransitMessage = {
    ...codInTransitMessage,
    id: "msg-3",
    payment_method: "kbzpay",
    payment_method_label: "KBZPay",
    payment_status: "awaiting_review",
    payment_status_label: "รอตรวจสอบสลิป",
  };

  beforeEach(() => {
    getConversation.mockReset();
    getMessages.mockReset();
    markAsRead.mockReset();
    sendMessage.mockReset();
    getById.mockReset();
    updateOrderStatus.mockReset();
    getConversation.mockResolvedValue({ data: mockConversation });
    markAsRead.mockResolvedValue({});
    getById.mockResolvedValue({ data: {
      id: "order-1",
      order_number: "ORD-1001",
      status: "in_transit",
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

  const renderAdminChat = (message) => {
    getMessages.mockResolvedValue({ data: [message] });
    return render(
      <BrowserRouter>
        <ChatRoom conversationId="conv-1" mode="admin" />
      </BrowserRouter>
    );
  };

  it("COD ส่งเสร็จสำเร็จ การ์ดทุกใบของ Order ID เดียวกันแสดง เก็บเงินแล้ว (pay-paid)", async () => {
    updateOrderStatus.mockResolvedValue({ data: {
      id: "order-1",
      status: "delivered",
      payment_status: "paid",
      payment_method: "cod",
    }});
    renderAdminChat(codInTransitMessage);

    await waitFor(() => expect(screen.getByRole("button", { name: /ส่งเสร็จ/ })).toBeTruthy(), { timeout: 5000 });
    // ก่อนส่งยังคงแสดง รอชำระปลายทาง
    expect(screen.getByText("รอชำระปลายทาง")).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /ส่งเสร็จ/ }));
    });

    await waitFor(() => expect(updateOrderStatus).toHaveBeenCalledWith("order-1", "delivered", ""), { timeout: 5000 });
    await waitFor(() => expect(screen.getByText("เก็บเงินแล้ว")).toBeTruthy(), { timeout: 5000 });
    const badge = screen.getByText("เก็บเงินแล้ว");
    expect(badge.closest(".order-card-status")?.classList.contains("pay-paid")).toBe(true);
    // ยังแสดงสถานะคำสั่งซื้อเป็นจัดส่งสำเร็จด้วย
    expect(screen.getByText("ส่งสำเร็จ")).toBeTruthy();
  }, 15000);

  it("KBZPay กดส่งเสร็จแล้วสถานะชำระเงินต้องคงเดิม (ตรวจสอบแล้ว), ไม่เปลี่ยนเป็น ชำระแล้ว", async () => {
    updateOrderStatus.mockResolvedValue({ data: {
      id: "order-1",
      status: "delivered",
      payment_status: "awaiting_review",
      payment_method: "kbzpay",
    }});
    renderAdminChat(kbzpayInTransitMessage);

    await waitFor(() => expect(screen.getByRole("button", { name: /ส่งเสร็จ/ })).toBeTruthy(), { timeout: 5000 });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /ส่งเสร็จ/ }));
    });

    await waitFor(() => expect(updateOrderStatus).toHaveBeenCalledWith("order-1", "delivered", ""), { timeout: 5000 });
    await waitFor(() => expect(screen.getByText("ตรวจสอบแล้ว")).toBeTruthy(), { timeout: 5000 });
    expect(screen.queryByText("ชำระแล้ว")).toBeNull();
  }, 15000);

  it("API ผิดพลาด ไม่อ้างว่ารับเงินแล้ว และยังแสดง รอชำระปลายทาง", async () => {
    updateOrderStatus.mockRejectedValue(new Error("ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์"));
    renderAdminChat(codInTransitMessage);

    await waitFor(() => expect(screen.getByRole("button", { name: /ส่งเสร็จ/ })).toBeTruthy(), { timeout: 5000 });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /ส่งเสร็จ/ }));
    });

    await waitFor(() => expect(screen.getByText(/ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์|เปลี่ยนสถานะไม่สำเร็จ/)).toBeTruthy(), { timeout: 5000 });
    expect(screen.queryByText("เก็บเงินแล้ว")).toBeNull();
    expect(screen.getByText("รอชำระปลายทาง")).toBeTruthy();
  }, 15000);
});


// ---------------------------------------------------------------------------
// Chat image attachments (regression)
// ---------------------------------------------------------------------------
// chat-attachments is a private bucket served via signed URLs that expire. An
// old message persists an expired URL; when it fails to load the client must
// re-sign it from the embedded { bucket, path } so old AND new images render.
describe("ChatRoom - chat image attachments", () => {
  // Build a signed URL with a real JWT-style token so the client can read `exp`
  // and decide proactively whether it is already expired. `objectPath` may carry
  // a duplicated bucket prefix (legacy rows written before the prefix fix).
  const signedUrl = (exp, objectPath) => {
    const payload = Buffer.from(JSON.stringify({ exp })).toString("base64url");
    return `https://test.supabase.co/storage/v1/object/sign/chat-attachments/${objectPath}?token=header.${payload}.signature`;
  };
  const nowSeconds = () => Math.floor(Date.now() / 1000);

  const makeImageMessage = (fileUrl) => ({
    id: "msg-img",
    type: "image",
    content: "",
    created_at: "2026-01-15T10:30:00Z",
    sender_id: "customer-1",
    sender: { id: "customer-1", name: "ลูกค้า ทดสอบ", avatar_url: null },
    attachments: [
      {
        id: "att-1",
        file_url: fileUrl,
        file_name: "shot.png",
        file_size: 2048,
        mime_type: "image/png",
      },
    ],
  });

  beforeEach(() => {
    getConversation.mockReset();
    getMessages.mockReset();
    markAsRead.mockReset();
    sendMessage.mockReset();
    getById.mockReset();
    getSignedUrl.mockReset();
    getConversation.mockResolvedValue({ data: mockConversation });
    markAsRead.mockResolvedValue({});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("re-signs an expired chat image URL (legacy double bucket prefix) before rendering", async () => {
    // Legacy shape: bucket name appears twice in the object path AND token expired.
    const expiredUrl = signedUrl(nowSeconds() - 3600, "chat-attachments/conv-1/2026/11/shot.png");
    const freshUrl = signedUrl(nowSeconds() + 3600, "chat-attachments/conv-1/2026/11/shot.png");
    getMessages.mockResolvedValue({ data: [makeImageMessage(expiredUrl)] });
    getSignedUrl.mockResolvedValue({ data: { signedUrl: freshUrl } });

    render(
      <BrowserRouter>
        <ChatRoom conversationId="conv-1" mode="customer" />
      </BrowserRouter>
    );

    const img = await screen.findByAltText("shot.png");
    await waitFor(() => expect(img.getAttribute("src")).toBe(freshUrl));
    // The path handed to the backend is the single normalised key (bucket prefix
    // stripped exactly once), never `chat-attachments/chat-attachments/...`.
    expect(getSignedUrl).toHaveBeenCalledWith(
      "chat-attachments",
      "conv-1/2026/11/shot.png",
      3600,
      "customer"
    );
  }, 10000);

  it("keeps a fresh, correctly-prefixed image URL untouched (no re-sign)", async () => {
    const workingUrl = signedUrl(nowSeconds() + 3600, "conv-1/2026/11/shot.png");
    getMessages.mockResolvedValue({ data: [makeImageMessage(workingUrl)] });

    render(
      <BrowserRouter>
        <ChatRoom conversationId="conv-1" mode="customer" />
      </BrowserRouter>
    );

    const img = await screen.findByAltText("shot.png");
    expect(img.getAttribute("src")).toBe(workingUrl);
    expect(getSignedUrl).not.toHaveBeenCalled();
  }, 10000);
});