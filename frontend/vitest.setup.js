// Vitest global setup.
//
// The API layer (src/api/index.js) reads tokens from the browser
// `localStorage`, which does not exist in the Node test environment.
// Provide a minimal in-memory implementation so `getToken`/`setToken`/
// `removeToken` behave exactly like the browser.
import { beforeEach, vi } from "vitest";

function createLocalStorageMock() {
  const store = new Map();
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
    clear: () => store.clear(),
    key: (index) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
  };
}

if (!globalThis.localStorage) {
  globalThis.localStorage = createLocalStorageMock();
}

beforeEach(() => {
  globalThis.localStorage.clear();
  // Default: no fetch mock until a test installs one.
  vi.stubGlobal("fetch", vi.fn());
});