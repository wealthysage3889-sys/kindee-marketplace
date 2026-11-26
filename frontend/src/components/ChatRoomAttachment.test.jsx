import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getConversationMock, getMessagesMock, getSignedUrlMock } = vi.hoisted(() => ({
  getConversationMock: vi.fn(),
  getMessagesMock: vi.fn(),
  getSignedUrlMock: vi.fn(),
}));

vi.mock("react-router-dom", () => ({
  useParams: () => ({}),
  useLocation: () => ({ pathname: "/messages/conv-1" }),
  useNavigate: () => vi.fn(),
}));

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    customer: { user: { id: "me", name: "Me" }, token: "token" },
    admin: null,
  }),
}));

vi.mock("../context/SocketContext", () => ({
  useSocket: () => ({
    connected: false,
    joinConversation: vi.fn(),
    leaveConversation: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
  }),
}));

vi.mock("../api", () => ({
  chatAPI: {
    getConversation: (...args) => getConversationMock(...args),
    getMessages: (...args) => getMessagesMock(...args),
    markAsRead: vi.fn(),
    sendMessage: vi.fn(),
  },
  uploadAPI: {
    getSignedUrl: (...args) => getSignedUrlMock(...args),
  },
  callAPI: {},
  adminAPI: {},
  normalizeAttachment: (attachment) => attachment,
}));

vi.mock("./VoiceCallUI", () => ({ default: () => <div data-testid="voice-call" /> }));
vi.mock("./ChatRoutePanel", () => ({ default: () => null }));
vi.mock("./OrderDetailModal", () => ({ default: () => null }));

import ChatRoom from "./ChatRoom";

function signedUrlWithExp(exp) {
  const payload = Buffer.from(JSON.stringify({ exp })).toString("base64url");
  return `https://test.supabase.co/storage/v1/object/sign/chat-attachments/conv-1/2026/11/chat.png?token=header.${payload}.signature`;
}

const nowSeconds = () => Math.floor(Date.now() / 1000);

describe("ChatRoom attachment signed URLs", () => {
  beforeEach(() => {
    getConversationMock.mockReset().mockResolvedValue({ data: { id: "conv-1", members: [] } });
    getMessagesMock.mockReset().mockResolvedValue({ data: [] });
    getSignedUrlMock.mockReset();
  });

  it("refreshes an expired image signed URL before rendering", async () => {
    const expired = signedUrlWithExp(nowSeconds() - 3600);
    const fresh = signedUrlWithExp(nowSeconds() + 3600);
    getMessagesMock.mockResolvedValue({
      data: [
        {
          id: "m-image",
          type: "image",
          content: "",
          attachments: [
            {
              id: "att-image",
              file_url: expired,
              file_name: "chat.png",
              file_size: 1024,
              mime_type: "image/png",
            },
          ],
          sender_id: "them",
          created_at: new Date().toISOString(),
        },
      ],
    });
    getSignedUrlMock.mockResolvedValue({ data: { signedUrl: fresh } });

    render(<ChatRoom conversationId="conv-1" mode="customer" />);

    await waitFor(() =>
      expect(getSignedUrlMock).toHaveBeenCalledWith(
        "chat-attachments",
        "conv-1/2026/11/chat.png",
        3600,
        "customer"
      )
    );
    const image = await screen.findByRole("img");
    expect(image).toHaveProperty("src", fresh);
  });

  it("does not request a fresh signed URL for a still-valid image URL", async () => {
    const fresh = signedUrlWithExp(nowSeconds() + 3600);
    getMessagesMock.mockResolvedValue({
      data: [
        {
          id: "m-image-fresh",
          type: "image",
          content: "",
          attachments: [
            {
              id: "att-image-fresh",
              file_url: fresh,
              file_name: "chat.png",
              file_size: 1024,
              mime_type: "image/png",
            },
          ],
          sender_id: "them",
          created_at: new Date().toISOString(),
        },
      ],
    });

    render(<ChatRoom conversationId="conv-1" mode="customer" />);

    const image = await screen.findByRole("img");
    expect(image).toHaveProperty("src", fresh);
    expect(getSignedUrlMock).not.toHaveBeenCalled();
  });

  it("refreshes an expired file attachment URL", async () => {
    const expired = signedUrlWithExp(nowSeconds() - 3600);
    const fresh = signedUrlWithExp(nowSeconds() + 3600);
    getMessagesMock.mockResolvedValue({
      data: [
        {
          id: "m-file",
          type: "file",
          content: "",
          attachments: [
            {
              id: "att-file",
              file_url: expired,
              file_name: "price.pdf",
              file_size: 2048,
              mime_type: "application/pdf",
            },
          ],
          sender_id: "them",
          created_at: new Date().toISOString(),
        },
      ],
    });
    getSignedUrlMock.mockResolvedValue({ data: { signedUrl: fresh } });

    render(<ChatRoom conversationId="conv-1" mode="customer" />);

    const link = (await screen.findByText("price.pdf")).closest("a");
    await waitFor(() => expect(link.getAttribute("href")).toBe(fresh));
  });

  it("coalesces identical concurrent refresh requests for the same object", async () => {
    const expired = signedUrlWithExp(nowSeconds() - 3600);
    const fresh = signedUrlWithExp(nowSeconds() + 3600);
    // Default (text) message renders BOTH image attachments; both point at the
    // same object key, so their proactive refreshes must coalesce into one call.
    const message = {
      id: "m-dup",
      type: "text",
      content: "",
      attachments: [
        { id: "a1", file_url: expired, file_name: "dup.png", file_size: 10, mime_type: "image/png" },
        { id: "a2", file_url: expired, file_name: "dup.png", file_size: 10, mime_type: "image/png" },
      ],
      sender_id: "them",
      created_at: new Date().toISOString(),
    };
    getMessagesMock.mockResolvedValue({ data: [message] });

    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    getSignedUrlMock.mockReturnValue(gate.then(() => ({ data: { signedUrl: fresh } })));

    render(<ChatRoom conversationId="conv-1" mode="customer" />);

    // Both attachments resolve to the same bucket+path -> a single in-flight call.
    await waitFor(() => expect(getSignedUrlMock).toHaveBeenCalledTimes(1));
    expect(getSignedUrlMock).toHaveBeenCalledWith(
      "chat-attachments",
      "conv-1/2026/11/chat.png",
      3600,
      "customer"
    );

    release();
    await waitFor(() =>
      expect(screen.getAllByAltText("dup.png").length).toBe(2)
    );
    const imgs = screen.getAllByAltText("dup.png");
    imgs.forEach((img) => expect(img.getAttribute("src")).toBe(fresh));
  });
});