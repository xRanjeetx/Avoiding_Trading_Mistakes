import { num } from "./format.js";

export const DEFAULT_TP_RR = 2;

const places = (text) => (String(text).trim().split(".")[1] || "").length;

// The take profit that gives `rr` times the risk, as text for the form: above the entry for a buy, below it for a sell.
// It keeps the decimals the user typed for entry and stop. Returns "" when the direction, entry or stop is missing, or the
// stop is on the wrong side of the entry for that direction.
export function autoTp(dir, entryText, slText, rr = DEFAULT_TP_RR) {
  const entry = num(entryText), sl = num(slText);
  if ((dir !== "buy" && dir !== "sell") || entry == null || sl == null) return "";
  const risk = dir === "buy" ? entry - sl : sl - entry;
  if (!(risk > 0)) return "";
  const price = dir === "buy" ? entry + rr * risk : entry - rr * risk;
  return price.toFixed(Math.min(8, Math.max(places(entryText), places(slText))));
}

// The reverse: the stop loss that makes `tpText` worth `rr` times the risk, below the entry for a buy, above it for a sell.
// Returns "" when the direction, entry or target is missing, or the target is on the wrong side of the entry.
export function autoSl(dir, entryText, tpText, rr = DEFAULT_TP_RR) {
  const entry = num(entryText), tp = num(tpText);
  if ((dir !== "buy" && dir !== "sell") || entry == null || tp == null) return "";
  const reward = dir === "buy" ? tp - entry : entry - tp;
  if (!(reward > 0)) return "";
  const price = dir === "buy" ? entry - reward / rr : entry + reward / rr;
  // Halving can need one more decimal than was typed (101.5 -> 100.75), so add it only when it does.
  const base = Math.min(8, Math.max(places(entryText), places(tpText)));
  return Math.abs(Number(price.toFixed(base)) - price) < 1e-9 ? price.toFixed(base) : price.toFixed(Math.min(8, base + 1));
}
