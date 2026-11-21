import { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import { authAPI } from "../api";

const MODE_CUSTOMER = "customer";
const MODE_ADMIN = "admin";

const STORAGE_KEYS = {
  [MODE_CUSTOMER]: {
    token: "kindee:customer:token",
    user: "kindee:customer:user",
    refreshToken: "kindee:customer:refreshToken",
  },
  [MODE_ADMIN]: {
    token: "kindee:admin:token",
    user: "kindee:admin:user",
    refreshToken: "kindee:admin:refreshToken",
  },
};

function keysFor(mode) {
  return STORAGE_KEYS[mode] || STORAGE_KEYS[MODE_CUSTOMER];
}

function readSession(mode) {
  const k = keysFor(mode);
  try {
    const token = localStorage.getItem(k.token);
    const user = localStorage.getItem(k.user);
    const refreshToken = localStorage.getItem(k.refreshToken);
    // A persisted user without a token is not a session. Keeping it would make
    // login pages redirect to a protected page while ProtectedRoute treats the
    // request as unauthenticated, which ping-pongs forever.
    if (!token) {
      return { token: null, user: null, refreshToken: refreshToken || null };
    }
    return {
      token,
      user: user ? JSON.parse(user) : null,
      refreshToken: refreshToken || null,
    };
  } catch {
    return { token: null, user: null, refreshToken: null };
  }
}

function writeSession(token, user, refreshToken, mode) {
  const k = keysFor(mode);
  if (token !== undefined && token !== null) {
    localStorage.setItem(k.token, token);
  }
  if (user !== undefined) {
    localStorage.setItem(k.user, JSON.stringify(user));
  }
  if (refreshToken !== undefined && refreshToken !== null) {
    localStorage.setItem(k.refreshToken, refreshToken);
  }
}

function clearSession(mode) {
  const k = keysFor(mode);
  Object.values(k).forEach((key) => localStorage.removeItem(key));
}

export const AuthContext = createContext(null);

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
  const [customerSession, setCustomerSession] = useState(() => readSession(MODE_CUSTOMER));
  const [adminSession, setAdminSession] = useState(() => readSession(MODE_ADMIN));
  // `initializing` stays true until the persisted sessions have been checked
  // against the server. Routing must not redirect while this is true, otherwise
  // a refresh can redirect to login before a valid session is restored.
  const [initializing, setInitializing] = useState(true);
  const [loading, setLoading] = useState(false);

  const applySession = useCallback((token, user, refreshToken, mode) => {
    writeSession(token, user, refreshToken, mode);
    if (mode === MODE_ADMIN) {
      setAdminSession({ token, user, refreshToken });
    } else {
      setCustomerSession({ token, user, refreshToken });
    }
  }, []);

  // Prevent two concurrent refreshes for the same namespace (401 storms).
  const refreshInFlight = useRef({ customer: null, admin: null });

  const login = useCallback(
    async (emailOrPhone, password, mode = MODE_CUSTOMER) => {
      setLoading(true);
      try {
        const data = unwrapPayload(await authAPI.login(emailOrPhone, password, mode));
        applySession(data.accessToken, data.user, data.refreshToken, mode);
        return data;
      } finally {
        setLoading(false);
      }
    },
    [applySession]
  );

  const register = useCallback(
    async (data, mode = MODE_CUSTOMER) => {
      setLoading(true);
      try {
        const result = unwrapPayload(await authAPI.register(data, mode));
        applySession(result.accessToken, result.user, result.refreshToken, mode);
        return result;
      } finally {
        setLoading(false);
      }
    },
    [applySession]
  );

  const logout = useCallback(
    async (mode = MODE_CUSTOMER) => {
      const session = mode === MODE_ADMIN ? adminSession : customerSession;
      // Start the server-side revocation first so the request still carries the
      // access token from storage, then clear locally without waiting on the
      // network. A stalled logout must not trap the user on a protected page.
      const revocation = session.refreshToken
        ? authAPI.logout(session.refreshToken, mode)
        : null;
      if (revocation) {
        revocation.catch((error) => console.error("Logout error:", error));
      }
      clearSession(mode);
      if (mode === MODE_ADMIN) {
        setAdminSession({ token: null, user: null, refreshToken: null });
      } else {
        setCustomerSession({ token: null, user: null, refreshToken: null });
      }
    },
    [adminSession, customerSession]
  );

  const updateProfile = useCallback(
    async (data, mode = MODE_CUSTOMER) => {
      const session = mode === MODE_ADMIN ? adminSession : customerSession;
      if (!session.token) throw new Error("Not authenticated");

      setLoading(true);
      try {
        const updatedUser = unwrapPayload(await authAPI.updateProfile(data, mode));
        applySession(session.token, updatedUser, session.refreshToken, mode);
        return updatedUser;
      } finally {
        setLoading(false);
      }
    },
    [applySession]
  );

  const changePassword = useCallback(
    async (currentPassword, newPassword, mode = MODE_CUSTOMER) => {
      const session = mode === MODE_ADMIN ? adminSession : customerSession;
      if (!session.token) throw new Error("Not authenticated");

      await authAPI.changePassword(currentPassword, newPassword, mode);
    },
    []
  );

  const loginWithGoogle = useCallback(
    async (credential, mode = MODE_CUSTOMER) => {
      setLoading(true);
      try {
        const data = unwrapPayload(await authAPI.googleLogin(credential, mode));
        applySession(data.accessToken, data.user, data.refreshToken, mode);
        return data;
      } finally {
        setLoading(false);
      }
    },
    [applySession]
  );

  const loginWithFacebook = useCallback(
    async (accessToken, mode = MODE_CUSTOMER) => {
      setLoading(true);
      try {
        const data = unwrapPayload(await authAPI.facebookLogin(accessToken, mode));
        applySession(data.accessToken, data.user, data.refreshToken, mode);
        return data;
      } finally {
        setLoading(false);
      }
    },
    [applySession]
  );

  const loginWithLine = useCallback(
    async (code, redirectUri, mode = MODE_CUSTOMER) => {
      setLoading(true);
      try {
        const data = unwrapPayload(await authAPI.lineLogin(code, redirectUri, mode));
        applySession(data.accessToken, data.user, data.refreshToken, mode);
        return data;
      } finally {
        setLoading(false);
      }
    },
    [applySession]
  );

  const refreshAccessToken = useCallback(
    async (mode = MODE_CUSTOMER) => {
      // Collapse concurrent refreshes for the same namespace: Supabase rotates
      // the refresh token, so two parallel refreshes would race and one would
      // fail with an invalid (already-used) refresh token.
      if (refreshInFlight.current[mode]) {
        return refreshInFlight.current[mode];
      }

      const session = mode === MODE_ADMIN ? adminSession : customerSession;
      if (!session.refreshToken) throw new Error("No refresh token");

      const refreshPromise = (async () => {
        try {
          const data = unwrapPayload(await authAPI.refreshToken(session.refreshToken, mode));
          applySession(data.accessToken, session.user, data.refreshToken, mode);
          return data.accessToken;
        } catch (error) {
          clearSession(mode);
          if (mode === MODE_ADMIN) {
            setAdminSession({ token: null, user: null, refreshToken: null });
          } else {
            setCustomerSession({ token: null, user: null, refreshToken: null });
          }
          throw error;
        }
      })();

      refreshInFlight.current[mode] = refreshPromise;
      try {
        return await refreshPromise;
      } finally {
        refreshInFlight.current[mode] = null;
      }
    },
    [applySession, adminSession, customerSession]
  );

  // Validate a namespace's stored session on load: the access token may have
  // expired while the tab was closed, or the refresh token may have been
  // revoked (logout elsewhere / password change). If the token is rejected we
  // try a single refresh; if that fails we clear the session so the user is
  // sent back to /login instead of holding a dead token.
  const validateSession = useCallback(
    async (mode = MODE_CUSTOMER, sessionSnapshot = null) => {
      const session = sessionSnapshot || (mode === MODE_ADMIN ? adminSession : customerSession);
      if (!session?.token) return;

      const setSession = mode === MODE_ADMIN ? setAdminSession : setCustomerSession;
      // Only clear if the session is still the one we validated: a login that
      // completes while this request is in flight must never be wiped out.
      // Check storage too, since the API helpers read the token from there.
      const clearIfCurrent = () => {
        if (readSession(mode).token !== session.token) return;
        clearSession(mode);
        setSession((prev) => (prev.token === session.token ? { token: null, user: null, refreshToken: null } : prev));
      };

      try {
        await authAPI.getProfile(mode);
        // Token still good — nothing to do.
      } catch (error) {
        if (error?.status !== 401 || !session.refreshToken) {
          clearIfCurrent();
          return;
        }

        // Access token expired/rejected but we have a refresh token: refresh once.
        try {
          await refreshAccessToken(mode);
        } catch {
          // refreshAccessToken already cleared the session on failure.
        }
      }
    },
    [adminSession, customerSession, refreshAccessToken]
  );

  useEffect(() => {
    let cancelled = false;
    const bootstrap = async () => {
      const customerSnapshot = readSession(MODE_CUSTOMER);
      const adminSnapshot = readSession(MODE_ADMIN);
      try {
        await Promise.all([
          validateSession(MODE_CUSTOMER, customerSnapshot),
          validateSession(MODE_ADMIN, adminSnapshot),
        ]);
      } finally {
        if (!cancelled) setInitializing(false);
      }
    };
    bootstrap();
    return () => {
      cancelled = true;
    };
    // Run once on mount to reconcile persisted sessions with the server.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync namespace state across tabs when another tab writes to localStorage.
  // Customer changes only affect customer state; admin changes only affect admin state.
  useEffect(() => {
    const handleStorage = (e) => {
      if (!e.key) return;
      const customerKeys = Object.values(STORAGE_KEYS[MODE_CUSTOMER]);
      const adminKeys = Object.values(STORAGE_KEYS[MODE_ADMIN]);
      if (customerKeys.includes(e.key)) {
        setCustomerSession(readSession(MODE_CUSTOMER));
      }
      if (adminKeys.includes(e.key)) {
        setAdminSession(readSession(MODE_ADMIN));
      }
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  const customer = {
    token: customerSession.token,
    user: customerSession.user,
    isAuthenticated: !!customerSession.token,
  };
  const admin = {
    token: adminSession.token,
    user: adminSession.user,
    isAuthenticated: !!adminSession.token,
  };

  // Single source of truth for "can use the admin namespace": a token AND an
  // admin/owner role. Login pages and ProtectedRoute both read this value, so
  // they can never disagree and bounce a request back and forth.
  const isAdmin = !!adminSession.token && ["admin", "owner"].includes(adminSession.user?.role);
  const isSeller = customerSession.user?.role === "seller";
  const isCourier = customerSession.user?.role === "courier";
  const user = customerSession.user;
  const token = customerSession.token;
  const isAuthenticated = !!customerSession.token;

  const value = {
    loading,
    initializing,
    customer,
    admin,
    user,
    token,
    isAuthenticated,
    isAdmin,
    isSeller,
    isCourier,
    login,
    register,
    logout,
    updateProfile,
    changePassword,
    loginWithGoogle,
    loginWithFacebook,
    loginWithLine,
    refreshAccessToken,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
