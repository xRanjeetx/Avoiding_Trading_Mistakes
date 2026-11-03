import { useEffect, useState } from "react";
import { changedCount, groupIcon, groupItems, itemsOf, progress } from "../lib/checklists.js";
import { Empty } from "./EntryCard.jsx";
import SwipeRow from "./SwipeRow.jsx";
import { Icon } from "./ui.jsx";

const LINE_MAX = 500;
const rowKey = (i) => `${i.mine ? "m" : "s"}${i.id}`;

function RestoreButton({ count, onClick }) {
  return <button type="button" className="btn small ghost" onClick={onClick} title="Bring back the lines you removed or reworded, as they were">Restore {count}</button>;
}

// One Learning checklist: a header with a progress ring, then the lines under their sub-headings.
// Every line can be reworded or removed by the user, and they can add lines of their own. A shared line is changed for
// that user only, and Restore brings the originals back.
export default function ChecklistPanel({ list, items, onTick, onClear, onAdd, onEdit, onRemove, onRestore }) {
  const mine = itemsOf(items, list.kind);
  const { done, total, pct } = progress(mine);
  const changed = changedCount(items, list.kind);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(null); // { id, mine, text } of the line being edited
  const [openId, setOpenId] = useState(null); // the line whose Edit / Delete is showing (see rowKey)
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
  useEffect(() => {
    if (openId == null) return undefined;
    const onKey = (e) => { if (e.key === "Escape") setOpenId(null); };
    const away = (e) => { if (!e.target.closest(".chk-row")) setOpenId(null); };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", away);
    return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("pointerdown", away); };
  }, [openId]);

  async function saveEdit(e) {
    e.preventDefault();
    const text = editing.text.trim();
    if (text && text !== mine.find((i) => !!i.mine === editing.mine && i.id === editing.id)?.text) await onEdit(editing.id, text, editing.mine);
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
        <>
          <Empty icon={list.icon}>{own ? "No rules yet. Write your first one below." : changed ? "You removed every line from this list." : "Nothing has been added to this list yet."}</Empty>
          {changed > 0 && <div className="chk-meta"><span /><RestoreButton count={changed} onClick={() => onRestore(list.kind)} /></div>}
        </>
      ) : (
        <>
          <div className="chk-meta">
            <span><b>{done}</b> of {total} ticked</span>
            <span className="chk-meta-acts">
              {changed > 0 && <RestoreButton count={changed} onClick={() => onRestore(list.kind)} />}
              {done > 0 && <button type="button" className="btn small ghost" onClick={() => onClear(list.kind)}>Reset</button>}
            </span>
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
                    <li key={`${i.mine ? "m" : "s"}${i.id}`} className="chk-row" style={{ "--i": Math.min(n, 14) }}>
                      {editing && editing.id === i.id && editing.mine === !!i.mine ? (
                        <form className="chk-edit" onSubmit={saveEdit}>
                          <input autoFocus maxLength={LINE_MAX} aria-label="Edit line" value={editing.text} onChange={(e) => setEditing({ ...editing, text: e.target.value })}
                            onKeyDown={(e) => e.key === "Escape" && setEditing(null)} />
                          <button type="submit" className="btn small primary" aria-label="Save line"><Icon name="check" size={16} /></button>
                          <button type="button" className="btn small ghost" aria-label="Cancel" onClick={() => setEditing(null)}><Icon name="x" size={16} /></button>
                        </form>
                      ) : (
                        <>
                          <SwipeRow text={i.text} open={openId === rowKey(i)} onOpen={(o) => setOpenId(o ? rowKey(i) : null)}
                            onEdit={() => { setOpenId(null); setEditing({ id: i.id, mine: !!i.mine, text: i.text }); }}
                            onDelete={() => { setOpenId(null); onRemove(i.id, !!i.mine); }}>
                            <label className={`chk-item ${i.done ? "done" : ""}`}>
                              <input type="checkbox" checked={i.done} onChange={(e) => onTick(i.id, e.target.checked, !!i.mine)} />
                              <span className="chk-box"><Icon name="check" size={14} /></span>
                              <span className="chk-no">{i.position}</span>
                              <span className="chk-text">{i.text}{i.edited && <em className="chk-edited">edited</em>}</span>
                            </label>
                          </SwipeRow>
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
