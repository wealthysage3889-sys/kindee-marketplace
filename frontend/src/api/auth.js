const RAW_API_BASE = import.meta.env.VITE_API_BASE || "/api";
const API_BASE = RAW_API_BASE.endsWith("/api")
  ? RAW_API_BASE
  : `${RAW_API_BASE.replace(/\/$/, "")}/api`;

const STORAGE_KEYS = {
  customer: {
    token: "kindee:customer:token",
    refreshToken: "kindee:customer:refreshToken",
  },
  admin: {
    token: "kindee:admin:token",
    refreshToken: "kindee:admin:refreshToken",
  },
};

function keysFor(mode) {
  return STORAGE_KEYS[mode] || STORAGE_KEYS.customer;
}

export function getToken(mode = "customer") {
  return localStorage.getItem(keysFor(mode).token);
}

// Shared cache + single-flight for public social config
let socialConfigCache = null; // { data, ts, failed? }
let socialConfigInFlight = null;
const SOCIAL_CONFIG_TTL_MS = 5 * 60 * 1000;
const SOCIAL_CONFIG_FAILED_TTL_MS = 30 * 1000;

export async function request(path, options = {}, mode = "customer") {
  const rawToken = getToken(mode);
  const token = rawToken ? rawToken.trim() : null;

  const isFormData = options.body instanceof FormData;
  const headers = new Headers();
  if (!isFormData) {
    headers.set("Content-Type", "application/json");
  }
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  if (options.headers) {
    const extra = new Headers(options.headers);
    extra.forEach((value, key) => headers.set(key, value));
  }

  let retried304 = false;

  async function doRequest(currentToken, skipCache = false) {
    const requestHeaders = new Headers(headers);
    if (currentToken) {
      requestHeaders.set("Authorization", `Bearer ${currentToken}`);
    }
    if (skipCache) {
      requestHeaders.set("Cache-Control", "no-store");
      requestHeaders.set("Pragma", "no-cache");
    }

    let response;
    try {
      response = await fetch(`${API_BASE}${path}`, {
        method: options.method,
        headers: requestHeaders,
        body: options.body,
        credentials: "omit",
        cache: skipCache ? "no-store" : undefined,
      });
    } catch {
      throw new Error("ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้");
    }

    // Handle 304 Not Modified: retry exactly once without cache validation.
    if (response.status === 304 && !skipCache && !retried304) {
      retried304 = true;
      return doRequest(currentToken, true);
    }

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const err = new Error(data.message || "ดึงข้อมูลจากเซิร์ฟเวอร์ไม่สำเร็จ");
      err.data = data;
      err.status = response.status;
      throw err;
    }
    return data;
  }

  return await doRequest(token);
}

export const apiRequest = request;

export const authAPI = {
  login: (email, password, mode = "customer") =>
    request("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }, mode),

  register: ({ name, email, password, phone, address, role }, mode = "customer") =>
    request("/auth/register", {
      method: "POST",
      body: JSON.stringify({ name, email, password, phone, address, role }),
    }, mode),

  googleLogin: (credential, mode = "customer") =>
    request("/auth/google", {
      method: "POST",
      body: JSON.stringify({ credential }),
    }, mode),

  facebookLogin: (accessToken, mode = "customer") =>
    request("/auth/facebook", {
      method: "POST",
      body: JSON.stringify({ accessToken }),
    }, mode),

  lineLogin: (code, redirectUri, mode = "customer") =>
    request("/auth/line", {
      method: "POST",
      body: JSON.stringify({ code, redirectUri }),
    }, mode),

  getSocialConfig: async () => {
    const now = Date.now();
    if (socialConfigCache) {
      const ttl = socialConfigCache.failed ? SOCIAL_CONFIG_FAILED_TTL_MS : SOCIAL_CONFIG_TTL_MS;
      if (now - socialConfigCache.ts < ttl) {
        return socialConfigCache.data;
      }
    }
    if (socialConfigInFlight) {
      return socialConfigInFlight;
    }
    socialConfigInFlight = request("/settings/public/social-config")
      .then((res) => {
        socialConfigCache = { data: res, ts: Date.now() };
        socialConfigInFlight = null;
        return res;
      })
      .catch((err) => {
        socialConfigCache = { data: null, ts: Date.now(), failed: true };
        socialConfigInFlight = null;
        throw err;
      });
    return socialConfigInFlight;
  },
};
