const RAW_API_BASE = import.meta.env.VITE_API_BASE || "/api";
const API_BASE = RAW_API_BASE.endsWith("/api")
  ? RAW_API_BASE
  : `${RAW_API_BASE.replace(/\/$/, "")}/api`;

const STORAGE_KEYS = {
  customer: {
    token: "kindee:customer:token",
    user: "kindee:customer:user",
    refreshToken: "kindee:customer:refreshToken",
  },
  admin: {
    token: "kindee:admin:token",
    user: "kindee:admin:user",
    refreshToken: "kindee:admin:refreshToken",
  },
};

function keysFor(mode) {
  return STORAGE_KEYS[mode] || STORAGE_KEYS.customer;
}

export function getToken(mode = "customer") {
  return localStorage.getItem(keysFor(mode).token);
}

export function setToken(token, mode = "customer") {
  localStorage.setItem(keysFor(mode).token, token);
}

export function removeToken(mode = "customer") {
  localStorage.removeItem(keysFor(mode).token);
}

// Refresh access token for the given mode
async function refreshAccessToken(mode) {
  const refreshToken = localStorage.getItem(keysFor(mode).refreshToken);
  if (!refreshToken) throw new Error("No refresh token");
  
  const response = await fetch(`${API_BASE}/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken }),
  });
  
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = new Error(data.message || "Token refresh failed");
    err.data = data;
    err.status = response.status;
    throw err;
  }
  
  if (data.data?.accessToken) {
    setToken(data.data.accessToken, mode);
    if (data.data.refreshToken) {
      localStorage.setItem(keysFor(mode).refreshToken, data.data.refreshToken);
    }
    return data.data.accessToken;
  }
  throw new Error("No access token in refresh response");
}

export async function request(path, options = {}, mode = "customer") {
  let token = getToken(mode);
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

  let retried = false;
  
  async function doRequest(currentToken, skipCache = false) {
    const requestHeaders = new Headers(headers);
    if (currentToken) {
      requestHeaders.set("Authorization", `Bearer ${currentToken}`);
    }
    if (skipCache) {
      requestHeaders.set("Cache-Control", "no-cache");
      requestHeaders.set("Pragma", "no-cache");
    }
    
    const response = await fetch(`${API_BASE}${path}`, {
      method: options.method,
      headers: requestHeaders,
      body: options.body,
      credentials: "omit",
    });

    // Handle 304 Not Modified: browser should serve cached response,
    // but if no cache exists, re-fetch without cache validation.
    if (response.status === 304 && !skipCache) {
      return doRequest(currentToken, true);
    }

    const data = await response.json().catch(() => ({}));
    
    if (!response.ok) {
      const err = new Error(data.message || "Request failed");
      err.data = data;
      err.status = response.status;
      throw err;
    }
    
    return data;
  }

  try {
    return await doRequest(token);
  } catch (error) {
    // On 401, try to refresh token and retry once
    if (error.status === 401 && !retried && token) {
      retried = true;
      try {
        const newToken = await refreshAccessToken(mode);
        return await doRequest(newToken);
      } catch (refreshError) {
        // Refresh failed, clear tokens and rethrow original error
        localStorage.removeItem(keysFor(mode).token);
        localStorage.removeItem(keysFor(mode).refreshToken);
        throw error;
      }
    }
    if (error instanceof TypeError) {
      throw new Error("Cannot connect to server");
    }
    throw error;
  }
}

export const apiRequest = request;

// Auth API
export const authAPI = {
  login: (emailOrPhone, password, mode = "customer") =>
    request("/auth/login", {
      method: "POST",
      body: JSON.stringify({ emailOrPhone, password }),
    }, mode),

  register: (data, mode = "customer") =>
    request("/auth/register", {
      method: "POST",
      body: JSON.stringify(data),
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

  getProfile: (mode = "customer") =>
    request("/auth/profile", undefined, mode),

  updateProfile: (data, mode = "customer") =>
    request("/auth/profile", {
      method: "PUT",
      body: JSON.stringify(data),
    }, mode),

  changePassword: (currentPassword, newPassword, mode = "customer") =>
    request("/auth/password", {
      method: "PUT",
      body: JSON.stringify({ currentPassword, newPassword }),
    }, mode),

  refreshToken: (refreshToken, mode = "customer") =>
    request("/auth/refresh", {
      method: "POST",
      body: JSON.stringify({ refreshToken }),
    }, mode),

  logout: (options = {}, mode = "customer") => {
    const { refreshToken, revokeAllSessions, scope } = options;
    return request("/auth/logout", {
      method: "POST",
      body: JSON.stringify({ refreshToken, revokeAllSessions, scope }),
    }, mode);
  },

  // Sessions (Migration 025)
  getSessions: (mode = "customer") =>
    request("/auth/sessions", undefined, mode),

  revokeSession: (sessionId, mode = "customer") =>
    request("/auth/sessions/revoke", {
      method: "POST",
      body: JSON.stringify({ session_id: sessionId }),
    }, mode),

  revokeAllSessions: (mode = "customer") =>
    request("/auth/sessions/revoke", {
      method: "POST",
      body: JSON.stringify({ all: true }),
    }, mode),

  // Login History (Migration 026)
  getLoginHistory: (mode = "customer") =>
    request("/auth/login-history", undefined, mode),

  // Security Alerts (Migration 027)
  getSecurityAlerts: (mode = "customer") =>
    request("/auth/security-alerts", undefined, mode),

  markAlertRead: (alertId, mode = "customer") =>
    request(`/auth/security-alerts/${alertId}/read`, {
      method: "PATCH",
    }, mode),

  // Social unlink (Migration 006 columns)
  unlinkSocial: (provider, mode = "customer") =>
    request("/auth/social/unlink", {
      method: "POST",
      body: JSON.stringify({ provider }),
    }, mode),

  deactivateAccount: (mode = "customer") =>
    request("/auth/account", {
      method: "DELETE",
    }, mode),
};

// Stores API
export const storeAPI = {
  getAll: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/stores?${query}`);
  },

  getBySlug: (slug) =>
    request(`/stores/slug/${slug}`),

  getById: (id) =>
    request(`/stores/${id}`),

  getMyStores: () =>
    request("/stores/my/stores"),

  create: (data) =>
    request("/stores", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  update: (id, data) =>
    request(`/stores/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  uploadLogo: (id, file) => {
    const formData = new FormData();
    formData.append("logo", file);
    return request(`/stores/${id}/logo`, {
      method: "POST",
      body: formData,
    });
  },

  uploadCover: (id, file) => {
    const formData = new FormData();
    formData.append("cover", file);
    return request(`/stores/${id}/cover`, {
      method: "POST",
      body: formData,
    });
  },

  delete: (id) =>
    request(`/stores/${id}`, {
      method: "DELETE",
    }),
};

// Products API
export const productAPI = {
  getAll: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/products?${query}`);
  },

  search: (q, params = {}) => {
    const query = new URLSearchParams({ q, ...params }).toString();
    return request(`/products/search?${query}`);
  },

  getByCategory: (categoryId, params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/products/category/${categoryId}?${query}`);
  },

  getById: (id) =>
    request(`/products/${id}`),

  getByStore: (storeId, params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/products/store/${storeId}?${query}`);
  },

  create: (data) =>
    request("/products", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  update: (id, data) =>
    request(`/products/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  uploadImages: (id, files) => {
    const formData = new FormData();
    files.forEach(file => formData.append("images", file));
    return request(`/products/${id}/images`, {
      method: "POST",
      body: formData,
    });
  },

  updateStock: (id, quantity, operation = "set") =>
    request(`/products/${id}/stock`, {
      method: "PATCH",
      body: JSON.stringify({ quantity, operation }),
    }),

  bulkUpdate: (storeId, updates) =>
    request("/products/bulk-update", {
      method: "POST",
      body: JSON.stringify({ storeId, updates }),
    }),

  delete: (id) =>
    request(`/products/${id}`, {
      method: "DELETE",
    }),
};

// Orders API
export const orderAPI = {
  create: (data) =>
    request("/orders", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  getMyOrders: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/orders?${query}`);
  },

  getById: (id, mode = "customer") =>
    request(`/orders/${id}`, {}, mode),

  getRoute: (id, mode = "customer") =>
    request(`/orders/${id}/route`, {}, mode),

  cancel: (id, reason) =>
    request(`/orders/${id}/cancel`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    }),

  getHistory: (id) =>
    request(`/orders/${id}/history`),

  getStoreOrderHistory: (storeOrderId) =>
    request(`/orders/store-orders/${storeOrderId}/history`),

  getStoreOrders: (storeId, params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/orders/store/${storeId}?${query}`);
  },

  getAllOrders: (params = {}, mode = "admin") => {
    const query = new URLSearchParams(params).toString();
    return request(`/orders/admin/all?${query}`, {}, mode);
  },

  updateStoreOrderStatus: (storeOrderId, status, notes) =>
    request(`/orders/store-orders/${storeOrderId}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status, notes }),
    }),

  createRefund: (orderId, data) =>
    request(`/orders/${orderId}/refund`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  uploadPaymentSlip: (orderId, file, amountThb, note) => {
    const formData = new FormData();
    formData.append("slip", file);
    if (amountThb != null) formData.append("amountThb", String(amountThb));
    if (note != null) formData.append("note", note);
    return request(`/orders/${orderId}/payment-slip`, {
      method: "POST",
      body: formData,
    });
  },

  // Submit ONE slip for one or more KBZPay orders of the same store.
  submitStorePaymentSlips: (storeId, orderIds, file, note) => {
    const formData = new FormData();
    formData.append("slip", file);
    formData.append("storeId", String(storeId));
    formData.append("orderIds", JSON.stringify(Array.isArray(orderIds) ? orderIds : []));
    if (note != null) formData.append("note", note);
    return request("/orders/submit-slip", {
      method: "POST",
      body: formData,
    });
  },

  // Store owner: list payment slips for their own store.
  getStorePaymentSlips: (storeId, params = {}, mode = "customer") => {
    const query = new URLSearchParams(params).toString();
    return request(`/orders/store/${storeId}/payment-slips${query ? `?${query}` : ""}`, {}, mode);
  },

  // Store owner: approve/reject a slip (manual payment confirmation).
  approveStorePaymentSlip: (slipId, mode = "customer") =>
    request(`/orders/store/payment-slips/${slipId}/approve`, { method: "PATCH" }, mode),

  rejectStorePaymentSlip: (slipId, reason, mode = "customer") =>
    request(`/orders/store/payment-slips/${slipId}/reject`, {
      method: "PATCH",
      body: JSON.stringify({ reason }),
    }, mode),
};

// Address Book API
export const addressAPI = {
  getAddresses: () =>
    request("/addresses"),

  create: (data) =>
    request("/addresses", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  update: (id, data) =>
    request(`/addresses/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  remove: (id) =>
    request(`/addresses/${id}`, {
      method: "DELETE",
    }),

  setDefault: (id) =>
    request(`/addresses/${id}/default`, {
      method: "POST",
    }),
};

// Wallet API
export const walletAPI = {
  getSummary: () =>
    request("/wallet/summary"),

  getTransactions: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/wallet/transactions?${query}`);
  },

  getHistory: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/wallet/history?${query}`);
  },

  getVouchers: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/wallet/vouchers?${query}`);
  },

  getCards: () =>
    request("/wallet/cards"),

  addCard: (data) =>
    request("/wallet/cards", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  updateCard: (id, data) =>
    request(`/wallet/cards/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  deleteCard: (id) =>
    request(`/wallet/cards/${id}`, {
      method: "DELETE",
    }),

  getBankAccounts: () =>
    request("/wallet/bank-accounts"),

  addBankAccount: (data) =>
    request("/wallet/bank-accounts", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  updateBankAccount: (id, data) =>
    request(`/wallet/bank-accounts/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  deleteBankAccount: (id) =>
    request(`/wallet/bank-accounts/${id}`, {
      method: "DELETE",
    }),

  verifyBankAccount: (id) =>
    request(`/wallet/bank-accounts/${id}/verify`, {
      method: "POST",
    }),

  getSettings: () =>
    request("/wallet/settings"),

  // Mee Card Wallet Registration (Customer)
  createMeeCardRegistration: (data) =>
    request("/wallet/mee-card-registration", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  getMyMeeCardRegistration: () =>
    request("/wallet/mee-card-registration"),

  // Mee Card Wallet Registration (Admin)
  getPendingMeeCardRegistrations: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/wallet/admin/mee-card-registrations?${query}`, {}, "admin");
  },

  getMeeCardRegistrationCounts: () =>
    request("/wallet/admin/mee-card-registrations/counts", {}, "admin"),

  reviewMeeCardRegistration: (id, action, rejectionReason = null) =>
    request(`/wallet/admin/mee-card-registrations/${id}/review`, {
      method: "PATCH",
      body: JSON.stringify({ action, rejection_reason: rejectionReason }),
    }, "admin"),
};

// Chat API
export const chatAPI = {
  getOrCreateConversation: (storeId, storeOrderId, mode = "customer") =>
    request("/chat/conversations", {
      method: "POST",
      body: JSON.stringify({ storeId, storeOrderId }),
    }, mode),

  getConversations: (params = {}, mode = "customer") => {
    const query = new URLSearchParams(params).toString();
    return request(`/chat/conversations?${query}`, {}, mode);
  },

  getConversation: (id, mode = "customer") =>
    request(`/chat/conversations/${id}`, {}, mode),

  getMessages: (conversationId, params = {}, mode = "customer") => {
    const query = new URLSearchParams(params).toString();
    return request(`/chat/conversations/${conversationId}/messages?${query}`, {}, mode);
  },

  sendMessage: (conversationId, data, mode = "customer") =>
    request(`/chat/conversations/${conversationId}/messages`, {
      method: "POST",
      body: JSON.stringify(data),
    }, mode),

  markAsRead: (conversationId, lastReadMessageId, mode = "customer") =>
    request(`/chat/conversations/${conversationId}/read`, {
      method: "POST",
      body: JSON.stringify({ lastReadMessageId }),
    }, mode),

  getUnreadCount: (mode = "customer") =>
    request("/chat/unread-count", {}, mode),

  editMessage: (messageId, content, mode = "customer") =>
    request(`/chat/messages/${messageId}`, {
      method: "PUT",
      body: JSON.stringify({ content }),
    }, mode),

  deleteMessage: (messageId, mode = "customer") =>
    request(`/chat/messages/${messageId}`, {
      method: "DELETE",
    }, mode),

  createGroup: (data, mode = "customer") =>
    request("/chat/conversations/group", {
      method: "POST",
      body: JSON.stringify(data),
    }, mode),

  addMember: (conversationId, memberId, role, mode = "customer") =>
    request(`/chat/conversations/${conversationId}/members`, {
      method: "POST",
      body: JSON.stringify({ memberId, role }),
    }, mode),

  removeMember: (conversationId, memberId, mode = "customer") =>
    request(`/chat/conversations/${conversationId}/members/${memberId}`, {
      method: "DELETE",
    }, mode),

  muteConversation: (conversationId, muted, mode = "customer") =>
    request(`/chat/conversations/${conversationId}/mute`, {
      method: "PATCH",
      body: JSON.stringify({ muted }),
    }, mode),

  // Update conversation alias (rename chat)
  updateAlias: (conversationId, alias, mode = "customer") =>
    request(`/chat/conversations/${conversationId}/alias`, {
      method: "PATCH",
      body: JSON.stringify({ alias }),
    }, mode),

  // Update conversation hidden state (hide/show chat)
  updateHidden: (conversationId, isHidden, mode = "customer") =>
    request(`/chat/conversations/${conversationId}/hidden`, {
      method: "PATCH",
      body: JSON.stringify({ isHidden }),
    }, mode),

  // Mark conversation as spam (store owner)
  markSpam: (conversationId, mode = "customer") =>
    request(`/chat/conversations/${conversationId}/spam`, {
      method: "POST",
    }, mode),

  // Restore conversation from spam (store owner)
  restoreFromSpam: (conversationId, mode = "customer") =>
    request(`/chat/conversations/${conversationId}/restore`, {
      method: "POST",
    }, mode),

  // Get spam conversations (store owner)
  getSpamConversations: (storeId, params = {}, mode = "customer") => {
    const query = new URLSearchParams(params).toString();
    return request(`/chat/store/${storeId}/spam?${query}`, {}, mode);
  },

  // Get conversation route (map/navigation)
  getRoute: (conversationId, mode = "customer") =>
    request(`/chat/conversations/${conversationId}/route`, {}, mode),

  // Get the customer's approximate IP-based location (never used as a
  // delivery destination; separate from shared GPS locations)
  getIpLocation: (conversationId, mode = "customer") =>
    request(`/chat/conversations/${conversationId}/ip-location`, {}, mode),

  uploadAttachment: (messageId, files, mode = "customer") => {
    const formData = new FormData();
    files.forEach(file => formData.append("attachments", file));
    return request(`/chat/messages/${messageId}/attachments`, {
      method: "POST",
      body: formData,
    }, mode).then((res) => {
      const list = Array.isArray(res?.data) ? res.data : [];
      return { ...res, data: list.map(normalizeAttachment) };
    });
  },

  getStoreConversations: (storeId, params = {}, mode = "customer") => {
    const query = new URLSearchParams(params).toString();
    return request(`/chat/store/${storeId}/conversations?${query}`, {}, mode);
  },
};

// Calls API
export const callAPI = {
  getConfig: () =>
    request("/calls/config"),

  initiate: (data, mode = "customer") => {
    // `mode` must match the chat session (customer vs admin), otherwise the
    // call is authenticated with the wrong namespace's token (401).
    const { mode: _ignored, ...payload } = data || {};
    return request("/calls", {
      method: "POST",
      body: JSON.stringify(payload),
    }, mode);
  },

  accept: (callId, mode = "customer") =>
    request(`/calls/${callId}/accept`, {
      method: "POST",
    }, mode),

  cancel: (callId, mode = "customer") =>
    request(`/calls/${callId}/cancel`, {
      method: "POST",
    }, mode),

  reject: (callId, mode = "customer") =>
    request(`/calls/${callId}/reject`, {
      method: "POST",
    }, mode),

  end: (callId, mode = "customer") =>
    request(`/calls/${callId}/end`, {
      method: "POST",
    }, mode),

  getHistory: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/calls/history?${query}`);
  },

  getActive: () =>
    request("/calls/active"),

  getById: (id) =>
    request(`/calls/${id}`),

  signal: (callId, signalData) =>
    request(`/calls/${callId}/signal`, {
      method: "POST",
      body: JSON.stringify(signalData),
    }),

  getSignaling: (callId) =>
    request(`/calls/${callId}/signaling`),

  toggleMute: (callId, muted) =>
    request(`/calls/${callId}/mute`, {
      method: "POST",
      body: JSON.stringify({ muted }),
    }),
};

// Deliveries API
export const deliveryAPI = {
  create: (storeOrderId) =>
    request(`/deliveries/store-orders/${storeOrderId}`, {
      method: "POST",
    }),

  getById: (id) =>
    request(`/deliveries/${id}`),

  getMyDeliveries: (status) => {
    const query = status ? `?status=${status}` : "";
    return request(`/deliveries/courier/me${query}`);
  },

  getStoreDeliveries: (storeId, params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/deliveries/store/${storeId}?${query}`);
  },

  acceptAssignment: (assignmentId) =>
    request(`/deliveries/assignments/${assignmentId}/accept`, {
      method: "POST",
    }),

  rejectAssignment: (assignmentId) =>
    request(`/deliveries/assignments/${assignmentId}/reject`, {
      method: "POST",
    }),

  pickup: (deliveryId) =>
    request(`/deliveries/${deliveryId}/pickup`, {
      method: "POST",
    }),

  deliver: (deliveryId, proofImage) =>
    request(`/deliveries/${deliveryId}/deliver`, {
      method: "POST",
      body: JSON.stringify({ proofImage }),
    }),

  updateLocation: (deliveryId, coordinates, metadata = {}) =>
    request(`/deliveries/${deliveryId}/location`, {
      method: "POST",
      body: JSON.stringify({ coordinates, ...metadata }),
    }),

  getRoute: (deliveryId) =>
    request(`/deliveries/${deliveryId}/route`),

  endShift: () =>
    request("/deliveries/courier/end-shift", {
      method: "POST",
    }),
};

// Notifications API
export const notificationAPI = {
  getAll: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/notifications?${query}`);
  },

  getUnreadCount: () =>
    request("/notifications/unread-count"),

  markAsRead: (id) =>
    request(`/notifications/${id}/read`, {
      method: "PATCH",
    }),

  markAllAsRead: () =>
    request("/notifications/read-all", {
      method: "POST",
    }),

  delete: (id) =>
    request(`/notifications/${id}`, {
      method: "DELETE",
    }),
};

// Users API
export const userAPI = {
  getProfile: (id) =>
    request(`/users/${id}/profile`),

  getMyStores: () =>
    request("/users/me/stores"),

  getAll: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/users?${query}`);
  },

  updateRole: (id, role) =>
    request(`/users/${id}/role`, {
      method: "PATCH",
      body: JSON.stringify({ role }),
    }),

  updateStatus: (id, isActive) =>
    request(`/users/${id}/status`, {
      method: "PATCH",
      body: JSON.stringify({ isActive }),
    }),
};

// Categories API
export const categoryAPI = {
  getAll: (parentId) => {
    const query = parentId ? `?parentId=${parentId}` : "";
    return request(`/categories${query}`);
  },

  getById: (id) =>
    request(`/categories/${id}`),

  create: (data) =>
    request("/categories", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  update: (id, data) =>
    request(`/categories/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  delete: (id) =>
    request(`/categories/${id}`, {
      method: "DELETE",
    }),
};

// Settings API
export const settingsAPI = {
  getPublic: () =>
    request("/settings"),

  getByKey: (key) =>
    request(`/settings/${key}`),
};

// The upload endpoint answers with { url, path, fileName, fileSize, mimeType },
// while POST /chat/conversations/:id/messages expects the message_attachments
// column names (file_url, file_name, file_size, mime_type). Normalising here
// keeps both sides (customer + seller/admin) able to attach files in one call.
export function normalizeAttachment(file = {}) {
  const fileUrl = file.file_url || file.fileUrl || file.url;
  const fileName = file.file_name || file.fileName || file.name;
  const fileSize = file.file_size ?? file.fileSize ?? file.size ?? 0;
  const mimeType = file.mime_type || file.mimeType || file.type || "application/octet-stream";

  return {
    ...file,
    file_url: fileUrl,
    file_name: fileName,
    file_size: fileSize,
    mime_type: mimeType,
  };
}

// Upload API
export const uploadAPI = {
  uploadAvatar: (file) => {
    const formData = new FormData();
    formData.append("avatar", file);
    return request("/upload/avatar", {
      method: "POST",
      body: formData,
    });
  },

  uploadChatAttachment: (conversationId, files, mode = "customer") => {
    const formData = new FormData();
    files.forEach(file => formData.append("attachments", file));
    return request(`/upload/chat/${conversationId}`, {
      method: "POST",
      body: formData,
    }, mode).then((res) => {
      const list = Array.isArray(res?.data) ? res.data : [];
      return { ...res, data: list.map(normalizeAttachment) };
    });
  },

  getSignedUrl: (bucket, path, expiresIn, mode = "customer") =>
    request(`/upload/signed-url?bucket=${encodeURIComponent(bucket)}&path=${encodeURIComponent(path)}&expiresIn=${encodeURIComponent(expiresIn ?? 3600)}`, {}, mode),

  deleteFile: (bucket, path) =>
    request(`/upload/${bucket}/${path}`, {
      method: "DELETE",
    }),
};

// Admin API
export const adminAPI = {
  getStats: () =>
    request("/admin/stats"),

  getOrders: (params = {}, mode = "admin") => {
    const query = new URLSearchParams(params).toString();
    return request(`/admin/orders?${query}`, {}, mode);
  },

  updateOrderStatus: (id, status, notes, mode = "admin") =>
    request(`/admin/orders/${id}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status, notes }),
    }, mode),

  getStores: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/admin/stores?${query}`);
  },

  verifyStore: (id, verified) =>
    request(`/admin/stores/${id}/verify`, {
      method: "PATCH",
      body: JSON.stringify({ verified }),
    }),

  getProducts: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/admin/products?${query}`);
  },

  getUsers: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/admin/users?${query}`);
  },

  sendNotification: (data) =>
    request("/admin/notifications", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  getSettings: () =>
    request("/admin/settings"),

  updateSetting: (key, data) =>
    request(`/admin/settings/${key}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  // Payment slips (admin)
  getPaymentSlips: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/admin/payment-slips?${query}`);
  },

  approvePaymentSlip: (slipId) =>
    request(`/admin/payment-slips/${slipId}/approve`, {
      method: "PATCH",
    }),

  rejectPaymentSlip: (slipId, reason) =>
    request(`/admin/payment-slips/${slipId}/reject`, {
      method: "PATCH",
      body: JSON.stringify({ reason }),
    }),
};

export default {
  auth: authAPI,
  store: storeAPI,
  product: productAPI,
  order: orderAPI,
  address: addressAPI,
  chat: chatAPI,
  call: callAPI,
  delivery: deliveryAPI,
  notification: notificationAPI,
  user: userAPI,
  category: categoryAPI,
  settings: settingsAPI,
  upload: uploadAPI,
  admin: adminAPI,
  wallet: walletAPI,
};