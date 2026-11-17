// Outgoing ringback tone manager.
// Plays /sounds/outgoing-ringback.mp3 in a loop while the caller waits for the
// callee to pick up. Bound to a specific Call ID so that switching calls or
// receiving an incoming call stops the previous tone immediately.
//
// Unlike the incoming ringtone (which is started by IncomingCallHandler for the
// callee), this is started by VoiceCallUI on the caller side only.

let audio = null;
let activeCallId = null;
let unlockRetryTimer = null;

const SOUND_PATH = "/sounds/outgoing-ringback.mp3";

function getAudio() {
  if (!audio) {
    audio = new Audio(SOUND_PATH);
    audio.loop = true;
    audio.volume = 0.8;
    audio.addEventListener("error", () => {
      console.warn("[ringback] audio element error", { callId: activeCallId });
    });
  }
  return audio;
}

export const ringback = {
  // Start the ringback tone for a call. Idempotent per callId.
  start(callId) {
    if (typeof window === "undefined") return;
    if (activeCallId === callId) return;
    // Stop previous ringback if switching to a new call
    if (activeCallId) {
      this.stop();
    }
    activeCallId = callId;
    const a = getAudio();
    a.currentTime = 0;

    const attemptPlay = () => {
      if (activeCallId !== callId) return;
      const p = a.play();
      if (p && typeof p.catch === "function") {
        p.catch((err) => {
          if (activeCallId !== callId) return;
          if (err.name === "NotAllowedError" || err.name === "AbortError") {
            // Browser blocked autoplay; retry on next user gesture
            const retry = () => {
              if (activeCallId !== callId) return;
              attemptPlay();
            };
            window.addEventListener("click", retry, { once: true });
            window.addEventListener("keydown", retry, { once: true });
            window.addEventListener("touchstart", retry, { once: true });
          } else {
            console.warn("[ringback] play failed", { callId, error: err?.message || String(err) });
          }
        });
      }
    };

    attemptPlay();
  },

  // Stop the ringback tone immediately and reset playback.
  stop() {
    activeCallId = null;
    const a = getAudio();
    a.pause();
    a.currentTime = 0;
  },

  isActive() {
    return !!activeCallId;
  },

  getActiveCallId() {
    return activeCallId;
  },

  // Pre-unlock audio by playing at volume 0 (must be called in a user gesture).
  unlock() {
    if (typeof window === "undefined") return Promise.resolve();
    const a = getAudio();
    const prevVolume = a.volume;
    a.volume = 0;
    return a.play().then(() => {
      a.pause();
      a.currentTime = 0;
      a.volume = prevVolume;
    }).catch(() => {
      a.volume = prevVolume;
    });
  }
};

// Auto-attach unlock listeners so the first user gesture unlocks audio
// for the ringback (and any other Audio elements on the page).
if (typeof window !== "undefined") {
  const events = ["click", "keydown", "touchstart"];
  const handler = () => {
    ringback.unlock();
    events.forEach((e) => window.removeEventListener(e, handler));
  };
  events.forEach((e) => window.addEventListener(e, handler, { passive: true }));
}