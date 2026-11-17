import { useState, useEffect, useRef, useCallback } from "react";
import { useAuth } from "../context/AuthContext";
import { useSocket } from "../context/SocketContext";
import { callAPI } from "../api";
import { ringtone } from "../utils/ringtone";
import { ringback } from "../utils/ringback";
import "./VoiceCallUI.css";

export default function VoiceCallUI({ 
  initialCallId, 
  onClose, 
  onCallEnded,
  calleeId,
  conversationId,
  storeOrderId,
  callMode = "customer",
  callerName,
  callerAvatar
}) {
  const { token, user } = useAuth();
  const { sendCallSignal, joinCall, leaveCall, on, off } = useSocket();
  
  const [callId, setCallId] = useState(initialCallId);
  const [status, setStatus] = useState("connecting");
  const [duration, setDuration] = useState(0);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState("");
  const [remoteStream, setRemoteStream] = useState(null);
  const [localStream, setLocalStream] = useState(null);
  
  const localAudioRef = useRef(null);
  const remoteAudioRef = useRef(null);
  const durationIntervalRef = useRef(null);
  const callStartTimeRef = useRef(null);
  const isInitiatorRef = useRef(false);
  const peerConnectionRef = useRef(null);
  const pendingIceCandidatesRef = useRef([]);
  const localStreamRef = useRef(null);
  const mediaReadyRef = useRef(false);
  const offerSentRef = useRef(false);
  const answerSentRef = useRef(false);
  const answerAppliedRef = useRef(false);
  const signalLockRef = useRef(false);
  
  // Signal handshake is initiated from socket handlers / mount effect so these
  // callbacks are only invoked through refs, never during render.
  const createOfferRef = useRef(null);
  const terminateCallRef = useRef(null);

  const startDurationTimer = useCallback(() => {
    if (durationIntervalRef.current) return;
    callStartTimeRef.current = Date.now();
    durationIntervalRef.current = setInterval(() => {
      setDuration(Math.floor((Date.now() - callStartTimeRef.current) / 1000));
    }, 1000);
  }, []);

  const stopDurationTimer = useCallback(() => {
    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current);
      durationIntervalRef.current = null;
    }
  }, []);

  // Stop the incoming-call ringtone. Declared before every consumer below so no callback
  // closes over it before its const initialization (temporal dead zone).
  const stopRingtone = useCallback(() => {
    ringtone.stop();
  }, []);

  // Stop the outgoing ringback tone (caller side). Declared before every consumer
  // below so no callback closes over it before its const initialization.
  const stopRingback = useCallback(() => {
    ringback.stop();
  }, []);

  const playRingtone = useCallback(() => {
    ringtone.start(callId);
  }, [callId]);

  // Start the outgoing ringback tone for the call we initiated. Bound to the
  // active Call ID so switching calls or receiving an incoming call stops the
  // previous tone immediately.
  const playRingback = useCallback(() => {
    if (!callId) return;
    ringback.start(callId);
  }, [callId]);

  const getRTCConfig = useCallback(async () => {
    try {
      const result = await callAPI.getConfig();
      const cfg = result.data || { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };
      const iceCount = Array.isArray(cfg.iceServers) ? cfg.iceServers.length : 0;
      const types = (cfg.iceServers || []).map((s) => (Array.isArray(s.urls) ? s.urls : [s.urls]).join(",")).join("|");
      console.info("[call] config", { iceServers: iceCount, urls: types, callId });
      return cfg;
    } catch (err) {
      console.warn("[call] config fallback STUN", { callId, error: err?.message || String(err) });
      return {
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
      };
    }
  }, [callId]);

  const createPeerConnection = useCallback(async () => {
    const config = await getRTCConfig();
    const pc = new RTCPeerConnection(config);

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        console.debug("[call] ice candidate local", {
          callId,
          type: event.candidate.type || "candidate",
          protocol: event.candidate.protocol,
        });
        sendCallSignal(callId, {
          type: "ice-candidate",
          candidate: event.candidate.toJSON()
        });
      } else {
        console.info("[call] ice gathering complete", { callId });
      }
    };

    pc.oniceconnectionstatechange = () => {
      console.info("[call] iceConnectionState", { callId, state: pc.iceConnectionState });
    };

    pc.ontrack = (event) => {
      const stream = event.streams?.[0] || new MediaStream([event.track]);
      console.info("[call] ontrack", {
        callId,
        kind: event.track?.kind,
        streams: event.streams?.length || 0,
        trackId: event.track?.id,
      });
      setRemoteStream(stream);
      if (remoteAudioRef.current) {
        remoteAudioRef.current.srcObject = stream;
        const playPromise = remoteAudioRef.current.play();
        if (playPromise && typeof playPromise.catch === "function") {
          playPromise.catch((err) => {
            console.warn("[call] remote audio play blocked/failed", { callId, error: err?.message || String(err) });
          });
        }
      }
    };

    pc.onconnectionstatechange = () => {
      console.info("[call] connectionState", { callId, state: pc.connectionState });
      if (pc.connectionState === "connected") {
        setStatus("accepted");
        callStartTimeRef.current = Date.now();
        startDurationTimer();
      } else if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
        console.warn("[call] connection ended by state", { callId, state: pc.connectionState });
        terminateCallRef.current();
      }
    };

    peerConnectionRef.current = pc;
    return pc;
  }, [callId, getRTCConfig, sendCallSignal, startDurationTimer]);

  const getUserMedia = useCallback(async () => {
    try {
      console.info("[call] getUserMedia requesting", { callId });
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        },
        video: false
      });

      setLocalStream(stream);
      localStreamRef.current = stream;
      if (localAudioRef.current) {
        localAudioRef.current.srcObject = stream;
        localAudioRef.current.muted = true;
      }
      const track = stream.getAudioTracks?.()[0];
      const settings = track?.getSettings?.() || {};
      console.info("[call] getUserMedia success", {
        callId,
        tracks: stream.getTracks?.().length || 0,
        deviceId: settings.deviceId ? "[set]" : "[default]",
        label: track?.label ? "[available]" : "[unavailable]",
      });

      return stream;
    } catch (err) {
      console.error("[call] getUserMedia error", { callId, name: err?.name, message: err?.message });
      const msg = err?.name === "NotAllowedError"
        ? "ไม่ได้รับอนุญาตให้ใช้ไมโครโฟน"
        : err?.name === "NotFoundError"
          ? "ไม่พบอุปกรณ์ไมโครโฟน"
          : "ไม่สามารถเข้าถึงไมโครโฟนได้";
      setError(msg);
      throw err;
    }
  }, [callId]);

  // Prepare PC + local media (idempotent). Used by both caller and callee.
  const prepareMediaAndPC = useCallback(async () => {
    if (mediaReadyRef.current) return;
    const stream = await getUserMedia();
    const pc = await createPeerConnection();
    stream.getTracks().forEach(track => pc.addTrack(track, stream));
    mediaReadyRef.current = true;
    stopRingtone();
  }, [createPeerConnection, getUserMedia, stopRingtone]);

  // Create offer (caller). Triggered only after the callee accepts (callAccepted),
  // so the callee is already in the call room and ready to receive it.
  const createOffer = useCallback(async () => {
    if (offerSentRef.current) return;
    await prepareMediaAndPC();
    const pc = peerConnectionRef.current;
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    
    sendCallSignal(callId, {
      type: "offer",
      sdp: pc.localDescription.toJSON()
    });
    
    offerSentRef.current = true;
    isInitiatorRef.current = true;
  }, [callId, prepareMediaAndPC, sendCallSignal]);

  // Create answer (callee). Triggered when the offer arrives.
  const createAnswer = useCallback(async (offerSdp) => {
    if (signalLockRef.current) return;
    signalLockRef.current = true;
    try {
      if (answerSentRef.current) return;
      await prepareMediaAndPC();
      const pc = peerConnectionRef.current;
      
      await pc.setRemoteDescription(new RTCSessionDescription(offerSdp));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      
      sendCallSignal(callId, {
        type: "answer",
        sdp: pc.localDescription.toJSON()
      });
      
      answerSentRef.current = true;
      
      // Add pending ICE candidates queued before remote description was set.
      pendingIceCandidatesRef.current.forEach(candidate => {
        try { pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch {}
      });
      pendingIceCandidatesRef.current = [];
    } finally {
      signalLockRef.current = false;
    }
  }, [callId, prepareMediaAndPC, sendCallSignal]);

  // Handle incoming signaling (offer / answer / ice-candidate).
  const handleSignal = useCallback(async (signal) => {
    const pc = peerConnectionRef.current;
    if (!pc) {
      console.warn("[call] signal before pc", { callId, type: signal?.type });
      return;
    }

    try {
      switch (signal.type) {
        case "offer":
          // Ignore if we are the caller or already answered (duplicate signal
          // delivered over a second socket/namespace).
          if (isInitiatorRef.current || answerSentRef.current) {
            console.info("[call] offer ignored", { callId, initiator: isInitiatorRef.current, answered: answerSentRef.current });
            return;
          }
          console.info("[call] offer received", { callId });
          await createAnswer(signal.sdp);
          break;

        case "answer":
          if (!isInitiatorRef.current || answerAppliedRef.current) {
            console.info("[call] answer ignored", { callId, initiator: isInitiatorRef.current, applied: answerAppliedRef.current });
            return;
          }
          answerAppliedRef.current = true;
          console.info("[call] answer received", { callId });
          await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));

          pendingIceCandidatesRef.current.forEach(candidate => {
            try { pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch (e) {
              console.warn("[call] queued ice add failed", { callId, error: e?.message });
            }
          });
          pendingIceCandidatesRef.current = [];
          break;

        case "ice-candidate":
          console.debug("[call] ice candidate remote", { callId, hasRemoteDesc: !!pc.remoteDescription });
          if (pc.remoteDescription) {
            await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
          } else {
            pendingIceCandidatesRef.current.push(signal.candidate);
          }
          break;
        default:
          console.warn("[call] unknown signal", { callId, type: signal?.type });
      }
    } catch (err) {
      console.error("[call] signal handling error", { callId, type: signal?.type, error: err?.message || String(err) });
    }
  }, [callId, createAnswer]);

  const cleanup = useCallback(() => {
    stopDurationTimer();
    stopRingtone();
    stopRingback();
    
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }
    
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
    }
    
    setLocalStream(null);
    setRemoteStream(null);
    setStatus("ended");
    pendingIceCandidatesRef.current = [];
    mediaReadyRef.current = false;
    offerSentRef.current = false;
    answerSentRef.current = false;
    answerAppliedRef.current = false;
    signalLockRef.current = false;
  }, [stopDurationTimer, stopRingtone, stopRingback]);

  const terminateCall = useCallback(() => {
    cleanup();
    onCallEnded?.(callId, duration);
    onClose?.();
  }, [callId, duration, cleanup, onCallEnded, onClose]);

  createOfferRef.current = createOffer;
  terminateCallRef.current = terminateCall;

  // Socket event handlers (subscribed once; volatile callbacks read via refs).
  useEffect(() => {
    const handleIncomingCall = (callData) => {
      if (initialCallId) return; // Already in a call
      console.info("[call] incomingCall event", { callId: callData?.call_id, from: callData?.caller_id, conversationId: callData?.conversation_id });

      setCallId(callData.call_id);
      setStatus("ringing");
      playRingtone();
    };

    const handleCallSignal = ({ from, signal }) => {
      if (from === user?.id) return;
      console.debug("[call] callSignal event", { callId, from, type: signal?.type });
      handleSignal(signal);
    };

    const onCallEndedSocket = (callData) => {
      console.info("[call] callEnded event", { callId, status: callData?.status, endedBy: callData?.ended_by || callData?.rejected_by });
      stopRingtone();
      stopRingback();
      const terminal = callData && ["ended","missed","rejected","failed"].includes(callData.status);
      if (terminal) {
        // Do NOT tear down on "accepted": that means the callee picked up and
        // the peer connection is still being established.
        terminateCallRef.current();
      }
    };

    const handleCallAccepted = (payload) => {
      console.info("[call] callAccepted event", { callId, acceptedBy: payload?.accepted_by, initiator: isInitiatorRef.current });
      stopRingtone();
      stopRingback();
      setStatus("accepted");
      if (isInitiatorRef.current && !offerSentRef.current) {
        createOfferRef.current();
      }
    };

    const handleCallRejected = (payload) => {
      console.info("[call] callRejected event", { callId, rejectedBy: payload?.rejected_by });
      stopRingtone();
      stopRingback();
      terminateCallRef.current();
    };

    on("incomingCall", handleIncomingCall);
    on("callSignal", handleCallSignal);
    on("callEnded", onCallEndedSocket);
    on("callAccepted", handleCallAccepted);
    on("callRejected", handleCallRejected);

    return () => {
      off("incomingCall", handleIncomingCall);
      off("callSignal", handleCallSignal);
      off("callEnded", onCallEndedSocket);
      off("callAccepted", handleCallAccepted);
      off("callRejected", handleCallRejected);
      stopRingtone();
      stopRingback();
    };
  }, [callId, initialCallId, user?.id, on, off, handleSignal, playRingtone, stopRingtone, stopRingback]);

  // Initialize call
  useEffect(() => {
    let active = true;
    (async () => {
      if (initialCallId && calleeId) {
        // We are the caller (both initialCallId and calleeId provided)
        isInitiatorRef.current = true;
        joinCall(initialCallId);
        // Wait for callAccepted from the callee before sending the offer.
      } else if (initialCallId && !calleeId) {
        // We are the callee (initialCallId from an accepted incoming call)
        isInitiatorRef.current = false;
        joinCall(initialCallId);
        if (active) await prepareMediaAndPC();
      } else if (calleeId && !callId) {
        // We are initiating a new call (no initialCallId, but have calleeId)
        initiateCall();
      }
    })();

    // Cleanup runs on unmount and when the call session target changes, never
    // when callId is set after the backend responds.
    const callIdAtMount = callId;
    return () => {
      active = false;
      if (callIdAtMount) {
        leaveCall(callIdAtMount);
      }
      cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialCallId, calleeId, joinCall, leaveCall, prepareMediaAndPC, cleanup]);

  const initiateCall = async () => {
    try {
      console.info("[call] initiating", { conversationId, hasCallee: !!calleeId, hasStoreOrder: !!storeOrderId });
      const result = await callAPI.initiate({
        calleeId,
        conversationId,
        // Omit the order id when the conversation has none: the API validates it
        // as a UUID only when the key is present, and sending null failed with 400.
        storeOrderId: storeOrderId || undefined,
        callType: "voice"
      }, callMode);

setCallId(result.data.id);
      isInitiatorRef.current = true;
      console.info("[call] initiated", { callId: result.data.id, status: result.data?.status });
      // Start the outgoing ringback tone immediately after the backend
      // confirms the call was created in "ringing" state. It loops until the
      // callee accepts/rejects/ends the call or the line expires.
      playRingback();
      // createOffer is triggered by the callAccepted socket event after
      // the callee picks up.
    } catch (err) {
      console.error("[call] initiate failed", { error: err?.message || String(err), status: err?.status });
      stopRingback();
      setError(err.message || "ไม่สามารถtelefonได้");
      onClose?.();
    }
  };

  const acceptCall = async () => {
    try {
      console.info("[call] accepting", { callId });
      stopRingtone();
      await callAPI.accept(callId, callMode);
      setStatus("accepted");
      console.info("[call] accepted", { callId });
      // Media + peer connection are prepared in the mount effect above.
      // The offer arrives via handleSignal -> createAnswer.
    } catch (err) {
      console.error("[call] accept failed", { callId, error: err?.message || String(err) });
      setError(err.message || "ไม่สามารถรับสายได้");
      terminateCall();
    }
  };

  const rejectCall = async () => {
    try {
      console.info("[call] rejecting", { callId });
      stopRingtone();
      await callAPI.reject(callId, callMode);
      console.info("[call] rejected", { callId });
    } catch (err) {
      console.error("[call] reject failed", { callId, error: err?.message || String(err) });
    } finally {
      terminateCall();
    }
  };

  const endCall = async () => {
    try {
      console.info("[call] ending", { callId });
      stopRingtone();
      await callAPI.end(callId, callMode);
      console.info("[call] end requested", { callId });
    } catch (err) {
      console.error("[call] end failed", { callId, error: err?.message || String(err) });
    } finally {
      terminateCall();
    }
  };

  const toggleMute = async () => {
    const newMuted = !muted;
    setMuted(newMuted);
    
    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach(track => {
        track.enabled = !newMuted;
      });
    }
    
    try {
      await callAPI.toggleMute(callId, newMuted);
    } catch (err) {
      console.error("Toggle mute error:", err);
    }
  };

  const formatDuration = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };
  
  if (status === "connecting") {
    return (
      <div className="voice-call-modal connecting">
        <div className="call-content">
          <div className="call-avatar">
            {callerAvatar ? (
              <img src={callerAvatar} alt={callerName} />
            ) : (
              <span>{callerName?.charAt(0) || "?"}</span>
            )}
          </div>
          <h3>กำลังเชื่อมต่อ...</h3>
          <p>{callerName}</p>
        </div>
      </div>
    );
  }
  
  if (status === "ringing") {
    return (
      <div className="voice-call-modal ringing">
        <div className="call-content">
          <div className="call-avatar">
            {callerAvatar ? (
              <img src={callerAvatar} alt={callerName} />
            ) : (
              <span>{callerName?.charAt(0) || "?"}</span>
            )}
          </div>
          <h3>สายเข้า</h3>
          <p>{callerName}</p>
          
          <div className="call-actions">
            <button className="btn-accept" onClick={acceptCall}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path>
              </svg>
              รับสาย
            </button>
            <button className="btn-reject" onClick={rejectCall}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18.36 6.64a9 9 0 1 1-12.73 0"></path>
                <line x1="12" y1="2" x2="12" y2="22"></line>
              </svg>
              ปฏิเสธ
            </button>
          </div>
        </div>
      </div>
    );
  }
  
  return (
    <div className="voice-call-modal active">
      <audio ref={localAudioRef} autoPlay muted playsInline />
      <audio ref={remoteAudioRef} autoPlay playsInline />
      
      <div className="call-content">
        <div className="call-header">
          <div className="call-avatar large">
            {callerAvatar ? (
              <img src={callerAvatar} alt={callerName} />
            ) : (
              <span>{callerName?.charAt(0) || "?"}</span>
            )}
          </div>
          <div className="call-info">
            <h3>{callerName}</h3>
            <span className={status === "accepted" ? "status-connected" : status}>
              {status === "accepted" ? `เชื่อมต่อแล้ว • ${formatDuration(duration)}` : status}
            </span>
          </div>
        </div>
        
        {error && <div className="call-error">{error}</div>}
        
        <div className="call-controls">
          <button 
            className={`control-btn ${muted ? "active" : ""}`}
            onClick={toggleMute}
            title={muted ? "เปิดไมโครโฟน" : "ปิดไมโครโฟน"}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              {muted ? (
                <>
                  <path d="M1 1l22 22"></path>
                  <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"></path>
                  <path d="M17 16.95a7 7 0 0 1-5 1.31"></path>
                </>
              ) : (
                <>
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
                  <line x1="12" y1="19" x2="12" y2="22"></line>
                  <line x1="8" y1="23" x2="16" y2="23"></line>
                </>
              )}
            </svg>
          </button>
          
          <button 
            className="control-btn end-call"
            onClick={endCall}
            title="วางสาย"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path>
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
