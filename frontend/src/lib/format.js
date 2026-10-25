import { ymd } from "./stats.js";

// Form text to a number. Blank, whitespace-only, NaN and Infinity all mean "no value" (null), never 0.
export function num(v) {
  if (v == null || (typeof v === "string" && v.trim() === "")) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
export const isToday = (ts) => ymd(ts) === ymd(Date.now());

export function minutesOf(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}
// Handles windows that cross midnight (e.g. 22:00 to 02:00).
export function inWindow(start, end, date = new Date()) {
  const now = date.getHours() * 60 + date.getMinutes();
  const s = minutesOf(start), e = minutesOf(end);
  return s <= e ? now >= s && now < e : now >= s || now < e;
}

export function fmtMoney(v, currency, withSign = true) {
  const a = Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${v < 0 ? "−" : withSign && v > 0 ? "+" : ""}${currency}${a}`;
}
export const fmtR = (r) => `${r > 0 ? "+" : r < 0 ? "−" : ""}${Math.abs(r).toFixed(2)}R`;
export const signClass = (v) => (v > 0 ? "pos" : v < 0 ? "neg" : "");
export function compactMoney(v) {
  const a = Math.abs(v);
  const s = a >= 1000 ? (a / 1000).toFixed(1).replace(/\.0$/, "") + "k" : a >= 100 ? String(Math.round(a)) : a.toFixed(1).replace(/\.0$/, "");
  return `${v < 0 ? "−" : "+"}${s}`;
}

export const timeOf = (ts) => new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
export const dateTimeOf = (ts) => new Date(ts).toLocaleString([], { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

// Break-even and CTC both close at cost, so their P&L is 0 and no amount is asked.
export const isAtCost = (result) => result === "be" || result === "ctc";
