const RAW_API_BASE = import.meta.env.VITE_API_BASE || "/api";
const API_BASE = RAW_API_BASE.endsWith("/api")
  ? RAW_API_BASE
  : `${RAW_API_BASE.replace(/\/$/, "")}/api`;

export function getToken() {
  return (
    localStorage.getItem("token") ||
    localStorage.getItem("customerToken") ||
    localStorage.getItem("adminToken")
  );
}

export function setToken(token) {
  localStorage.setItem("token", token);
  localStorage.setItem("customerToken", token);
}

export function removeToken() {
  ["token", "customerToken", "adminToken"].forEach((key) => localStorage.removeItem(key));
}

export async function request(path, options = {}) {
  const token = getToken();
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
    const response = await fetch(`${API_BASE}${path}`, {
      method: options.method,
      headers,
      body: options.body,
      credentials: "omit",
    });

    const data = await response.json().catch(() => ({}));
    
    if (!response.ok) {
      const err = new Error(data.message || "Request failed");
      err.data = data;
      err.status = response.status;
      throw err;
    }
    
    return data;
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error("Cannot connect to server");
    }
    throw error;
  }
}

export const apiRequest = request;

// Auth API
export const authAPI = {
  login: (emailOrPhone, password) =>
    request("/auth/login", {
      method: "POST",
      body: JSON.stringify({ emailOrPhone, password }),
    }),

  register: (data) =>
    request("/auth/register", {
      method: "POST",
      body: JSON.stringify(data),
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

  getProfile: () =>
    request("/auth/profile"),

  updateProfile: (data) =>
    request("/auth/profile", {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  changePassword: (currentPassword, newPassword) =>
    request("/auth/password", {
      method: "PUT",
      body: JSON.stringify({ currentPassword, newPassword }),
    }),

  refreshToken: (refreshToken) =>
    request("/auth/refresh", {
      method: "POST",
      body: JSON.stringify({ refreshToken }),
    }),

  logout: (refreshToken) =>
    request("/auth/logout", {
      method: "POST",
      body: JSON.stringify({ refreshToken }),
    }),

  deactivateAccount: () =>
    request("/auth/account", {
      method: "DELETE",
    }),
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

  getById: (id) =>
    request(`/orders/${id}`),

  cancel: (id, reason) =>
    request(`/orders/${id}/cancel`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    }),

  getHistory: (id) =>
    request(`/orders/${id}/history`),

  getStoreOrders: (storeId, params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/orders/store/${storeId}?${query}`);
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
};

// Chat API
export const chatAPI = {
  getOrCreateConversation: (storeId, storeOrderId) =>
    request("/chat/conversations", {
      method: "POST",
      body: JSON.stringify({ storeId, storeOrderId }),
    }),

  getConversations: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/chat/conversations?${query}`);
  },

  getConversation: (id) =>
    request(`/chat/conversations/${id}`),

  getMessages: (conversationId, params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/chat/conversations/${conversationId}/messages?${query}`);
  },

  sendMessage: (conversationId, data) =>
    request(`/chat/conversations/${conversationId}/messages`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  markAsRead: (conversationId, lastReadMessageId) =>
    request(`/chat/conversations/${conversationId}/read`, {
      method: "POST",
      body: JSON.stringify({ lastReadMessageId }),
    }),

  getUnreadCount: () =>
    request("/chat/unread-count"),

  editMessage: (messageId, content) =>
    request(`/chat/messages/${messageId}`, {
      method: "PUT",
      body: JSON.stringify({ content }),
    }),

  deleteMessage: (messageId) =>
    request(`/chat/messages/${messageId}`, {
      method: "DELETE",
    }),

  createGroup: (data) =>
    request("/chat/conversations/group", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  addMember: (conversationId, memberId, role) =>
    request(`/chat/conversations/${conversationId}/members`, {
      method: "POST",
      body: JSON.stringify({ memberId, role }),
    }),

  removeMember: (conversationId, memberId) =>
    request(`/chat/conversations/${conversationId}/members/${memberId}`, {
      method: "DELETE",
    }),

  muteConversation: (conversationId, muted) =>
    request(`/chat/conversations/${conversationId}/mute`, {
      method: "PATCH",
      body: JSON.stringify({ muted }),
    }),

  uploadAttachment: (messageId, files) => {
    const formData = new FormData();
    files.forEach(file => formData.append("attachments", file));
    return request(`/chat/messages/${messageId}/attachments`, {
      method: "POST",
      body: formData,
    });
  },

  getStoreConversations: (storeId, params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/chat/store/${storeId}/conversations?${query}`);
  },
};

// Calls API
export const callAPI = {
  getConfig: () =>
    request("/calls/config"),

  initiate: (data) =>
    request("/calls", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  accept: (callId) =>
    request(`/calls/${callId}/accept`, {
      method: "POST",
    }),

  reject: (callId) =>
    request(`/calls/${callId}/reject`, {
      method: "POST",
    }),

  end: (callId) =>
    request(`/calls/${callId}/end`, {
      method: "POST",
    }),

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

  uploadChatAttachment: (conversationId, files) => {
    const formData = new FormData();
    files.forEach(file => formData.append("attachments", file));
    return request(`/upload/chat/${conversationId}`, {
      method: "POST",
      body: formData,
    });
  },

  getSignedUrl: (bucket, path, expiresIn) =>
    request("/upload/signed-url", {
      method: "POST",
      body: JSON.stringify({ bucket, path, expiresIn }),
    }),

  deleteFile: (bucket, path) =>
    request(`/upload/${bucket}/${path}`, {
      method: "DELETE",
    }),
};

// Admin API
export const adminAPI = {
  getStats: () =>
    request("/admin/stats"),

  getOrders: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/admin/orders?${query}`);
  },

  updateOrderStatus: (id, status, notes) =>
    request(`/admin/orders/${id}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status, notes }),
    }),

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
};

export default {
  auth: authAPI,
  store: storeAPI,
  product: productAPI,
  order: orderAPI,
  chat: chatAPI,
  call: callAPI,
  delivery: deliveryAPI,
  notification: notificationAPI,
  user: userAPI,
  category: categoryAPI,
  settings: settingsAPI,
  upload: uploadAPI,
  admin: adminAPI,
};