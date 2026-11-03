// Phone / desktop reminders. They are device-local (a notification permission belongs to one browser),
// so the preferences live in localStorage, not in the account settings.
//
// While the app is open (a tab, or the installed app, even in the background) the reminders are worked out here.
// For a closed app the server sends the same reminders as web push (see syncPush); the notification tag is the
// reminder key, so a device never shows one twice.
import { activeZones, fmtDuration, minutesLeft, nextZone, normalizeKillzones, KILLZONE_NAMES } from "./killzones.js";
import { CTC_RR } from "./rules.js";
import { ymd } from "./stats.js";

const KEY_PREFS = "atm_reminders";
const KEY_SENT = "atm_reminders_sent";

export const REMINDER_DEFAULTS = { on: false, lead: 5, closeLead: 5, longMin: 120 };

export function loadPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem(KEY_PREFS) || "{}");
    return {
      on: p.on === true,
      lead: clamp(p.lead, 1, 60, REMINDER_DEFAULTS.lead),
      closeLead: clamp(p.closeLead, 1, 60, REMINDER_DEFAULTS.closeLead),
      longMin: clamp(p.longMin, 5, 1440, REMINDER_DEFAULTS.longMin),
    };
  } catch {
    return { ...REMINDER_DEFAULTS };
  }
}

export function savePrefs(p) {
  try { localStorage.setItem(KEY_PREFS, JSON.stringify(p)); } catch {}
}

function clamp(v, lo, hi, fallback) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
}

export const supported = () => typeof Notification !== "undefined";
export const permission = () => (supported() ? Notification.permission : "unsupported");

// Reminders that are due right now: [{ key, title, body }]. `key` is unique per occurrence, so a reminder
// is sent once (see wasSent / markSent), and a long-open trade repeats once per `longMin` it stays open.
export function dueReminders({ entries, settings, prefs, now = new Date() }) {
  if (!prefs.on) return [];
  const out = [];

  const next = nextZone(normalizeKillzones(settings.killzones), now);
  if (next && next.inMin <= prefs.lead) {
    const opens = new Date(now.getTime() + next.inMin * 60000);
    const name = KILLZONE_NAMES[next.zone.key];
    out.push({
      key: `open:${next.zone.key}:${ymd(opens)}`,
      title: `${name} session opens in ${fmtDuration(next.inMin)}`,
      body: "Open the checklist, clear your head and wait for your setup.",
    });
  }

  // A session about to close: close or protect trades, take no new entry.
  for (const z of activeZones(normalizeKillzones(settings.killzones), now)) {
    const left = minutesLeft(z, now);
    if (!(left <= prefs.closeLead)) continue;
    const closes = new Date(now.getTime() + left * 60000);
    out.push({
      key: `close:${z.key}:${ymd(closes)}`,
      title: `${KILLZONE_NAMES[z.key]} session closes in ${fmtDuration(left)}`,
      body: "Protect or close your open trades. Do not start a new one this close to the end.",
    });
  }

  const longMs = prefs.longMin * 60000;
  for (const e of entries) {
    if (!e.traded || e.result !== "open") continue;
    const age = now.getTime() - e.timestamp;
    if (age < longMs) continue;
    out.push({
      key: `long:${e.id}:${Math.floor(age / longMs)}`,
      title: `${[e.pair, e.dir && e.dir.toUpperCase()].filter(Boolean).join(" ") || "Trade"} open for ${fmtDuration(Math.floor(age / 60000))}`,
      body: ctcAdvice(e),
    });
  }
  return out;
}

// The price at which a trade is 1.5 times its risk in profit, or null when entry, stop or direction is missing.
// It carries the decimals of the entry and stop (at least 2), plus one when 1.5 times the risk needs it (1.0850 and 1.0800 give 1.0925).
export function ctcPrice(e) {
  if (e.entry == null || e.sl == null || e.entry === e.sl || !e.dir) return null;
  const sign = e.dir === "buy" ? 1 : -1;
  const places = (n) => (String(n).split(".")[1] || "").length;
  const decimals = Math.max(2, places(e.entry), places(e.sl));
  const price = (e.entry + sign * CTC_RR * Math.abs(e.entry - e.sl)).toFixed(decimals + 1);
  return price.endsWith("0") ? price.slice(0, -1) : price;
}

function ctcAdvice(e) {
  const price = ctcPrice(e);
  return `If price reached ${CTC_RR} RR${price ? ` (${price})` : ""}, move your SL to cost (CTC). Otherwise stay with the plan.`;
}

const readSent = () => {
  try { return JSON.parse(localStorage.getItem(KEY_SENT) || "[]"); } catch { return []; }
};
export const wasSent = (key) => readSent().includes(key);
export function markSent(key) {
  try { localStorage.setItem(KEY_SENT, JSON.stringify([...readSent(), key].slice(-60))); } catch {}
}

// The in-app inbox (the bell in the header): reminders waiting to be seen. It is cleared once the user has looked,
// so it also covers a reminder that fired while the app was closed or the system notification was missed.
const KEY_INBOX = "atm_inbox";
export function loadInbox() {
  try {
    const list = JSON.parse(localStorage.getItem(KEY_INBOX) || "[]");
    return Array.isArray(list) ? list.filter((n) => n && n.key && n.title) : [];
  } catch {
    return [];
  }
}
export function saveInbox(list) {
  try { localStorage.setItem(KEY_INBOX, JSON.stringify(list.slice(0, 30))); } catch {}
}

// Shows a system notification. Android Chrome only allows it through a service worker, so use that first.
export async function notify(title, body, tag) {
  if (permission() !== "granted") return false;
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) {
      await reg.showNotification(title, { body, tag, icon: "/icon.svg", badge: "/icon.svg" });
      return true;
    }
    new Notification(title, { body, tag, icon: "/icon.svg" });
    return true;
  } catch {
    return false;
  }
}

// Asks for permission (must run from a click) and registers the service worker used to show notifications.
export async function enable() {
  if (!supported()) return "unsupported";
  let p = Notification.permission;
  if (p === "default") p = await Notification.requestPermission();
  if (p === "granted") {
    try { await navigator.serviceWorker?.register("/sw.js"); } catch {}
  }
  return p;
}

const b64ToBytes = (b64) => {
  const raw = atob((b64 + "=".repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

// Keeps this device's push subscription and the server's copy of the reminder preferences in step, so reminders arrive
// while the app is closed. Quietly does nothing where push is unavailable (no support, permission not granted, or the
// server has no push keys). `api` is the fetch client (passed in so this file stays free of imports from api/).
export async function syncPush(api, prefs) {
  try {
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || permission() !== "granted") return false;
    const reg = (await navigator.serviceWorker.getRegistration()) || (await navigator.serviceWorker.register("/sw.js"));
    await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!prefs.on) {
      if (sub) { await api.pushRemove(sub.endpoint).catch(() => {}); await sub.unsubscribe(); }
      return false;
    }
    if (!sub) {
      const { publicKey } = await api.pushKey();
      if (!publicKey) return false;
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) });
    }
    const json = sub.toJSON();
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    await api.pushSave({ endpoint: json.endpoint, keys: json.keys }, { on: prefs.on, lead: prefs.lead, closeLead: prefs.closeLead, longMin: prefs.longMin, tz });
    return true;
  } catch {
    return false;
  }
}
