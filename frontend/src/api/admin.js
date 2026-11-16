import { request } from "./auth";

const adminRequest = (path, options) => request(path, options, "admin");

export const adminAPI = {
  // Dashboard
  getDashboardStats: () => adminRequest("/admin/stats"),

  // Image upload for products
  uploadProductImages: (formData) =>
    adminRequest("/admin/products/upload-images", {
      method: "POST",
      body: formData,
    }),

  // Users
  getUsers: (params = {}) => {
    const clean = Object.fromEntries(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== "")
    );
    const query = new URLSearchParams(clean).toString();
    return adminRequest(`/admin/users${query ? `?${query}` : ""}`);
  },
  getUserById: (id) => adminRequest(`/admin/users/${id}`),
  createUser: (data) =>
    adminRequest("/admin/users", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateUserRole: (id, role) =>
    adminRequest(`/admin/users/${id}/role`, {
      method: "PATCH",
      body: JSON.stringify({ role }),
    }),
  deleteUser: (id) =>
    adminRequest(`/admin/users/${id}`, {
      method: "DELETE",
    }),

  // Products
  getProducts: (params = {}) => {
    const clean = Object.fromEntries(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== "")
    );
    const query = new URLSearchParams(clean).toString();
    return adminRequest(`/admin/products${query ? `?${query}` : ""}`);
  },
  getProductById: (id) => adminRequest(`/admin/products/${id}`),
  createProduct: (data) =>
    adminRequest("/admin/products", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateProduct: (id, data) =>
    adminRequest(`/admin/products/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  deleteProduct: (id) =>
    adminRequest(`/admin/products/${id}`, {
      method: "DELETE",
    }),

  // Reports
  getReports: (params = {}) => {
    const clean = Object.fromEntries(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== "")
    );
    const query = new URLSearchParams(clean).toString();
    return adminRequest(`/admin/reports${query ? `?${query}` : ""}`);
  },

  // Public social config (no auth)
  getSocialConfigPublic: () => request("/settings/public/social-config"),

  // Settings
  getSettings: (category = null) => {
    const query = category ? `?category=${category}` : "";
    return adminRequest(`/settings${query}`);
  },
  getSetting: (key) => adminRequest(`/settings/${key}`),
  updateSetting: (key, value, description = "", category = "general", isPublic = false) =>
    adminRequest(`/settings/${key}`, {
      method: "PUT",
      body: JSON.stringify({ value, description, category, isPublic }),
    }),
  bulkUpdateSettings: (settings) =>
    adminRequest("/settings/bulk", {
      method: "POST",
      body: JSON.stringify({ settings }),
    }),
};