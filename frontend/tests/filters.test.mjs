import test from "node:test";
import assert from "node:assert/strict";
import { NO_FILTER, filterEntries, isFiltered } from "../src/lib/filters.js";

// Local times, so the day keys match what the Journal shows.
const at = (d, h = 9) => new Date(2026, 9, d, h, 0).getTime();
const list = [
  { id: "a", timestamp: at(5), pair: "XAUUSD", setup: "fvg", traded: true, result: "tp", pnl: 20, notes: "Clean breakout", lesson: "" },
  { id: "b", timestamp: at(6), pair: "EURUSD", setup: "wick", traded: true, result: "sl", pnl: -10, notes: "", lesson: "Too early entry" },
  { id: "c", timestamp: at(7, 23), pair: "XAUUSD", setup: null, traded: true, result: "open", pnl: null, notes: "", lesson: "" },
  { id: "d", timestamp: at(8), pair: "GBPUSD", setup: "fvg", traded: false, result: "open", pnl: null, notes: "skipped, news", lesson: "" },
];
const ids = (f) => filterEntries(list, { ...NO_FILTER, ...f }).map((e) => e.id);

test("no filter returns everything", () => assert.deepEqual(ids({}), ["a", "b", "c", "d"]));

test("by result", () => {
  assert.deepEqual(ids({ result: "win" }), ["a"]);
  assert.deepEqual(ids({ result: "loss" }), ["b"]);
  assert.deepEqual(ids({ result: "open" }), ["c"]);
  assert.deepEqual(ids({ result: "skipped" }), ["d"]);
});

test("by pair and by setup, including untagged", () => {
  assert.deepEqual(ids({ pair: "XAUUSD" }), ["a", "c"]);
  assert.deepEqual(ids({ setup: "fvg" }), ["a", "d"]);
  assert.deepEqual(ids({ setup: "none" }), ["c"]);
});

test("date range includes both end days, even late in the evening", () => {
  assert.deepEqual(ids({ from: "2026-10-06", to: "2026-10-07" }), ["b", "c"]);
  assert.deepEqual(ids({ from: "2026-10-08" }), ["d"]);
  assert.deepEqual(ids({ to: "2026-10-05" }), ["a"]);
  assert.deepEqual(ids({ from: "2026-10-09" }), []);
});

test("search covers pair, notes and lessons, ignoring case", () => {
  assert.deepEqual(ids({ q: "BREAKOUT" }), ["a"]);
  assert.deepEqual(ids({ q: "too early" }), ["b"]);
  assert.deepEqual(ids({ q: "gbp" }), ["d"]);
  assert.deepEqual(ids({ q: "  news " }), ["d"]);
});

test("filters combine", () => {
  assert.deepEqual(ids({ pair: "XAUUSD", result: "win", from: "2026-10-01" }), ["a"]);
  assert.deepEqual(ids({ pair: "XAUUSD", result: "loss" }), []);
});

test("isFiltered", () => {
  assert.equal(isFiltered(NO_FILTER), false);
  assert.equal(isFiltered({ ...NO_FILTER, pair: "XAUUSD" }), true);
  assert.equal(isFiltered({ ...NO_FILTER, from: "2026-10-01" }), true);
});
