import { closeTime, sum } from "../lib/stats.js";
import { fmtMoney, isToday, signClass } from "../lib/format.js";
import { todayCounts } from "../lib/evaluate.js";
import EntryCard, { Empty } from "./EntryCard.jsx";
import Discipline from "./Discipline.jsx";
import { CardHead, Icon } from "./ui.jsx";

export default function Today({ active, entries, settings, onQuick }) {
  const c = todayCounts(entries);
  const closedToday = entries.filter((e) => e.traded && e.result !== "open" && e.pnl != null && isToday(closeTime(e)));
  const pnl = sum(closedToday.map((e) => e.pnl));
  const today = entries.filter((e) => isToday(e.timestamp)).reverse();
  const lockMsg = c.sl >= settings.maxSL
    ? `${c.sl} SL hit today. Trading is done for today. Close the charts.`
    : c.trades >= settings.maxTrades ? `${c.trades} trades taken today. Daily limit reached.` : "";

  return (
    <section id="today" className={`tab ${active ? "active" : ""}`}>
      {lockMsg && <div className="banner lock"><Icon name="lock" size={20} />{lockMsg}</div>}
      <div className="stats-grid">
        <div className="stat"><small><Icon name="swap" size={14} /> Trades</small><span>{c.trades}<em className="of">/{settings.maxTrades}</em></span>
          <div className="meter"><i style={{ width: `${Math.min(100, (c.trades / settings.maxTrades) * 100)}%` }} /></div></div>
        <div className="stat"><small><Icon name="flag" size={14} /> SL hit</small><span>{c.sl}<em className="of">/{settings.maxSL}</em></span>
          <div className="meter bad"><i style={{ width: `${Math.min(100, (c.sl / settings.maxSL) * 100)}%` }} /></div></div>
        <div className="stat"><small><Icon name="wallet" size={14} /> P&amp;L today</small>
          <span className={closedToday.length ? signClass(pnl) : ""}>{closedToday.length ? fmtMoney(pnl, settings.currency) : "–"}</span></div>
      </div>
      <Discipline entries={entries} settings={settings} compact />
      <div className="card">
        <CardHead icon="sun" title="Today's trades"><span className="chip">{today.length}</span></CardHead>
        {today.length
          ? today.map((e) => <EntryCard key={e.id} e={e} mode="today" settings={settings} onQuick={onQuick} />)
          : <Empty icon="sun">No trades yet today.<br />Pass the checklist to log your first one.</Empty>}
      </div>
    </section>
  );
}
