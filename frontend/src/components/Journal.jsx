import { useMemo, useState } from "react";
import { computeStats, sum, ymd } from "../lib/stats.js";
import { NO_FILTER, filterEntries, isFiltered } from "../lib/filters.js";
import { SETUPS } from "../lib/rules.js";
import { paginate } from "../lib/news.js";
import { fmtMoney, signClass } from "../lib/format.js";
import EntryCard, { Empty } from "./EntryCard.jsx";
import { Icon } from "./ui.jsx";

const PAGE_SIZE = 10; // trades per page, counted over the whole (filtered) journal, not per day
const FILTERS = [["all", "All"], ["open", "Open"], ["win", "Wins"], ["loss", "Losses"], ["be", "BE"], ["ctc", "CTC"]];

export default function Journal({ active, entries, settings, onEdit, onDelete }) {
  const [f, setF] = useState(NO_FILTER);
  const [pageNo, setPageNo] = useState(1);
  const set = (patch) => { setF((x) => ({ ...x, ...patch })); setPageNo(1); }; // a new filter starts again on page 1
  const [expanded, setExpanded] = useState(() => new Set());
  const pairs = useMemo(() => [...new Set(entries.map((e) => e.pair).filter(Boolean))].sort(), [entries]);
  const cur = settings.currency;

  const toggle = (id) => setExpanded((s) => {
    const n = new Set(s);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });

  const visible = filterEntries(entries, f).sort((a, b) => b.timestamp - a.timestamp);

  const s = computeStats(entries);

  // The day headers always total the whole day, even when its trades are split across two pages.
  const days = {};
  for (const e of visible) (days[ymd(e.timestamp)] ??= []).push(e);

  const pg = paginate(visible, pageNo, PAGE_SIZE);
  const goPage = (n) => { setPageNo(n); window.scrollTo({ top: 0, behavior: "smooth" }); };

  const groups = [];
  for (const e of pg.items) {
    const key = ymd(e.timestamp);
    if (!groups.length || groups[groups.length - 1].key !== key) groups.push({ key, ts: e.timestamp, items: [] });
    groups[groups.length - 1].items.push(e);
  }

  return (
    <section id="log" className={`tab ${active ? "active" : ""}`}>
      <div className="summary-bar">
        {entries.length > 0 && (
          <>
            <div><small>Trades</small><b>{entries.length}</b></div>
            <div><small>Win rate</small><b>{s.winRate == null ? "–" : Math.round(s.winRate * 100) + "%"}</b></div>
            <div><small>Net P&amp;L</small><b className={signClass(s.net)}>{s.hasPnl ? fmtMoney(s.net, cur) : "–"}</b></div>
          </>
        )}
      </div>
      <div className="search-wrap">
        <Icon name="search" size={18} />
        <input className="search" type="search" placeholder="Search pair, notes or lessons…" autoComplete="off" value={f.q} onChange={(e) => set({ q: e.target.value })} />
      </div>
      <div className="pills fit">
        {FILTERS.map(([key, label]) => <button key={key} data-k={key} className={f.result === key ? "on" : ""} onClick={() => set({ result: key })}>{label}</button>)}
      </div>
      <div className="jr-filters">
        <label className="field"><span>From</span><input type="date" value={f.from} max={f.to || undefined} onChange={(e) => set({ from: e.target.value })} /></label>
        <label className="field"><span>To</span><input type="date" value={f.to} min={f.from || undefined} onChange={(e) => set({ to: e.target.value })} /></label>
        <label className="field"><span>Pair</span>
          <select value={f.pair} onChange={(e) => set({ pair: e.target.value })}>
            <option value="all">All pairs</option>
            {pairs.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
        <label className="field"><span>Setup</span>
          <select value={f.setup} onChange={(e) => set({ setup: e.target.value })}>
            <option value="all">All setups</option>
            {Object.entries(SETUPS).map(([key, name]) => <option key={key} value={key}>{name}</option>)}
          </select>
        </label>
      </div>
      {isFiltered(f) && (
        <div className="jr-count">
          <span className="muted">Showing {visible.length} of {entries.length} trade{entries.length === 1 ? "" : "s"}</span>
          <button type="button" className="btn ghost sm" onClick={() => { setF(NO_FILTER); setPageNo(1); }}><Icon name="x" size={14} /> Clear filters</button>
        </div>
      )}

      <div>
        {!visible.length && (
          entries.length
            ? <Empty icon="search">No trades match this filter.</Empty>
            : <Empty icon="book">Your journal is empty.<br />Log your first trade from the Check tab.</Empty>
        )}
        {groups.map((g) => {
          const dayItems = days[g.key];
          const pnls = dayItems.filter((e) => e.pnl != null && e.traded && e.result !== "open").map((e) => e.pnl);
          const label = new Date(g.ts).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
          return (
            <div key={g.key}>
              <div className="day-head">
                <span>{label}</span>
                <span className="muted">{dayItems.length} trade{dayItems.length > 1 ? "s" : ""}
                  {pnls.length > 0 && <> · <b className={signClass(sum(pnls))}>{fmtMoney(sum(pnls), cur)}</b></>}</span>
              </div>
              <div className="card tight">
                {g.items.map((e) => (
                  <EntryCard key={e.id} e={e} mode="log" settings={settings} open={expanded.has(e.id)}
                    onToggle={() => toggle(e.id)} onEdit={onEdit} onDelete={onDelete} />
                ))}
              </div>
            </div>
          );
        })}
        {pg.pages > 1 && (
          <div className="pager">
            <span className="muted">{pg.from}–{pg.to} of {pg.total}</span>
            <div className="pager-ctl">
              <button type="button" className="btn ghost sm" disabled={pg.page <= 1} aria-label="Previous page" onClick={() => goPage(pg.page - 1)}>Prev</button>
              <span className="muted">Page {pg.page} of {pg.pages}</span>
              <button type="button" className="btn ghost sm" disabled={pg.page >= pg.pages} aria-label="Next page" onClick={() => goPage(pg.page + 1)}>Next</button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
