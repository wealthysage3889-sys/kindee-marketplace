import { createContext, useContext, useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";

const SocketContext = createContext(null);

export function useSocket() {
  const ctx = useContext(SocketContext);
  if (!ctx) {
    throw new Error("useSocket must be used within SocketProvider");
  }
  return ctx;
}

export function SocketProvider({ children }) {
  const socketRef = useRef(null);
  const [connected, setConnected] = useState(false);
  const [typingUsers, setTypingUsers] = useState({});

  const getCurrentUserId = () => {
    try {
      const userRaw =
        localStorage.getItem("customerUser") || localStorage.getItem("adminUser");
      const user = userRaw ? JSON.parse(userRaw) : null;
      return user?._id || user?.id || null;
    } catch {
      return null;
    }
  };

  useEffect(() => {
    const token =
      localStorage.getItem("customerToken") || localStorage.getItem("adminToken");

    const API_BASE = import.meta.env.VITE_API_BASE || "/api";
    const socketUrl = API_BASE.replace(/\/api$/, "") || "";

    socketRef.current = io(socketUrl || undefined, {
      path: "/socket.io",
      withCredentials: true,
      transports: ["websocket", "polling"],
      auth: token ? { token } : undefined,
    });

    const joinUserRoom = () => {
      const uid = getCurrentUserId();
      if (uid) socketRef.current?.emit("joinUser", uid);
    };

    const onConnect = () => {
      console.log("Socket connected:", socketRef.current.id);
      setConnected(true);
      joinUserRoom();
    };

    const onDisconnect = () => {
      console.log("Socket disconnected");
      setConnected(false);
    };

    const onReconnect = (attempt) => {
      console.log("Socket reconnected after attempt:", attempt);
      setConnected(true);
      joinUserRoom();
    };

    const onTyping = ({ userId, name }) => {
      if (!userId) return;
      setTypingUsers((prev) => ({ ...prev, [userId]: name }));
    };

    const onStoppedTyping = ({ userId }) => {
      if (!userId) return;
      setTypingUsers((prev) => {
        const next = { ...prev };
        delete next[userId];
        return next;
      });
    };

    socketRef.current.on("connect", onConnect);
    socketRef.current.on("disconnect", onDisconnect);
    socketRef.current.io?.on("reconnect", onReconnect);
    socketRef.current.on("typing", onTyping);
    socketRef.current.on("stopTyping", onStoppedTyping);

    return () => {
      if (socketRef.current) {
        socketRef.current.io?.off("reconnect", onReconnect);
        socketRef.current.disconnect();
        socketRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (connected) {
      const uid = getCurrentUserId();
      if (uid) socketRef.current?.emit("joinUser", uid);
    }
  }, [connected]);

  const joinStore = (storeId) => {
    socketRef.current?.emit("joinStore", storeId);
  };

  const leaveStore = (storeId) => {
    socketRef.current?.emit("leaveStore", storeId);
  };

  const startTyping = (storeId, name) => {
    socketRef.current?.emit("typing", { storeId, name });
  };

  const stopTyping = (storeId) => {
    socketRef.current?.emit("stopTyping", { storeId });
  };

  const on = (event, handler) => {
    socketRef.current?.on(event, handler);
  };

  const off = (event, handler) => {
    socketRef.current?.off(event, handler);
  };

  const emit = (event, data) => {
    socketRef.current?.emit(event, data);
  };

  const value = {
    socket: socketRef.current,
    connected,
    joinStore,
    leaveStore,
    startTyping,
    stopTyping,
    on,
    off,
    emit,
    typingUsers,
  };

  return <SocketContext.Provider value={value}>{children}</SocketContext.Provider>;
}