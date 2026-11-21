import { request } from "./auth";

export const productAPI = {
  getProducts: (params = {}, mode = "customer") => {
    const clean = Object.fromEntries(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== "")
    );
    const query = new URLSearchParams(clean).toString();
    return request(`/products${query ? `?${query}` : ""}`, {}, mode);
  },

  getProductById: (id, mode = "customer") => request(`/products/${id}`, {}, mode),

  createProduct: (data, mode = "customer") =>
    request("/products", {
      method: "POST",
      body: data instanceof FormData ? data : JSON.stringify(data),
    }, mode),

  updateProduct: (id, data, mode = "customer") =>
    request(`/products/${id}`, {
      method: "PUT",
      body: data instanceof FormData ? data : JSON.stringify(data),
    }, mode),

  deleteProduct: (id, mode = "customer") =>
    request(`/products/${id}`, {
      method: "DELETE",
    }, mode),

  getSellerProducts: (mode = "customer") => request("/products/seller/mine", {}, mode),
};

export const storeAPI = {
  getStoreById: (id, mode = "customer") => request(`/stores/${id}`, {}, mode),

  getStoresByOwner: (_ownerId, mode = "customer") => request(`/stores/owner/me`, {}, mode),

  getStoreByOwner: (_ownerId, mode = "customer") => request(`/stores/owner/me`, {}, mode),

  createStore: (data, mode = "customer") =>
    request("/stores", {
      method: "POST",
      body: data instanceof FormData ? data : JSON.stringify(data),
    }, mode),

  getStores: (params = {}, mode = "customer") => {
    const clean = Object.fromEntries(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== "")
    );
    const query = new URLSearchParams(clean).toString();
    return request(`/stores${query ? `?${query}` : ""}`, {}, mode);
  },

  getStoreProducts: (id, params = {}, mode = "customer") => {
    const clean = Object.fromEntries(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== "")
    );
    const query = new URLSearchParams(clean).toString();
    return request(`/stores/${id}/products${query ? `?${query}` : ""}`, {}, mode);
  },

  updateStore: (id, data, mode = "customer") =>
    request(`/stores/${id}`, {
      method: "PUT",
      body: data instanceof FormData ? data : JSON.stringify(data),
    }, mode),

  uploadStoreLogo: (id, file, mode = "customer") => {
    const formData = new FormData();
    formData.append("logo", file);
    return request(`/stores/${id}/logo`, { method: "POST", body: formData }, mode);
  },

  uploadStoreCover: (id, file, mode = "customer") => {
    const formData = new FormData();
    formData.append("cover", file);
    return request(`/stores/${id}/cover`, { method: "POST", body: formData }, mode);
  },

  // KBZPay payment settings (per store)
  getKbzpaySettings: (storeId, mode = "customer") =>
    request(`/stores/${storeId}/kbzpay-settings`, undefined, mode),

  updateKbzpaySettings: (storeId, data, mode = "customer") =>
    request(`/stores/${storeId}/kbzpay-settings`, {
      method: "PUT",
      body: JSON.stringify(data),
    }, mode),

  uploadKbzpayQr: (storeId, file, mode = "customer") => {
    const formData = new FormData();
    formData.append("qr", file);
    return request(`/stores/${storeId}/kbzpay-qr`, {
      method: "POST",
      body: formData,
    }, mode);
  },
};