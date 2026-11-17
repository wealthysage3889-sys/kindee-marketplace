import { useState, useEffect, useCallback, useRef } from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useSocket } from "../context/SocketContext";
import { callAPI } from "../api";
import VoiceCallUI from "./VoiceCallUI";
import { ringtone } from "../utils/ringtone";
import "./IncomingCall.css";

// Incoming calls must be accepted with the session that owns this layout:
// `/` and `/courier` use the customer token, `/selladmin` uses the admin token.
function resolveCallMode(pathname) {
  return pathname.startsWith("/selladmin") ? "admin" : "customer";
}

export default function IncomingCallHandler({ children }) {
  const { customer, admin } = useAuth();
  const location = useLocation();
  const mode = resolveCallMode(location.pathname);
  const { on, off, joinCall, leaveCall } = useSocket();
  const [incomingCall, setIncomingCall] = useState(null);
  const [showCallUI, setShowCallUI] = useState(false);
  // The session that owns this layout: admin on /selladmin, customer elsewhere.
  // A bare token is not enough — the recipient's profile role must authorize
  // them to receive calls (admin/owner on the admin layout).
  const session = mode === "admin" ? admin : customer;
  const isAuthenticated = !!session.token;
  const isAuthorized = mode === "admin"
    ? ["admin", "owner"].includes((session.user || {}).role)
    : isAuthenticated;
  const userId = session.user?.id || session.user?._id;
  // The socket handler is registered once; it reads the current session/user
  // from refs so an incoming call is never dropped or checked against a stale
  // closure value (this used to silence the modal in the admin/owner session,
  // where `isAuthenticated` in the closure referred to the customer session).
  const sessionRef = useRef({ mode, isAuthenticated, isAuthorized, userId });
  sessionRef.current = { mode, isAuthenticated, isAuthorized, userId };
  // Mirror of the active incoming call + whether the call UI is up, so socket
  // handlers can act on the current call without being re-registered (and read
  // through a stale closure) every time state changes.
  const incomingCallRef = useRef(null);
  const showCallUIStateRef = useRef(false);

  const clearIncoming = useCallback(() => {
    ringtone.stop();
    incomingCallRef.current = null;
    showCallUIStateRef.current = false;
    setIncomingCall(null);
    setShowCallUI(false);
  }, []);

  const handleIncomingCall = useCallback((callData) => {
    console.info("[call] IncomingCallHandler incomingCall", { callId: callData?.call_id, from: callData?.caller_id, hasConversation: !!callData?.conversation_id });

    const session = sessionRef.current;

    // Don't show if already in a call
    if (showCallUIStateRef.current || incomingCallRef.current) {
      console.warn("[call] IncomingCallHandler ignored (already in a call)", { callId: callData?.call_id });
      return;
    }

    // Ignore our own call (multi-tab / dual socket echo).
    if (session.userId && callData?.caller_id && String(callData.caller_id) === String(session.userId)) {
      console.info("[call] IncomingCallHandler ignored own call", { callId: callData?.call_id });
      return;
    }

    // Join the call signaling room immediately so the offer (sent by the
    // caller after the callee accepts) reaches this client before it mounts
    // VoiceCallUI. Prevents the callee from missing the offer.
    joinCall(callData.call_id);
    console.info("[call] IncomingCallHandler joined call room", { callId: callData?.call_id });

    const next = {
      callId: callData.call_id,
      callerId: callData.caller_id,
      callerName: callData.caller_name,
      callerAvatar: callData.caller_avatar,
      conversationId: callData.conversation_id,
      storeOrderId: callData.store_order_id,
      callType: callData.call_type || "voice"
    };
    incomingCallRef.current = next;
    setIncomingCall(next);

    // Play incoming-call ringtone (loops until stopped)
    ringtone.start(callData.call_id);

    // Show browser notification if permission granted
    showBrowserNotification(callData);
  }, [joinCall]);

  // Called when the call ends/closes for any reason (local close, remote
  // hang-up, or VoiceCallUI teardown). Stops the ringtone, leaves the call room
  // and clears the modal.
  const handleCallEnded = useCallback(() => {
    console.info("[call] IncomingCallHandler call ended/closed", { callId: incomingCallRef.current?.callId });
    if (incomingCallRef.current) {
      leaveCall(incomingCallRef.current.callId);
    }
    clearIncoming();
  }, [leaveCall, clearIncoming]);

  // A socket callEnded/callRejected for the incoming call must close the modal
  // and stop the ringtone even before VoiceCallUI is mounted (caller cancelled
  // while we were still ringing). Events for other calls are ignored by call_id.
  const makeRemoteEndHandler = useCallback((eventName) => (payload) => {
    const endedCallId = payload?.call_id ?? payload?.callId;
    const current = incomingCallRef.current;
    if (!current) return;
    if (endedCallId && String(endedCallId) !== String(current.callId)) {
      console.info(`[call] ${eventName} ignored (different call)`, { active: current.callId, event: endedCallId });
      return;
    }
    console.info(`[call] ${eventName} -> clearing incoming modal`, { callId: current.callId, status: payload?.status });
    // VoiceCallUI (if mounted) also handles its own teardown; clearing here
    // guarantees the ringtone and modal close even when it is not mounted.
    leaveCall(current.callId);
    clearIncoming();
  }, [leaveCall, clearIncoming]);

  const handleAccept = useCallback(async () => {
    const callId = incomingCallRef.current?.callId;
    console.info("[call] IncomingCallHandler accept clicked", { callId, mode });
    if (!callId) return;
    // Mount VoiceCallUI first so it joins/subscribes before the caller sends the offer.
    showCallUIStateRef.current = true;
    setShowCallUI(true);
    // Stop the ringtone immediately on accept; VoiceCallUI takes over media.
    ringtone.stop();
    try {
      // Accept must be called with the same session token that owns this layout
      // (admin on /selladmin, customer elsewhere) so the backend authorizes the callee.
      console.info("[call] acceptCall() invoking API", { callId, mode });
      await callAPI.accept(callId, mode);
      console.info("[call] acceptCall() API accepted", { callId, mode });
    } catch (err) {
      console.error("[call] IncomingCallHandler accept failed", { callId, mode, error: err?.message || String(err) });
    }
  }, [mode]);

  const handleReject = useCallback(async () => {
    const current = incomingCallRef.current;
    console.info("[call] IncomingCallHandler reject clicked", { callId: current?.callId });
    ringtone.stop();
    if (current) {
      try {
        await callAPI.reject(current.callId, mode);
      } catch (err) {
        console.error("[call] IncomingCallHandler reject error", { callId: current.callId, error: err?.message || String(err) });
      }
      leaveCall(current.callId);
    }
    clearIncoming();
  }, [leaveCall, clearIncoming, mode]);

  const handleRemoteCallEnded = useCallback((payload) => makeRemoteEndHandler("callEnded")(payload), [makeRemoteEndHandler]);
  const handleRemoteCallRejected = useCallback((payload) => makeRemoteEndHandler("callRejected")(payload), [makeRemoteEndHandler]);

  useEffect(() => {
    // Only register the listener for the session that owns this layout. An
    // admin on /selladmin must receive calls even when no customer session
    // exists, and only when the admin/owner role authorizes them.
    if (!isAuthenticated || !isAuthorized) return;

    on("incomingCall", handleIncomingCall);
    on("callEnded", handleRemoteCallEnded);
    on("callRejected", handleRemoteCallRejected);

    return () => {
      off("incomingCall", handleIncomingCall);
      off("callEnded", handleRemoteCallEnded);
      off("callRejected", handleRemoteCallRejected);
    };
  }, [isAuthenticated, isAuthorized, on, off, handleIncomingCall, handleRemoteCallEnded, handleRemoteCallRejected]);

  // Stop the ringtone on unmount (route change / logout) so it can never keep
  // looping after this handler is gone.
  useEffect(() => {
    return () => {
      ringtone.stop();
    };
  }, []);

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
          callMode={mode}
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