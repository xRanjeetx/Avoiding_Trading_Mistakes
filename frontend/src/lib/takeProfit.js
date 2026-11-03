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
