import { minutesOf } from "./format.js";

// Market sessions ("killzones"). Times are New York clock times, so daylight saving changes in
// New York need no manual edit; they are shown in the user's own time as well.
export const NY_TZ = "America/New_York";

export const KILLZONE_NAMES = { asian: "Asian", london: "London", newyork: "New York", londonclose: "London Close" };

export const DEFAULT_KILLZONES = [
  { key: "asian", start: "20:00", end: "00:00", on: true, color: "#06b6d4" },
  { key: "london", start: "02:00", end: "05:00", on: true, color: "#f59e0b" },
  { key: "newyork", start: "07:00", end: "10:00", on: true, color: "#a78bfa" },
  { key: "londonclose", start: "10:00", end: "12:00", on: true, color: "#ec4899" },
];

const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;
const COLOR = /^#[0-9a-fA-F]{6}$/;

// Saved list (maybe missing, partial or from an older version) merged over the defaults, always 4 valid rows.
export function normalizeKillzones(saved) {
  const byKey = new Map((Array.isArray(saved) ? saved : []).map((z) => [z?.key, z]));
  return DEFAULT_KILLZONES.map((d) => {
    const z = byKey.get(d.key) || {};
    return {
      key: d.key,
      start: CLOCK.test(z.start) ? z.start : d.start,
      end: CLOCK.test(z.end) ? z.end : d.end,
      on: typeof z.on === "boolean" ? z.on : d.on,
      color: COLOR.test(z.color) ? z.color : d.color,
    };
  });
}

const pad = (n) => String(n).padStart(2, "0");

// The New York wall clock at `now`, plus how far New York is from UTC at that moment (DST aware).
export function nyClock(now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: NY_TZ, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric",
    }).formatToParts(now).map((p) => [p.type, p.value]),
  );
  const [y, mo, d, h, mi] = [+parts.year, +parts.month, +parts.day, +parts.hour, +parts.minute];
  const wallAsUtc = Date.UTC(y, mo - 1, d, h, mi);
  const offsetMs = wallAsUtc - Math.floor(now.getTime() / 60000) * 60000;
  const day = new Date(Date.UTC(y, mo - 1, d)).getUTCDay(); // 0 = Sunday ... 6 = Saturday, in New York
  return { y, mo, d, day, minutes: h * 60 + mi, label: `${pad(h)}:${pad(mi)}`, offsetMs };
}

// The forex week: closed from Friday 17:00 to Sunday 17:00 New York time. No session counts as live in that gap.
const WEEK_CLOSE = 17 * 60; // minutes after midnight, on Friday
const WEEK_OPEN = 17 * 60;  // minutes after midnight, on Sunday
const closedAt = (day, minutes) => (day === 6) || (day === 5 && minutes >= WEEK_CLOSE) || (day === 0 && minutes < WEEK_OPEN);

// { open: true } during the week, or { open: false, reopensInMin } for the weekend.
export function marketStatus(now = new Date()) {
  const { day, minutes } = nyClock(now);
  if (!closedAt(day, minutes)) return { open: true };
  const toMidnight = 1440 - minutes;
  const reopensInMin = day === 0 ? WEEK_OPEN - minutes : day === 6 ? toMidnight + WEEK_OPEN : toMidnight + 1440 + WEEK_OPEN;
  return { open: false, reopensInMin };
}

// A New York clock time ("HH:MM", today in New York) as "HH:MM" on the user's own clock.
export function nyToLocal(hhmm, now = new Date()) {
  const { y, mo, d, offsetMs } = nyClock(now);
  const instant = new Date(Date.UTC(y, mo - 1, d, ...hhmm.split(":").map(Number)) - offsetMs);
  return `${pad(instant.getHours())}:${pad(instant.getMinutes())}`;
}

// End is exclusive and a window may cross midnight (20:00 to 00:00 ends at midnight).
const inRange = (n, s, e) => (s <= e ? n >= s && n < e : n >= s || n < e);

export function activeZones(zones, now = new Date()) {
  const { minutes: n, day } = nyClock(now);
  if (closedAt(day, n)) return [];
  return zones.filter((z) => z.on && inRange(n, minutesOf(z.start), minutesOf(z.end)));
}

export function minutesLeft(zone, now = new Date()) {
  const n = nyClock(now).minutes;
  return ((minutesOf(zone.end) - n + 1440) % 1440) || 1440;
}

// The enabled session that opens soonest after `now`, skipping openings that fall in the weekend gap.
export function nextZone(zones, now = new Date()) {
  const { minutes: n, day } = nyClock(now);
  let best = null;
  for (let ahead = 0; ahead <= 7; ahead++) {
    for (const z of zones) {
      if (!z.on) continue;
      const start = minutesOf(z.start);
      const inMin = ahead * 1440 + start - n;
      if (inMin <= 0 || closedAt((day + ahead) % 7, start)) continue;
      if (!best || inMin < best.inMin) best = { zone: z, inMin };
    }
    if (best) break; // a later day cannot open sooner than a found one on an earlier day
  }
  return best;
}

export function fmtDuration(min) {
  const d = Math.floor(min / 1440), h = Math.floor((min % 1440) / 60), m = min % 60;
  if (d) return h ? `${d}d ${h}h` : `${d}d`;
  return h ? (m ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
}
