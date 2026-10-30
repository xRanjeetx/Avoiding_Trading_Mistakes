import test from "node:test";
import assert from "node:assert/strict";
import { parseCsv, toCsv } from "../../src/lib/csv.js";

const entry = (over = {}) => ({
  id: "e1", timestamp: Date.UTC(2026, 9, 5, 9, 0), pair: "XAUUSD", dir: "buy", setup: "fvg", lot: 0.02, entry: 100, sl: 98,
  tp: 104, rr: 2, traded: true, result: "tp", exit: 104, pnl: -12.5, closedAt: Date.UTC(2026, 9, 5, 10, 0),
  failedRules: [3, 7], answers: { 1: true, 2: false }, emotion: "calm", emotionAfter: "relieved", notes: "plain", lesson: "", ...over,
});

test("export then import gives back the same trades", () => {
  const list = [entry(), entry({ id: "e2", timestamp: Date.UTC(2026, 9, 6), pair: "EURUSD", dir: null, setup: null, pnl: null, exit: null, closedAt: null, result: "open", failedRules: [], answers: {}, emotion: null, emotionAfter: null })];
  assert.deepEqual(parseCsv(toCsv(list)), list.map((e) => ({ ...e, answers: JSON.parse(JSON.stringify(e.answers)) })));
});

test("commas, quotes and line breaks in notes survive", () => {
  const notes = 'said "wait", then\r\nentered, too early';
  const [back] = parseCsv(toCsv([entry({ notes, lesson: "line1\nline2" })]));
  assert.equal(back.notes, notes);
  assert.equal(back.lesson, "line1\nline2");
});

test("text that looks like a spreadsheet formula is neutralised in the file and restored on import", () => {
  const csv = toCsv([entry({ notes: "=HYPERLINK(\"http://evil\")", lesson: "-5 pips", pnl: -5 })]);
  const dataLine = csv.split("\r\n")[1];
  assert.ok(!/(^|,)=/.test(dataLine) && dataLine.includes("'=HYPERLINK"));
  assert.ok(dataLine.includes(",-5,"), "numbers keep their minus sign");
  const [back] = parseCsv(csv);
  assert.equal(back.notes, '=HYPERLINK("http://evil")');
  assert.equal(back.lesson, "-5 pips");
  assert.equal(back.pnl, -5);
});

test("a note that legitimately starts with an apostrophe is not altered", () => {
  const [back] = parseCsv(toCsv([entry({ notes: "'tis fine" })]));
  assert.equal(back.notes, "'tis fine");
});

test("Excel files: BOM, CRLF and a trailing blank line are accepted", () => {
  const csv = "﻿" + toCsv([entry()]) + "\r\n";
  assert.equal(parseCsv(csv).length, 1);
});

test("a minimal file with only date and pair works", () => {
  const [e] = parseCsv("date,pair\n2026-10-05T09:00:00Z,gbpusd\n");
  assert.equal(e.pair, "GBPUSD");
  assert.equal(e.timestamp, Date.UTC(2026, 9, 5, 9, 0));
  assert.equal(e.result, "open");
  assert.equal(e.traded, true);
  assert.equal(e.id, undefined);
});

test("bad files give readable errors", () => {
  assert.throws(() => parseCsv(""), /empty/);
  assert.throws(() => parseCsv("name,age\nbob,3\n"), /does not look like/);
  assert.throws(() => parseCsv("timestamp,pair\n"), /no trades/);
  assert.throws(() => parseCsv("timestamp,pnl\n1700000000000,abc\n"), /Row 2.*not a number/);
  assert.throws(() => parseCsv("timestamp,result\n1700000000000,banana\n"), /Row 2.*unknown result/);
  assert.throws(() => parseCsv("timestamp,pair\n1700000000000,\"oops\n"), /unclosed quote/);
  assert.throws(() => parseCsv("timestamp,pair\nnot-a-date,x\n"), /Row 2.*timestamp/);
});

test("ids that the API would reject are dropped so a new one is generated", () => {
  const [e] = parseCsv("id,timestamp\nbad id!,1700000000000\n");
  assert.equal(e.id, undefined);
});

test("emotion tags survive, and an unusable one is dropped instead of rejecting the file", () => {
  const [back] = parseCsv(toCsv([entry({ emotion: "fomo", emotionAfter: "regret" })]));
  assert.equal(back.emotion, "fomo");
  assert.equal(back.emotionAfter, "regret");
  const [odd] = parseCsv("timestamp,emotion,emotionAfter\n1700000000000,Very Happy!,\n");
  assert.equal(odd.emotion, null);
  assert.equal(odd.emotionAfter, null);
});
