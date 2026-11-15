import { useState, useEffect, useRef, useCallback } from "react";
import { useAuth } from "../context/AuthContext";
import { useSocket } from "../context/SocketContext";
import { callAPI } from "../api";
import { formatRelativeTime } from "../utils/helpers";
import "./VoiceCallUI.css";

export default function VoiceCallUI({ 
  initialCallId, 
  onClose, 
  onCallEnded,
  calleeId,
  conversationId,
  storeOrderId,
  callerName,
  callerAvatar
}) {
  const { token, user } = useAuth();
  const { sendCallSignal, joinCall, leaveCall, on, off, connected } = useSocket();
  
  const [callId, setCallId] = useState(initialCallId);
  const [status, setStatus] = useState("connecting");
  const [duration, setDuration] = useState(0);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState("");
  const [remoteStream, setRemoteStream] = useState(null);
  const [localStream, setLocalStream] = useState(null);
  const [peerConnection, setPeerConnection] = useState(null);
  const [iceCandidates, setIceCandidates] = useState([]);
  
  const localAudioRef = useRef(null);
  const remoteAudioRef = useRef(null);
  const durationIntervalRef = useRef(null);
  const callStartTimeRef = useRef(null);
  const isInitiatorRef = useRef(false);

  // WebRTC Configuration
  const getRTCConfig = useCallback(async () => {
    try {
      const result = await callAPI.getConfig();
      return result.data;
    } catch {
      return {
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
      };
    }
  }, []);

  // Initialize peer connection
  const createPeerConnection = useCallback(async () => {
    const config = await getRTCConfig();
    const pc = new RTCPeerConnection(config);
    
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        sendCallSignal(callId, {
          type: "ice-candidate",
          candidate: event.candidate.toJSON()
        });
      }
    };
    
    pc.ontrack = (event) => {
      setRemoteStream(event.streams[0]);
      if (remoteAudioRef.current) {
        remoteAudioRef.current.srcObject = event.streams[0];
      }
    };
    
    pc.onconnectionstatechange = () => {
      console.log("Connection state:", pc.connectionState);
      if (pc.connectionState === "connected") {
        setStatus("accepted");
        callStartTimeRef.current = Date.now();
        startDurationTimer();
      } else if (pc.connectionState === "disconnected" || pc.connectionState === "failed") {
        handleCallEnded();
      }
    };
    
    setPeerConnection(pc);
    return pc;
  }, [callId, getRTCConfig, sendCallSignal]);

  // Get user media
  const getUserMedia = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        },
        video: false
      });
      
      setLocalStream(stream);
      if (localAudioRef.current) {
        localAudioRef.current.srcObject = stream;
        localAudioRef.current.muted = true; // Don't hear yourself
      }
      
      return stream;
    } catch (err) {
      console.error("getUserMedia error:", err);
      setError("ไม่สามารถเข้าถึงไมโครโฟนได้");
      throw err;
    }
  }, []);

  // Create offer (caller)
  const createOffer = useCallback(async () => {
    const pc = await createPeerConnection();
    const stream = await getUserMedia();
    
    stream.getTracks().forEach(track => pc.addTrack(track, stream));
    
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    
    sendCallSignal(callId, {
      type: "offer",
      sdp: pc.localDescription.toJSON()
    });
    
    isInitiatorRef.current = true;
  }, [callId, createPeerConnection, getUserMedia, sendCallSignal]);

  // Create answer (callee)
  const createAnswer = useCallback(async (offer) => {
    const pc = await createPeerConnection();
    const stream = await getUserMedia();
    
    stream.getTracks().forEach(track => pc.addTrack(track, stream));
    
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    
    sendCallSignal(callId, {
      type: "answer",
      sdp: pc.localDescription.toJSON()
    });
    
    // Add pending ICE candidates
    iceCandidates.forEach(candidate => {
      pc.addIceCandidate(new RTCIceCandidate(candidate));
    });
    setIceCandidates([]);
  }, [callId, createPeerConnection, getUserMedia, sendCallSignal, iceCandidates]);

  // Handle incoming signal
  const handleSignal = useCallback(async (signal) => {
    const pc = peerConnection;
    if (!pc) return;
    
    try {
      switch (signal.type) {
        case "offer":
          if (!isInitiatorRef.current) {
            await createAnswer(signal.sdp);
          }
          break;
          
        case "answer":
          if (isInitiatorRef.current) {
            await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
            
            // Add pending ICE candidates
            iceCandidates.forEach(candidate => {
              pc.addIceCandidate(new RTCIceCandidate(candidate));
            });
            setIceCandidates([]);
          }
          break;
          
        case "ice-candidate":
          if (pc.remoteDescription) {
            await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
          } else {
            setIceCandidates(prev => [...prev, signal.candidate]);
          }
          break;
      }
    } catch (err) {
      console.error("Signal handling error:", err);
    }
  }, [peerConnection, iceCandidates, createAnswer]);

  // Socket event handlers
  useEffect(() => {
    const handleIncomingCall = (callData) => {
      if (initialCallId) return; // Already have a call
      
      setCallId(callData.call_id);
      setStatus("ringing");
      // Play ringtone
      playRingtone();
    };
    
    const handleCallSignal = ({ from, signal }) => {
      if (from === user?.id) return; // Ignore own signals
      handleSignal(signal);
    };
    
    const handleCallEnded = (callData) => {
      stopRingtone();
      handleCallEnded();
    };
    
    on("incomingCall", handleIncomingCall);
    on("callSignal", handleCallSignal);
    on("callEnded", handleCallEnded);
    
    return () => {
      off("incomingCall", handleIncomingCall);
      off("callSignal", handleCallSignal);
      off("callEnded", handleCallEnded);
      stopRingtone();
    };
  }, [initialCallId, user?.id, on, off, handleSignal]);

  // Initialize call
  useEffect(() => {
    if (initialCallId) {
      // We are the caller
      isInitiatorRef.current = true;
      createOffer();
      joinCall(initialCallId);
    } else if (calleeId && !callId) {
      // We are initiating a new call
      initiateCall();
    }
    
    return () => {
      if (callId) {
        leaveCall(callId);
      }
      cleanup();
    };
  }, [initialCallId, calleeId]);

  const initiateCall = async () => {
    try {
      const result = await callAPI.initiate({
        calleeId,
        conversationId,
        storeOrderId,
        callType: "voice"
      });
      
      setCallId(result.data.id);
      isInitiatorRef.current = true;
      await createOffer();
      joinCall(result.data.id);
    } catch (err) {
      setError(err.message || "ไม่สามารถโทรได้");
      onClose?.();
    }
  };

  const acceptCall = async () => {
    try {
      stopRingtone();
      await callAPI.accept(callId);
      setStatus("accepted");
      
      // Wait for offer from caller
    } catch (err) {
      setError(err.message || "ไม่สามารถรับสายได้");
      handleCallEnded();
    }
  };

  const rejectCall = async () => {
    try {
      stopRingtone();
      await callAPI.reject(callId);
    } catch (err) {
      console.error("Reject call error:", err);
    } finally {
      handleCallEnded();
    }
  };

  const endCall = async () => {
    try {
      stopRingtone();
      await callAPI.end(callId);
    } catch (err) {
      console.error("End call error:", err);
    } finally {
      handleCallEnded();
    }
  };

  const handleCallEnded = () => {
    cleanup();
    onCallEnded?.(callId, duration);
    onClose?.();
  };

  const cleanup = () => {
    stopDurationTimer();
    stopRingtone();
    
    if (peerConnection) {
      peerConnection.close();
      setPeerConnection(null);
    }
    
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
      setLocalStream(null);
    }
    
    setRemoteStream(null);
    setStatus("ended");
  };

  const toggleMute = async () => {
    const newMuted = !muted;
    setMuted(newMuted);
    
    if (localStream) {
      localStream.getAudioTracks().forEach(track => {
        track.enabled = !newMuted;
      });
    }
    
    try {
      await callAPI.toggleMute(callId, newMuted);
    } catch (err) {
      console.error("Toggle mute error:", err);
    }
  };

  const startDurationTimer = () => {
    callStartTimeRef.current = Date.now();
    durationIntervalRef.current = setInterval(() => {
      setDuration(Math.floor((Date.now() - callStartTimeRef.current) / 1000));
    }, 1000);
  };

  const stopDurationTimer = () => {
    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current);
      durationIntervalRef.current = null;
    }
  };

  const playRingtone = () => {
    // Create a simple ringtone using Web Audio API
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(440, audioContext.currentTime);
    oscillator.frequency.setValueAtTime(880, audioContext.currentTime + 0.5);
    
    gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
    
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    oscillator.start();
    oscillator.stop(audioContext.currentTime + 2);
    
    // Repeat
    ringtoneIntervalRef.current = setInterval(() => {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      
      osc.type = "sine";
      osc.frequency.setValueAtTime(440, ctx.currentTime);
      osc.frequency.setValueAtTime(880, ctx.currentTime + 0.5);
      
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      
      osc.connect(gain);
      gain.connect(ctx.destination);
      
      osc.start();
      osc.stop(ctx.currentTime + 2);
    }, 3000);
  };

  const ringtoneIntervalRef = useRef(null);

  const stopRingtone = () => {
    if (ringtoneIntervalRef.current) {
      clearInterval(ringtoneIntervalRef.current);
      ringtoneIntervalRef.current = null;
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
      <audio ref={localAudioRef} autoPlay />
      <audio ref={remoteAudioRef} autoPlay />
      
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