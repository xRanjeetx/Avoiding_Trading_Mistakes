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

// fetch with the login token. `init.headers` are added to it.
async function send(method, path, init = {}) {
  const session = getSession();
  try {
    return await fetch(BASE + path, {
      method,
      body: init.body,
      headers: { ...init.headers, ...(session && { Authorization: `Bearer ${session.token}` }) },
    });
  } catch {
    throw new ApiError(0, "Cannot reach the server. Check your connection and try again.");
  }
}

async function failure(res) {
  const data = await res.json().catch(() => null);
  const d = data && data.detail;
  // FastAPI validation errors come back as a list of { msg }.
  return new ApiError(res.status, typeof d === "string" ? d : Array.isArray(d) ? d.map((x) => x.msg).join(", ") : "Request failed");
}

async function request(method, path, body) {
  const res = await send(method, path, {
    headers: body !== undefined ? { "Content-Type": "application/json" } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  if (!res.ok) throw await failure(res);
  return res.json().catch(() => null);
}

export const api = {
  login: (email, password) => request("POST", "/auth/login", { email, password }),
  register: (email, password) => request("POST", "/auth/register", { email, password }),
  verifyEmail: (token) => request("POST", "/auth/verify-email", { token }),
  resendVerification: (email) => request("POST", "/auth/resend-verification", { email }),
  forgotPassword: (email) => request("POST", "/auth/forgot-password", { email }),
  resetPassword: (token, password) => request("POST", "/auth/reset-password", { token, password }),
  me: () => request("GET", "/auth/me"),
  deleteAccount: (password) => request("POST", "/auth/delete-account", { password }),
  adminOverview: () => request("GET", "/admin/overview"),
  adminGrowth: (days) => request("GET", `/admin/growth?days=${days}`),
  adminUsers: (q = "", page = 1, pageSize = 25) =>
    request("GET", `/admin/users?q=${encodeURIComponent(q)}&page=${page}&pageSize=${pageSize}`),
  adminCreateUser: (email) => request("POST", "/admin/users", { email }),
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
  importEntries: (list) => request("POST", "/entries/import", list),
  deleteAllEntries: () => request("DELETE", "/entries"),
  // The shared Learning library: read-only books, plus this user's own place in each.
  listLibrary: () => request("GET", "/library"),
  saveProgress: (id, p) => request("PUT", `/library/${id}/progress`, p),
  // The file bytes, fetched with the login token (an <iframe> or link could not send it).
  async libraryFile(id) {
    const res = await send("GET", `/library/${id}/file`);
    if (!res.ok) throw await failure(res);
    return res.arrayBuffer();
  },
};
