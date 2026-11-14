path = r'C:\Users\LEGION\OneDrive\Desktop\kindee-marketplace\frontend\src\api\auth.js'

content = '''const API_BASE = "/api";

export async function request(path, options = {}) {
  const token = localStorage.getItem("token");
  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
    ...options,
  });
  const data = await res.json();
  if (!res.ok) {
    const err = new Error(data.message || "\u0e40\u0e01\u0e34\u0e01\u0e04\u0e49\u0e44\u0e21\u0e49\u0e16\u0e34\u0e21");
    err.data = data;
    err.status = res.status;
    throw err;
  }
  return data;
}

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
};
'''

with open(path, 'w', encoding='utf-8') as f:
    f.write(content)

# Verify
with open(path, 'r', encoding='utf-8') as f:
    verify = f.read()
print("Contains correct Thai:", "\u0e40\u0e01\u0e34\u0e01\u0e04\u0e49\u0e44\u0e21\u0e49\u0e16\u0e34\u0e21" in verify)
print("File length:", len(verify))