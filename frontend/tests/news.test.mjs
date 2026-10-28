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
