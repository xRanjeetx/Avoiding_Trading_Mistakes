// Journal <-> CSV. Columns match the API's entry fields, so an export can be imported again (also into another account).
const COLUMNS = [
  "id", "timestamp", "date", "pair", "dir", "setup", "lot", "entry", "sl", "tp", "rr", "traded", "result",
  "exit", "pnl", "closedAt", "failedRules", "answers", "emotion", "emotionAfter", "notes", "lesson",
];
const RESULTS = ["open", "tp", "sl", "be", "ctc", "manual"];
const TEXT_COLUMNS = new Set(["pair", "notes", "lesson"]);

// A cell that starts with = + - @ is run as a formula by Excel / Sheets, so free text gets a leading apostrophe.
const FORMULA = /^[=+\-@]/;
const guard = (s) => (FORMULA.test(s) ? `'${s}` : s);
const unguard = (s) => (/^'[=+\-@]/.test(s) ? s.slice(1) : s);

const cell = (v) => {
  const s = v == null ? "" : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function toCsv(entries) {
  const sorted = [...entries].sort((a, b) => a.timestamp - b.timestamp);
  const value = (e, c) => {
    if (c === "date") return new Date(e.timestamp).toISOString();
    if (c === "failedRules") return (e.failedRules || []).join(";");
    if (c === "answers") return JSON.stringify(e.answers || {});
    const v = e[c];
    return TEXT_COLUMNS.has(c) && typeof v === "string" ? guard(v) : v;
  };
  const rows = sorted.map((e) => COLUMNS.map((c) => cell(value(e, c))).join(","));
  return [COLUMNS.join(","), ...rows].join("\r\n") + "\r\n";
}

// RFC 4180: quoted cells may hold commas, quotes ("") and line breaks.
function parseRows(text) {
  const rows = [];
  let row = [];
  let cur = "";
  let quoted = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') { cur += '"'; i++; } else quoted = false;
      } else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cur); cur = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(cur); cur = "";
      rows.push(row); row = [];
    } else cur += ch;
  }
  if (quoted) throw new Error("The file has an unclosed quote.");
  if (cur !== "" || row.length) { row.push(cur); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

// An emotion key the API accepts ("calm"), or null.
const emotionKey = (s) => (/^[a-z][a-z_]{0,19}$/.test(s.trim()) ? s.trim() : null);

const toNum = (s, line, name) => {
  if (s == null || s.trim() === "") return null;
  const n = Number(s);
  if (!Number.isFinite(n)) throw new Error(`Row ${line}: "${s}" is not a number (${name}).`);
  return n;
};

// Returns entries ready to send to the API. Throws an Error with a readable message on a bad file.
function parseCsv(text) {
  const rows = parseRows(text);
  if (!rows.length) throw new Error("The file is empty.");
  const head = rows[0].map((h) => h.trim());
  const col = Object.fromEntries(head.map((h, i) => [h, i]));
  if (!("timestamp" in col) && !("date" in col)) throw new Error("This does not look like a Trade Guard export (no timestamp or date column).");
  if (rows.length === 1) throw new Error("The file has no trades in it.");

  return rows.slice(1).map((r, idx) => {
    const line = idx + 2;
    const get = (name) => (name in col ? r[col[name]] ?? "" : "");
    let timestamp = toNum(get("timestamp"), line, "timestamp");
    if (timestamp == null) timestamp = Date.parse(get("date"));
    if (!Number.isFinite(timestamp)) throw new Error(`Row ${line}: no valid timestamp or date.`);

    const result = get("result").trim() || "open";
    if (!RESULTS.includes(result)) throw new Error(`Row ${line}: unknown result "${result}".`);
    const dir = get("dir").trim();
    const id = get("id").trim();
    let answers = {};
    try {
      const a = JSON.parse(get("answers") || "{}");
      if (a && typeof a === "object" && !Array.isArray(a)) answers = a;
    } catch { /* an unreadable answers cell is left empty */ }

    return {
      ...(/^[A-Za-z0-9_-]{1,40}$/.test(id) && { id }),
      timestamp,
      pair: unguard(get("pair")).trim().toUpperCase(),
      dir: dir === "buy" || dir === "sell" ? dir : null,
      setup: get("setup").trim() || null,
      lot: toNum(get("lot"), line, "lot"),
      entry: toNum(get("entry"), line, "entry"),
      sl: toNum(get("sl"), line, "sl"),
      tp: toNum(get("tp"), line, "tp"),
      rr: toNum(get("rr"), line, "rr"),
      traded: get("traded").trim().toLowerCase() !== "false",
      result,
      exit: toNum(get("exit"), line, "exit"),
      pnl: toNum(get("pnl"), line, "pnl"),
      closedAt: toNum(get("closedAt"), line, "closedAt"),
      failedRules: get("failedRules").split(";").filter((x) => x.trim() !== "").map(Number).filter(Number.isInteger),
      answers,
      emotion: emotionKey(get("emotion")),
      emotionAfter: emotionKey(get("emotionAfter")),
      notes: unguard(get("notes")),
      lesson: unguard(get("lesson")),
    };
  });
}

export { COLUMNS, parseCsv, toCsv };
