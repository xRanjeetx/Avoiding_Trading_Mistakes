import test from "node:test";
import assert from "node:assert/strict";
import { autoTp } from "../../src/lib/takeProfit.js";

test("buy puts the take profit above the entry at 1:2", () => {
  assert.equal(autoTp("buy", "1.0850", "1.0800"), "1.0950");
  assert.equal(autoTp("buy", "2650.50", "2648.25"), "2655.00");
});

test("sell puts the take profit below the entry at 1:2", () => {
  assert.equal(autoTp("sell", "1.0800", "1.0850"), "1.0700");
  assert.equal(autoTp("sell", "150", "150.5"), "149.0");
});

test("a custom ratio works", () => {
  assert.equal(autoTp("buy", "100", "99", 3), "103");
});

test("nothing is filled until direction, entry and stop make sense", () => {
  assert.equal(autoTp(null, "1.08", "1.07"), "");
  assert.equal(autoTp("buy", "", "1.07"), "");
  assert.equal(autoTp("buy", "1.08", ""), "");
  assert.equal(autoTp("buy", "1.07", "1.08"), ""); // stop above the entry on a buy
  assert.equal(autoTp("sell", "1.07", "1.07"), "");
});
