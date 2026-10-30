import test from "node:test";
import assert from "node:assert/strict";
import { clampPage, fmtSize, progressLabel } from "../../src/lib/books.js";

test("fmtSize", () => {
  assert.equal(fmtSize(0), "1 KB");
  assert.equal(fmtSize(512 * 1024), "512 KB");
  assert.equal(fmtSize(1024 * 1024), "1.0 MB");
  assert.equal(fmtSize(2.5 * 1024 * 1024), "2.5 MB");
  assert.equal(fmtSize(12.4 * 1024 * 1024), "12 MB");
});

test("clampPage keeps the page inside the book", () => {
  assert.equal(clampPage(5, 10), 5);
  assert.equal(clampPage(0, 10), 1);
  assert.equal(clampPage(-3, 10), 1);
  assert.equal(clampPage(99, 10), 10);
  assert.equal(clampPage("7", 10), 7);
  assert.equal(clampPage("abc", 10), 1);
  assert.equal(clampPage(2.6, 10), 3);
  assert.equal(clampPage(4, 0), 1);
});

test("progressLabel", () => {
  assert.equal(progressLabel(1, 100), "Not started");
  assert.equal(progressLabel(0, 100), "Not started");
  assert.equal(progressLabel(37, 210), "Page 37 of 210");
  assert.equal(progressLabel(37, 0), "Page 37");
});
