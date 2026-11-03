import { useState } from "react";
import { SETUPS } from "../lib/rules.js";
import { KILLZONE_NAMES } from "../lib/killzones.js";
import { STAGE_TITLE, emotionInsight, emotionOf } from "../lib/emotions.js";
import { computeStats, dailyPnl, inRange, ymd } from "../lib/stats.js";
import { compactMoney, fmtMoney, fmtR, signClass } from "../lib/format.js";
import { Empty } from "../components/EntryCard.jsx";
import Discipline from "../components/Discipline.jsx";
import { CardHead, Icon } from "../components/ui.jsx";
import Dropdown from "../components/Dropdown.jsx";

const RANGES = [[7, "7D"], [30, "30D"], [90, "90D"], [0, "All time"]];
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const RESULTS = [["TP hit", "tp", "tp"], ["SL hit", "sl", ""], ["Break-even", "be", "be"], ["CTC", "ctc", "be"], ["Closed early", "manual", "manual"], ["Open", "open", "open"]];

function Tile({ label, value, sub = "", cls = "" }) {
  return <div className="stat"><small>{label}</small><span className={cls}>{value}</span>{sub && <em>{sub}</em>}</div>;
}

function Equity({ points, start, currency }) {
  const [hover, setHover] = useState(null);
  if (points.length < 2) return <Empty icon="trend">Close a few trades with a P&amp;L amount<br />to see your equity curve.</Empty>;
  const W = 320, H = 150, padX = 8, padTop = 14, padBot = 10;
  const vals = points.map((p) => p.v + start);
  const lo = Math.min(start, ...vals), hi = Math.max(start, ...vals);
  const span = hi - lo || 1;
  const x = (i) => padX + (i / (points.length - 1)) * (W - padX * 2);
  const y = (v) => H - padBot - ((v - lo) / span) * (H - padTop - padBot);
  const line = vals.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  const area = `${line} L${x(vals.length - 1).toFixed(1)} ${H - padBot} L${x(0).toFixed(1)} ${H - padBot} Z`;
  const up = vals[vals.length - 1] >= start;
  const shown = hover ?? vals.length - 1;
  const money = (v, sign) => fmtMoney(v, currency, sign);

  const onMove = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const sx = ((e.clientX - r.left) / r.width) * W;
    const i = Math.round(((sx - padX) / (W - padX * 2)) * (points.length - 1));
    setHover(Math.max(0, Math.min(points.length - 1, i)));
  };

  const tipLeft = (x(shown) / W) * 100;
  const tipShift = tipLeft < 22 ? "0%" : tipLeft > 78 ? "-100%" : "-50%";
  const when = (t) => new Date(t).toLocaleString([], { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const pnl = points[shown].v;

  return (
    <div className="eq-wrap">
      <svg className={`eq ${up ? "up" : "down"} ${hover != null ? "live" : ""}`} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Equity curve"
        onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={() => setHover(null)} onPointerCancel={() => setHover(null)}>
        <defs>
          <linearGradient id="eq-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.32" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((f) => <line key={f} className="eq-grid" x1={padX} x2={W - padX} y1={(padTop + f * (H - padTop - padBot)).toFixed(1)} y2={(padTop + f * (H - padTop - padBot)).toFixed(1)} />)}
        <line className="eq-base" x1={padX} x2={W - padX} y1={y(start).toFixed(1)} y2={y(start).toFixed(1)} />
        <path className="eq-area" d={area} fill="url(#eq-fill)" /><path className="eq-line" d={line} />
        {hover != null && <line className="eq-cross" x1={x(shown).toFixed(1)} x2={x(shown).toFixed(1)} y1={padTop - 6} y2={H - padBot} />}
        <circle className="eq-halo" cx={x(shown).toFixed(1)} cy={y(vals[shown]).toFixed(1)} r="7" />
        <circle className="eq-dot" cx={x(shown).toFixed(1)} cy={y(vals[shown]).toFixed(1)} r="3.5" />
      </svg>
      <span className="eq-axis hi">{money(hi, false)}</span>
      <span className="eq-axis lo">{money(lo, false)}</span>
      {hover != null && (
        <div className="eq-tip" style={{ left: `${tipLeft}%`, transform: `translateX(${tipShift})` }}>
          <small>{shown === 0 ? "Start" : `Trade ${shown} of ${points.length - 1}`}</small>
          <b>{money(vals[shown], false)}</b>
          <span className={signClass(pnl)}>{money(pnl)}{start ? ` · ${pnl >= 0 ? "+" : "−"}${Math.abs((pnl / start) * 100).toFixed(2)}%` : ""}</span>
          {shown > 0 && <em>{when(points[shown].t)}</em>}
        </div>
      )}
    </div>
  );
}

function calendarData(entries, month) {
  const y = month.getFullYear(), m = month.getMonth();
  const daily = dailyPnl(entries);
  const offset = (new Date(y, m, 1).getDay() + 6) % 7; // Monday first
  const days = new Date(y, m + 1, 0).getDate();
  let total = 0, tradeDays = 0, anyPnl = false;
  const cells = [];
  for (let d = 1; d <= days; d++) {
    const key = `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const info = daily[key];
    let cls = "", val = "";
    if (info) {
      tradeDays++;
      total += info.pnl;
      if (info.pnl !== 0) anyPnl = true;
      cls = info.pnl > 0 ? "pos" : info.pnl < 0 ? "neg" : "zero";
      val = info.pnl !== 0 ? compactMoney(info.pnl) : `${info.n}×`;
    }
    cells.push(<div key={d} className={`cal-day ${cls} ${key === ymd(Date.now()) ? "today" : ""}`}><span className="d">{d}</span><span className="v">{val}</span></div>);
  }
  return { total, tradeDays, anyPnl, offset, cells };
}

export default function Stats({ active, entries, settings }) {
  const [range, setRange] = useState(0);
  const [emoStage, setEmoStage] = useState("before");
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const cur = settings.currency;
  const all = computeStats(entries);
  // One filter bar for the page. It narrows everything below it except Discipline, and it works on top of the period.
  const [filter, setFilter] = useState({ pair: "", setup: "", session: "", dir: "", result: "" });
  const setF = (patch) => setFilter((f) => ({ ...f, ...patch }));
  const filtered = Object.values(filter).some(Boolean);
  const pick = (list) => list.filter((e) =>
    (!filter.pair || e.pair === filter.pair) && (!filter.setup || (e.setup || "none") === filter.setup) && (!filter.session || e.session === filter.session)
    && (!filter.dir || e.dir === filter.dir) && (!filter.result || e.result === filter.result));
  const s = computeStats(pick(inRange(entries, range)));
  const noTrades = filtered ? "No trades match these filters." : "No trades in this period.";
  const start = settings.balance > 0 ? settings.balance : 0;
  const money = (v, sign) => fmtMoney(v, cur, sign);

  const bal = settings.balance > 0 && all.hasPnl
    ? `Balance ${money(settings.balance + all.net, false)} (${all.net >= 0 ? "+" : "−"}${Math.abs((all.net / settings.balance) * 100).toFixed(1)}%)` : "";

  // The equity card can pick its own period; the shared filters still apply to it.
  const [eqRange, setEqRange] = useState(null);
  const eqDays = eqRange ?? range;
  const traded = entries.filter((e) => e.traded && e.result !== "open");
  const filterPairs = [...new Set(traded.map((e) => e.pair).filter(Boolean))].sort();
  const filterSetups = [...new Set(traded.map((e) => e.setup || "none"))];
  const eq = computeStats(pick(inRange(entries, eqDays)));
  const last = eq.equity[eq.equity.length - 1].v;

  const cal = calendarData(pick(entries), month);
  const shiftMonth = (n) => setMonth(new Date(month.getFullYear(), month.getMonth() + n, 1));

  const resultTotal = RESULTS.reduce((a, [, k]) => a + (s.byResult[k] || 0), 0);
  const pairs = Object.entries(s.byPair).sort((a, b) => b[1].pnl - a[1].pnl || b[1].n - a[1].n);
  const setups = Object.entries(s.bySetup).sort((a, b) => b[1].pnl - a[1].pnl || b[1].n - a[1].n);
  const sessions = Object.entries(s.bySession).sort((a, b) => b[1].pnl - a[1].pnl || b[1].n - a[1].n);
  // Win rate per emotion, best first. Emotions with no win or loss yet go last.
  const emoBy = emoStage === "before" ? s.byEmotion : s.byEmotionAfter;
  const rate = (p) => (p.wins + p.losses ? p.wins / (p.wins + p.losses) : -1);
  const emotions = Object.entries(emoBy).sort((a, b) => rate(b[1]) - rate(a[1]) || b[1].n - a[1].n);
  const insight = emotionInsight(emoBy);
  const emoLabel = (key) => { const e = emotionOf(key, emoStage); return `${e.emoji} ${e.label}`; };
  const maxAbs = Math.max(...s.byWeekday.map(Math.abs), 0);

  const groupRow = (name, p, label = name === "none" ? "Not tagged" : SETUPS[name] || name) => (
    <div className="pair-row" key={name}>
      <div><b>{label}</b>
        <small>{p.n} trade{p.n > 1 ? "s" : ""}{p.wins + p.losses ? ` · ${Math.round((p.wins / (p.wins + p.losses)) * 100)}% win` : ""}</small></div>
      <div className={`pnl ${s.hasPnl ? signClass(p.pnl) : ""}`}>{s.hasPnl ? money(p.pnl) : ""}</div>
    </div>
  );

  return (
    <section id="stats" className={`tab ${active ? "active" : ""}`}>
      <div className="pills">
        {RANGES.map(([d, label]) => <button key={d} className={range === d ? "on" : ""} onClick={() => { setRange(d); setEqRange(null); }}>{label}</button>)}
      </div>
      <div className="eq-selects st-filters">
        <Dropdown label="Filter by pair" value={filter.pair} onChange={(v) => setF({ pair: v })} options={[{ value: "", label: "All pairs" }, ...filterPairs.map((p) => ({ value: p, label: p }))]} />
        <Dropdown label="Filter by setup" value={filter.setup} onChange={(v) => setF({ setup: v })} options={[{ value: "", label: "All setups" }, ...filterSetups.map((k) => ({ value: k, label: k === "none" ? "Not tagged" : SETUPS[k] || k }))]} />
        <Dropdown label="Filter by session" value={filter.session} onChange={(v) => setF({ session: v })} options={[{ value: "", label: "All sessions" }, ...Object.entries(KILLZONE_NAMES).map(([key, name]) => ({ value: key, label: name }))]} />
        <Dropdown label="Filter by direction" value={filter.dir} onChange={(v) => setF({ dir: v })} options={[{ value: "", label: "Buy and sell" }, { value: "buy", label: "Buy" }, { value: "sell", label: "Sell" }]} />
        <Dropdown label="Filter by result" value={filter.result} onChange={(v) => setF({ result: v })} options={[{ value: "", label: "All results" }, ...RESULTS.filter(([, k]) => k !== "open").map(([label, k]) => ({ value: k, label }))]} />
        <button type="button" className="eq-reset" disabled={!filtered} onClick={() => setFilter({ pair: "", setup: "", session: "", dir: "", result: "" })}>Reset</button>
      </div>
      <Discipline entries={entries} settings={settings} days={range} />
      <div className="stats-grid two">
        <Tile label="Net P&L" value={s.hasPnl ? money(s.net) : "–"} sub={bal || `${s.n} closed trade${s.n === 1 ? "" : "s"}`} cls={s.hasPnl ? signClass(s.net) : ""} />
        <Tile label="Win rate" value={s.winRate == null ? "–" : Math.round(s.winRate * 100) + "%"} sub={`${s.wins}W · ${s.losses}L · ${s.be}BE`} />
        <Tile label="Total R" value={s.totalR == null ? "–" : fmtR(s.totalR)} sub={s.avgR == null ? "" : `Avg ${fmtR(s.avgR)} / trade`} cls={s.totalR == null ? "" : signClass(s.totalR)} />
        <Tile label="Avg win" value={s.avgWin == null ? "–" : money(s.avgWin)} cls={s.avgWin == null ? "" : "pos"} />
        <Tile label="Avg loss" value={s.avgLoss == null ? "–" : money(-s.avgLoss)} cls={s.avgLoss == null ? "" : "neg"} />
        <Tile label="Max drawdown" value={s.hasPnl && s.maxDD ? money(-s.maxDD) : "–"} cls={s.maxDD ? "neg" : ""} />
        <Tile label="Max profit streak" value={s.maxWinStreak} sub={`Winning trades in a row · now ${s.curWinStreak}`} cls={s.maxWinStreak ? "pos" : ""} />
        <Tile label="Max loss streak" value={s.maxLossStreak} sub={`Losing trades in a row · now ${s.curLossStreak}`} cls={s.maxLossStreak ? "neg" : ""} />
        <Tile label="Max CTC streak" value={s.maxCtcStreak} sub={`CTC trades in a row · now ${s.curCtcStreak}`} cls={s.maxCtcStreak ? "warn" : ""} />
      </div>

      <div className="card">
        <CardHead icon="trend" title="Equity curve">
          <span className={`chip ${eq.hasPnl ? (last >= 0 ? "good" : "bad") : ""}`}>{eq.hasPnl ? (start ? `${money(start + last, false)} (${money(last)})` : money(last)) : "–"}</span>
        </CardHead>
        <div className="eq-filters">
          <div className="pills">
            {RANGES.map(([d, label]) => <button key={d} className={eqDays === d ? "on" : ""} onClick={() => setEqRange(d)}>{label}</button>)}
          </div>
        </div>
        <div><Equity points={eq.equity} start={start} currency={cur} /></div>
      </div>

      <div className="card">
        <CardHead icon="calendar" title="Calendar">
          <div className="row">
            <button className="icon-btn small" aria-label="Previous month" onClick={() => shiftMonth(-1)}><Icon name="left" size={18} /></button>
            <button className="icon-btn small" aria-label="Next month" onClick={() => shiftMonth(1)}><Icon name="right" size={18} /></button>
          </div>
        </CardHead>
        <div className="cal-title">
          <strong>{month.toLocaleDateString([], { month: "long", year: "numeric" })}</strong>
          <span className={`chip ${cal.anyPnl ? (cal.total >= 0 ? "good" : "bad") : ""}`}>
            {cal.tradeDays ? (cal.anyPnl ? money(cal.total) : `${cal.tradeDays} trading day${cal.tradeDays > 1 ? "s" : ""}`) : "No trades"}
          </span>
        </div>
        <div>
          <div className="cal-grid">
            {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => <div key={i} className="cal-dow">{d}</div>)}
            {Array.from({ length: cal.offset }, (_, i) => <div key={`o${i}`} />)}
            {cal.cells}
          </div>
        </div>
      </div>

      <div className="card">
        <CardHead icon="pulse" title="Results" />
        <div>
          {resultTotal ? RESULTS.map(([label, key, cls]) => {
            const n = s.byResult[key] || 0;
            return (
              <div className={`bar ${cls}`} key={key}>
                <div className="lbl"><span>{label}</span><b>{n}</b></div>
                <div className="track"><div className="fill" style={{ width: `${(n / resultTotal) * 100}%` }} /></div>
              </div>
            );
          }) : <Empty icon="bars">{noTrades}</Empty>}
        </div>
      </div>

      <div className="card">
        <CardHead icon="swap" title="By pair" />
        <div>{pairs.length ? pairs.map(([pair, p]) => (
          <div className="pair-row" key={pair}>
            <div><b>{pair}</b><small>{p.n} trade{p.n > 1 ? "s" : ""}{p.wins + p.losses ? ` · ${Math.round((p.wins / (p.wins + p.losses)) * 100)}% win` : ""}</small></div>
            <div className={`pnl ${s.hasPnl ? signClass(p.pnl) : ""}`}>{s.hasPnl ? money(p.pnl) : ""}</div>
          </div>
        )) : <Empty icon="swap">{noTrades}</Empty>}</div>
      </div>

      <div className="card">
        <CardHead icon="target" title="By setup" />
        <div>{setups.length ? setups.map(([key, p]) => groupRow(key, p)) : <Empty icon="target">{noTrades}</Empty>}</div>
      </div>

      <div className="card">
        <CardHead icon="clock" title="By session" />
        <div>{sessions.length ? sessions.map(([key, p]) => groupRow(key, p, KILLZONE_NAMES[key] || "Not recorded")) : <Empty icon="clock">{noTrades}</Empty>}</div>
      </div>

      <div className="card">
        <CardHead icon="heart" title="By emotion">
          <div className="seg emo-seg">
            {Object.keys(STAGE_TITLE).map((k) => (
              <button key={k} type="button" className={emoStage === k ? "on" : ""} onClick={() => setEmoStage(k)}>{STAGE_TITLE[k]}</button>
            ))}
          </div>
        </CardHead>
        <div>{emotions.length ? emotions.map(([key, p]) => (
          <div className="pair-row" key={key}>
            <div><b>{emoLabel(key)}</b>
              <small>{p.n} trade{p.n > 1 ? "s" : ""}{p.wins + p.losses ? ` · ${Math.round((p.wins / (p.wins + p.losses)) * 100)}% win` : ""}</small></div>
            <div className={`pnl ${s.hasPnl ? signClass(p.pnl) : ""}`}>{s.hasPnl ? money(p.pnl) : ""}</div>
          </div>
        )) : <Empty icon="heart">Tag how you felt on your trades to see your win rate per emotion.</Empty>}</div>
        {insight && (
          <p className="muted hint">
            Best when {emoLabel(insight.best.key)} ({Math.round(insight.best.rate * 100)}% win). Weakest when {emoLabel(insight.worst.key)} ({Math.round(insight.worst.rate * 100)}%).
          </p>
        )}
      </div>

      <div className="card">
        <CardHead icon="calendar" title="By weekday"><span className="chip">P&amp;L</span></CardHead>
        <div>
          {s.n && s.hasPnl ? DAYS.map((d, i) => (
            <div className={`bar ${s.byWeekday[i] < 0 ? "" : "tp"}`} key={d}>
              <div className="lbl">
                <span>{d} <small className="muted">{s.weekdayN[i]} trade{s.weekdayN[i] === 1 ? "" : "s"}</small></span>
                <b className={signClass(s.byWeekday[i])}>{s.weekdayN[i] ? money(s.byWeekday[i]) : "–"}</b>
              </div>
              <div className="track"><div className="fill" style={{ width: `${maxAbs ? (Math.abs(s.byWeekday[i]) / maxAbs) * 100 : 0}%` }} /></div>
            </div>
          )) : <Empty icon="calendar">Add P&amp;L amounts to see your best days.</Empty>}
        </div>
      </div>
    </section>
  );
}
