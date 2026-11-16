import { createContext, useContext, useEffect, useRef, useState, useCallback } from "react";
import { io } from "socket.io-client";
import { useAuth } from "./AuthContext";

const SocketContext = createContext(null);

export function useSocket() {
  const ctx = useContext(SocketContext);
  if (!ctx) {
    throw new Error("useSocket must be used within SocketProvider");
  }
  return ctx;
}

// The app keeps two token namespaces (customer + admin/store-owner). A browser
// can be signed in to both at the same time, so one socket is opened per
// namespace: that way the customer chat and the store-owner chat both receive
// realtime events, no matter which session the current page uses.
export function SocketProvider({ children }) {
  const { customer, admin } = useAuth();
  const customerToken = customer?.token || null;
  const adminToken = admin?.token || null;

  const socketsRef = useRef(new Map()); // token -> socket
  const detachRef = useRef(new Map()); // token -> detach handlers
  const [connected, setConnected] = useState(false);
  const [typingUsers, setTypingUsers] = useState({});
  const [activeCall, setActiveCall] = useState(null);

  const anyConnected = () => [...socketsRef.current.values()].some((socket) => socket.connected);

  const attachHandlers = useCallback((socket) => {
    const onConnect = () => {
      console.log("Socket connected:", socket.id);
      setConnected(anyConnected());
    };

    const onDisconnect = (reason) => {
      console.log("Socket disconnected:", reason);
      setConnected(anyConnected());
    };

    const onReconnect = (attempt) => {
      console.log("Socket reconnected after attempt:", attempt);
      setConnected(anyConnected());
    };

    const onConnectError = (error) => {
      console.error("Socket connection error:", error);
    };

    const onTyping = ({ userId, name }) => {
      if (!userId) return;
      setTypingUsers(prev => ({ ...prev, [userId]: name }));
    };

    const onStoppedTyping = ({ userId }) => {
      if (!userId) return;
      setTypingUsers(prev => {
        const next = { ...prev };
        delete next[userId];
        return next;
      });
    };

    // Message events
    const onNewMessage = (message) => {
      if (!message?.id) return;
      socket.emit('messageReceived', message.id);
    };

    const onMessagesRead = () => {
      // Read receipts are handled by the chat room itself
    };

    const onOrderStatusUpdate = () => {};
    const onNewOrder = () => {};
    const onDeliveryStatusUpdate = () => {};
    const onCourierLocationUpdate = () => {};
    const onNotification = () => {};

    const onIncomingCall = (callData) => setActiveCall(callData);
    const onCallEnded = () => setActiveCall(null);
    const onCallSignal = () => {};

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.io?.on("reconnect", onReconnect);
    socket.io?.on("connect_error", onConnectError);
    socket.on("typing", onTyping);
    socket.on("stopTyping", onStoppedTyping);
    socket.on("newMessage", onNewMessage);
    socket.on("messagesRead", onMessagesRead);
    socket.on("orderStatusUpdate", onOrderStatusUpdate);
    socket.on("newOrder", onNewOrder);
    socket.on("deliveryStatusUpdate", onDeliveryStatusUpdate);
    socket.on("courierLocationUpdate", onCourierLocationUpdate);
    socket.on("incomingCall", onIncomingCall);
    socket.on("callEnded", onCallEnded);
    socket.on("callSignal", onCallSignal);
    socket.on("notification", onNotification);

    return () => {
      socket.io?.off("reconnect", onReconnect);
      socket.io?.off("connect_error", onConnectError);
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("typing", onTyping);
      socket.off("stopTyping", onStoppedTyping);
      socket.off("newMessage", onNewMessage);
      socket.off("messagesRead", onMessagesRead);
      socket.off("orderStatusUpdate", onOrderStatusUpdate);
      socket.off("newOrder", onNewOrder);
      socket.off("deliveryStatusUpdate", onDeliveryStatusUpdate);
      socket.off("courierLocationUpdate", onCourierLocationUpdate);
      socket.off("incomingCall", onIncomingCall);
      socket.off("callEnded", onCallEnded);
      socket.off("callSignal", onCallSignal);
      socket.off("notification", onNotification);
    };
  }, []);

  const createSocket = useCallback((token) => {
    const API_BASE = import.meta.env.VITE_API_BASE || "/api";
    const socketUrl = API_BASE.replace(/\/api$/, "") || "";

    return io(socketUrl || undefined, {
      path: "/socket.io",
      transports: ["websocket", "polling"],
      auth: { token },
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    });
  }, []);

  const connect = useCallback(() => {
    const tokens = [];
    [customerToken, adminToken].forEach((token) => {
      if (token && !tokens.includes(token)) tokens.push(token);
    });

    // Drop sockets whose session disappeared (logout).
    for (const [token, socket] of [...socketsRef.current.entries()]) {
      if (!tokens.includes(token)) {
        detachRef.current.get(token)?.();
        detachRef.current.delete(token);
        socketsRef.current.delete(token);
        socket.disconnect();
      }
    }

    tokens.forEach((token) => {
      if (socketsRef.current.has(token)) return;
      const socket = createSocket(token);
      socketsRef.current.set(token, socket);
      detachRef.current.set(token, attachHandlers(socket));
    });

    setConnected(anyConnected());
  }, [customerToken, adminToken, createSocket, attachHandlers]);

  const disconnectAll = useCallback(() => {
    for (const [token, socket] of [...socketsRef.current.entries()]) {
      detachRef.current.get(token)?.();
      detachRef.current.delete(token);
      socketsRef.current.delete(token);
      socket.disconnect();
    }
    setConnected(false);
  }, []);

  useEffect(() => {
    connect();
    return disconnectAll;
  }, [connect, disconnectAll]);

  const eachSocket = (fn) => {
    socketsRef.current.forEach((socket) => fn(socket));
  };

  // Socket actions
  const joinStore = useCallback((storeId) => {
    eachSocket((socket) => socket.emit("joinStore", storeId));
  }, []);

  const leaveStore = useCallback((storeId) => {
    eachSocket((socket) => socket.emit("leaveStore", storeId));
  }, []);

  const joinConversation = useCallback((conversationId) => {
    eachSocket((socket) => socket.emit("joinConversation", conversationId));
  }, []);

  const leaveConversation = useCallback((conversationId) => {
    eachSocket((socket) => socket.emit("leaveConversation", conversationId));
  }, []);

  const joinDelivery = useCallback((deliveryId) => {
    eachSocket((socket) => socket.emit("joinDelivery", deliveryId));
  }, []);

  const leaveDelivery = useCallback((deliveryId) => {
    eachSocket((socket) => socket.emit("leaveDelivery", deliveryId));
  }, []);

  const joinCall = useCallback((callId) => {
    eachSocket((socket) => socket.emit("joinCall", callId));
  }, []);

  const leaveCall = useCallback((callId) => {
    eachSocket((socket) => socket.emit("leaveCall", callId));
  }, []);

  const startTyping = useCallback((conversationId, name) => {
    eachSocket((socket) => socket.emit("typing", { conversationId, name }));
  }, []);

  const stopTyping = useCallback((conversationId) => {
    eachSocket((socket) => socket.emit("stopTyping", { conversationId }));
  }, []);

  const sendCallSignal = useCallback((callId, signal) => {
    eachSocket((socket) => socket.emit("callSignal", { callId, signal }));
  }, []);

  const sendCourierLocation = useCallback((deliveryId, coordinates, metadata) => {
    eachSocket((socket) => socket.emit("courierLocationUpdate", { deliveryId, coordinates, metadata }));
  }, []);

  const on = useCallback((event, handler) => {
    eachSocket((socket) => socket.on(event, handler));
  }, []);

  const off = useCallback((event, handler) => {
    eachSocket((socket) => socket.off(event, handler));
  }, []);

  const emit = useCallback((event, data) => {
    eachSocket((socket) => socket.emit(event, data));
  }, []);

  const value = {
    socket: socketsRef.current.values().next().value || null,
    connected,
    joinStore,
    leaveStore,
    joinConversation,
    leaveConversation,
    joinDelivery,
    leaveDelivery,
    joinCall,
    leaveCall,
    startTyping,
    stopTyping,
    sendCallSignal,
    sendCourierLocation,
    on,
    off,
    emit,
    typingUsers,
    activeCall,
    setActiveCall
  };

  return <SocketContext.Provider value={value}>{children}</SocketContext.Provider>;
}