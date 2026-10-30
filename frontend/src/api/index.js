const BASE = (import.meta.env.VITE_API_URL || "").replace(/\/$/, "") + "/api";
const HINT = "atm_hint";
const OLD_KEY = "atm_session"; // older builds kept the whole login token here

// The login has two halves. The short-lived access token lives only in this variable, so a script injected into the page
// cannot read it from storage, and it is gone on reload. The long-lived refresh token is an HttpOnly cookie that scripts
// cannot read at all; the browser sends it to /auth/refresh, which hands out a new access token. localStorage keeps only a
// hint ({ email, isAdmin }) that this browser has a login, so the app knows to ask for one.
let accessToken = null;

export function getSession() {
  try { localStorage.removeItem(OLD_KEY); } catch {}
  try {
    const hint = JSON.parse(localStorage.getItem(HINT));
    return hint && hint.email ? hint : null;
  } catch {
    return null;
  }
}
export function setSession(s) {
  if (s.token) accessToken = s.token;
  try { localStorage.setItem(HINT, JSON.stringify({ email: s.email, isAdmin: !!s.isAdmin })); } catch {}
}
// Also tells the server to end this login (best effort), so the cookie stops working.
export function clearSession() {
  const had = accessToken || getSession();
  accessToken = null;
  try { localStorage.removeItem(HINT); } catch {}
  if (had) fetch(BASE + "/auth/logout", { method: "POST", credentials: "include" }).catch(() => {});
}

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const OFFLINE = "Cannot reach the server. Check your connection and try again.";
// Calls that need no login (and must not trigger a renewal).
const OPEN = new Set([
  "/auth/login", "/auth/register", "/auth/verify-email", "/auth/resend-verification", "/auth/forgot-password",
  "/auth/reset-password", "/auth/refresh", "/auth/logout",
]);

// Asks the server for a new access token using the refresh cookie. true = renewed, false = the login is over (sign the user
// out), and it throws when the server could not be reached or answered with an error (a sleeping free server), because
// that says nothing about the login. Calls made at the same time share one request: the refresh token works once.
let renewing;
function renew() {
  renewing ??= (async () => {
    let res;
    try {
      res = await fetch(BASE + "/auth/refresh", { method: "POST", credentials: "include" });
    } catch {
      throw new ApiError(0, OFFLINE);
    }
    if (res.status === 401 || res.status === 403) return false;
    if (!res.ok) throw new ApiError(res.status, "The server is not ready. Try again in a moment.");
    const t = await res.json();
    setSession({ token: t.access_token, email: t.email, isAdmin: !!t.is_admin });
    return true;
  })().finally(() => { renewing = undefined; });
  return renewing;
}

async function once(method, path, init) {
  try {
    return await fetch(BASE + path, {
      method,
      body: init.body,
      headers: { ...init.headers, ...(accessToken && { Authorization: `Bearer ${accessToken}` }) },
    });
  } catch {
    throw new ApiError(0, OFFLINE);
  }
}

// fetch with the access token, renewing it first after a reload and again if it has expired. `init.headers` are added.
async function send(method, path, init = {}) {
  if (OPEN.has(path)) return once(method, path, init);
  let renewed = false;
  if (!accessToken && getSession()) { renewed = true; await renew(); }
  let res = await once(method, path, init);
  if (res.status === 401 && !renewed && (await renew())) res = await once(method, path, init);
  return res;
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
  register: (email, password, captchaToken) => request("POST", "/auth/register", { email, password, ...(captchaToken && { captcha_token: captchaToken }) }),
  verifyEmail: (token) => request("POST", "/auth/verify-email", { token }),
  resendVerification: (email) => request("POST", "/auth/resend-verification", { email }),
  forgotPassword: (email, captchaToken) => request("POST", "/auth/forgot-password", { email, ...(captchaToken && { captcha_token: captchaToken }) }),
  resetPassword: (token, password) => request("POST", "/auth/reset-password", { token, password }),
  me: () => request("GET", "/auth/me"),
  logoutAll: () => request("POST", "/auth/logout-all"),
  // Second step of signing in when the account has two-factor sign-in on (mfaToken comes from login / resetPassword).
  login2fa: (mfaToken, code) => request("POST", "/auth/login/2fa", { mfa_token: mfaToken, code }),
  twoFactorSetup: (password) => request("POST", "/auth/2fa/setup", { password }),
  twoFactorEnable: (code) => request("POST", "/auth/2fa/enable", { code }),
  twoFactorDisable: (password, code) => request("POST", "/auth/2fa/disable", { password, code }),
  // Everything stored about this account as a JSON file (a Blob).
  async exportData() {
    const res = await send("GET", "/auth/export");
    if (!res.ok) throw await failure(res);
    return res.blob();
  },
  deleteAccount: (password) => request("POST", "/auth/delete-account", { password }),
  adminOverview: () => request("GET", "/admin/overview"),
  adminGrowth: (days) => request("GET", `/admin/growth?days=${days}`),
  adminUsers: (q = "", page = 1, pageSize = 25) =>
    request("GET", `/admin/users?q=${encodeURIComponent(q)}&page=${page}&pageSize=${pageSize}`),
  adminCreateUser: (email) => request("POST", "/admin/users", { email }),
  adminSetActive: (id, isActive) => request("PATCH", `/admin/users/${id}`, { isActive }),
  adminDeleteUser: (id) => request("DELETE", `/admin/users/${id}`),
  adminPending: () => request("GET", "/admin/pending"),
  adminApprove: (id) => request("POST", `/admin/users/${id}/approve`),
  adminReject: (id) => request("POST", `/admin/users/${id}/reject`),
  adminVerify: (id) => request("POST", `/admin/users/${id}/verify`),
  adminSendReset: (id) => request("POST", `/admin/users/${id}/send-reset`),
  getSettings: () => request("GET", "/settings"),
  putSettings: (s) => request("PUT", "/settings", s),
  listEntries: () => request("GET", "/entries"),
  // The automatic news calendar: { enabled, updatedAt, events: [{ at, currency, title, impact }] }
  getCalendar: () => request("GET", "/calendar"),
  createEntry: (e) => request("POST", "/entries", e),
  updateEntry: (e) => request("PUT", `/entries/${encodeURIComponent(e.id)}`, e),
  deleteEntry: (id) => request("DELETE", `/entries/${encodeURIComponent(id)}`),
  importEntries: (list) => request("POST", "/entries/import", list),
  deleteAllEntries: () => request("DELETE", "/entries"),
  // Trade screenshots ("before" / "after"). The upload is the raw image, already shrunk by lib/image.js.
  async putImage(id, slot, blob) {
    const res = await send("PUT", `/entries/${encodeURIComponent(id)}/images/${slot}`, { body: blob, headers: { "Content-Type": blob.type } });
    if (!res.ok) throw await failure(res);
    return res.json();
  },
  deleteImage: (id, slot) => request("DELETE", `/entries/${encodeURIComponent(id)}/images/${slot}`),
  // The picture itself, fetched with the login token (an <img> could not send it). `token` is the server's version of
  // the image: it goes in the URL so a replaced picture is never answered from the browser's cache of the old one.
  async imageBlob(id, slot, token) {
    const res = await send("GET", `/entries/${encodeURIComponent(id)}/images/${slot}?v=${encodeURIComponent(token)}`);
    if (!res.ok) throw await failure(res);
    return res.blob();
  },
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
