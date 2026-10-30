import { SETUPS } from "../lib/rules.js";
import { fmtDuration } from "../lib/killzones.js";
import { outcome, tradeR } from "../lib/stats.js";
import { fmtMoney, fmtR, fullDateTimeOf, signClass } from "../lib/format.js";
import { ruleTitle } from "../lib/evaluate.js";
import { emotionKeys, emotionOf } from "../lib/emotions.js";
import { ShotThumbs } from "./Shots.jsx";
import { Icon } from "./ui.jsx";

const RESULT_LABEL = { tp: "TP", sl: "SL", be: "BE", ctc: "CTC", manual: "EARLY", open: "OPEN" };
const TAG_BY_OUTCOME = { win: "tp", loss: "sl", be: "be", open: "open", skipped: "skipped" };

export function Empty({ icon, children }) {
  return <div className="empty"><span className="e-icon"><Icon name={icon} size={26} /></span><p>{children}</p></div>;
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
  const before = emotionKeys(e.emotion).map((k) => emotionOf(k, "before"));
  const after = emotionKeys(e.emotionAfter).map((k) => emotionOf(k, "after"));
  const emojis = (list) => list.map((x) => x.emoji).join("");
  const labels = (list) => list.map((x) => x.label).join(", ");
  // When the form was submitted (timestamp) and when the trade was closed (closedAt, set on closing), with how long it was held.
  const isOpen = e.result === "open";
  const held = e.traded ? Math.max(0, Math.round(((isOpen ? Date.now() : e.closedAt) - e.timestamp) / 60000)) : null;
  const heldText = held == null || (!isOpen && !e.closedAt) ? null : fmtDuration(held);

  const head = (
    <div className="entry-head" onClick={mode === "log" ? onToggle : undefined} data-toggle={mode === "log" ? "" : undefined}>
      <div className="row-between">
        <div className="row">
          <strong className="pair">{e.pair || "—"}</strong>
          {e.dir && <span className={`tag ${e.dir}`}>{e.dir.toUpperCase()}</span>}
          <span className={`tag ${TAG_BY_OUTCOME[out]}`}>{out === "skipped" ? "SKIPPED" : RESULT_LABEL[e.result] || e.result.toUpperCase()}</span>
          {e.setup && SETUPS[e.setup] && <span className="tag setup">{SETUPS[e.setup]}</span>}
          {Object.keys(e.images || {}).length > 0 && <span className="tag emo-tag" title="Has screenshots"><Icon name="image" size={14} /></span>}
          {(before.length > 0 || after.length > 0) && (
            <span className="tag emo-tag" title={[before.length && `Before: ${labels(before)}`, after.length && `After: ${labels(after)}`].filter(Boolean).join(" · ")}>
              {emojis(before)}{before.length > 0 && after.length > 0 && " → "}{emojis(after)}
            </span>
          )}
        </div>
        <div className="head-end">
          <Pnl e={e} currency={cur} />
          {mode === "log" && <span className="chev"><Icon name="chevron" size={18} /></span>}
        </div>
      </div>
      <div className="meta">
        <span>Lot <b>{e.lot ?? "–"}</b></span>
        <span>Entry <b>{e.entry ?? "–"}</b>{e.exit != null && <> → <b>{e.exit}</b></>}</span>
        {e.rr ? <span>RR <b>1:{(+e.rr).toFixed(2)}</b></span> : null}
        {r != null && e.pnl != null && <span><b>{fmtR(r)}</b></span>}
      </div>
      <div className="times">
        <span className="t-in"><Icon name="clock" size={13} /><small>Entered</small><b>{fullDateTimeOf(e.timestamp)}</b></span>
        {e.traded && (
          <span className={`t-out ${isOpen ? "open" : ""}`}>
            <Icon name={isOpen ? "alert" : "check"} size={13} /><small>Closed</small>
            <b>{isOpen ? "Still open" : e.closedAt ? fullDateTimeOf(e.closedAt) : "Not recorded"}</b>
          </span>
        )}
        {heldText && <span className="t-held"><Icon name="timer" size={13} />{isOpen ? "open for" : "held"} {heldText}</span>}
      </div>
      {mode === "today" && e.notes && <div className="note-preview">{e.notes}</div>}
    </div>
  );

  if (mode === "today") {
    return (
      <div className={`entry dir-${e.dir || "none"}`}>
        {head}
        {e.traded && e.result === "open" && (
          <>
            <div className="result-btns">
              <button className="btn small res-tp" onClick={() => onQuick(e.id, "tp")}><Icon name="check" size={15} /> TP hit</button>
              <button className="btn small res-sl" onClick={() => onQuick(e.id, "sl")}><Icon name="x" size={15} /> SL hit</button>
              <button className="btn small res-be" title="Closed at cost by hand, before 1:1.5 RR" onClick={() => onQuick(e.id, "be")}>BE</button>
              <button className="btn small res-ctc" title="Reached 1:1.5 RR, SL moved to cost, then price reversed" onClick={() => onQuick(e.id, "ctc")}>CTC</button>
            </div>
            <div className="muted res-hint">BE: closed at cost by hand · CTC: reversed to cost after 1:1.5 RR</div>
            <button className="btn small ghost" onClick={() => onQuick(e.id, null)}><Icon name="edit" size={15} /> Closed early / add notes</button>
          </>
        )}
      </div>
    );
  }

  const kv = [
    ["Stop loss", e.sl ?? "–"], ["Take profit", e.tp ?? "–"], ["Exit", e.exit ?? "–"],
    ["Planned RR", e.rr ? `1:${(+e.rr).toFixed(2)}` : "–"], ["Result", r != null ? fmtR(r) : "–"],
    ["Held for", heldText ?? "–"],
  ];
  // Kept in their own row so they share the full width instead of leaving a gap in the 3-column grid.
  const felt = [["Felt before", before], ["Felt after", after]].filter(([, list]) => list.length);
  return (
    <div className={`entry dir-${e.dir || "none"} ${open ? "open" : ""}`}>
      {head}
      <div className="more">
        <div className="kv">{kv.map(([k, v]) => <div key={k}><small>{k}</small><b>{v}</b></div>)}</div>
        {felt.length > 0 && (
          <div className="kv felt">
            {felt.map(([k, list]) => (
              <div key={k}>
                <small>{k}</small>
                <ul>{list.map((x) => <li key={x.key}><span aria-hidden="true">{x.emoji}</span><b>{x.label}</b></li>)}</ul>
              </div>
            ))}
          </div>
        )}
        <ShotThumbs entry={e} />
        {e.notes && <div className="note"><small>Why I took it</small>{e.notes}</div>}
        {e.lesson && <div className="note"><small>Lesson</small>{e.lesson}</div>}
        {e.failedRules?.length > 0 && (
          <div className="note broken">Broken: {e.failedRules.map((id) => ruleTitle(id, settings)).join(" · ")}</div>
        )}
        <div className="row">
          <button className={`btn small ${e.result === "open" ? "primary" : ""}`} onClick={() => onEdit(e.id)}><Icon name={e.result === "open" ? "check" : "edit"} size={15} /> {e.result === "open" ? "Close trade" : "Edit"}</button>
          <button className="btn small danger-outline" aria-label="Delete" onClick={() => onDelete(e.id)}><Icon name="trash" size={15} /> Delete</button>
        </div>
      </div>
    </div>
  );
}
