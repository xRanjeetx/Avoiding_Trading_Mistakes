// Journal maths. Pure functions with no DOM access, so they are easy to test.
//
// A journal entry looks like:
//   { id, timestamp, pair, dir, setup, lot, entry, sl, tp, rr, traded,
//     result: "open" | "tp" | "sl" | "be" | "ctc" | "manual",   (ctc = closed at cost after 1:1.5 RR)
//     pnl (money, signed) | null, exit (price) | null, closedAt (ms) | null,
//     notes (why I took it), lesson (what I learned) }

const closeTime = (e) => e.closedAt || e.timestamp;

// Local calendar date as YYYY-MM-DD.
function ymd(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// "win" | "loss" | "be" | "open" | "skipped". Real P&L wins over the result label.
function outcome(e) {
  if (!e.traded) return "skipped";
  if (e.result === "open") return "open";
  if (e.pnl != null) return e.pnl > 0 ? "win" : e.pnl < 0 ? "loss" : "be";
  if (e.result === "tp") return "win";
  if (e.result === "sl") return "loss";
  return "be";
}

// R multiple: how many times the planned risk was won (+) or lost (-).
function tradeR(e) {
  if (!e.traded || e.result === "open") return null;
  if (e.exit != null && e.entry != null && e.sl != null && e.entry !== e.sl && e.dir) {
    const sign = e.dir === "buy" ? 1 : -1;
    return (sign * (e.exit - e.entry)) / Math.abs(e.entry - e.sl);
  }
  if (e.result === "tp") return e.rr ?? null;
  if (e.result === "sl") return -1;
  if (outcome(e) === "be") return 0;
  return null;
}

const sum = (arr) => arr.reduce((a, b) => a + b, 0);

function computeStats(all) {
  const closed = all
    .filter((e) => e.traded && e.result !== "open")
    .sort((a, b) => closeTime(a) - closeTime(b));
  const outs = closed.map(outcome);
  const wins = outs.filter((o) => o === "win").length;
  const losses = outs.filter((o) => o === "loss").length;
  const be = outs.filter((o) => o === "be").length;

  const withPnl = closed.filter((e) => e.pnl != null);
  const pnls = withPnl.map((e) => e.pnl);
  const net = sum(pnls);
  const grossWin = sum(pnls.filter((p) => p > 0));
  const grossLoss = Math.abs(sum(pnls.filter((p) => p < 0)));
  const winPnls = pnls.filter((p) => p > 0);
  const lossPnls = pnls.filter((p) => p < 0);

  // Equity curve (cumulative P&L) and max drawdown.
  const equity = [{ t: closed.length ? closeTime(closed[0]) : Date.now(), v: 0 }];
  let cum = 0, peak = 0, maxDD = 0;
  for (const e of withPnl) {
    cum += e.pnl;
    peak = Math.max(peak, cum);
    maxDD = Math.max(maxDD, peak - cum);
    equity.push({ t: closeTime(e), v: cum });
  }

  // Streaks (break-even trades neither extend nor break a streak).
  let maxWin = 0, maxLoss = 0, curType = null, curLen = 0;
  for (const o of outs) {
    if (o === "be") continue;
    if (o === curType) curLen++; else { curType = o; curLen = 1; }
    if (o === "win") maxWin = Math.max(maxWin, curLen);
    else maxLoss = Math.max(maxLoss, curLen);
  }

  // CTC streak: consecutive trades closed at cost after 1:1.5 RR (any other result breaks it).
  let maxCtc = 0, ctcRun = 0;
  for (const e of closed) {
    if (e.result === "ctc") { ctcRun++; maxCtc = Math.max(maxCtc, ctcRun); } else ctcRun = 0;
  }

  const rs = closed.map(tradeR).filter((r) => r != null);

  const bySetup = {};
  for (const e of closed) {
    const s = (bySetup[e.setup || "none"] ??= { n: 0, wins: 0, losses: 0, pnl: 0 });
    s.n++;
    const o = outcome(e);
    if (o === "win") s.wins++;
    if (o === "loss") s.losses++;
    s.pnl += e.pnl ?? 0;
  }

  const byPair = {};
  for (const e of closed) {
    const p = (byPair[e.pair || "—"] ??= { n: 0, wins: 0, losses: 0, pnl: 0 });
    p.n++;
    const o = outcome(e);
    if (o === "win") p.wins++;
    if (o === "loss") p.losses++;
    p.pnl += e.pnl ?? 0;
  }

  const byWeekday = Array(7).fill(0); // index 0 = Monday
  const weekdayN = Array(7).fill(0);
  for (const e of closed) {
    const i = (new Date(closeTime(e)).getDay() + 6) % 7;
    byWeekday[i] += e.pnl ?? 0;
    weekdayN[i]++;
  }

  const byResult = { tp: 0, sl: 0, be: 0, ctc: 0, manual: 0, open: all.filter((e) => e.traded && e.result === "open").length };
  for (const e of closed) byResult[e.result] = (byResult[e.result] || 0) + 1;

  return {
    n: closed.length,
    wins, losses, be,
    winRate: wins + losses ? wins / (wins + losses) : null,
    hasPnl: withPnl.length > 0,
    net,
    grossWin, grossLoss,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : null,
    avgWin: winPnls.length ? sum(winPnls) / winPnls.length : null,
    avgLoss: lossPnls.length ? Math.abs(sum(lossPnls)) / lossPnls.length : null,
    expectancy: withPnl.length ? net / withPnl.length : null,
    best: pnls.length ? Math.max(...pnls) : null,
    worst: pnls.length ? Math.min(...pnls) : null,
    maxDD,
    maxWinStreak: maxWin,
    maxLossStreak: maxLoss,
    maxCtcStreak: maxCtc,
    curWinStreak: curType === "win" ? curLen : 0,
    curLossStreak: curType === "loss" ? curLen : 0,
    curCtcStreak: ctcRun,
    bySetup,
    totalR: rs.length ? sum(rs) : null,
    avgR: rs.length ? sum(rs) / rs.length : null,
    equity,
    byPair,
    byWeekday, weekdayN,
    byResult,
  };
}

// { "2026-10-25": { pnl, n } } for closed trades, keyed by the day they were closed.
function dailyPnl(all) {
  const out = {};
  for (const e of all) {
    if (!e.traded || e.result === "open") continue;
    const d = (out[ymd(closeTime(e))] ??= { pnl: 0, n: 0 });
    d.pnl += e.pnl ?? 0;
    d.n++;
  }
  return out;
}

// Keep trades closed within the last `days` days (0 = all time).
function inRange(all, days) {
  if (!days) return all;
  const from = Date.now() - days * 86400000;
  return all.filter((e) => closeTime(e) >= from);
}

export { closeTime, ymd, outcome, tradeR, sum, computeStats, dailyPnl, inRange };
