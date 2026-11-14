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

  getStoreByOwner: (ownerId, mode = "customer") => request(`/stores/owner/${ownerId}`, {}, mode),

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
};