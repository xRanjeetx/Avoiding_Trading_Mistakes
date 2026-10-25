import test from "node:test";
import assert from "node:assert/strict";
import { RULES } from "../src/lib/rules.js";
import { evaluate, ruleTitle, todayCounts } from "../src/lib/evaluate.js";

const settings = { lot: 0.02, minRR: 2, maxTrades: 4, maxSL: 4, londonStart: "12:30", londonEnd: "17:30", sessionStart: "18:00", sessionEnd: "22:30" };
const evening = new Date(2026, 9, 26, 19, 0); // outside London, inside my session
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

test("London session blocks trading; my session is required", () => {
  const london = new Date(2026, 9, 26, 14, 0);
  assert.equal(run({}, { now: london }).res[4].pass, false);
  assert.equal(run({}, { now: london }).res[11].pass, false);
  const early = new Date(2026, 9, 26, 9, 0);
  assert.equal(run({}, { now: early }).res[4].pass, true);
  assert.equal(run({}, { now: early }).res[11].pass, false);
  const late = new Date(2026, 9, 26, 23, 0);
  assert.equal(run({}, { now: late }).res[11].pass, false);
  assert.equal(run({}, { now: new Date(2026, 9, 26, 18, 0) }).ok, true);   // session opens at 18:00
  assert.equal(run({}, { now: new Date(2026, 9, 26, 22, 30) }).res[11].pass, false); // and closes at 22:30
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
  assert.equal(ruleTitle(3, settings), "Lot Size Fixed 0.02");
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
