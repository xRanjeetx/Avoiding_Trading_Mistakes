import test from "node:test";
import assert from "node:assert/strict";
import { dueReminders } from "../../src/lib/reminders.js";

const settings = {};
const prefs = { on: true, lead: 5, longMin: 120 };
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
