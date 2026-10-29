// Loss limits: how much money a trade risks and how much of the daily and overall limits is left. Pure functions.
//
// The risk of a trade is its stop-loss distance in money:  |entry - SL| x lot x value
// where "value" is what 1 lot gains or loses when price moves 1.00 (gold 100, EURUSD 100000).
//
// remaining = limit + net P&L - risk of trades still open. A profit gives room back: with a daily limit of 20 and +30
// made today, 50 may still be risked. Open trades count at their full SL risk, the worst case, so several open trades
// can never add up to more than the limit.
import { NO_LOSS_LIMITS } from "./rules.js";
import { closeTime, sum, ymd } from "./stats.js";

// Built in for these pairs only. Any other pair needs its value typed in Settings > Pairs.
const BUILT_IN_VALUES = { XAUUSD: 100, EURUSD: 100000 };
const USDJPY_UNITS = 100000; // USDJPY pays in yen, so its value in dollars is 100000 / the price

// What the value box in Settings > Pairs shows for a pair. Built-in pairs are filled in, so typing XAUUSD shows 100 at once;
// USDJPY follows the price, so its box shows an estimate, 100000 / `usdjpyPrice`; the checklist itself uses the entry price
// of each trade, which is exact. The saved state stays empty unless the user types a number, which keeps "use the
// built-in value" separate from "override it".
export function valueBox(pair, typed, usdjpyPrice = USDJPY_FALLBACK_PRICE) {
  const p = upper(pair).replace(/[^A-Z0-9._-]/g, "");
  const builtIn = p === "USDJPY" ? Number((USDJPY_UNITS / usdjpyPrice).toFixed(2)) : BUILT_IN_VALUES[p] ?? "";
  return {
    value: typed !== "" ? typed : builtIn,
    placeholder: "Value",
    title: p === "USDJPY" && typed === "" ? "Estimate: 100000 / price. The checklist uses the entry price of each trade." : undefined,
  };
}

// The price the USDJPY estimate is based on: the entry of the latest USDJPY trade in the journal, else a typical rate.
const USDJPY_FALLBACK_PRICE = 150;
export function usdjpyPrice(entries) {
  const last = [...(entries || [])].filter((e) => upper(e.pair) === "USDJPY" && e.entry > 0).sort((a, b) => b.timestamp - a.timestamp)[0];
  return last ? last.entry : USDJPY_FALLBACK_PRICE;
}

const upper = (s) => String(s || "").trim().toUpperCase();

// The value for a pair: the one typed in Settings, else the built-in one, else null (unknown).
export function valueFor(settings, pair, price) {
  const p = upper(pair);
  if (!p) return null;
  const own = (settings?.pairs || []).find((x) => x.pair === p)?.value;
  if (own > 0) return own;
  if (BUILT_IN_VALUES[p]) return BUILT_IN_VALUES[p];
  if (p === "USDJPY" && price > 0) return USDJPY_UNITS / price;
  return null;
}

// t: { pair, entry, sl, lot }. null when something is missing or the pair's value is unknown.
export function tradeRisk(t, settings) {
  if (t.entry == null || t.sl == null || t.lot == null) return null;
  const value = valueFor(settings, t.pair, t.entry);
  return value == null ? null : Math.abs(t.entry - t.sl) * t.lot * value;
}

export const limitsOf = (settings) => ({ ...NO_LOSS_LIMITS, ...settings?.lossLimits });

// { daily, overall } are null when that limit is off, else { limit, pnl, remaining }.
// openRisk: the SL risk of open trades. unknownOpen: open trades whose risk could not be worked out (pair value missing).
export function lossStatus(entries, settings, now = new Date()) {
  const lim = limitsOf(settings);
  const closed = entries.filter((e) => e.traded && e.result !== "open" && e.pnl != null);
  const today = ymd(now);
  const dayPnl = sum(closed.filter((e) => ymd(closeTime(e)) === today).map((e) => e.pnl));
  const allPnl = sum(closed.filter((e) => !lim.since || closeTime(e) >= lim.since).map((e) => e.pnl));

  let openRisk = 0;
  let unknownOpen = 0;
  for (const e of entries.filter((e) => e.traded && e.result === "open")) {
    const r = tradeRisk(e, settings);
    if (r == null) unknownOpen++;
    else openRisk += r;
  }
  const part = (limit, pnl) => (limit == null ? null : { limit, pnl, remaining: limit + pnl - openRisk });
  return { daily: part(lim.daily, dayPnl), overall: part(lim.overall, allPnl), openRisk, unknownOpen };
}
