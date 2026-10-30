import { groupIcon, groupItems, itemsOf, progress } from "../lib/checklists.js";
import { Empty } from "./EntryCard.jsx";
import { Icon } from "./ui.jsx";

// One Learning checklist: a header with a progress ring, then the lines under their sub-headings.
export default function ChecklistPanel({ list, items, onTick, onClear }) {
  const mine = itemsOf(items, list.kind);
  const { done, total, pct } = progress(mine);

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
        <Empty icon={list.icon}>Nothing has been added to this list yet.</Empty>
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
                {g.group && (
                  <h3 className="chk-group-title">
                    <span className="chk-gico"><Icon name={groupIcon(g.group)} size={15} /></span>
                    {g.group}
                    <em>{part.done}/{part.total}</em>
                  </h3>
                )}
                <ul className="chk-list">
                  {g.items.map((i, n) => (
                    <li key={i.id} style={{ "--i": Math.min(n, 14) }}>
                      <label className={`chk-item ${i.done ? "done" : ""}`}>
                        <input type="checkbox" checked={i.done} onChange={(e) => onTick(i.id, e.target.checked)} />
                        <span className="chk-box"><Icon name="check" size={14} /></span>
                        <span className="chk-no">{i.position}</span>
                        <span className="chk-text">{i.text}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </>
      )}
    </div>
  );
}
