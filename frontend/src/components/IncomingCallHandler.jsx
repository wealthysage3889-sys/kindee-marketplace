import { useState, useEffect, useCallback } from "react";
import { useAuth } from "../context/AuthContext";
import { useSocket } from "../context/SocketContext";
import { callAPI } from "../api";
import VoiceCallUI from "./VoiceCallUI";
import "./IncomingCall.css";

export default function IncomingCallHandler({ children }) {
  const { token, user, isAuthenticated } = useAuth();
  const { on, off, connected } = useSocket();
  const [incomingCall, setIncomingCall] = useState(null);
  const [showCallUI, setShowCallUI] = useState(false);

  const handleIncomingCall = useCallback((callData) => {
    console.log("Incoming call:", callData);
    
    // Don't show if already in a call
    if (showCallUI) return;
    
    setIncomingCall({
      callId: callData.call_id,
      callerId: callData.caller_id,
      callerName: callData.caller_name,
      callerAvatar: callData.caller_avatar,
      conversationId: callData.conversation_id,
      storeOrderId: callData.store_order_id,
      callType: callData.call_type || "voice"
    });
    
    // Play notification sound
    playNotificationSound();
    
    // Show browser notification if permission granted
    showBrowserNotification(callData);
  }, [showCallUI]);

  const handleCallEnded = useCallback(() => {
    setIncomingCall(null);
    setShowCallUI(false);
  }, []);

  const handleAccept = useCallback(() => {
    setShowCallUI(true);
  }, []);

  const handleReject = useCallback(async () => {
    if (incomingCall) {
      try {
        await callAPI.reject(incomingCall.callId);
      } catch (err) {
        console.error("Reject error:", err);
      }
    }
    setIncomingCall(null);
  }, [incomingCall]);

  useEffect(() => {
    if (!isAuthenticated) return;
    
    on("incomingCall", handleIncomingCall);
    
    return () => {
      off("incomingCall", handleIncomingCall);
    };
  }, [isAuthenticated, on, off, handleIncomingCall]);

  // Request notification permission on mount
  useEffect(() => {
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
  }, []);

  const playNotificationSound = () => {
    try {
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(523.25, audioContext.currentTime); // C5
      oscillator.frequency.setValueAtTime(659.25, audioContext.currentTime + 0.3); // E5
      oscillator.frequency.setValueAtTime(783.99, audioContext.currentTime + 0.6); // G5
      
      gainNode.gain.setValueAtTime(0.2, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 1);
      
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      
      oscillator.start();
      oscillator.stop(audioContext.currentTime + 1);
    } catch (err) {
      console.log("Could not play notification sound");
    }
  };

  const showBrowserNotification = (callData) => {
    if (!("Notification" in window)) return;
    if (Notification.permission !== "granted") return;
    if (document.visibilityState === "visible") return; // Don't show if app is focused
    
    const notification = new Notification("สายเข้าใหม่", {
      body: `${callData.caller_name} กำลังโทรหาคุณ`,
      icon: callData.caller_avatar || "/favicon.ico",
      tag: `call-${callData.call_id}`,
      requireInteraction: true,
      actions: [
        { action: "accept", title: "รับสาย" },
        { action: "reject", title: "ปฏิเสธ" }
      ]
    });
    
    notification.onclick = () => {
      window.focus();
      notification.close();
      handleAccept();
    };
  };

  if (!incomingCall) {
    return children;
  }

  return (
    <>
      {children}
      <IncomingCallModal
        callData={incomingCall}
        onAccept={handleAccept}
        onReject={handleReject}
      />
      {showCallUI && incomingCall && (
        <VoiceCallUI
          initialCallId={incomingCall.callId}
          callerName={incomingCall.callerName}
          callerAvatar={incomingCall.callerAvatar}
          onClose={handleCallEnded}
          onCallEnded={handleCallEnded}
        />
      )}
    </>
  );
}

function IncomingCallModal({ callData, onAccept, onReject }) {
  return (
    <div className="incoming-call-overlay" role="dialog" aria-modal="true" aria-labelledby="caller-name">
      <div className="overlay-content">
        <div className="overlay-avatar">
          {callData.callerAvatar ? (
            <img src={callData.callerAvatar} alt={callData.callerName} />
          ) : (
            <span>{callData.callerName?.charAt(0) || "?"}</span>
          )}
        </div>
        
        <div className="overlay-info">
          <h1 id="caller-name">สายเข้า</h1>
          <p>{callData.callerName}</p>
          {callData.storeOrderId && (
            <span className="call-context">เกี่ยวกับออเดอร์ #{callData.storeOrderId}</span>
          )}
        </div>
        
        <div className="overlay-actions">
          <button className="overlay-btn reject" onClick={onReject} aria-label="ปฏิเสธสาย">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18.36 6.64a9 9 0 1 1-12.73 0"></path>
              <line x1="12" y1="2" x2="12" y2="22"></line>
            </svg>
          </button>
          
          <button className="overlay-btn accept" onClick={onAccept} aria-label="รับสาย">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path>
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}