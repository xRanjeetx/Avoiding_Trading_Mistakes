// News events that block or warn before a trade. Pure functions.
//
// Two sources are merged: the news the user added by hand (it blocks every pair), and the automatic calendar that the
// server downloads from the free ForexFactory-style feed. The calendar comes from GET /api/calendar as
// { enabled, updatedAt (epoch ms or null), events: [{ at, currency, title, impact: "high" | "medium" }] }.
//
// Calendar news is pair-specific and covers three pairs only. An event matters for a pair when its currency is one of the
// pair's currencies: trading XAUUSD is only affected by USD news, EURUSD by EUR and USD, USDJPY by USD and JPY.
// High-impact events block; medium-impact events only warn.
import { NO_NEWS } from "./rules.js";

// Calendar data older than this is not trusted: the checklist says so and only checks the user's own news.
export const STALE_MS = 24 * 3600000;
const DAY = 86400000;

export const PAIR_CURRENCIES = { XAUUSD: ["USD"], EURUSD: ["EUR", "USD"], USDJPY: ["USD", "JPY"] };
export const NEWS_PAIRS = Object.keys(PAIR_CURRENCIES);
const upper = (s) => String(s || "").trim().toUpperCase();
const pairsFor = (currency) => NEWS_PAIRS.filter((p) => PAIR_CURRENCIES[p].includes(currency));

export const newsOf = (settings) => ({ ...NO_NEWS, ...settings?.news });

// "off": automatic news is switched off. "unavailable": it is on, but the calendar was never downloaded, is switched off
// on the server or is older than a day. "ok": usable.
export function calendarState(settings, calendar, now = new Date()) {
  if (!newsOf(settings).auto) return "off";
  if (!calendar || !calendar.enabled || !calendar.updatedAt || now.getTime() - calendar.updatedAt > STALE_MS) return "unavailable";
  return "ok";
}

// Every event worth showing, soonest first: { at, title, source: "manual" | "auto", impact?, currency?, pairs? }.
// Calendar events are only kept when they affect one of the three pairs (`pairs` lists which). Events at the same time
// and in the same currency (a rate decision and its statement) are shown as one.
export function newsEvents(settings, calendar, now = new Date()) {
  const news = newsOf(settings);
  const own = news.events.map((e) => ({ at: e.at, title: e.title, source: "manual" }));
  if (calendarState(settings, calendar, now) !== "ok") return own.sort((a, b) => a.at - b.at);

  const impacts = news.includeMedium ? ["high", "medium"] : ["high"];
  const groups = new Map();
  for (const e of calendar.events) {
    if (!impacts.includes(e.impact) || !pairsFor(e.currency).length) continue;
    const key = `${e.at}|${e.currency}`;
    const g = groups.get(key) || { at: e.at, currency: e.currency, titles: [], impact: "medium" };
    g.titles.push(e.title);
    if (e.impact === "high") g.impact = "high";
    groups.set(key, g);
  }
  const auto = [...groups.values()].map((g) => ({ at: g.at, title: `${g.currency} ${g.titles.join(", ")}`, source: "auto", impact: g.impact, currency: g.currency, pairs: pairsFor(g.currency) }));
  return [...own, ...auto].sort((a, b) => a.at - b.at);
}

// Does this event matter when trading `pair`? The user's own events matter for every pair.
export const affects = (e, pair) => e.source === "manual" || e.pairs.includes(upper(pair));
// Does it block? The user's own events and high-impact calendar events do; medium-impact ones only warn.
export const blocks = (e) => e.source === "manual" || e.impact === "high";
// The events that matter for one pair, soonest first.
export const eventsForPair = (settings, calendar, now, pair) => newsEvents(settings, calendar, now).filter((e) => affects(e, pair));

// The user's own events: add one from the form (the date and time are the user's local time). Returns the same object
// when the draft cannot be added, so callers can test `next !== current`.
export function withNewsDraft(news, d) {
  const at = d.when ? new Date(d.when).getTime() : NaN;
  return Number.isFinite(at) && news.events.length < 200
    ? { ...news, events: [...news.events, { at, title: d.title.trim() }].sort((a, b) => a.at - b.at) }
    : news;
}

// The user's own events that ended more than a day ago are not worth keeping.
export const pruneEvents = (events, nowMs) => events.filter((e) => e.at > nowMs - DAY);

// One page of a list. `page` (1-based) is moved back into range, so a list that got shorter never shows an empty page.
// Returns { items, page, pages, from, to, total }: `from` and `to` are the 1-based positions of the first and last item shown.
export function paginate(list, page, size) {
  const total = list.length;
  const pages = Math.max(1, Math.ceil(total / size));
  const at = Math.min(Math.max(1, page), pages);
  const start = (at - 1) * size;
  const items = list.slice(start, start + size);
  return { items, page: at, pages, from: total ? start + 1 : 0, to: start + items.length, total };
}
