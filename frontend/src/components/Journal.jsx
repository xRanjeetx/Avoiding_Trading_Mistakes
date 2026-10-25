import { useState } from "react";
import { computeStats, outcome, sum, ymd } from "../lib/stats.js";
import { fmtMoney, signClass } from "../lib/format.js";
import EntryCard, { Empty } from "./EntryCard.jsx";

const FILTERS = [["all", "All"], ["open", "Open"], ["win", "Wins"], ["loss", "Losses"], ["be", "BE / CTC"]];

export default function Journal({ active, entries, settings, onEdit, onDelete }) {
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState(() => new Set());
  const cur = settings.currency;

  const toggle = (id) => setExpanded((s) => {
    const n = new Set(s);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });

  const q = search.trim().toLowerCase();
  const visible = entries
    .filter((e) => (filter === "all" || outcome(e) === filter) && (!q || [e.pair, e.notes, e.lesson].join(" ").toLowerCase().includes(q)))
    .sort((a, b) => b.timestamp - a.timestamp);

  const s = computeStats(entries);

  const groups = [];
  for (const e of visible) {
    const key = ymd(e.timestamp);
    if (!groups.length || groups[groups.length - 1].key !== key) groups.push({ key, ts: e.timestamp, items: [] });
    groups[groups.length - 1].items.push(e);
  }

  return (
    <section id="log" className={`tab ${active ? "active" : ""}`}>
      <div className="page-head"><h2 className="page-title">Journal</h2><span className="chip">{entries.length}</span></div>
      <div className="summary-bar">
        {s.n > 0 && (
          <>
            <div><small>Closed</small><b>{s.n}</b></div>
            <div><small>Win rate</small><b>{s.winRate == null ? "–" : Math.round(s.winRate * 100) + "%"}</b></div>
            <div><small>Net P&amp;L</small><b className={signClass(s.net)}>{s.hasPnl ? fmtMoney(s.net, cur) : "–"}</b></div>
          </>
        )}
      </div>
      <input className="search" type="search" placeholder="Search pair or notes…" autoComplete="off" value={search} onChange={(e) => setSearch(e.target.value)} />
      <div className="pills">
        {FILTERS.map(([key, label]) => <button key={key} className={filter === key ? "on" : ""} onClick={() => setFilter(key)}>{label}</button>)}
      </div>

      <div>
        {!visible.length && (
          entries.length
            ? <Empty icon="🔍">No trades match this filter.</Empty>
            : <Empty icon="📒">Your journal is empty.<br />Log your first trade from the Check tab.</Empty>
        )}
        {groups.map((g) => {
          const pnls = g.items.filter((e) => e.pnl != null && e.traded && e.result !== "open").map((e) => e.pnl);
          const label = new Date(g.ts).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
          return (
            <div key={g.key}>
              <div className="day-head">
                <span>{label}</span>
                <span className="muted">{g.items.length} trade{g.items.length > 1 ? "s" : ""}
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
      </div>
    </section>
  );
}
