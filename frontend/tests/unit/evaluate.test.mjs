import test from "node:test";
import assert from "node:assert/strict";
import { RULES } from "../../src/lib/rules.js";
import { evaluate, ruleTitle, todayCounts } from "../../src/lib/evaluate.js";

const settings = { lot: 0.02, minRR: 2, maxTrades: 4, maxSL: 4 }; // killzones omitted: the default sessions apply
// 26 Oct 2026 is EDT (UTC-4): 12:00Z is 08:00 in New York, inside the New York session (07:00-10:00).
const evening = new Date("2026-10-26T12:00:00Z");
const SELF = RULES.filter((r) => r.type === "self");
const allYes = Object.fromEntries(SELF.map((r) => [r.id, true]));
const good = { pair: "XAUUSD", dir: "buy", setup: "fvg", lot: 0.02, entry: 100, sl: 98, tp: 104 };
const run = (over = {}, extra = {}) => evaluate({ f: { ...good, ...over }, answers: allYes, entries: [], settings, now: evening, ...extra });
const trade = (over = {}) => ({ id: "x", timestamp: Date.now(), pair: "XAUUSD", dir: "buy", traded: true, result: "open", ...over });

test("a clean setup passes every rule", () => {
  const r = run();
  assert.equal(r.ok, true);
  assert.deepEqual(r.failed, []);
  assert.deepEqual(r.pending, []);
  assert.equal(r.rr, 2);
});

test("there is a result for every rule id", () => {
  const r = run();
  for (const rule of RULES) assert.ok(r.res[rule.id], `missing result for rule ${rule.id}`);
});

test("nothing filled in: pending, not failed, not ok", () => {
  const r = evaluate({ f: { pair: "", dir: null, setup: null, lot: null, entry: null, sl: null, tp: null }, answers: {}, entries: [], settings, now: evening });
  assert.equal(r.ok, false);
  assert.ok(r.pending.length > 0);
  assert.deepEqual(r.failed, []);
  assert.equal(r.rr, null);
});

test("RR 1:2 exactly passes, just below fails (floating point safe)", () => {
  assert.equal(run({ entry: 100, sl: 98, tp: 104 }).res[2].pass, true);
  assert.equal(run({ entry: 1.0876, sl: 1.0866, tp: 1.0896 }).res[2].pass, true); // 20 pips / 10 pips
  assert.equal(run({ entry: 100, sl: 98, tp: 103.9 }).res[2].pass, false);
  assert.equal(run({ entry: 100, sl: 98, tp: 110 }).res[2].pass, true);
});

test("minimum RR comes from settings", () => {
  const r = run({ entry: 100, sl: 98, tp: 103 }, { settings: { ...settings, minRR: 1.5 } });
  assert.equal(r.res[2].pass, true);
});

test("buy needs SL below and TP above; sell is the opposite", () => {
  assert.equal(run({ dir: "buy", entry: 100, sl: 102, tp: 104 }).res[2].pass, false);
  assert.equal(run({ dir: "buy", entry: 100, sl: 98, tp: 96 }).res[2].pass, false);
  assert.equal(run({ dir: "sell", entry: 100, sl: 102, tp: 96 }).res[2].pass, true);
  assert.equal(run({ dir: "sell", entry: 100, sl: 98, tp: 96 }).res[2].pass, false);
});

test("zero risk (SL equals entry) fails instead of dividing by zero", () => {
  const r = run({ entry: 100, sl: 100, tp: 104 });
  assert.equal(r.res[2].pass, false);
  assert.equal(r.rr, null);
});

test("lot must match the fixed lot", () => {
  assert.equal(run({ lot: 0.02 }).res[3].pass, true);
  assert.equal(run({ lot: 0.03 }).res[3].pass, false);
  assert.equal(run({ lot: 0.1 + 0.2 - 0.28 }).res[3].pass, true); // floating point noise around 0.02
  assert.equal(run({ lot: null }).res[3].pass, null);
});

test("trading is allowed only while a market session is live", () => {
  const ny = (iso) => ({ now: new Date(iso) });
  // each default session, in New York time (EDT, UTC-4)
  assert.equal(run({}, ny("2026-10-26T06:30:00Z")).res[11].pass, true);  // 02:30 London
  assert.equal(run({}, ny("2026-10-26T12:00:00Z")).res[11].pass, true);  // 08:00 New York
  assert.equal(run({}, ny("2026-10-26T14:30:00Z")).res[11].pass, true);  // 10:30 London Close
  assert.equal(run({}, ny("2026-10-27T01:00:00Z")).res[11].pass, true);  // 21:00 Asian
  // gaps between sessions
  assert.equal(run({}, ny("2026-10-26T16:00:00Z")).res[11].pass, false); // 12:00, London Close just ended
  assert.equal(run({}, ny("2026-10-26T20:00:00Z")).res[11].pass, false); // 16:00
  assert.equal(run({}, ny("2026-10-26T05:00:00Z")).res[11].pass, false); // 01:00, before London
  assert.match(run({}, ny("2026-10-26T05:00:00Z")).res[11].detail, /London opens in 1h/);
  assert.equal(run({}, ny("2026-10-26T12:00:00Z")).ok, true);
  assert.equal(run({}, ny("2026-10-26T20:00:00Z")).ok, false);
});

test("no trading at the weekend, even inside a session window", () => {
  const sat = run({}, { now: new Date("2026-10-31T12:00:00Z") }); // Saturday 08:00 New York, the New York window
  assert.equal(sat.res[11].pass, false);
  assert.match(sat.res[11].detail, /closed for the weekend.*reopens in 1d/);
  assert.equal(sat.ok, false);
  const fri = run({}, { now: new Date("2026-10-30T22:00:00Z") }); // Friday 18:00 New York, after the weekly close
  assert.equal(fri.res[11].pass, false);
  const sunNight = run({}, { now: new Date("2026-10-26T00:30:00Z") }); // Sunday 20:30 New York: Asian is live
  assert.equal(sunNight.res[11].pass, true);
  assert.match(sunNight.res[11].detail, /Asian/);
});

test("the old London-session rule is gone and a switched-off session does not count", () => {
  assert.equal(RULES.some((r) => r.id === 4), false);
  assert.equal(run().res[4], undefined);
  const noNy = { ...settings, killzones: [{ key: "newyork", start: "07:00", end: "10:00", on: false, color: "#a78bfa" }] };
  const r = run({}, { settings: noNy }); // evening is 08:00 New York, but New York is off; Asian etc. use their defaults
  assert.equal(r.res[11].pass, false);
  const allOff = { ...settings, killzones: ["asian", "london", "newyork", "londonclose"].map((key) => ({ key, start: "00:00", end: "23:59", on: false, color: "#000000" })) };
  assert.match(run({}, { settings: allOff }).res[11].detail, /switched off/);
});

test("an open trade in the same direction on the same pair blocks a new one", () => {
  const open = [trade()];
  assert.equal(run({}, { entries: open }).res[8].pass, false);
  assert.equal(run({ dir: "sell", entry: 100, sl: 102, tp: 96 }, { entries: open }).res[8].pass, true);
  assert.equal(run({ pair: "EURUSD" }, { entries: open }).res[8].pass, true);
  assert.equal(run({}, { entries: [trade({ result: "tp" })] }).res[8].pass, true);
  assert.equal(run({}, { entries: [trade({ traded: false })] }).res[8].pass, true);
});

test("max trades per day uses today's traded entries only", () => {
  const day = (n) => Array.from({ length: n }, (_, i) => trade({ id: String(i), result: "tp" }));
  assert.equal(run({}, { entries: day(3) }).res[15].pass, true);
  assert.equal(run({}, { entries: day(4) }).res[15].pass, false);
  const yesterday = Array.from({ length: 6 }, (_, i) => trade({ id: String(i), timestamp: Date.now() - 36 * 3600000 }));
  assert.equal(run({}, { entries: yesterday }).res[15].pass, true);
  assert.equal(run({}, { entries: [...day(3), trade({ id: "skipped", traded: false })] }).res[15].pass, true);
});

test("after the max stop-losses the day is over", () => {
  const sl = (n) => Array.from({ length: n }, (_, i) => trade({ id: String(i), result: "sl" }));
  assert.equal(run({}, { entries: sl(3) }).res[19].pass, true);
  const r = run({}, { entries: sl(4) });
  assert.equal(r.res[19].pass, false);
  assert.equal(r.ok, false);
});

test("a single 'No' on a self rule blocks trading and is listed", () => {
  const r = run({}, { answers: { ...allYes, 7: false } });
  assert.equal(r.ok, false);
  assert.deepEqual(r.failed, [7]);
});

test("an unanswered self rule keeps it pending, not failed", () => {
  const { 7: _drop, ...rest } = allYes;
  const r = run({}, { answers: rest });
  assert.equal(r.ok, false);
  assert.deepEqual(r.pending, [7]);
  assert.deepEqual(r.failed, []);
});

test("setup must be picked", () => {
  assert.equal(run({ setup: null }).res[25].pass, null);
  assert.equal(run({ setup: "wick" }).res[25].pass, true);
});

test("todayCounts and ruleTitle", () => {
  const c = todayCounts([trade(), trade({ result: "sl" }), trade({ result: "sl", traded: false }), trade({ timestamp: Date.now() - 3 * 86400000, result: "sl" })]);
  assert.deepEqual(c, { trades: 2, sl: 1 });
  assert.equal(ruleTitle(3, settings), "Lot Size Fixed");
  assert.equal(ruleTitle(7, settings), "No FOMO");
  assert.equal(ruleTitle(999, settings), "Rule #999"); // a rule removed from the app but still in old entries
});

test("rule definitions are consistent", () => {
  const ids = RULES.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length, "duplicate rule ids");
  for (const r of RULES) {
    assert.ok(r.title, `rule ${r.id} has no title`);
    assert.ok(r.type === "auto" || r.type === "self");
    if (r.type === "self") assert.ok(r.q, `self rule ${r.id} needs a question`);
  }
});

test("a loss locks the same pair for 10 minutes, other pairs stay open", () => {
  const T = evening.getTime();
  const lost = (minAgo, over = {}) => trade({ result: "sl", pair: "XAUUSD", timestamp: T - 3600000, closedAt: T - minAgo * 60000, ...over });
  const r = run({}, { entries: [lost(3)] });
  assert.equal(r.res[30].pass, false);
  assert.match(r.res[30].detail, /locked 7 more min/i);
  assert.equal(r.ok, false);
  const eur = { settings: { ...settings, pairs: [{ pair: "EURUSD", lot: 0.2 }] }, entries: [lost(3)] };
  assert.equal(run({ pair: "EURUSD", lot: 0.2 }, eur).res[30].pass, true);
  assert.equal(run({}, { entries: [lost(10)] }).res[30].pass, true); // exactly 10 minutes later: free
  assert.equal(run({}, { entries: [lost(9.5)] }).res[30].pass, false);
  assert.equal(run({}, { entries: [lost(3, { result: "tp" })] }).res[30].pass, true); // a win does not lock
  assert.equal(run({}, { entries: [lost(3, { result: "open" })] }).res[30].pass, true);
  assert.equal(run({}, { entries: [lost(3, { traded: false })] }).res[30].pass, true);
  assert.equal(run({ pair: "xauusd" }, { entries: [lost(3)] }).res[30].pass, false); // case-insensitive
  assert.equal(run({ pair: "" }).res[30].pass, null);
});

test("only an SL hit starts the cooldown, not a negative P&L from another close", () => {
  const T = evening.getTime();
  const e = trade({ result: "manual", pnl: -5, timestamp: T - 3600000, closedAt: T - 60000 });
  assert.equal(run({}, { entries: [e] }).res[30].pass, true);
  assert.equal(run({}, { entries: [{ ...e, result: "sl" }] }).res[30].pass, false);
  assert.equal(run({}, { entries: [{ ...e, result: "sl", pnl: 5 }] }).res[30].pass, false); // SL result is what counts
});

test("lot rule uses the lot set for the pair, falling back to the default lot", () => {
  const s = { ...settings, pairs: [{ pair: "XAUUSD", lot: 0.02 }, { pair: "EURUSD", lot: 0.2 }] };
  const lot = (over) => run(over, { settings: s }).res[3].pass;
  assert.equal(lot({ pair: "EURUSD", lot: 0.2 }), true);
  assert.equal(lot({ pair: "EURUSD", lot: 0.02 }), false);
  assert.equal(lot({ pair: "XAUUSD", lot: 0.02 }), true);
  assert.equal(lot({ pair: "XAUUSD", lot: 0.2 }), false);
  assert.equal(lot({ pair: "GBPUSD", lot: 0.02 }), true); // not listed: default lot
});
