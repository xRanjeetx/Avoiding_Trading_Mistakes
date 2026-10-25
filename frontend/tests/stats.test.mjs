import test from "node:test";
import assert from "node:assert/strict";
import { computeStats, dailyPnl, inRange, outcome, tradeR, ymd } from "../src/lib/stats.js";

const D = 86400000;
let n = 0;
// Builds a closed trade. `day` shifts the close date; times are local so weekday checks are stable.
const mk = (over = {}) => {
  n += 1;
  return {
    id: `t${n}`, timestamp: new Date(2026, 9, 5 + (over.day ?? 0), 9, 0).getTime(), pair: "XAUUSD", dir: "buy", setup: "fvg",
    lot: 0.02, entry: 100, sl: 98, tp: 104, rr: 2, traded: true, result: "tp", pnl: 20, exit: null, closedAt: null, ...over,
  };
};

test("outcome prefers real P&L over the result label", () => {
  assert.equal(outcome(mk({ result: "tp", pnl: 20 })), "win");
  assert.equal(outcome(mk({ result: "tp", pnl: -5 })), "loss");
  assert.equal(outcome(mk({ result: "manual", pnl: 0 })), "be");
  assert.equal(outcome(mk({ result: "tp", pnl: null })), "win");
  assert.equal(outcome(mk({ result: "sl", pnl: null })), "loss");
  assert.equal(outcome(mk({ result: "ctc", pnl: null })), "be");
  assert.equal(outcome(mk({ result: "open", pnl: null })), "open");
  assert.equal(outcome(mk({ traded: false })), "skipped");
});

test("tradeR: from exit price, planned RR, or result", () => {
  assert.equal(tradeR(mk({ result: "open" })), null);
  assert.equal(tradeR(mk({ traded: false })), null);
  assert.equal(tradeR(mk({ result: "tp", exit: 104 })), 2);                       // buy: (104-100)/2
  assert.equal(tradeR(mk({ result: "sl", exit: 98 })), -1);
  assert.equal(tradeR(mk({ dir: "sell", entry: 100, sl: 102, exit: 96, result: "tp" })), 2); // sell wins when price falls
  assert.equal(tradeR(mk({ dir: "sell", entry: 100, sl: 102, exit: 103, result: "manual" })), -1.5);
  assert.equal(tradeR(mk({ result: "tp", exit: null, rr: 2.5 })), 2.5);
  assert.equal(tradeR(mk({ result: "sl", exit: null })), -1);
  assert.equal(tradeR(mk({ result: "be", exit: null, pnl: 0 })), 0);
  assert.equal(tradeR(mk({ result: "manual", exit: null, pnl: 7 })), null);       // no way to know the R
  assert.equal(tradeR(mk({ result: "tp", exit: 104, sl: 100, rr: 2 })), 2);      // entry === sl: no division by zero, falls back to planned RR
});

test("empty journal gives safe defaults", () => {
  const s = computeStats([]);
  assert.equal(s.n, 0);
  assert.equal(s.winRate, null);
  assert.equal(s.profitFactor, null);
  assert.equal(s.avgWin, null);
  assert.equal(s.avgLoss, null);
  assert.equal(s.totalR, null);
  assert.equal(s.maxDD, 0);
  assert.equal(s.hasPnl, false);
  assert.equal(s.equity.length, 1);
  assert.deepEqual(s.byWeekday, [0, 0, 0, 0, 0, 0, 0]);
  assert.equal(s.byResult.open, 0);
});

test("only open trades: nothing closed, open counted", () => {
  const s = computeStats([mk({ result: "open", pnl: null }), mk({ result: "open", pnl: null })]);
  assert.equal(s.n, 0);
  assert.equal(s.byResult.open, 2);
  assert.equal(s.winRate, null);
});

test("headline numbers for a realistic month", () => {
  const trades = [
    mk({ day: 0, pnl: 40 }), mk({ day: 1, pnl: -20, result: "sl" }), mk({ day: 2, pnl: 40 }),
    mk({ day: 3, pnl: -20, result: "sl" }), mk({ day: 4, pnl: 0, result: "be" }), mk({ day: 7, pnl: 40 }),
  ];
  const s = computeStats(trades);
  assert.equal(s.n, 6);
  assert.deepEqual([s.wins, s.losses, s.be], [3, 2, 1]);
  assert.equal(s.winRate, 3 / 5);                 // break-even does not count in the win rate
  assert.equal(s.net, 80);
  assert.equal(s.grossWin, 120);
  assert.equal(s.grossLoss, 40);
  assert.equal(s.profitFactor, 3);
  assert.equal(s.avgWin, 40);
  assert.equal(s.avgLoss, 20);
  assert.equal(s.best, 40);
  assert.equal(s.worst, -20);
  assert.equal(s.expectancy, 80 / 6);
});

test("profit factor: Infinity with no losses, null with nothing at all", () => {
  assert.equal(computeStats([mk({ pnl: 10 })]).profitFactor, Infinity);
  assert.equal(computeStats([mk({ pnl: 0, result: "be" })]).profitFactor, null);
  assert.equal(computeStats([mk({ pnl: -10, result: "sl" })]).profitFactor, 0);
});

test("equity curve and max drawdown follow close order, not insertion order", () => {
  const s = computeStats([
    mk({ day: 3, pnl: 30 }), mk({ day: 0, pnl: 50 }), mk({ day: 1, pnl: -40 }), mk({ day: 2, pnl: -30 }),
  ]);
  assert.deepEqual(s.equity.map((p) => p.v), [0, 50, 10, -20, 10]);
  assert.equal(s.maxDD, 70); // peak 50 -> trough -20
});

test("a closedAt later than the open time moves the trade in the curve", () => {
  const a = mk({ day: 0, pnl: 10, closedAt: new Date(2026, 9, 20).getTime() });
  const b = mk({ day: 1, pnl: -5 });
  assert.deepEqual(computeStats([a, b]).equity.map((p) => p.v), [0, -5, 5]);
});

test("streaks: break-even neither extends nor breaks, CTC streak is separate", () => {
  const seq = [["tp", 10], ["tp", 10], ["be", 0], ["tp", 10], ["sl", -5], ["sl", -5], ["ctc", 0], ["ctc", 0], ["tp", 10]];
  const s = computeStats(seq.map(([result, pnl], i) => mk({ day: i, result, pnl })));
  assert.equal(s.maxWinStreak, 3);
  assert.equal(s.maxLossStreak, 2);
  assert.equal(s.maxCtcStreak, 2);
  assert.equal(s.curWinStreak, 1);
  assert.equal(s.curLossStreak, 0);
  assert.equal(s.curCtcStreak, 0);
});

test("current streaks reflect the latest trades", () => {
  const s = computeStats([mk({ day: 0, pnl: 5 }), mk({ day: 1, result: "sl", pnl: -5 }), mk({ day: 2, result: "sl", pnl: -5 })]);
  assert.equal(s.curLossStreak, 2);
  assert.equal(s.curWinStreak, 0);
});

test("groups: by pair, by setup (untagged = none), by weekday (Monday = 0)", () => {
  const monday = new Date(2026, 9, 26, 10).getTime(); // Mon 26 Oct 2026
  const s = computeStats([
    mk({ pair: "XAUUSD", setup: "fvg", pnl: 30, timestamp: monday }),
    mk({ pair: "XAUUSD", setup: "wick", pnl: -10, result: "sl", timestamp: monday + D }),
    mk({ pair: "EURUSD", setup: null, pnl: 5, timestamp: monday + 6 * D }), // Sunday
    mk({ pair: "", setup: "fvg", pnl: 1, timestamp: monday + 2 * D }),
  ]);
  assert.equal(s.byPair.XAUUSD.n, 2);
  assert.equal(s.byPair.XAUUSD.pnl, 20);
  assert.equal(s.byPair.EURUSD.n, 1);
  assert.ok(s.byPair["—"]);
  assert.equal(s.bySetup.fvg.n, 2);
  assert.equal(s.bySetup.none.n, 1);
  assert.equal(s.byWeekday[0], 30);   // Monday
  assert.equal(s.byWeekday[1], -10);  // Tuesday
  assert.equal(s.byWeekday[6], 5);    // Sunday
  assert.equal(s.weekdayN[0], 1);
});

test("results breakdown counts every result type once", () => {
  const s = computeStats([
    mk({ result: "tp" }), mk({ result: "sl", pnl: -1 }), mk({ result: "be", pnl: 0 }), mk({ result: "ctc", pnl: 0 }),
    mk({ result: "manual", pnl: 3 }), mk({ result: "open", pnl: null }), mk({ traded: false, result: "tp" }),
  ]);
  assert.deepEqual(s.byResult, { tp: 1, sl: 1, be: 1, ctc: 1, manual: 1, open: 1 });
});

test("trades without a P&L amount still count, but do not create fake money", () => {
  const s = computeStats([mk({ result: "tp", pnl: null }), mk({ result: "sl", pnl: null })]);
  assert.equal(s.n, 2);
  assert.equal(s.hasPnl, false);
  assert.equal(s.net, 0);
  assert.equal(s.winRate, 0.5);
});

test("totalR uses exit prices and averages per trade", () => {
  const s = computeStats([mk({ result: "tp", exit: 104 }), mk({ result: "sl", exit: 98 })]);
  assert.equal(s.totalR, 1);
  assert.equal(s.avgR, 0.5);
});

test("dailyPnl groups by the day a trade was closed and skips open trades", () => {
  const d = dailyPnl([
    mk({ day: 0, pnl: 10 }), mk({ day: 0, pnl: -4, result: "sl" }), mk({ day: 1, pnl: 7 }),
    mk({ day: 1, result: "open", pnl: null }), mk({ day: 2, traded: false }),
  ]);
  const k0 = ymd(new Date(2026, 9, 5).getTime());
  const k1 = ymd(new Date(2026, 9, 6).getTime());
  assert.deepEqual(d[k0], { pnl: 6, n: 2 });
  assert.deepEqual(d[k1], { pnl: 7, n: 1 });
  assert.equal(Object.keys(d).length, 2);
});

test("inRange keeps recent trades; 0 means all time", () => {
  const now = Date.now();
  const old = mk({ timestamp: now - 40 * D });
  const recent = mk({ timestamp: now - 2 * D });
  assert.equal(inRange([old, recent], 0).length, 2);
  assert.deepEqual(inRange([old, recent], 7).map((e) => e.id), [recent.id]);
  assert.equal(inRange([old, recent], 90).length, 2);
  assert.equal(inRange([{ ...old, closedAt: now - D }], 7).length, 1); // closed recently although opened long ago
});

test("ymd pads month and day", () => {
  assert.equal(ymd(new Date(2026, 0, 5).getTime()), "2026-01-05");
  assert.equal(ymd(new Date(2026, 11, 31).getTime()), "2026-12-31");
});
