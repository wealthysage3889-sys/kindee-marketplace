import React, { StrictMode } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { ioMock, sockets, authState } = vi.hoisted(() => {
  const sockets = [];
  const ioMock = vi.fn((url, opts) => {
    const token = opts?.auth?.token || "none";
    const socket = {
      id: `socket-${token}`,
      connected: false,
      on: vi.fn(),
      off: vi.fn(),
      emit: vi.fn(),
      disconnect: vi.fn(),
    };
    sockets.push({ token, socket, url, opts });
    return socket;
  });
  return {
    ioMock,
    sockets,
    authState: {
      current: {
        customer: { token: "c1" },
        admin: { token: "a1" },
      },
    },
  };
});

vi.mock("socket.io-client", () => ({ io: ioMock }));
vi.mock("./AuthContext", () => ({ useAuth: () => authState.current }));
vi.mock("./NotificationContext", () => ({
  useNotifications: () => ({
    clearUnread: vi.fn(),
    addNotification: vi.fn(),
    setNotifications: vi.fn(),
    playNotificationSound: vi.fn(),
    showToast: vi.fn(),
  }),
}));
vi.mock("../utils/toast", () => ({ toast: vi.fn() }));

import { SocketProvider, useSocket } from "./SocketContext";

function Consumer() {
  const { connected, joinConversation } = useSocket();
  return (
    <div>
      <span data-testid="connected">{String(connected)}</span>
      <button type="button" onClick={() => joinConversation("conv-1")}>join</button>
    </div>
  );
}

describe("SocketContext lifecycle", () => {
  beforeEach(() => {
    sockets.length = 0;
    ioMock.mockClear();
    authState.current = {
      customer: { token: "c1" },
      admin: { token: "a1" },
    };
  });

  it("does not disconnect still-valid sockets during the StrictMode probe or token refresh", () => {
    const view = render(
      <StrictMode>
        <SocketProvider>
          <Consumer />
        </SocketProvider>
      </StrictMode>
    );

    const customer = sockets.find((entry) => entry.token === "c1")?.socket;
    const admin = sockets.find((entry) => entry.token === "a1")?.socket;
    expect(customer).toBeTruthy();
    expect(admin).toBeTruthy();
    expect(customer.disconnect).not.toHaveBeenCalled();
    expect(admin.disconnect).not.toHaveBeenCalled();

    authState.current = {
      customer: { token: "c1" },
      admin: { token: "a2" },
    };
    view.rerender(
      <StrictMode>
        <SocketProvider>
          <Consumer />
        </SocketProvider>
      </StrictMode>
    );

    expect(admin.disconnect).toHaveBeenCalledTimes(1);
    expect(customer.disconnect).not.toHaveBeenCalled();
    expect(sockets.some((entry) => entry.token === "a2")).toBe(true);
  });

  it("emits joinConversation to the connected sockets", () => {
    render(
      <SocketProvider>
        <Consumer />
      </SocketProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: "join" }));
    expect(
      sockets.every((entry) =>
        entry.socket.emit.mock.calls.some(([event]) => event === "joinConversation")
      )
    ).toBe(true);
  });
});