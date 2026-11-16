// LINE Login state (CSRF/replay protection).
//
// LINE Login uses the Authorization Code flow. A cryptographically random
// `state` value is generated per attempt and stored in sessionStorage before
// redirecting to LINE. On the callback, the returned `state` must match the
// stored one, otherwise the flow is aborted (CSRF / mix-up / replay defense).
//
// `state` is stored per-flow ("login" | "register") so the two entry points do
// not interfere, and is consumed (removed) once validated.

const KEY_PREFIX = "kindee:line:state:";

const STORAGE = () => window.sessionStorage;

export const LINE_STATE_KEY = {
  login: `${KEY_PREFIX}login`,
  register: `${KEY_PREFIX}register`,
};

// Cryptographically random state value.
export function generateLineState() {
  const bytes = new Uint8Array(24);
  window.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// Generate + persist a fresh state for the given flow, and return it so it can
// be sent to LINE in the authorize URL.
export function createLineState(flow = "login") {
  const state = generateLineState();
  STORAGE().setItem(LINE_STATE_KEY[flow] || LINE_STATE_KEY.login, state);
  return state;
}

// Consume (read + remove) the stored state for a flow.
export function consumeLineState(flow = "login") {
  const key = LINE_STATE_KEY[flow] || LINE_STATE_KEY.login;
  const stored = STORAGE().getItem(key);
  STORAGE().removeItem(key);
  return stored;
}

// Validate a callback `state` against the stored one for the flow. Returns true
// only when both are present and equal. Always consumes the stored state.
export function validateLineState(flow, callbackState) {
  if (!callbackState) return false;
  const stored = consumeLineState(flow);
  return Boolean(stored) && stored === callbackState;
}