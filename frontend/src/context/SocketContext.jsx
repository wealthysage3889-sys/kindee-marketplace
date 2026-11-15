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

export function SocketProvider({ children }) {
  const { token, isAuthenticated } = useAuth();
  const socketRef = useRef(null);
  const [connected, setConnected] = useState(false);
  const [typingUsers, setTypingUsers] = useState({});
  const [activeCall, setActiveCall] = useState(null);

  const connect = useCallback(() => {
    if (!isAuthenticated || !token) return;
    
    if (socketRef.current?.connected) return;

    const API_BASE = import.meta.env.VITE_API_BASE || "/api";
    const socketUrl = API_BASE.replace(/\/api$/, "") || "";

    socketRef.current = io(socketUrl || undefined, {
      path: "/socket.io",
      transports: ["websocket", "polling"],
      auth: { token },
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    });

    const onConnect = () => {
      console.log("Socket connected:", socketRef.current.id);
      setConnected(true);
    };

    const onDisconnect = (reason) => {
      console.log("Socket disconnected:", reason);
      setConnected(false);
    };

    const onReconnect = (attempt) => {
      console.log("Socket reconnected after attempt:", attempt);
      setConnected(true);
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
      socketRef.current.emit('messageReceived', message.id);
    };

    const onMessagesRead = ({ conversationId, userId, count }) => {
      // Handle read receipts
    };

    // Order events
    const onOrderStatusUpdate = (data) => {
      // Handle order status updates
    };

    const onNewOrder = (order) => {
      // Handle new order notification
    };

    // Delivery events
    const onDeliveryStatusUpdate = (data) => {
      // Handle delivery status updates
    };

    const onCourierLocationUpdate = (data) => {
      // Handle real-time courier location
    };

    // Call events
    const onIncomingCall = (callData) => {
      setActiveCall(callData);
    };

    const onCallEnded = (callData) => {
      setActiveCall(null);
    };

    const onCallSignal = ({ from, signal }) => {
      // Handle WebRTC signaling
    };

    // Notification events
    const onNotification = (notification) => {
      // Handle new notification
    };

    socketRef.current.on("connect", onConnect);
    socketRef.current.on("disconnect", onDisconnect);
    socketRef.current.io?.on("reconnect", onReconnect);
    socketRef.current.io?.on("connect_error", onConnectError);
    socketRef.current.on("typing", onTyping);
    socketRef.current.on("stopTyping", onStoppedTyping);
    socketRef.current.on("newMessage", onNewMessage);
    socketRef.current.on("messagesRead", onMessagesRead);
    socketRef.current.on("orderStatusUpdate", onOrderStatusUpdate);
    socketRef.current.on("newOrder", onNewOrder);
    socketRef.current.on("deliveryStatusUpdate", onDeliveryStatusUpdate);
    socketRef.current.on("courierLocationUpdate", onCourierLocationUpdate);
    socketRef.current.on("incomingCall", onIncomingCall);
    socketRef.current.on("callEnded", onCallEnded);
    socketRef.current.on("callSignal", onCallSignal);
    socketRef.current.on("notification", onNotification);

    return () => {
      if (socketRef.current) {
        socketRef.current.io?.off("reconnect", onReconnect);
        socketRef.current.io?.off("connect_error", onConnectError);
        socketRef.current.off("connect", onConnect);
        socketRef.current.off("disconnect", onDisconnect);
        socketRef.current.off("typing", onTyping);
        socketRef.current.off("stopTyping", onStoppedTyping);
        socketRef.current.off("newMessage", onNewMessage);
        socketRef.current.off("messagesRead", onMessagesRead);
        socketRef.current.off("orderStatusUpdate", onOrderStatusUpdate);
        socketRef.current.off("newOrder", onNewOrder);
        socketRef.current.off("deliveryStatusUpdate", onDeliveryStatusUpdate);
        socketRef.current.off("courierLocationUpdate", onCourierLocationUpdate);
        socketRef.current.off("incomingCall", onIncomingCall);
        socketRef.current.off("callEnded", onCallEnded);
        socketRef.current.off("callSignal", onCallSignal);
        socketRef.current.off("notification", onNotification);
        socketRef.current.disconnect();
        socketRef.current = null;
      }
    };
  }, [isAuthenticated, token]);

  useEffect(() => {
    if (isAuthenticated && token) {
      connect();
    }
    
    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
    };
  }, [isAuthenticated, token, connect]);

  // Socket actions
  const joinStore = useCallback((storeId) => {
    socketRef.current?.emit("joinStore", storeId);
  }, []);

  const leaveStore = useCallback((storeId) => {
    socketRef.current?.emit("leaveStore", storeId);
  }, []);

  const joinConversation = useCallback((conversationId) => {
    socketRef.current?.emit("joinConversation", conversationId);
  }, []);

  const leaveConversation = useCallback((conversationId) => {
    socketRef.current?.emit("leaveConversation", conversationId);
  }, []);

  const joinDelivery = useCallback((deliveryId) => {
    socketRef.current?.emit("joinDelivery", deliveryId);
  }, []);

  const leaveDelivery = useCallback((deliveryId) => {
    socketRef.current?.emit("leaveDelivery", deliveryId);
  }, []);

  const joinCall = useCallback((callId) => {
    socketRef.current?.emit("joinCall", callId);
  }, []);

  const leaveCall = useCallback((callId) => {
    socketRef.current?.emit("leaveCall", callId);
  }, []);

  const startTyping = useCallback((conversationId, name) => {
    socketRef.current?.emit("typing", { conversationId, name });
  }, []);

  const stopTyping = useCallback((conversationId) => {
    socketRef.current?.emit("stopTyping", { conversationId });
  }, []);

  const sendCallSignal = useCallback((callId, signal) => {
    socketRef.current?.emit("callSignal", { callId, signal });
  }, []);

  const sendCourierLocation = useCallback((deliveryId, coordinates, metadata) => {
    socketRef.current?.emit("courierLocationUpdate", { deliveryId, coordinates, metadata });
  }, []);

  const on = useCallback((event, handler) => {
    socketRef.current?.on(event, handler);
  }, []);

  const off = useCallback((event, handler) => {
    socketRef.current?.off(event, handler);
  }, []);

  const emit = useCallback((event, data) => {
    socketRef.current?.emit(event, data);
  }, []);

  const value = {
    socket: socketRef.current,
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