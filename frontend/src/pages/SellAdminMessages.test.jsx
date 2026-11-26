import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { navigateMock, getConversationsMock } = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  getConversationsMock: vi.fn(),
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => navigateMock,
}));

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    admin: { user: { id: "admin-1", role: "admin", name: "Admin" } },
  }),
}));

vi.mock("../context/SocketContext", () => ({
  useSocket: () => ({
    connected: true,
    on: vi.fn(),
    off: vi.fn(),
  }),
}));

vi.mock("../api", () => ({
  chatAPI: {
    getConversations: (...args) => getConversationsMock(...args),
    getSpamConversations: vi.fn().mockResolvedValue({ data: { conversations: [] } }),
    updateAlias: vi.fn(),
    updateHidden: vi.fn(),
    markSpam: vi.fn(),
    restoreFromSpam: vi.fn(),
    markAsRead: vi.fn(),
    getMessages: vi.fn(),
  },
}));

vi.mock("../api/product", () => ({
  storeAPI: {
    getStoresByOwner: vi.fn().mockResolvedValue({ data: [] }),
  },
}));

import SellAdminMessages from "./SellAdminMessages";

const conversation = {
  id: "conv-1",
  store_id: "store-1",
  last_message: {
    id: "m1",
    content: "hello",
    created_at: new Date().toISOString(),
    sender_id: "cust-1",
  },
  members: [
    {
      profile_id: "admin-1",
      unread_count: 0,
      alias: null,
      is_hidden: false,
      profile: { id: "admin-1", name: "Admin" },
    },
    {
      profile_id: "cust-1",
      unread_count: 0,
      alias: null,
      is_hidden: false,
      profile: { id: "cust-1", name: "Customer" },
    },
  ],
};

describe("SellAdminMessages", () => {
  beforeEach(() => {
    navigateMock.mockReset();
    getConversationsMock.mockReset().mockResolvedValue({
      data: { conversations: [conversation], pagination: { total: 1 } },
    });
  });

  it("loads conversations with the admin chat token and navigates to the admin chat route", async () => {
    render(<SellAdminMessages />);

    expect(await screen.findByText("Customer")).toBeTruthy();
    expect(getConversationsMock).toHaveBeenCalledWith({}, "admin");

    fireEvent.click(screen.getByText("Customer"));
    expect(navigateMock).toHaveBeenCalledWith("/selladmin/messages/conv-1");
  });
});