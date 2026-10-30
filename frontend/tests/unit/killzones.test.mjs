import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_KILLZONES, activeZones, fmtDuration, marketStatus, minutesLeft, nextZone, normalizeKillzones, nyClock, nyToLocal,
} from "../../src/lib/killzones.js";

const Z = DEFAULT_KILLZONES;
const at = (iso) => new Date(iso);
const keys = (zones) => zones.map((z) => z.key);

test("New York clock follows daylight saving", () => {
  assert.equal(nyClock(at("2026-10-27T14:00:00Z")).label, "10:00"); // EDT, UTC-4
  assert.equal(nyClock(at("2026-11-02T15:00:00Z")).label, "10:00"); // EST, UTC-5 (clocks changed on 1 Nov)
  assert.equal(nyClock(at("2026-07-01T04:00:00Z")).label, "00:00");
});

test("each default session is live inside its window", () => {
  assert.deepEqual(keys(activeZones(Z, at("2026-10-27T06:30:00Z"))), ["london"]);       // 02:30 NY
  assert.deepEqual(keys(activeZones(Z, at("2026-10-27T11:00:00Z"))), ["newyork"]);      // 07:00 NY
  assert.deepEqual(keys(activeZones(Z, at("2026-10-27T14:00:00Z"))), ["londonclose"]);  // 10:00 NY
  assert.deepEqual(keys(activeZones(Z, at("2026-10-28T03:00:00Z"))), ["asian"]);        // 23:00 NY
});

test("window end is exclusive and a gap has no live session", () => {
  assert.deepEqual(activeZones(Z, at("2026-10-27T16:00:00Z")), []);  // 12:00 NY, London Close just ended
  assert.deepEqual(activeZones(Z, at("2026-10-28T04:00:00Z")), []);  // 00:00 NY, Asian ended, London not yet open
  assert.deepEqual(activeZones(Z, at("2026-10-27T23:59:00Z")), []);  // 19:59 NY, Asian not open yet
});

test("Asian runs from 20:00 until midnight New York time", () => {
  assert.deepEqual(keys(activeZones(Z, at("2026-10-28T00:00:00Z"))), ["asian"]); // 20:00 NY, start is inclusive
  assert.deepEqual(keys(activeZones(Z, at("2026-10-28T03:59:00Z"))), ["asian"]); // 23:59 NY
});

test("a switched-off session is never live or next", () => {
  const off = Z.map((z) => (z.key === "newyork" ? { ...z, on: false } : z));
  assert.deepEqual(activeZones(off, at("2026-10-27T11:00:00Z")), []);
  assert.notEqual(nextZone(off, at("2026-10-27T09:00:00Z")).zone.key, "newyork");
});

test("time left and next session", () => {
  const now = at("2026-10-27T11:20:00Z"); // 07:20 NY, New York live until 10:00
  const [live] = activeZones(Z, now);
  assert.equal(minutesLeft(live, now), 160);
  assert.equal(fmtDuration(160), "2h 40m");
  const n = nextZone(Z, now); // London Close opens at 10:00
  assert.equal(n.zone.key, "londonclose");
  assert.equal(n.inMin, 160);
  assert.equal(fmtDuration(45), "45m");
  assert.equal(fmtDuration(120), "2h");
});

test("next session wraps past midnight", () => {
  const n = nextZone(Z, at("2026-10-28T05:00:00Z")); // 01:00 NY, London opens at 02:00
  assert.equal(n.zone.key, "london");
  assert.equal(n.inMin, 60);
});

test("New York time converts to the user's clock", () => {
  const now = at("2026-10-27T14:00:00Z"); // 10:00 in New York
  const local = new Date(now);
  const hhmm = `${String(local.getHours()).padStart(2, "0")}:${String(local.getMinutes()).padStart(2, "0")}`;
  assert.equal(nyToLocal("10:00", now), hhmm);
});

test("normalizeKillzones repairs missing or bad saved data", () => {
  assert.deepEqual(normalizeKillzones(undefined), Z);
  assert.deepEqual(normalizeKillzones([]), Z);
  const r = normalizeKillzones([{ key: "london", start: "09:00", end: "bad", on: false, color: "#abcdef" }, { key: "nope" }]);
  assert.equal(r.length, 4);
  const l = r.find((z) => z.key === "london");
  assert.deepEqual(l, { key: "london", start: "09:00", end: "05:00", on: false, color: "#abcdef" });
});

test("the market is closed from Friday 17:00 to Sunday 17:00 New York time", () => {
  // Fri 30 Oct 2026 (EDT, UTC-4)
  assert.deepEqual(keys(activeZones(Z, at("2026-10-30T14:30:00Z"))), ["londonclose"]);  // Fri 10:30, still open
  assert.equal(marketStatus(at("2026-10-30T20:59:00Z")).open, true);                      // Fri 16:59
  assert.deepEqual(marketStatus(at("2026-10-30T21:00:00Z")), { open: false, reopensInMin: 2880 }); // Fri 17:00, back in 48h
  assert.deepEqual(activeZones(Z, at("2026-10-31T00:30:00Z")), []);                       // Fri 20:30: Asian window, but closed
  // Saturday: nothing is live at any hour
  assert.deepEqual(activeZones(Z, at("2026-10-31T15:00:00Z")), []);                       // Sat 11:00
  assert.deepEqual(marketStatus(at("2026-10-31T15:00:00Z")), { open: false, reopensInMin: 1800 });
  assert.deepEqual(activeZones(Z, at("2026-10-31T06:30:00Z")), []);                       // Sat 02:30, London window
  // Sunday: closed until 17:00, then the Asian session opens at 20:00
  assert.deepEqual(activeZones(Z, at("2026-10-25T14:00:00Z")), []);                       // Sun 10:00, London Close window
  assert.equal(marketStatus(at("2026-10-25T20:59:00Z")).open, false);                     // Sun 16:59
  assert.equal(marketStatus(at("2026-10-25T21:00:00Z")).open, true);                      // Sun 17:00
  assert.deepEqual(activeZones(Z, at("2026-10-25T21:00:00Z")), []);                       // Sun 17:00: market open, but no session until 20:00
  assert.deepEqual(keys(activeZones(Z, at("2026-10-26T00:30:00Z"))), ["asian"]);          // Sun 20:30
  assert.deepEqual(keys(activeZones(Z, at("2026-10-26T06:30:00Z"))), ["london"]);         // Mon 02:30
});

test("the next session skips the weekend", () => {
  const n = nextZone(Z, at("2026-10-30T19:00:00Z")); // Fri 15:00 New York
  assert.equal(n.zone.key, "asian");                 // Friday's 20:00 Asian is closed; Sunday's 20:00 is the next opening
  assert.equal(n.inMin, 3180);
  assert.equal(fmtDuration(3180), "2d 5h");
  assert.equal(fmtDuration(2880), "2d");
  const sat = nextZone(Z, at("2026-10-31T15:00:00Z")); // Sat 11:00
  assert.equal(sat.zone.key, "asian");
  assert.equal(sat.inMin, 33 * 60);                    // Sun 20:00
});

