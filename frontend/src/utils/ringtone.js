// Singleton incoming-call ringtone manager.
// Plays /sounds/incoming-call.mp3 in a loop until stopped.
// Handles browser autoplay policies by retrying on user gesture.
// Idempotent per callId: starting the same callId twice is a no-op,
// and starting a different callId stops the previous one first.

let audio = null;
let activeCallId = null;

const SOUND_PATH = "/sounds/incoming-call.mp3";

function getAudio() {
  if (!audio) {
    audio = new Audio(SOUND_PATH);
    audio.loop = true;
    audio.volume = 0.8;
    audio.addEventListener("error", () => {
      console.warn("[ringtone] audio element error", { callId: activeCallId });
    });
  }
  return audio;
}

function cleanupListeners() {
  // no-op placeholder for future listener management
}

export const ringtone = {
  // Start ringing for a call. Idempotent per callId.
  start(callId) {
    if (typeof window === "undefined") return;
    if (activeCallId === callId) return;
    // Stop previous ringtone if switching to a new call
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
              cleanupListeners();
            };
            window.addEventListener("click", retry, { once: true });
            window.addEventListener("keydown", retry, { once: true });
            window.addEventListener("touchstart", retry, { once: true });
          } else {
            console.warn("[ringtone] play failed", { callId, error: err?.message || String(err) });
          }
        });
      }
    };

    attemptPlay();
  },

  // Stop the ringtone immediately.
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
// for the ringtone (and any other Audio elements on the page).
if (typeof window !== "undefined") {
  const events = ["click", "keydown", "touchstart"];
  const handler = () => {
    ringtone.unlock();
    events.forEach((e) => window.removeEventListener(e, handler));
  };
  events.forEach((e) => window.addEventListener(e, handler, { passive: true }));
}