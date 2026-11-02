import { useState } from "react";
import { groupIcon, groupItems, itemsOf, progress } from "../lib/checklists.js";
import { Empty } from "./EntryCard.jsx";
import { Icon } from "./ui.jsx";

const LINE_MAX = 500;

// One Learning checklist: a header with a progress ring, then the lines under their sub-headings.
// Every list also lets the user add lines of their own, which only they see and can edit or delete.
export default function ChecklistPanel({ list, items, onTick, onClear, onAdd, onEdit, onRemove }) {
  const mine = itemsOf(items, list.kind);
  const { done, total, pct } = progress(mine);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(null); // { id, text } of the own line being edited
  const own = list.kind === "rules"; // the user's own list: no headings, the empty state invites a first line

  async function add(e) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || busy) return;
    setBusy(true);
    const ok = await onAdd(list.kind, text);
    setBusy(false);
    if (ok) setDraft("");
  }
  async function saveEdit(e) {
    e.preventDefault();
    const text = editing.text.trim();
    if (text && text !== mine.find((i) => i.mine && i.id === editing.id)?.text) await onEdit(editing.id, text);
    setEditing(null);
  }

  return (
    <div className={`card chk k-${list.kind}`}>
      <div className="chk-hero">
        <span className="chk-badge"><Icon name={list.icon} size={26} /></span>
        <div className="chk-hero-main">
          <h2>{list.title}</h2>
          <p>{list.blurb}</p>
        </div>
        {total > 0 && (
          <div className="chk-ring" style={{ "--pct": pct }} role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-label={`${list.title}: ${done} of ${total} ticked`}>
            <b>{pct}<small>%</small></b>
          </div>
        )}
      </div>

      {mine.length === 0 ? (
        <Empty icon={list.icon}>{own ? "No rules yet. Write your first one below." : "Nothing has been added to this list yet."}</Empty>
      ) : (
        <>
          <div className="chk-meta">
            <span><b>{done}</b> of {total} ticked</span>
            {done > 0 && <button type="button" className="btn small ghost" onClick={() => onClear(list.kind)}>Reset</button>}
          </div>

          {done === total && (
            <div className="chk-win" role="status"><Icon name="sparkle" size={20} /><span>{list.done}</span></div>
          )}

          {groupItems(mine).map((g) => {
            const part = progress(g.items);
            return (
              <section key={g.group || "all"} className="chk-group">
                {g.group && !own && (
                  <h3 className="chk-group-title">
                    <span className="chk-gico"><Icon name={groupIcon(g.group)} size={15} /></span>
                    {g.group}
                    <em>{part.done}/{part.total}</em>
                  </h3>
                )}
                <ul className="chk-list">
                  {g.items.map((i, n) => (
                    <li key={`${i.mine ? "m" : "s"}${i.id}`} className={i.mine ? "chk-row" : undefined} style={{ "--i": Math.min(n, 14) }}>
                      {i.mine && editing?.id === i.id ? (
                        <form className="chk-edit" onSubmit={saveEdit}>
                          <input autoFocus maxLength={LINE_MAX} aria-label="Edit line" value={editing.text} onChange={(e) => setEditing({ id: i.id, text: e.target.value })}
                            onKeyDown={(e) => e.key === "Escape" && setEditing(null)} />
                          <button type="submit" className="btn small primary" aria-label="Save line"><Icon name="check" size={16} /></button>
                          <button type="button" className="btn small ghost" aria-label="Cancel" onClick={() => setEditing(null)}><Icon name="x" size={16} /></button>
                        </form>
                      ) : (
                        <>
                          <label className={`chk-item ${i.done ? "done" : ""}`}>
                            <input type="checkbox" checked={i.done} onChange={(e) => onTick(i.id, e.target.checked, !!i.mine)} />
                            <span className="chk-box"><Icon name="check" size={14} /></span>
                            <span className="chk-no">{i.position}</span>
                            <span className="chk-text">{i.text}</span>
                          </label>
                          {i.mine && (
                            <span className="chk-acts">
                              <button type="button" className="chk-act" aria-label={`Edit: ${i.text}`} title="Edit" onClick={() => setEditing({ id: i.id, text: i.text })}><Icon name="edit" size={16} /></button>
                              <button type="button" className="chk-act del" aria-label={`Delete: ${i.text}`} title="Delete" onClick={() => onRemove(i.id)}><Icon name="trash" size={16} /></button>
                            </span>
                          )}
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </>
      )}

      <form className="chk-add" onSubmit={add}>
        <input maxLength={LINE_MAX} placeholder={own ? "Write a rule, e.g. Never move my stop away" : "Add your own point to this list"} aria-label={`Add to ${list.title}`}
          value={draft} onChange={(e) => setDraft(e.target.value)} />
        <button type="submit" className="btn small primary" disabled={!draft.trim() || busy}><Icon name="plus" size={16} /> Add</button>
      </form>
    </div>
  );
}
