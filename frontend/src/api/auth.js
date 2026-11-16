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

export async function request(path, options = {}, mode = "customer") {
  const rawToken = getToken(mode);
  const token = rawToken ? rawToken.trim() : null;
  let response;

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

  try {
    response = await fetch(`${API_BASE}${path}`, {
      method: options.method,
      headers,
      body: options.body,
      credentials: "omit",
    });
  } catch {
    throw new Error("ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้");
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

  getSocialConfig: () => request("/settings/public/social-config"),
};
