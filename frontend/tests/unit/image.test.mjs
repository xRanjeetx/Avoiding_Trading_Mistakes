import test from "node:test";
import assert from "node:assert/strict";
import { fitSize, MAX_SIDE } from "../../src/lib/image.js";

test("fitSize shrinks the longest side to the limit and keeps the aspect ratio", () => {
  assert.deepEqual(fitSize(3200, 1600), { width: 1600, height: 800 });
  assert.deepEqual(fitSize(1000, 4000, 2000), { width: 500, height: 2000 });
  assert.deepEqual(fitSize(2400, 2400), { width: MAX_SIDE, height: MAX_SIDE });
});

test("fitSize never enlarges a small image", () => {
  assert.deepEqual(fitSize(800, 600), { width: 800, height: 600 });
  assert.deepEqual(fitSize(MAX_SIDE, 10), { width: MAX_SIDE, height: 10 });
});

test("fitSize never returns a zero side", () => {
  assert.deepEqual(fitSize(10000, 1), { width: 1600, height: 1 });
});
