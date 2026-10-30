import test from "node:test";
import assert from "node:assert/strict";
import { lossStatus, tradeRisk, usdjpyPrice, valueBox, valueFor } from "../../src/lib/risk.js";
import { evaluate } from "../../src/lib/evaluate.js";
import { RULES } from "../../src/lib/rules.js";

// 26 Oct 2026, 12:00Z = 08:00 New York (inside the New York session). Times below are local, on the day NOW falls on.
const NOW = new Date("2026-10-26T12:00:00Z");
const todayMs = (h) => { const d = new Date(NOW); d.setHours(h, 0, 0, 0); return d.getTime(); };
const DAY = 86400000;
const settings = (limits, extra = {}) => ({ lot: 0.02, minRR: 2, maxTrades: 9, maxSL: 9, currency: "$", lossLimits: limits, ...extra });
const closed = (pnl, over = {}) => ({ id: String(Math.random()), timestamp: todayMs(9), closedAt: todayMs(10), traded: true, result: pnl > 0 ? "tp" : "sl", pnl, ...over });
const open = (over = {}) => ({ id: String(Math.random()), timestamp: todayMs(9), traded: true, result: "open", pair: "XAUUSD", dir: "buy", lot: 0.02, entry: 2000, sl: 1990, ...over });

test("built-in values: gold 100, EURUSD 100000, USDJPY from the price, others unknown", () => {
  const s = settings({});
  assert.equal(valueFor(s, "XAUUSD"), 100);
  assert.equal(valueFor(s, "eurusd"), 100000);
  assert.equal(valueFor(s, "USDJPY", 150), 100000 / 150);
  assert.equal(valueFor(s, "USDJPY"), null); // needs a price
  assert.equal(valueFor(s, "US30"), null);
  assert.equal(valueFor(s, ""), null);
});

test("a value typed in Settings wins over the built-in one", () => {
  const s = settings({}, { pairs: [{ pair: "XAUUSD", lot: 0.02, value: 10 }, { pair: "US30", lot: 0.1, value: 1 }] });
  assert.equal(valueFor(s, "XAUUSD"), 10);
  assert.equal(valueFor(s, "US30"), 1);
});

test("a pair listed without a value falls back to the built-in one", () => {
  const s = settings({}, { pairs: [{ pair: "XAUUSD", lot: 0.02, value: null }] });
  assert.equal(valueFor(s, "XAUUSD"), 100);
});

test("trade risk is distance x lot x value", () => {
  const s = settings({});
  assert.equal(tradeRisk({ pair: "XAUUSD", entry: 2000, sl: 1990, lot: 0.02 }, s), 20);
  assert.ok(Math.abs(tradeRisk({ pair: "EURUSD", entry: 1.085, sl: 1.084, lot: 0.2 }, s) - 20) < 1e-9);
  assert.ok(Math.abs(tradeRisk({ pair: "USDJPY", entry: 150, sl: 149.5, lot: 0.1 }, s) - (0.5 * 0.1 * 100000) / 150) < 1e-9);
  assert.equal(tradeRisk({ pair: "XAUUSD", entry: 2000, sl: null, lot: 0.02 }, s), null);
  assert.equal(tradeRisk({ pair: "US30", entry: 40000, sl: 39990, lot: 1 }, s), null);
});

test("the example: +30 today with a daily limit of 20 leaves 50 to risk", () => {
  const st = lossStatus([closed(30)], settings({ daily: 20 }), NOW);
  assert.equal(st.daily.remaining, 50);
  assert.equal(st.overall, null);
});

test("a loss uses up the limit: -15 today with a daily limit of 20 leaves 5", () => {
  assert.equal(lossStatus([closed(-15)], settings({ daily: 20 }), NOW).daily.remaining, 5);
});

test("daily counts only today; overall counts every trade, or only those since the chosen date", () => {
  const old = closed(-100, { timestamp: todayMs(9) - 3 * DAY, closedAt: todayMs(9) - 3 * DAY });
  const all = [old, closed(-10)];
  const a = lossStatus(all, settings({ daily: 50, overall: 500 }), NOW);
  assert.equal(a.daily.remaining, 40);
  assert.equal(a.overall.remaining, 390);
  const b = lossStatus(all, settings({ daily: 50, overall: 500, since: todayMs(0) }), NOW);
  assert.equal(b.overall.remaining, 490);
});

test("open trades count at their full SL risk, and unknown ones are reported", () => {
  const st = lossStatus([open(), open({ pair: "US30", entry: 40000, sl: 39990, lot: 1 })], settings({ daily: 100 }), NOW);
  assert.equal(st.openRisk, 20);
  assert.equal(st.unknownOpen, 1);
  assert.equal(st.daily.remaining, 80);
});

test("skipped trades and trades without an amount change nothing", () => {
  const st = lossStatus([closed(-50, { traded: false }), closed(-50, { pnl: null })], settings({ daily: 100 }), NOW);
  assert.equal(st.daily.remaining, 100);
});

// ---- the checklist rule ----
const SELF = RULES.filter((r) => r.type === "self");
const answers = Object.fromEntries(SELF.map((r) => [r.id, true]));
const form = { pair: "XAUUSD", dir: "buy", setup: "fvg", lot: 0.02, entry: 2000, sl: 1990, tp: 2020 }; // risks 20
const run = (limits, entries = [], over = {}, extra = {}) => evaluate({ f: { ...form, ...over }, answers, entries, settings: settings(limits, extra), now: NOW });

test("no limits set: the rule passes and the trade is OK", () => {
  const r = run({});
  assert.equal(r.res[33].pass, true);
  assert.equal(r.ok, true);
});

test("a trade that fits passes and the text shows risk and what is left", () => {
  const r = run({ daily: 50, overall: 1000 });
  assert.equal(r.res[33].pass, true);
  assert.match(r.res[33].detail, /Risk \$20\.00/);
  assert.match(r.res[33].detail, /daily left \$50\.00/);
  assert.match(r.res[33].detail, /overall left \$1,000\.00/);
  assert.equal(r.ok, true);
});

test("a trade bigger than what is left is blocked, naming the limit", () => {
  const r = run({ daily: 20 }, [closed(-5)]); // 15 left, trade risks 20
  assert.equal(r.res[33].pass, false);
  assert.match(r.res[33].detail, /Daily: this trade risks \$20\.00 but only \$15\.00 is left/);
  assert.equal(r.ok, false);
  assert.ok(r.failed.includes(33));
});

test("profit gives room back: +30 with a limit of 20 allows a risk of 50", () => {
  assert.equal(run({ daily: 20 }, [closed(30)], { sl: 1975 }).res[33].pass, true); // risk 50
  assert.equal(run({ daily: 20 }, [closed(30)], { sl: 1974 }).res[33].pass, false); // risk 52
});

test("the overall limit blocks even when the daily one is fine", () => {
  const yesterday = closed(-15, { timestamp: todayMs(9) - DAY, closedAt: todayMs(9) - DAY });
  const r = run({ daily: 500, overall: 30 }, [yesterday]);
  assert.equal(r.res[33].pass, false);
  assert.match(r.res[33].detail, /Overall: this trade risks \$20\.00 but only \$15\.00 is left/);
});

test("a spent limit blocks any trade, even before entry and SL are filled in", () => {
  const r = run({ daily: 20 }, [closed(-20)], { entry: null, sl: null });
  assert.equal(r.res[33].pass, false);
  assert.match(r.res[33].detail, /Daily loss limit reached/);
});

test("waits for entry, SL and lot before it can judge", () => {
  assert.equal(run({ daily: 50 }, [], { sl: null }).res[33].pass, null);
  assert.equal(run({ daily: 50 }, [], { lot: null }).res[33].pass, null);
});

test("an unknown pair value fails with a clear message instead of passing silently", () => {
  const r = run({ daily: 50 }, [], { pair: "US30", entry: 40000, sl: 39990 });
  assert.equal(r.res[33].pass, false);
  assert.match(r.res[33].detail, /Set the value for US30 in Settings/);
});

test("open trades reduce what is left", () => {
  const r = run({ daily: 30 }, [open()]); // the open trade risks 20, so 10 is left; the new one risks 20
  assert.equal(r.res[33].pass, false);
  assert.match(r.res[33].detail, /only \$10\.00 is left/);
});

test("switching the rule off removes it from the verdict", () => {
  const r = run({ daily: 5 }, [], {}, { rules: { disabled: [33], custom: [], nextId: 1000 } });
  assert.equal(r.res[33].pass, false); // still computed
  assert.equal(r.ok, true); // but ignored
});

test("the value box fills itself in for built-in pairs and says Auto for USDJPY", () => {
  assert.equal(valueBox("XAUUSD", "").value, 100);
  assert.equal(valueBox("eurusd", "").value, 100000);
  assert.equal(valueBox("US30", "").value, "");
  assert.equal(valueBox("", "").value, "");
  assert.equal(valueBox("usd jpy", "").value, 666.67); // 100000 / 150, the fallback price
  assert.equal(valueBox("USDJPY", "", 125).value, 800); // 100000 / the latest USDJPY entry
  assert.match(valueBox("USDJPY", "").title, /Estimate/);
  assert.equal(valueBox("USDJPY", "700").title, undefined);
});

test("the USDJPY estimate follows the latest USDJPY entry in the journal", () => {
  assert.equal(usdjpyPrice([]), 150);
  assert.equal(usdjpyPrice([{ pair: "XAUUSD", entry: 2000, timestamp: 9 }]), 150);
  const list = [{ pair: "USDJPY", entry: 140, timestamp: 1 }, { pair: "usdjpy", entry: 155, timestamp: 5 }, { pair: "USDJPY", entry: null, timestamp: 9 }];
  assert.equal(usdjpyPrice(list), 155);
});

test("a typed value wins over the built-in one in the box", () => {
  assert.equal(valueBox("XAUUSD", "10").value, "10");
  assert.equal(valueBox("US30", "1").value, "1");
  assert.equal(valueBox("USDJPY", "700").value, "700");
});
