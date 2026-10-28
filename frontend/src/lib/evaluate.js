import { COOLDOWN_MIN, NO_NEWS, SETUPS, activeRules, allRules } from "./rules.js";
import { isToday } from "./format.js";
import { closeTime } from "./stats.js";
import { KILLZONE_NAMES, activeZones, fmtDuration, marketStatus, minutesLeft, nextZone, normalizeKillzones } from "./killzones.js";

// The fixed lot for a pair: its own entry in Settings > Pairs, else the general fixed lot.
export function lotFor(settings, pair) {
  const p = String(pair || "").trim().toUpperCase();
  const hit = p && (settings.pairs || []).find((x) => x.pair === p);
  return hit ? hit.lot : settings.lot;
}

export function ruleTitle(id, settings) {
  const r = allRules(settings).find((r) => r.id === id);
  if (!r) return `Rule #${id}`; // a rule that was removed, still referenced by old journal entries
  return id === 3 ? "Lot Size Fixed" : r.title;
}

// The latest loss on `pair` that is still inside its cooldown, or null. Other pairs are never locked.
// Returns { lostAt, until, leftMin } (leftMin rounds up, so it never shows 0 while locked).
export function cooldownFor(entries, pair, now = new Date()) {
  const p = String(pair || "").trim().toUpperCase();
  if (!p) return null;
  const nowMs = now.getTime();
  let lostAt = 0;
  for (const e of entries) {
    if (!e.traded || e.result !== "sl" || String(e.pair || "").trim().toUpperCase() !== p) continue;
    const t = closeTime(e);
    if (t <= nowMs && t > lostAt) lostAt = t;
  }
  const until = lostAt + COOLDOWN_MIN * 60000;
  return lostAt && until > nowMs ? { lostAt, until, leftMin: Math.ceil((until - nowMs) / 60000) } : null;
}

// The high-impact news that currently blocks trading, or null. Trading stops `leadMin` minutes before an event and the
// lock ends when the event time passes. Returns { event, inMin } for the soonest such event (inMin rounds up).
export function newsLock(settings, now = new Date()) {
  const { leadMin, events } = { ...NO_NEWS, ...settings?.news };
  const t = now.getTime();
  const hit = events
    .filter((e) => e.at > t && e.at - leadMin * 60000 <= t)
    .sort((a, b) => a.at - b.at)[0];
  return hit ? { event: hit, inMin: Math.ceil((hit.at - t) / 60000) } : null;
}

// The soonest news that has not happened yet, or null.
export function nextNews(settings, now = new Date()) {
  const t = now.getTime();
  return (settings?.news?.events || []).filter((e) => e.at > t).sort((a, b) => a.at - b.at)[0] || null;
}

const newsName = (e) => (e.title ? e.title : "High-impact news");
const newsTime = (at) => new Date(at).toLocaleString([], { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export function todayCounts(entries) {
  const today = entries.filter((e) => isToday(e.timestamp));
  return {
    trades: today.filter((e) => e.traded).length,
    sl: today.filter((e) => e.traded && e.result === "sl").length,
  };
}

// f: { pair, dir, setup, lot, entry, sl, tp } (numbers or null). answers: { [ruleId]: boolean }.
// Each result: { pass: true | false | null (not filled yet), detail }
export function evaluate({ f, answers, entries, settings, now = new Date() }) {
  const c = todayCounts(entries);
  const res = {};
  let rr = null;

  // 2: RR
  if (f.entry == null || f.sl == null || f.tp == null || !f.dir) {
    res[2] = { pass: null, detail: "Enter direction, entry, SL and TP" };
  } else {
    const risk = Math.abs(f.entry - f.sl);
    const reward = Math.abs(f.tp - f.entry);
    const sidesOk = f.dir === "buy" ? f.sl < f.entry && f.tp > f.entry : f.sl > f.entry && f.tp < f.entry;
    if (!sidesOk || risk === 0) {
      res[2] = { pass: false, detail: `SL/TP are on the wrong side for a ${f.dir.toUpperCase()}` };
    } else {
      rr = reward / risk;
      res[2] = { pass: rr + 1e-9 >= settings.minRR, detail: `RR is 1:${rr.toFixed(2)} (need 1:${settings.minRR})` };
    }
  }

  // 3: lot size
  const fixed = lotFor(settings, f.pair);
  const forPair = f.pair ? ` for ${f.pair}` : "";
  res[3] = f.lot == null
    ? { pass: null, detail: `Enter lot size (must be ${fixed}${forPair})` }
    : { pass: Math.abs(f.lot - fixed) < 1e-9, detail: `Lot ${f.lot} (fixed ${fixed}${forPair})` };

  // 11: trade only inside a market session (the enabled ones in Settings, in New York time)
  const zones = normalizeKillzones(settings.killzones);
  const [live] = activeZones(zones, now);
  const market = marketStatus(now);
  if (!market.open) {
    res[11] = { pass: false, detail: `Market is closed for the weekend. It reopens in ${fmtDuration(market.reopensInMin)}` };
  } else if (live) {
    res[11] = { pass: true, detail: `${KILLZONE_NAMES[live.key]} session is live (ends in ${fmtDuration(minutesLeft(live, now))})` };
  } else {
    const next = nextZone(zones, now);
    res[11] = {
      pass: false,
      detail: next ? `No market session is live. ${KILLZONE_NAMES[next.zone.key]} opens in ${fmtDuration(next.inMin)}` : "All market sessions are switched off in Settings",
    };
  }

  // 32: no trading in the hours before high-impact news (the events and lead time are set in Settings)
  const lock = newsLock(settings, now);
  const upcoming = nextNews(settings, now);
  const lead = settings?.news?.leadMin ?? NO_NEWS.leadMin;
  if (lock) {
    res[32] = { pass: false, detail: `${newsName(lock.event)} at ${newsTime(lock.event.at)}, in ${fmtDuration(lock.inMin)}. No trading in the last ${fmtDuration(lead)} before news` };
  } else if (upcoming) {
    res[32] = { pass: true, detail: `Next news: ${newsName(upcoming)}, ${newsTime(upcoming.at)}` };
  } else {
    res[32] = { pass: true, detail: "No high-impact news added in Settings" };
  }

  // 8: same direction already open
  if (!f.pair || !f.dir) {
    res[8] = { pass: null, detail: "Enter pair and direction" };
  } else {
    const open = entries.some((e) => e.traded && e.result === "open" && e.pair === f.pair && e.dir === f.dir);
    res[8] = { pass: !open, detail: open ? `You already have an open ${f.dir.toUpperCase()} on ${f.pair}` : "No open trade in the same direction" };
  }

  // 30: cooldown after a loss on the same pair
  if (!f.pair) {
    res[30] = { pass: null, detail: "Enter the pair" };
  } else {
    const cd = cooldownFor(entries, f.pair, now);
    res[30] = cd
      ? { pass: false, detail: `${f.pair} just lost. Locked ${cd.leftMin} more min (until ${new Date(cd.until).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}). Other pairs are fine` }
      : { pass: true, detail: `No loss on ${f.pair} in the last ${COOLDOWN_MIN} min` };
  }

  // 25: setup picked (5m FVG or 5m wick FVG)
  res[25] = f.setup
    ? { pass: true, detail: `Setup: ${SETUPS[f.setup]}` }
    : { pass: null, detail: "Pick your setup: 5m FVG or 5m Wick FVG" };

  // 15: trades per day
  res[15] = { pass: c.trades < settings.maxTrades, detail: `${c.trades}/${settings.maxTrades} trades taken today` };

  // 19: SL per day
  res[19] = { pass: c.sl < settings.maxSL, detail: `${c.sl}/${settings.maxSL} SL hit today` };

  // Self rules (built-in and the user's own)
  for (const r of allRules(settings).filter((r) => r.type === "self")) {
    const a = answers[r.id];
    res[r.id] = { pass: a === undefined ? null : a };
  }

  // Only the rules switched on count. Results for switched-off rules are still computed, and just ignored.
  const rules = activeRules(settings);
  const failed = rules.filter((r) => res[r.id].pass === false).map((r) => r.id);
  const pending = rules.filter((r) => res[r.id].pass === null).map((r) => r.id);
  return { rr, res, failed, pending, ok: failed.length === 0 && pending.length === 0 };
}
