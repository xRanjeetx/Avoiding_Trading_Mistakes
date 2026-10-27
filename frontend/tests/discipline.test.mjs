import test from "node:test";
import assert from "node:assert/strict";
import { computeDiscipline } from "../src/lib/discipline.js";

const settings = { maxTrades: 4, maxSL: 2 }; // default sessions apply
const NOW = new Date("2026-10-27T18:00:00Z");
// Tuesday 27 Oct 2026 is EDT (UTC-4): 12:00Z is 08:00 in New York, inside the New York session.
const at = (iso) => new Date(iso).getTime();
let n = 0;
const t = (iso, over = {}) => ({ id: `t${++n}`, timestamp: at(iso), closedAt: at(iso) + 30 * 60000, pair: "XAUUSD", traded: true, result: "tp", pnl: 10, ...over });
const inSession = "2026-10-27T12:00:00Z";  // 08:00 New York
const outSession = "2026-10-27T09:00:00Z"; // 05:00 New York, between London and New York

test("no closed trades: no score", () => {
  const d = computeDiscipline([], settings, NOW);
  assert.equal(d.score, null);
  assert.equal(d.tradeStreak, 0);
});

test("clean trades give 100 and build a streak, win or lose", () => {
  const d = computeDiscipline([t(inSession), t("2026-10-27T13:00:00Z", { result: "sl", pnl: -10, pair: "EURUSD" })], settings, NOW);
  assert.equal(d.score, 100);
  assert.equal(d.grade, "Elite");
  assert.equal(d.tradeStreak, 2);
  assert.equal(d.goodLosses, 1);
});

test("each habit is detected and breaks the streak", () => {
  const d = computeDiscipline([
    t(inSession),
    t(outSession, { pair: "A" }),                      // session
    t("2026-10-27T13:30:00Z", { result: "manual", pair: "B" }), // plan
    t("2026-10-27T14:00:00Z", { pair: "C" }),          // clean again
  ], settings, NOW);
  assert.equal(d.slips.session, 1);
  assert.equal(d.slips.plan, 1);
  assert.equal(d.score, 50);
  assert.equal(d.tradeStreak, 1);
  assert.equal(d.bestTradeStreak, 1);
  assert.equal(d.badWins, 2); // the out-of-session win and the manually closed win
});

test("re-entering a pair within 10 minutes of its loss is a revenge slip, another pair is not", () => {
  const loss = t(inSession, { result: "sl", pnl: -10, closedAt: at(inSession) + 5 * 60000 });
  const quick = t("2026-10-27T12:12:00Z");                  // 7 min after the loss closed
  const other = t("2026-10-27T12:12:00Z", { pair: "EURUSD" });
  const later = t("2026-10-27T12:20:00Z", { pair: "XAUUSD" }); // 15 min after the loss
  const d = computeDiscipline([loss, quick, other, later], settings, NOW);
  assert.equal(d.slips.calm, 1);
});

test("daily limits: a trade after the max SL, or beyond the max trades, is a slip", () => {
  const sl = (iso, pair) => t(iso, { result: "sl", pnl: -1, closedAt: at(iso) + 60000, pair });
  const d = computeDiscipline([sl("2026-10-27T12:00:00Z", "P1"), sl("2026-10-27T12:30:00Z", "P2"), t("2026-10-27T13:00:00Z", { pair: "Z" })], settings, NOW);
  assert.equal(d.slips.limits, 1); // the third trade, after 2 SL
  const many = ["12:00", "12:20", "12:40", "13:00", "13:20"].map((h, i) => t(`2026-10-27T${h}:00Z`, { pair: `Q${i}` }));
  assert.equal(computeDiscipline(many, { maxTrades: 4, maxSL: 9 }, NOW).slips.limits, 1); // the fifth trade
});

test("day streak counts clean trading days and skips days with no trades", () => {
  const day = (d, over = {}) => t(`2026-10-${d}T12:00:00Z`, over); // 20 Tue, 21 Wed, 22 Thu, 23 Fri, 27 Tue (all 08:00 New York)
  const d = computeDiscipline([day(20), day(21), day(22, { result: "manual" }), day(23), day(27)], settings, NOW);
  assert.equal(d.dayStreak, 2); // the 23rd and the 27th (the weekend is skipped)
  assert.equal(d.bestDayStreak, 2);
});

test("only the last 30 days feed the score; open and skipped trades are ignored", () => {
  const old = t("2026-08-04T12:00:00Z", { result: "manual" });
  const d = computeDiscipline([old, t(inSession), t(inSession, { result: "open", closedAt: null }), t(inSession, { traded: false })], settings, NOW);
  assert.equal(d.windowN, 1);
  assert.equal(d.score, 100);
  assert.equal(d.n, 2);
});

test("with every session switched off the session habit is not judged", () => {
  const off = ["asian", "london", "newyork", "londonclose"].map((key) => ({ key, start: "00:00", end: "23:59", on: false, color: "#000000" }));
  assert.equal(computeDiscipline([t(outSession)], { ...settings, killzones: off }, NOW).slips.session, 0);
});
