// Discipline score and streaks. Pure functions, like stats.js.
//
// Profit says little about process, so every closed trade is judged on four habits:
//   session  taken while a market session was live (skipped when every session is switched off)
//   plan     held to the plan: not closed early by hand
//   calm     not opened within the cooldown after a loss on the same pair (revenge)
//   limits   not beyond the daily trade limit or after the daily stop-loss limit
// A trade is disciplined when all four hold, win or lose. A disciplined loss is a "good loss".
import { COOLDOWN_MIN } from "./rules.js";
import { activeZones, normalizeKillzones } from "./killzones.js";
import { closeTime, outcome, ymd } from "./stats.js";

export const HABITS = {
  session: "Traded outside a market session",
  plan: "Closed by hand before the plan finished",
  calm: "Re-entered a pair right after a loss",
  limits: "Went past the daily trade or SL limit",
};

export const WINDOW_DAYS = 30;

const upper = (s) => String(s || "").trim().toUpperCase();

// Which habits one trade broke: an array of keys from HABITS. `all` is every traded entry of the journal.
function broken(e, all, settings, zones) {
  const out = [];
  const at = new Date(e.timestamp);
  if (zones.some((z) => z.on) && activeZones(zones, at).length === 0) out.push("session");
  if (e.result === "manual") out.push("plan");

  const pair = upper(e.pair);
  const cool = COOLDOWN_MIN * 60000;
  if (pair && all.some((o) => o !== e && o.result === "sl" && upper(o.pair) === pair
      && closeTime(o) <= e.timestamp && e.timestamp - closeTime(o) < cool)) out.push("calm");

  const day = ymd(e.timestamp);
  const earlier = all.filter((o) => o !== e && ymd(o.timestamp) === day && (o.timestamp < e.timestamp || (o.timestamp === e.timestamp && o.id < e.id)));
  const slBefore = earlier.filter((o) => o.result === "sl" && closeTime(o) <= e.timestamp).length;
  if (earlier.length >= settings.maxTrades || slBefore >= settings.maxSL) out.push("limits");
  return out;
}

// windowDays: how far back the score and slips look (0 = all time). The streaks always cover the whole journal.
export function computeDiscipline(entries, settings, now = new Date(), windowDays = WINDOW_DAYS) {
  const zones = normalizeKillzones(settings.killzones);
  const traded = entries.filter((e) => e.traded);
  const closed = traded.filter((e) => e.result !== "open").sort((a, b) => closeTime(a) - closeTime(b));
  const rows = closed.map((e) => ({ e, slips: broken(e, traded, settings, zones) }));
  const clean = (r) => r.slips.length === 0;

  // Trade streak: disciplined trades in a row.
  let best = 0, run = 0;
  for (const r of rows) {
    run = clean(r) ? run + 1 : 0;
    best = Math.max(best, run);
  }

  // Day streak: days in a row where every closed trade was disciplined. Days without trades are skipped.
  const days = new Map();
  for (const r of rows) {
    const k = ymd(closeTime(r.e));
    days.set(k, (days.get(k) ?? true) && clean(r));
  }
  let bestDays = 0, dayRun = 0;
  for (const ok of days.values()) {
    dayRun = ok ? dayRun + 1 : 0;
    bestDays = Math.max(bestDays, dayRun);
  }

  const from = windowDays > 0 ? now.getTime() - windowDays * 86400000 : -Infinity;
  const recent = rows.filter((r) => closeTime(r.e) >= from);
  const slips = Object.fromEntries(Object.keys(HABITS).map((k) => [k, recent.filter((r) => r.slips.includes(k)).length]));
  const cleanRecent = recent.filter(clean);
  const score = recent.length ? Math.round((cleanRecent.length / recent.length) * 100) : null;

  return {
    n: rows.length,
    windowN: recent.length,
    score,
    grade: score == null ? null : score >= 90 ? "Elite" : score >= 75 ? "Solid" : score >= 50 ? "Slipping" : "Off track",
    tradeStreak: run,
    bestTradeStreak: best,
    dayStreak: dayRun,
    bestDayStreak: bestDays,
    goodLosses: cleanRecent.filter((r) => outcome(r.e) === "loss").length,
    badWins: recent.filter((r) => !clean(r) && outcome(r.e) === "win").length,
    slips,
  };
}
