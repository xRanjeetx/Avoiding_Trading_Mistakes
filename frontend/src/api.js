const BASE = (import.meta.env.VITE_API_URL || "").replace(/\/$/, "") + "/api";
const KEY = "atm_session";

export function getSession() {
  try {
    return JSON.parse(localStorage.getItem(KEY));
  } catch {
    return null;
  }
}
export const setSession = (s) => localStorage.setItem(KEY, JSON.stringify(s));
export const clearSession = () => localStorage.removeItem(KEY);

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function request(method, path, body) {
  const session = getSession();
  let res;
  try {
    res = await fetch(BASE + path, {
      method,
      headers: {
        ...(body !== undefined && { "Content-Type": "application/json" }),
        ...(session && { Authorization: `Bearer ${session.token}` }),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, "Cannot reach the server. Check your connection and try again.");
  }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const d = data && data.detail;
    // FastAPI validation errors come back as a list of { msg }.
    throw new ApiError(res.status, typeof d === "string" ? d : Array.isArray(d) ? d.map((x) => x.msg).join(", ") : "Request failed");
  }
  return data;
}

export const api = {
  login: (email, password) => request("POST", "/auth/login", { email, password }),
  register: (email, password) => request("POST", "/auth/register", { email, password }),
  verifyEmail: (token) => request("POST", "/auth/verify-email", { token }),
  resendVerification: (email) => request("POST", "/auth/resend-verification", { email }),
  forgotPassword: (email) => request("POST", "/auth/forgot-password", { email }),
  resetPassword: (token, password) => request("POST", "/auth/reset-password", { token, password }),
  me: () => request("GET", "/auth/me"),
  adminOverview: () => request("GET", "/admin/overview"),
  adminUsers: (q = "") => request("GET", `/admin/users?q=${encodeURIComponent(q)}`),
  adminSetActive: (id, isActive) => request("PATCH", `/admin/users/${id}`, { isActive }),
  adminDeleteUser: (id) => request("DELETE", `/admin/users/${id}`),
  adminVerify: (id) => request("POST", `/admin/users/${id}/verify`),
  adminSendReset: (id) => request("POST", `/admin/users/${id}/send-reset`),
  getSettings: () => request("GET", "/settings"),
  putSettings: (s) => request("PUT", "/settings", s),
  listEntries: () => request("GET", "/entries"),
  createEntry: (e) => request("POST", "/entries", e),
  updateEntry: (e) => request("PUT", `/entries/${encodeURIComponent(e.id)}`, e),
  deleteEntry: (id) => request("DELETE", `/entries/${encodeURIComponent(id)}`),
  deleteAllEntries: () => request("DELETE", "/entries"),
};
