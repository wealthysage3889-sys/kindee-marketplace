import { createContext, useContext, useState } from "react";

const RAW_API_BASE = import.meta.env.VITE_API_BASE || "/api";
const API_BASE = RAW_API_BASE.endsWith("/api")
  ? RAW_API_BASE
  : `${RAW_API_BASE.replace(/\/$/, "")}/api`;

export const AUTH_MODES = {
  customer: "customer",
  admin: "admin",
};

const STORAGE_KEYS = {
  customer: { token: "customerToken", user: "customerUser" },
  admin: { token: "adminToken", user: "adminUser" },
};

function readSession(mode) {
  const keys = STORAGE_KEYS[mode];
  try {
    const raw = localStorage.getItem(keys.user);
    return {
      token: localStorage.getItem(keys.token) || null,
      user: raw ? JSON.parse(raw) : null,
    };
  } catch {
    return { token: null, user: null };
  }
}

function writeSession(mode, token, user) {
  const keys = STORAGE_KEYS[mode];
  localStorage.setItem(keys.token, token);
  localStorage.setItem(keys.user, JSON.stringify(user));
}

function clearSession(mode) {
  const keys = STORAGE_KEYS[mode];
  localStorage.removeItem(keys.token);
  localStorage.removeItem(keys.user);
}

let legacyMigrated = false;

function migrateLegacySession() {
  if (legacyMigrated) return;
  legacyMigrated = true;
  try {
    const legacyToken = localStorage.getItem("token");
    const legacyUser = localStorage.getItem("user");
    if (!legacyToken && !legacyUser) return;
    const hasCustomer =
      localStorage.getItem("customerToken") || localStorage.getItem("customerUser");
    if (!hasCustomer && legacyToken) {
      localStorage.setItem("customerToken", legacyToken);
      if (legacyUser) localStorage.setItem("customerUser", legacyUser);
    }
    localStorage.removeItem("token");
    localStorage.removeItem("user");
  } catch {
    // ignore storage access errors
  }
}

export const AuthContext = createContext(null);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return ctx;
}

export function AuthProvider({ children }) {
  const [customer, setCustomer] = useState(() => {
    migrateLegacySession();
    return readSession("customer");
  });
  const [admin, setAdmin] = useState(() => readSession("admin"));
  const [loading, setLoading] = useState(false);

  const applySession = (mode, token, user) => {
    writeSession(mode, token, user);
    const setter = mode === "admin" ? setAdmin : setCustomer;
    setter({ token, user });
  };

  const login = async (email, password, mode = "customer") => {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) {
      const error = new Error(data.message || "เข้าสู่ระบบไม่สำเร็จ");
      error.data = data;
      error.status = res.status;
      throw error;
    }
    applySession(mode, data.token, data.user);
    return data;
  };

  const register = async ({ name, email, password, phone, address, role }) => {
    const res = await fetch(`${API_BASE}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, password, phone, address, role }),
    });
    const data = await res.json();
    if (!res.ok) {
      const error = new Error(data.message || "สมัครสมาชิกไม่สำเร็จ");
      error.data = data;
      error.status = res.status;
      throw error;
    }
    applySession("customer", data.token, data.user);
    return data;
  };

  const logout = (mode = "customer") => {
    clearSession(mode);
    const setter = mode === "admin" ? setAdmin : setCustomer;
    setter({ token: null, user: null });
  };

  const updateProfile = async (data, mode = "customer") => {
    const session = mode === "admin" ? admin : customer;
    const res = await fetch(`${API_BASE}/auth/profile`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        ...(session.token ? { Authorization: `Bearer ${session.token}` } : {}),
      },
      body: JSON.stringify(data),
    });
    const result = await res.json();
    if (!res.ok) {
      const error = new Error(result.message || "อัปเดตข้อมูลไม่สำเร็จ");
      error.data = result;
      error.status = res.status;
      throw error;
    }
    const updatedUser = { ...session.user, ...(result.data || {}) };
    applySession(mode, session.token, updatedUser);
    return updatedUser;
  };

  const loginWithGoogle = async (credential, mode = "customer") => {
    const res = await fetch(`${API_BASE}/auth/google`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ credential }),
    });
    const data = await res.json();
    if (!res.ok) {
      const error = new Error(data.message || "เข้าสู่ระบบด้วย Google ไม่สำเร็จ");
      error.data = data;
      error.status = res.status;
      throw error;
    }
    applySession(mode, data.token, data.user);
    return data;
  };

  const loginWithFacebook = async (accessToken, mode = "customer") => {
    const res = await fetch(`${API_BASE}/auth/facebook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessToken }),
    });
    const data = await res.json();
    if (!res.ok) {
      const error = new Error(data.message || "เข้าสู่ระบบด้วย Facebook ไม่สำเร็จ");
      error.data = data;
      error.status = res.status;
      throw error;
    }
    applySession(mode, data.token, data.user);
    return data;
  };

  const loginWithLine = async (code, redirectUri, mode = "customer") => {
    const res = await fetch(`${API_BASE}/auth/line`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, redirectUri }),
    });
    const data = await res.json();
    if (!res.ok) {
      const error = new Error(data.message || "เข้าสู่ระบบด้วย LINE ไม่สำเร็จ");
      error.data = data;
      error.status = res.status;
      throw error;
    }
    applySession(mode, data.token, data.user);
    return data;
  };

  const value = {
    loading,
    customer,
    admin,
    login,
    register,
    logout,
    updateProfile,
    loginWithGoogle,
    loginWithFacebook,
    loginWithLine,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}