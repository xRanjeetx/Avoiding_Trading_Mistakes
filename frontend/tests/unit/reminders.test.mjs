import test from "node:test";
import assert from "node:assert/strict";
import { ctcPrice, dueReminders } from "../../src/lib/reminders.js";

const settings = {};
const prefs = { on: true, lead: 5, closeLead: 5, longMin: 120 };
const BEFORE_NY = "2026-10-27T10:55:00Z"; // 06:55 in New York, 5 min before the 07:00 New York session

test("nothing is due when reminders are off", () => {
  assert.deepEqual(dueReminders({ entries: [], settings, prefs: { ...prefs, on: false }, now: new Date(BEFORE_NY) }), []);
});

test("a session about to open is announced inside the lead time, once per day", () => {
  const a = dueReminders({ entries: [], settings, prefs, now: new Date(BEFORE_NY) });
  assert.equal(a.length, 1);
  assert.match(a[0].title, /New York session opens in 5m/);
  const b = dueReminders({ entries: [], settings, prefs, now: new Date("2026-10-27T10:56:40Z") }); // a later tick
  assert.equal(b[0].key, a[0].key);
  assert.deepEqual(dueReminders({ entries: [], settings, prefs, now: new Date("2026-10-27T10:40:00Z") }), []); // too early
  const tomorrow = dueReminders({ entries: [], settings, prefs, now: new Date("2026-10-28T10:55:00Z") });
  assert.notEqual(tomorrow[0].key, a[0].key);
});

test("a trade open too long is reminded, and again each further interval", () => {
  const open = { id: "e1", traded: true, result: "open", pair: "XAUUSD", dir: "buy", timestamp: Date.parse("2026-10-27T13:00:00Z") };
  const long = (iso, e = open) => dueReminders({ entries: [e], settings, prefs, now: new Date(iso) }).filter((r) => r.key.startsWith("long"));
  assert.equal(long("2026-10-27T14:30:00Z").length, 0);
  const first = long("2026-10-27T15:00:00Z");
  assert.equal(first.length, 1);
  assert.match(first[0].title, /XAUUSD BUY open for 2h/);
  assert.equal(long("2026-10-27T15:30:00Z")[0].key, first[0].key); // same interval: same key, so it is not re-sent
  assert.notEqual(long("2026-10-27T17:00:00Z")[0].key, first[0].key);
  assert.equal(long("2026-10-27T17:00:00Z", { ...open, result: "tp" }).length, 0);
});

test("an open trade reminder tells you to keep CTC at 1.5 RR and gives the price", () => {
  const open = { id: "e1", traded: true, result: "open", pair: "XAUUSD", dir: "buy", entry: 4600, sl: 4590, timestamp: Date.parse("2026-10-27T13:00:00Z") };
  const [r] = dueReminders({ entries: [open], settings, prefs, now: new Date("2026-10-27T15:00:00Z") }).filter((x) => x.key.startsWith("long"));
  assert.match(r.body, /1\.5 RR \(4615\.00\), move your SL to cost \(CTC\)/);
  const bare = { ...open, entry: null, sl: null };
  assert.match(dueReminders({ entries: [bare], settings, prefs, now: new Date("2026-10-27T15:00:00Z") }).find((x) => x.key.startsWith("long")).body, /reached 1\.5 RR, move your SL/);
});

test("the 1.5 RR price points the right way and keeps the entry's decimals", () => {
  assert.equal(ctcPrice({ dir: "buy", entry: 1.0850, sl: 1.0800 }), "1.0925");
  assert.equal(ctcPrice({ dir: "sell", entry: 4600, sl: 4610 }), "4585.00");
  assert.equal(ctcPrice({ dir: "buy", entry: 1, sl: 1 }), null);
  assert.equal(ctcPrice({ dir: null, entry: 1, sl: 2 }), null);
});

test("a session about to close is announced inside the lead time, once per day", () => {
  const near = new Date("2026-10-27T08:56:00Z"); // 04:56 NY, London ends 05:00
  const [a] = dueReminders({ entries: [], settings, prefs, now: near });
  assert.match(a.title, /London session closes in 4m/);
  assert.equal(dueReminders({ entries: [], settings, prefs, now: new Date("2026-10-27T08:58:00Z") })[0].key, a.key);
  assert.deepEqual(dueReminders({ entries: [], settings, prefs, now: new Date("2026-10-27T08:30:00Z") }), []); // 30 min left
  assert.notEqual(dueReminders({ entries: [], settings, prefs, now: new Date("2026-10-28T08:56:00Z") })[0].key, a.key);
  assert.deepEqual(dueReminders({ entries: [], settings, prefs: { ...prefs, on: false }, now: near }), []);
});

test("the Asian session, which ends at midnight, gets its own close alert", () => {
  const [a] = dueReminders({ entries: [], settings, prefs, now: new Date("2026-10-28T03:56:00Z") }); // 23:56 NY
  assert.match(a.title, /Asian session closes in 4m/);
});
