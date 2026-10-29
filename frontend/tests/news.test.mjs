import test from "node:test";
import assert from "node:assert/strict";
import { RULES, activeRules } from "../src/lib/rules.js";
import { evaluate, newsLock, nextNews } from "../src/lib/evaluate.js";

const HOUR = 3600000;
const evening = new Date("2026-10-26T12:00:00Z"); // 08:00 New York: the New York session is live
const T = evening.getTime();
const SELF = RULES.filter((r) => r.type === "self");
const allYes = Object.fromEntries(SELF.map((r) => [r.id, true]));
const good = { pair: "XAUUSD", dir: "buy", setup: "fvg", lot: 0.02, entry: 100, sl: 98, tp: 104 };
const base = { lot: 0.02, minRR: 2, maxTrades: 4, maxSL: 4 };
const withNews = (events, leadMin = 120, extra = {}) => ({ ...base, ...extra, news: { leadMin, events } });
const run = (settings, now = evening) => evaluate({ f: good, answers: allYes, entries: [], settings, now });

test("with no news added the rule passes", () => {
  const r = run(base);
  assert.equal(r.res[32].pass, true);
  assert.match(r.res[32].detail, /No high-impact news/);
  assert.equal(r.ok, true);
});

test("trading is locked from 2 hours before the news until it happens", () => {
  const at = (minAhead) => withNews([{ at: T + minAhead * 60000, title: "NFP" }]);
  assert.equal(run(at(181)).res[32].pass, true); // 3h away
  assert.equal(run(at(121)).res[32].pass, true); // just outside the window
  assert.equal(run(at(120)).res[32].pass, false); // exactly 2h before: locked
  assert.equal(run(at(60)).res[32].pass, false);
  assert.equal(run(at(1)).res[32].pass, false);
  assert.equal(run(at(0)).res[32].pass, true); // the news time itself: the lock is over
  assert.equal(run(at(-30)).res[32].pass, true); // already passed
});

test("a locked checklist is not OK to trade and names the news and the time left", () => {
  const r = run(withNews([{ at: T + 90 * 60000, title: "FOMC" }]));
  assert.equal(r.ok, false);
  assert.deepEqual(r.failed, [32]);
  assert.match(r.res[32].detail, /FOMC/);
  assert.match(r.res[32].detail, /1h 30m/);
});

test("the lead time is yours to change", () => {
  const s = (lead) => withNews([{ at: T + 45 * 60000, title: "CPI" }], lead);
  assert.equal(run(s(30)).res[32].pass, true); // only the last 30 minutes are locked
  assert.equal(run(s(60)).res[32].pass, false);
});

test("an unnamed event still reads well", () => {
  assert.match(run(withNews([{ at: T + 60 * 60000, title: "" }])).res[32].detail, /High-impact news/);
});

test("only news inside the window matters, and the soonest one is reported", () => {
  const s = withNews([
    { at: T + 600 * 60000, title: "Later" },
    { at: T + 100 * 60000, title: "Soon" },
    { at: T - 30 * 60000, title: "Past" },
  ]);
  assert.equal(newsLock(s, evening).event.title, "Soon");
  assert.equal(newsLock(s, evening).inMin, 100);
  assert.equal(nextNews(s, evening).title, "Soon");
  assert.equal(newsLock(withNews([{ at: T + 600 * 60000, title: "Later" }]), evening), null);
  assert.equal(nextNews(withNews([{ at: T - HOUR, title: "Past" }]), evening), null);
});

test("two news events: after the first passes the second can still lock", () => {
  const s = withNews([{ at: T + 30 * 60000, title: "A" }, { at: T + 100 * 60000, title: "B" }]);
  const later = new Date(T + 40 * 60000); // A has passed, B is 60 minutes away
  assert.equal(run(s, later).res[32].pass, false);
  assert.match(run(s, later).res[32].detail, /B/);
});

test("switching the rule off ignores news", () => {
  const s = withNews([{ at: T + 60 * 60000, title: "NFP" }], 120, { rules: { disabled: [32], custom: [], nextId: 1000 } });
  assert.equal(activeRules(s).some((r) => r.id === 32), false);
  assert.equal(run(s).ok, true);
});

test("the rule exists in the built-in list as an automatic rule", () => {
  const r = RULES.find((x) => x.id === 32);
  assert.equal(r.type, "auto");
  assert.ok(r.title);
});

// ---------------- the automatic calendar ----------------
import { calendarState, eventsForPair, newsEvents, pruneEvents, withNewsDraft, STALE_MS } from "../src/lib/news.js";
import { newsWarning } from "../src/lib/evaluate.js";

const cal = (events, over = {}) => ({ enabled: true, updatedAt: T - 5 * 60000, events, ...over });
const ev = (minAhead, title, currency = "USD", impact = "high") => ({ at: T + minAhead * 60000, title, currency, impact });
const withAuto = (news = {}) => ({ ...base, news: { leadMin: 120, events: [], auto: true, includeMedium: true, ...news } });
const runCal = (settings, calendar, over = {}) => evaluate({ f: { ...good, ...over }, answers: allYes, entries: [], settings, now: evening, calendar });

test("calendarState: off, unavailable (never loaded, switched off, empty, stale) or ok", () => {
  assert.equal(calendarState(withAuto({ auto: false }), cal([]), evening), "off");
  assert.equal(calendarState(withAuto(), null, evening), "unavailable");
  assert.equal(calendarState(withAuto(), cal([], { enabled: false }), evening), "unavailable");
  assert.equal(calendarState(withAuto(), cal([], { updatedAt: null }), evening), "unavailable");
  assert.equal(calendarState(withAuto(), cal([], { updatedAt: T - STALE_MS - 1 }), evening), "unavailable");
  assert.equal(calendarState(withAuto(), cal([], { updatedAt: T - STALE_MS + 60000 }), evening), "ok");
  assert.equal(calendarState(withAuto(), cal([]), evening), "ok");
});

test("news blocks only the pairs it affects: USD hits all three, EUR only EURUSD, JPY only USDJPY", () => {
  const blocked = (calendar, pair) => runCal(withAuto(), calendar, { pair }).res[32].pass === false;
  const usd = cal([ev(60, "FOMC Statement", "USD")]);
  assert.deepEqual(["XAUUSD", "EURUSD", "USDJPY"].map((p) => blocked(usd, p)), [true, true, true]);
  const eur = cal([ev(60, "ECB Rate", "EUR")]);
  assert.deepEqual(["XAUUSD", "EURUSD", "USDJPY"].map((p) => blocked(eur, p)), [false, true, false]);
  const jpy = cal([ev(60, "BOJ Policy Rate", "JPY")]);
  assert.deepEqual(["XAUUSD", "EURUSD", "USDJPY"].map((p) => blocked(jpy, p)), [false, false, true]);
});

test("a blocking event is named in the checklist and blocks the verdict", () => {
  const r = runCal(withAuto(), cal([ev(60, "FOMC Statement")]));
  assert.equal(r.res[32].pass, false);
  assert.match(r.res[32].detail, /USD FOMC Statement/);
  assert.equal(r.ok, false);
  assert.ok(r.failed.includes(32));
  assert.equal(newsLock(withAuto(), evening, cal([ev(60, "FOMC Statement")]), "XAUUSD").inMin, 60);
  assert.equal(newsLock(withAuto(), evening, cal([ev(60, "FOMC Statement")]), ""), null); // no pair yet: nothing from the calendar
});

test("a trade in XAUUSD is not blocked by EUR news, and the pair is case-insensitive", () => {
  const r = runCal(withAuto(), cal([ev(30, "ECB Rate", "EUR")]), { pair: "XAUUSD" });
  assert.equal(r.res[32].pass, true);
  assert.equal(newsLock(withAuto(), evening, cal([ev(30, "ECB Rate", "EUR")]), "eurusd").inMin, 30);
});

test("events outside the lead time do not lock, and the next one for the pair is reported", () => {
  const r = runCal(withAuto(), cal([ev(300, "NFP"), ev(200, "ECB Rate", "EUR")]));
  assert.equal(r.res[32].pass, true);
  assert.match(r.res[32].detail, /Next news: USD NFP/); // the EUR one is not for XAUUSD
  assert.doesNotMatch(r.res[32].detail, /unavailable/);
  assert.equal(nextNews(withAuto(), evening, cal([ev(300, "NFP")]), "XAUUSD").title, "USD NFP");
});

test("medium-impact news only warns: the rule passes and says so", () => {
  const calendar = cal([ev(30, "Consumer Sentiment", "USD", "medium")]);
  const r = runCal(withAuto(), calendar);
  assert.equal(r.res[32].pass, true);
  assert.equal(r.ok, true);
  assert.match(r.res[32].detail, /Heads up: USD Consumer Sentiment/);
  assert.match(r.res[32].detail, /medium impact, not blocking/);
  assert.equal(newsLock(withAuto(), evening, calendar, "XAUUSD"), null);
  assert.equal(newsWarning(withAuto(), evening, calendar, "XAUUSD").inMin, 30);
});

test("a high-impact event beats a medium one: it blocks, not just warns", () => {
  const r = runCal(withAuto(), cal([ev(30, "Consumer Sentiment", "USD", "medium"), ev(50, "FOMC Statement")]));
  assert.equal(r.res[32].pass, false);
  assert.match(r.res[32].detail, /FOMC Statement/);
});

test("medium-impact warnings can be switched off", () => {
  const calendar = cal([ev(30, "Consumer Sentiment", "USD", "medium")]);
  const r = runCal(withAuto({ includeMedium: false }), calendar);
  assert.equal(r.res[32].pass, true);
  assert.doesNotMatch(r.res[32].detail, /Heads up/);
  assert.equal(newsWarning(withAuto({ includeMedium: false }), evening, calendar, "XAUUSD"), null);
});

test("only the three pairs' currencies are shown: GBP, CAD, AUD... news never appears", () => {
  const calendar = cal([ev(30, "BOE Rate", "GBP"), ev(40, "BOC Rate", "CAD"), ev(50, "RBA Rate", "AUD"), ev(60, "NFP", "USD")]);
  assert.deepEqual(newsEvents(withAuto(), calendar, evening).map((e) => e.title), ["USD NFP"]);
});

test("each calendar event says which of the three pairs it affects", () => {
  const list = newsEvents(withAuto(), cal([ev(30, "NFP", "USD"), ev(40, "ECB Rate", "EUR"), ev(50, "BOJ Policy Rate", "JPY")]), evening);
  assert.deepEqual(list.map((e) => e.pairs), [["XAUUSD", "EURUSD", "USDJPY"], ["EURUSD"], ["USDJPY"]]);
});

test("another pair is checked against your own news only, and the rule says so", () => {
  const r = runCal(withAuto(), cal([ev(30, "NFP")]), { pair: "GBPUSD" });
  assert.equal(r.res[32].pass, true);
  assert.match(r.res[32].detail, /Calendar news covers XAUUSD, EURUSD, USDJPY only/);
  const own = runCal(withAuto({ events: [{ at: T + 30 * 60000, title: "My news" }] }), cal([]), { pair: "GBPUSD" });
  assert.equal(own.res[32].pass, false); // your own news blocks every pair
});

test("your own news and the calendar are merged, soonest first, and tell their source", () => {
  const settings = withAuto({ events: [{ at: T + 90 * 60000, title: "My news" }] });
  const list = newsEvents(settings, cal([ev(200, "CPI"), ev(30, "NFP")]), evening);
  assert.deepEqual(list.map((e) => [e.title, e.source]), [["USD NFP", "auto"], ["My news", "manual"], ["USD CPI", "auto"]]);
  assert.equal(eventsForPair(settings, cal([ev(200, "CPI")]), evening, "XAUUSD").length, 2);
});

test("events at the same time in the same currency are shown as one", () => {
  const list = newsEvents(withAuto(), cal([ev(60, "Federal Funds Rate"), ev(60, "FOMC Statement"), ev(60, "ECB Rate", "EUR")]), evening);
  assert.equal(list.length, 2);
  assert.deepEqual(list.map((e) => e.title).sort(), ["EUR ECB Rate", "USD Federal Funds Rate, FOMC Statement"]);
  assert.equal(list.find((e) => e.currency === "USD").impact, "high");
});

test("with automatic news switched off only your own news counts, with no warning", () => {
  const settings = withAuto({ auto: false });
  const calendar = cal([ev(30, "NFP")]);
  const r = runCal(settings, calendar);
  assert.equal(r.res[32].pass, true);
  assert.doesNotMatch(r.res[32].detail, /unavailable/);
  assert.equal(newsEvents(settings, calendar, evening).length, 0);
});

test("when the calendar is unavailable the rule passes with a warning and your own news still locks", () => {
  const r = runCal(withAuto(), null);
  assert.equal(r.res[32].pass, true);
  assert.equal(r.ok, true);
  assert.match(r.res[32].detail, /Auto calendar unavailable: only the news you added is checked/);
  const own = runCal(withAuto({ events: [{ at: T + 30 * 60000, title: "NFP" }] }), null);
  assert.equal(own.res[32].pass, false);
});

test("a calendar that is more than a day old is not trusted", () => {
  const r = runCal(withAuto(), cal([ev(30, "NFP")], { updatedAt: T - STALE_MS - 1 }));
  assert.equal(r.res[32].pass, true); // the stale event is ignored
  assert.match(r.res[32].detail, /unavailable/);
});

test("withNewsDraft adds your own event in time order, and ignores an empty form", () => {
  const news = { leadMin: 120, events: [{ at: T + 1000, title: "Later" }] };
  const added = withNewsDraft(news, { when: "2020-01-01T00:00", title: " Old " });
  assert.equal(added.events[0].title, "Old");
  assert.equal(added.events.length, 2);
  assert.equal(withNewsDraft(news, { when: "", title: "x" }), news);
});

test("pruneEvents drops your own events that ended more than a day ago", () => {
  const events = [{ at: T - 2 * 86400000, title: "Ancient" }, { at: T - 3600000, title: "Just passed" }, { at: T + 1000, title: "Soon" }];
  assert.deepEqual(pruneEvents(events, T).map((e) => e.title), ["Just passed", "Soon"]);
});

// ---------------- paging ----------------
import { paginate } from "../src/lib/news.js";

test("paginate cuts a list into pages and says which items are shown", () => {
  const list = Array.from({ length: 25 }, (_, i) => i + 1);
  const p1 = paginate(list, 1, 10);
  assert.deepEqual([p1.items.length, p1.page, p1.pages, p1.from, p1.to, p1.total], [10, 1, 3, 1, 10, 25]);
  const p3 = paginate(list, 3, 10);
  assert.deepEqual(p3.items, [21, 22, 23, 24, 25]);
  assert.deepEqual([p3.from, p3.to], [21, 25]);
});

test("paginate moves an out-of-range page back, so a shorter list never shows an empty page", () => {
  const list = Array.from({ length: 12 }, (_, i) => i);
  assert.equal(paginate(list, 9, 10).page, 2);
  assert.equal(paginate(list, 0, 10).page, 1);
  assert.equal(paginate(list, -3, 10).page, 1);
});

test("paginate handles an empty list and an exact multiple of the page size", () => {
  const none = paginate([], 1, 10);
  assert.deepEqual([none.items.length, none.page, none.pages, none.from, none.to, none.total], [0, 1, 1, 0, 0, 0]);
  assert.equal(paginate(Array.from({ length: 20 }, (_, i) => i), 2, 10).pages, 2);
  assert.equal(paginate([1, 2, 3], 1, 10).pages, 1);
});
