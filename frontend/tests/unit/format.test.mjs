import test from "node:test";
import assert from "node:assert/strict";
import { compactMoney, fmtMoney, fmtR, inWindow, isAtCost, isToday, minutesOf, num, signClass } from "../../src/lib/format.js";

const at = (h, m) => new Date(2026, 9, 26, h, m); // local time

test("num turns form text into numbers or null", () => {
  assert.equal(num(""), null);
  assert.equal(num(null), null);
  assert.equal(num(undefined), null);
  assert.equal(num("abc"), null);
  assert.equal(num("0"), 0);
  assert.equal(num("1.5"), 1.5);
  assert.equal(num("-2"), -2);
  assert.equal(num("1e3"), 1000);
  assert.equal(num(7), 7);
});

test("num treats blank or non-finite text as 'no value', not 0 or Infinity", () => {
  assert.equal(num("   "), null);
  assert.equal(num("\t"), null);
  assert.equal(num("Infinity"), null);
  assert.equal(num("-Infinity"), null);
  assert.equal(num("NaN"), null);
});

test("minutesOf", () => {
  assert.equal(minutesOf("00:00"), 0);
  assert.equal(minutesOf("12:30"), 750);
  assert.equal(minutesOf("23:59"), 1439);
});

test("inWindow: start is inclusive, end is exclusive", () => {
  assert.equal(inWindow("12:30", "17:30", at(12, 29)), false);
  assert.equal(inWindow("12:30", "17:30", at(12, 30)), true);
  assert.equal(inWindow("12:30", "17:30", at(17, 29)), true);
  assert.equal(inWindow("12:30", "17:30", at(17, 30)), false);
});

test("inWindow handles windows that cross midnight", () => {
  assert.equal(inWindow("22:00", "02:00", at(23, 0)), true);
  assert.equal(inWindow("22:00", "02:00", at(1, 59)), true);
  assert.equal(inWindow("22:00", "02:00", at(2, 0)), false);
  assert.equal(inWindow("22:00", "02:00", at(12, 0)), false);
  assert.equal(inWindow("22:00", "02:00", at(0, 0)), true);
});

test("inWindow with identical start and end is an empty window", () => {
  assert.equal(inWindow("10:00", "10:00", at(10, 0)), false);
  assert.equal(inWindow("10:00", "10:00", at(15, 0)), false);
});

test("fmtMoney signs and rounding", () => {
  assert.match(fmtMoney(24.5, "$"), /^\+\$24\.50$/);
  assert.match(fmtMoney(-12.345, "$"), /^−\$12\.3[45]$/);
  assert.equal(fmtMoney(0, "$"), "$0.00");
  assert.equal(fmtMoney(24.5, "$", false), "$24.50");
  assert.match(fmtMoney(1234567.891, "€"), /^\+€1.234.567.89$/);
});

test("fmtMoney never shows a minus sign for -0", () => {
  assert.equal(fmtMoney(-0, "$"), "$0.00");
});

test("fmtR", () => {
  assert.equal(fmtR(2), "+2.00R");
  assert.equal(fmtR(-1), "−1.00R");
  assert.equal(fmtR(0), "0.00R");
  assert.equal(fmtR(1.256), "+1.26R");
});

test("compactMoney for calendar cells", () => {
  assert.equal(compactMoney(5), "+5");
  assert.equal(compactMoney(99.5), "+99.5");
  assert.equal(compactMoney(150), "+150");
  assert.equal(compactMoney(1000), "+1k");
  assert.equal(compactMoney(1250), "+1.3k");
  assert.equal(compactMoney(-2500), "−2.5k");
  assert.equal(compactMoney(-0.04), "−0");
});

test("signClass and isAtCost", () => {
  assert.equal(signClass(3), "pos");
  assert.equal(signClass(-3), "neg");
  assert.equal(signClass(0), "");
  assert.equal(isAtCost("be"), true);
  assert.equal(isAtCost("ctc"), true);
  assert.equal(isAtCost("tp"), false);
});

test("isToday", () => {
  assert.equal(isToday(Date.now()), true);
  assert.equal(isToday(Date.now() - 3 * 86400000), false);
});
