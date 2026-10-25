import { closeTime, sum } from "../lib/stats.js";
import { fmtMoney, isToday, signClass } from "../lib/format.js";
import { todayCounts } from "../lib/evaluate.js";
import EntryCard, { Empty } from "./EntryCard.jsx";

export default function Today({ active, entries, settings, onQuick }) {
  const c = todayCounts(entries);
  const closedToday = entries.filter((e) => e.traded && e.result !== "open" && e.pnl != null && isToday(closeTime(e)));
  const pnl = sum(closedToday.map((e) => e.pnl));
  const today = entries.filter((e) => isToday(e.timestamp)).reverse();
  const lockMsg = c.sl >= settings.maxSL
    ? `🔒 ${c.sl} SL hit today. Trading is done for today. Close the charts.`
    : c.trades >= settings.maxTrades ? `🔒 ${c.trades} trades taken today. Daily limit reached.` : "";

  return (
    <section id="today" className={`tab ${active ? "active" : ""}`}>
      <h2 className="page-title">Today</h2>
      <div className="stats-grid">
        <div className="stat"><small>Trades</small><span>{c.trades}/{settings.maxTrades}</span>
          <div className="meter"><i style={{ width: `${Math.min(100, (c.trades / settings.maxTrades) * 100)}%` }} /></div></div>
        <div className="stat"><small>SL hit</small><span>{c.sl}/{settings.maxSL}</span>
          <div className="meter bad"><i style={{ width: `${Math.min(100, (c.sl / settings.maxSL) * 100)}%` }} /></div></div>
        <div className="stat"><small>P&amp;L today</small>
          <span className={closedToday.length ? signClass(pnl) : ""}>{closedToday.length ? fmtMoney(pnl, settings.currency) : "–"}</span></div>
      </div>
      {lockMsg && <div className="banner">{lockMsg}</div>}
      <div className="card">
        <div className="card-head"><h2>Today's trades</h2></div>
        {today.length
          ? today.map((e) => <EntryCard key={e.id} e={e} mode="today" settings={settings} onQuick={onQuick} />)
          : <Empty icon="🌅">No trades yet today.</Empty>}
      </div>
    </section>
  );
}
