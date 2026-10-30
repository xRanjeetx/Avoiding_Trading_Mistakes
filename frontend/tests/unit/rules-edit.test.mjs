import test from "node:test";
import assert from "node:assert/strict";
import { NO_RULE_EDITS, RULES, activeRules, allRules, isRuleOn } from "../../src/lib/rules.js";
import { evaluate, ruleTitle } from "../../src/lib/evaluate.js";

const base = { lot: 0.02, minRR: 2, maxTrades: 4, maxSL: 4 };
const withRules = (rules) => ({ ...base, rules: { ...NO_RULE_EDITS, ...rules } });
const evening = new Date("2026-10-26T12:00:00Z"); // 08:00 New York: the New York session is live
const SELF = RULES.filter((r) => r.type === "self");
const allYes = Object.fromEntries(SELF.map((r) => [r.id, true]));
const good = { pair: "XAUUSD", dir: "buy", setup: "fvg", lot: 0.02, entry: 100, sl: 98, tp: 104 };
const run = (settings, over = {}, answers = allYes) => evaluate({ f: { ...good, ...over }, answers, entries: [], settings, now: evening });
const trade = (over = {}) => ({ id: "x", timestamp: evening.getTime() - 60000, pair: "XAUUSD", dir: "buy", traded: true, result: "open", ...over });

test("with no edits (or no rules key at all) every built-in rule is active", () => {
  assert.equal(activeRules(base).length, RULES.length);
  assert.equal(activeRules(withRules({})).length, RULES.length);
  assert.equal(activeRules(undefined).length, RULES.length);
  assert.equal(isRuleOn(base, 7), true);
});

test("a switched-off rule neither fails nor blocks the trade", () => {
  const off = withRules({ disabled: [7] });
  const r = run(off, {}, { ...allYes, 7: false }); // answering No to "No FOMO", which is switched off
  assert.equal(r.ok, true);
  assert.deepEqual(r.failed, []);
  assert.equal(activeRules(off).length, RULES.length - 1);
  // the same answer with the rule on does block
  assert.deepEqual(run(base, {}, { ...allYes, 7: false }).failed, [7]);
});

test("a switched-off rule is not waited for either", () => {
  const { 7: _skip, ...without } = allYes;
  assert.deepEqual(run(base, {}, without).pending, [7]);
  const r = run(withRules({ disabled: [7] }), {}, without);
  assert.deepEqual(r.pending, []);
  assert.equal(r.ok, true);
});

test("automatic rules can be switched off too", () => {
  const bad = { sl: 99.5, tp: 100.5 }; // RR 1:1, below the minimum of 2
  assert.deepEqual(run(base, bad).failed, [2]);
  const r = run(withRules({ disabled: [2] }), bad);
  assert.deepEqual(r.failed, []);
  assert.equal(r.ok, true);
});

test("the daily trade limit only applies while its rule is on", () => {
  // "today" in todayCounts is the real clock, so these trades are stamped with the real time
  const full = Array.from({ length: 4 }, (_, i) => trade({ id: `t${i}`, timestamp: Date.now() - 60000, result: "tp", pnl: 5, closedAt: Date.now() - 30000 }));
  const go = (settings) => evaluate({ f: good, answers: allYes, entries: full, settings, now: evening });
  assert.deepEqual(go(base).failed, [15]);
  assert.deepEqual(go(withRules({ disabled: [15] })).failed, []);
});

test("custom rules are asked after the built-in ones, and a No blocks the trade", () => {
  const s = withRules({ custom: [{ id: 1000, title: "Checked the news", q: "No red-folder news soon?" }], nextId: 1001 });
  const list = activeRules(s);
  assert.equal(list.at(-1).id, 1000);
  assert.equal(list.at(-1).type, "self");
  assert.equal(allRules(s).length, RULES.length + 1);
  assert.deepEqual(run(s, {}, allYes).pending, [1000]); // not answered yet
  assert.deepEqual(run(s, {}, { ...allYes, 1000: false }).failed, [1000]);
  const ok = run(s, {}, { ...allYes, 1000: true });
  assert.equal(ok.ok, true);
});

test("a custom rule can be switched off without deleting it", () => {
  const s = withRules({ custom: [{ id: 1000, title: "Checked the news", q: "" }], disabled: [1000], nextId: 1001 });
  assert.equal(activeRules(s).some((r) => r.id === 1000), false);
  assert.equal(run(s).ok, true);
  assert.equal(ruleTitle(1000, s), "Checked the news");
});

test("ruleTitle finds custom rules and falls back for deleted ones", () => {
  const s = withRules({ custom: [{ id: 1002, title: "My rule", q: "" }], nextId: 1003 });
  assert.equal(ruleTitle(1002, s), "My rule");
  assert.equal(ruleTitle(1001, s), "Rule #1001"); // deleted, still referenced by an old trade
  assert.equal(ruleTitle(7, s), "No FOMO");
});

test("switching every rule off leaves nothing to fail", () => {
  const s = withRules({ disabled: RULES.map((r) => r.id) });
  assert.equal(activeRules(s).length, 0);
  assert.equal(run(s, { entry: null }, {}).ok, true);
});
