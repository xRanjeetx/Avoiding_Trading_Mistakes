import { SETUPS } from "../lib/rules.js";
import { closeTime, outcome, tradeR } from "../lib/stats.js";
import { dateTimeOf, fmtMoney, fmtR, signClass, timeOf } from "../lib/format.js";
import { ruleTitle } from "../lib/evaluate.js";

const RESULT_LABEL = { tp: "TP", sl: "SL", be: "BE", ctc: "CTC", manual: "EARLY", open: "OPEN" };
const TAG_BY_OUTCOME = { win: "tp", loss: "sl", be: "be", open: "open", skipped: "skipped" };

export function Empty({ icon, children }) {
  return <div className="empty"><span className="e-icon">{icon}</span>{children}</div>;
}

function Pnl({ e, currency }) {
  if (e.pnl != null) return <div className={`pnl ${signClass(e.pnl)}`}>{fmtMoney(e.pnl, currency)}</div>;
  const r = tradeR(e);
  return r != null ? <div className={`pnl ${signClass(r)}`}>{fmtR(r)}</div> : null;
}

// mode "today": quick result buttons. mode "log": expandable card with edit/delete.
export default function EntryCard({ e, mode, settings, open, onToggle, onQuick, onEdit, onDelete }) {
  const out = outcome(e);
  const r = tradeR(e);
  const cur = settings.currency;
  const when = mode === "today" ? timeOf(e.timestamp) : dateTimeOf(e.timestamp);

  const head = (
    <div className="entry-head" onClick={mode === "log" ? onToggle : undefined}>
      <div className="row-between">
        <div className="row">
          <strong>{e.pair || "—"}</strong>
          {e.dir && <span className={`tag ${e.dir}`}>{e.dir.toUpperCase()}</span>}
          <span className={`tag ${TAG_BY_OUTCOME[out]}`}>{out === "skipped" ? "SKIPPED" : RESULT_LABEL[e.result] || e.result.toUpperCase()}</span>
          {e.setup && SETUPS[e.setup] && <span className="tag setup">{SETUPS[e.setup]}</span>}
        </div>
        <Pnl e={e} currency={cur} />
      </div>
      <div className="meta">
        <span>{when}</span>
        <span>Lot <b>{e.lot ?? "–"}</b></span>
        <span>Entry <b>{e.entry ?? "–"}</b>{e.exit != null && <> → <b>{e.exit}</b></>}</span>
        {e.rr ? <span>RR <b>1:{(+e.rr).toFixed(2)}</b></span> : null}
        {r != null && e.pnl != null && <span><b>{fmtR(r)}</b></span>}
      </div>
      {mode === "today" && e.notes && <div className="note-preview">{e.notes}</div>}
    </div>
  );

  if (mode === "today") {
    return (
      <div className="entry">
        {head}
        {e.traded && e.result === "open" && (
          <>
            <div className="result-btns">
              <button className="btn small" onClick={() => onQuick(e.id, "tp")}>TP hit</button>
              <button className="btn small" onClick={() => onQuick(e.id, "sl")}>SL hit</button>
              <button className="btn small" onClick={() => onQuick(e.id, "be")}>Break-even</button>
            </div>
            <button className="btn small ghost" onClick={() => onQuick(e.id, null)}>CTC / closed early / add notes</button>
          </>
        )}
      </div>
    );
  }

  const kv = [
    ["Stop loss", e.sl ?? "–"], ["Take profit", e.tp ?? "–"], ["Exit", e.exit ?? "–"],
    ["Planned RR", e.rr ? `1:${(+e.rr).toFixed(2)}` : "–"], ["Result", r != null ? fmtR(r) : "–"],
    ["Closed", e.result === "open" ? "Still open" : dateTimeOf(closeTime(e))],
  ];
  return (
    <div className={`entry ${open ? "open" : ""}`}>
      {head}
      <div className="more">
        <div className="kv">{kv.map(([k, v]) => <div key={k}><small>{k}</small><b>{v}</b></div>)}</div>
        {e.notes && <div className="note"><small>Why I took it</small>{e.notes}</div>}
        {e.lesson && <div className="note"><small>Lesson</small>{e.lesson}</div>}
        {e.failedRules?.length > 0 && (
          <div className="note broken">Broken: {e.failedRules.map((id) => `#${id} ${ruleTitle(id, settings)}`).join(" · ")}</div>
        )}
        <div className="row">
          <button className={`btn small ${e.result === "open" ? "primary" : ""}`} onClick={() => onEdit(e.id)}>{e.result === "open" ? "Close trade" : "Edit"}</button>
          <button className="btn small danger-outline" aria-label="Delete" onClick={() => onDelete(e.id)}>Delete</button>
        </div>
      </div>
    </div>
  );
}
