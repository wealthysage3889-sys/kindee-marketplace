import { request } from "./auth";

export const messageAPI = {
  getChatList: (mode = "customer") => request("/messages", {}, mode),
  getMessages: (storeId, params = {}, mode = "customer") => {
    const clean = Object.fromEntries(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== "")
    );
    const query = new URLSearchParams(clean).toString();
    return request(`/messages/${storeId}${query ? `?${query}` : ""}`, {}, mode);
  },
  sendMessage: (storeId, data, mode = "customer") =>
    request(`/messages/${storeId}`, {
      method: "POST",
      body: JSON.stringify(data),
    }, mode),
  markAsRead: (storeId, mode = "customer") =>
    request(`/messages/${storeId}/read`, {
      method: "PUT",
    }, mode),
};