import { closeTime, sum } from "../lib/stats.js";
import { fmtMoney, isToday, signClass } from "../lib/format.js";
import { todayCounts } from "../lib/evaluate.js";
import { lossStatus } from "../lib/risk.js";
import EntryCard, { Empty } from "../components/EntryCard.jsx";
import Discipline from "../components/Discipline.jsx";
import { CardHead, Icon } from "../components/ui.jsx";

export default function Today({ active, entries, settings, onQuick }) {
  const c = todayCounts(entries);
  const closedToday = entries.filter((e) => e.traded && e.result !== "open" && e.pnl != null && isToday(closeTime(e)));
  const pnl = sum(closedToday.map((e) => e.pnl));
  const today = entries.filter((e) => isToday(e.timestamp)).reverse();
  const lockMsg = c.sl >= settings.maxSL
    ? `${c.sl} SL hit today. Trading is done for today. Close the charts.`
    : c.trades >= settings.maxTrades ? `${c.trades} trades taken today. Daily limit reached.` : "";

  const loss = lossStatus(entries, settings);
  const limits = [["Daily", loss.daily], ["Overall", loss.overall]].filter(([, p]) => p);
  const money = (v) => fmtMoney(v, settings.currency, false);

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
      {limits.length > 0 && (
        <div className="card loss-card">
          <CardHead icon="wallet" title="Loss limits" />
          <div className={`loss-grid ${limits.length === 1 ? "one" : ""}`}>
            {limits.map(([name, p]) => {
              const used = Math.min(1, Math.max(0, (p.limit - p.remaining) / p.limit));
              return (
                <div className="stat" key={name}>
                  <small>{name} left</small>
                  <span className={p.remaining <= 0 ? "neg" : ""}>{money(Math.max(0, p.remaining))}<em className="of">/{money(p.limit)} limit</em></span>
                  <div className={`meter ${used >= 0.7 ? "bad" : ""}`}><i style={{ width: `${used * 100}%` }} /></div>
                  <small>
                    {p.remaining <= 0 ? <b className="neg">Limit reached. No more trades.</b>
                      : used >= 0.9 ? <b className="neg">Almost used up</b>
                      : <><b className={signClass(p.pnl)}>{fmtMoney(p.pnl, settings.currency)}</b> net so far</>}
                  </small>
                </div>
              );
            })}
          </div>
          {loss.unknownOpen > 0 && <p className="muted hint">{loss.unknownOpen} open trade{loss.unknownOpen > 1 ? "s" : ""} could not be counted: set the pair's value in Settings.</p>}
        </div>
      )}
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
