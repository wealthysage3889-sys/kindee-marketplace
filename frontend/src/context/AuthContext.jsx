import { createContext, useContext, useState, useEffect } from "react";
import { authAPI } from "../api";

const STORAGE_KEYS = {
  token: "token",
  user: "user",
  refreshToken: "refreshToken",
  customerToken: "customerToken",
  adminToken: "adminToken"
};

function readSession() {
  try {
    const token =
      localStorage.getItem(STORAGE_KEYS.token) ||
      localStorage.getItem(STORAGE_KEYS.customerToken) ||
      localStorage.getItem(STORAGE_KEYS.adminToken);
    const user = localStorage.getItem(STORAGE_KEYS.user);
    const refreshToken = localStorage.getItem(STORAGE_KEYS.refreshToken);
    return {
      token: token || null,
      user: user ? JSON.parse(user) : null,
      refreshToken: refreshToken || null
    };
  } catch {
    return { token: null, user: null, refreshToken: null };
  }
}

function writeSession(token, user, refreshToken) {
  localStorage.setItem(STORAGE_KEYS.token, token);
  localStorage.setItem(STORAGE_KEYS.user, JSON.stringify(user));
  // Legacy API modules (api/auth.js) read these keys.
  localStorage.setItem(STORAGE_KEYS.customerToken, token);
  if (["admin", "owner"].includes(user?.role)) {
    localStorage.setItem(STORAGE_KEYS.adminToken, token);
  } else {
    localStorage.removeItem(STORAGE_KEYS.adminToken);
  }
  if (refreshToken) {
    localStorage.setItem(STORAGE_KEYS.refreshToken, refreshToken);
  }
}

function clearSession() {
  Object.values(STORAGE_KEYS).forEach((key) => localStorage.removeItem(key));
}

export const AuthContext = createContext(null);

// Backend responses are wrapped as { success, data }; auth pages expect the payload.
function unwrapPayload(payload) {
  if (payload && typeof payload === "object" && !Array.isArray(payload) && "data" in payload) {
    return payload.data;
  }
  return payload;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return ctx;
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(() => readSession());
  const [loading, setLoading] = useState(false);

  const applySession = (token, user, refreshToken) => {
    writeSession(token, user, refreshToken);
    setSession({ token, user, refreshToken });
  };

  const login = async (emailOrPhone, password) => {
    setLoading(true);
    try {
      const data = unwrapPayload(await authAPI.login(emailOrPhone, password));
      applySession(data.accessToken, data.user, data.refreshToken);
      return data;
    } finally {
      setLoading(false);
    }
  };

  const register = async (data) => {
    setLoading(true);
    try {
      const result = unwrapPayload(await authAPI.register(data));
      applySession(result.accessToken, result.user, result.refreshToken);
      return result;
    } finally {
      setLoading(false);
    }
  };

  const logout = async () => {
    try {
      if (session.refreshToken) {
        await authAPI.logout(session.refreshToken);
      }
    } catch (error) {
      console.error("Logout error:", error);
    } finally {
      clearSession();
      setSession({ token: null, user: null, refreshToken: null });
    }
  };

  const updateProfile = async (data) => {
    if (!session.token) throw new Error("Not authenticated");
    
    setLoading(true);
    try {
      const updatedUser = unwrapPayload(await authAPI.updateProfile(data));
      applySession(session.token, updatedUser, session.refreshToken);
      return updatedUser;
    } finally {
      setLoading(false);
    }
  };

  const changePassword = async (currentPassword, newPassword) => {
    if (!session.token) throw new Error("Not authenticated");
    
    await authAPI.changePassword(currentPassword, newPassword);
  };

  const loginWithGoogle = async (credential) => {
    setLoading(true);
    try {
      const data = unwrapPayload(await authAPI.googleLogin(credential));
      applySession(data.accessToken, data.user, data.refreshToken);
      return data;
    } finally {
      setLoading(false);
    }
  };

  const loginWithFacebook = async (accessToken) => {
    setLoading(true);
    try {
      const data = unwrapPayload(await authAPI.facebookLogin(accessToken));
      applySession(data.accessToken, data.user, data.refreshToken);
      return data;
    } finally {
      setLoading(false);
    }
  };

  const loginWithLine = async (code, redirectUri) => {
    setLoading(true);
    try {
      const data = unwrapPayload(await authAPI.lineLogin(code, redirectUri));
      applySession(data.accessToken, data.user, data.refreshToken);
      return data;
    } finally {
      setLoading(false);
    }
  };

  const refreshAccessToken = async () => {
    if (!session.refreshToken) throw new Error("No refresh token");
    
    try {
      const data = unwrapPayload(await authAPI.refreshToken(session.refreshToken));
      applySession(data.accessToken, session.user, data.refreshToken);
      return data.accessToken;
    } catch (error) {
      // Refresh failed, logout
      clearSession();
      setSession({ token: null, user: null, refreshToken: null });
      throw error;
    }
  };

  // Check if token is expired and refresh if needed
  useEffect(() => {
    if (!session.token) return;
    
    const checkTokenExpiry = async () => {
      try {
        // Try to get profile to validate token
        await authAPI.getProfile();
      } catch (error) {
        if (error.status === 401 && session.refreshToken) {
          await refreshAccessToken();
        }
      }
    };
    
    checkTokenExpiry();
  }, [session.token]);

  const isAdmin = ['admin', 'owner'].includes(session.user?.role);
  const isCourier = session.user?.role === 'courier';
  // Legacy aliases used by the pre-existing customer/admin pages.
  const sessionRef = { user: session.user };
  const value = {
    loading,
    user: session.user,
    token: session.token,
    isAuthenticated: !!session.token,
    isSeller: session.user?.role === 'seller',
    isAdmin,
    isCourier,
    customer: sessionRef,
    admin: sessionRef,
    login,
    register,
    logout,
    updateProfile,
    changePassword,
    loginWithGoogle,
    loginWithFacebook,
    loginWithLine,
    refreshAccessToken
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}