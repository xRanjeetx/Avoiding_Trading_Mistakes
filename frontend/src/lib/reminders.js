// Phone / desktop reminders. They are device-local (a notification permission belongs to one browser),
// so the preferences live in localStorage, not in the account settings.
//
// Reminders fire while the app is open (a tab, or the installed app, even in the background). A closed
// app cannot be woken without a push server, which this project does not run.
import { fmtDuration, nextZone, normalizeKillzones, KILLZONE_NAMES } from "./killzones.js";
import { ymd } from "./stats.js";

const KEY_PREFS = "atm_reminders";
const KEY_SENT = "atm_reminders_sent";

export const REMINDER_DEFAULTS = { on: false, lead: 5, longMin: 120 };

export function loadPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem(KEY_PREFS) || "{}");
    return {
      on: p.on === true,
      lead: clamp(p.lead, 1, 60, REMINDER_DEFAULTS.lead),
      longMin: clamp(p.longMin, 15, 1440, REMINDER_DEFAULTS.longMin),
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

  const longMs = prefs.longMin * 60000;
  for (const e of entries) {
    if (!e.traded || e.result !== "open") continue;
    const age = now.getTime() - e.timestamp;
    if (age < longMs) continue;
    out.push({
      key: `long:${e.id}:${Math.floor(age / longMs)}`,
      title: `${[e.pair, e.dir && e.dir.toUpperCase()].filter(Boolean).join(" ") || "Trade"} open for ${fmtDuration(Math.floor(age / 60000))}`,
      body: "Is it still valid? Close it from the Today tab if it has finished, or stick to your plan.",
    });
  }
  return out;
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
