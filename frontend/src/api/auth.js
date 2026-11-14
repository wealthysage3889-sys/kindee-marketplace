const API_BASE = import.meta.env.VITE_API_BASE || "/api";

export function getToken(mode = "customer") {
  return localStorage.getItem(mode === "admin" ? "adminToken" : "customerToken");
}

export async function request(path, options = {}, mode = "customer") {
  const token = getToken(mode);
  let response;

  const isFormData = options.body instanceof FormData;
  const headers = {
    ...(isFormData ? {} : { "Content-Type": "application/json" }),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers,
  };

  try {
    response = await fetch(`${API_BASE}${path}`, {
      headers,
      ...options,
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
  login: (email, password) =>
    request("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),

  register: ({ name, email, password, phone, address, role }) =>
    request("/auth/register", {
      method: "POST",
      body: JSON.stringify({ name, email, password, phone, address, role }),
    }),

  googleLogin: (credential) =>
    request("/auth/google", {
      method: "POST",
      body: JSON.stringify({ credential }),
    }),

  facebookLogin: (accessToken) =>
    request("/auth/facebook", {
      method: "POST",
      body: JSON.stringify({ accessToken }),
    }),

  lineLogin: (code, redirectUri) =>
    request("/auth/line", {
      method: "POST",
      body: JSON.stringify({ code, redirectUri }),
    }),

  getSocialConfig: () => request("/settings/public/social-config"),
};
