import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "../api/index.js";
import { fmtSize, progressLabel } from "../lib/books.js";
import { LISTS, clearKind, itemsOf, progress, withDone, withHidden, withItem, withSharedText, withText, withoutItem } from "../lib/checklists.js";
import ChecklistPanel from "../components/ChecklistPanel.jsx";
import { Empty } from "../components/EntryCard.jsx";
import { CardHead, Icon } from "../components/ui.jsx";

// The reader (and pdf.js with it) is only downloaded when a book is opened.
const PdfReader = lazy(() => import("../components/PdfReader.jsx"));

// The books everyone can read, and the checklists taken from the strategy book. Both are loaded from the server and shared;
// you only keep your place in each book and which checklist lines you have ticked.
export default function Learning({ active, onExpired, confirm }) {
  const [view, setView] = useState("library"); // "library" or a checklist kind
  const [books, setBooks] = useState(null); // null while loading
  const [checks, setChecks] = useState(null); // null while loading
  const [error, setError] = useState("");
  const [reading, setReading] = useState(null); // the book id being read
  const saved = useRef({}); // id -> { page, pages } last sent to the server, so the same progress is not sent twice

  const fail = useCallback((err) => {
    if (err instanceof ApiError && err.status === 401) onExpired();
    else setError(err.message);
  }, [onExpired]);

  const load = useCallback(async () => {
    setError("");
    try {
      const [b, c] = await Promise.all([api.listLibrary(), api.listChecklists()]);
      setBooks(b);
      setChecks(c);
    } catch (err) {
      fail(err);
    }
  }, [fail]);

  useEffect(() => { if (active) load(); }, [active, load]);

  // Show the tick at once; put it back if the server refuses.
  const tick = useCallback((id, done, mine = false) => {
    setChecks((list) => withDone(list, id, done, mine));
    (mine ? api.tickChecklistLine(id, done) : api.tickChecklist(id, done))
      .catch((err) => { setChecks((list) => withDone(list, id, !done, mine)); fail(err); });
  }, [fail]);

  // The user's own lines. Resolves true when the server took it, so the form can empty itself.
  const add = useCallback(async (kind, text) => {
    try {
      const line = await api.addChecklistLine(kind, text);
      setChecks((list) => withItem(list, line));
      return true;
    } catch (err) {
      fail(err);
      return false;
    }
  }, [fail]);

  // A line of the user's own, or a shared line reworded for this user only.
  const edit = useCallback(async (id, text, mine = true) => {
    try {
      await (mine ? api.editChecklistLine(id, text) : api.editSharedLine(id, text));
      setChecks((list) => (mine ? withText(list, id, text) : withSharedText(list, id, text)));
    } catch (err) {
      fail(err);
    }
  }, [fail]);

  const remove = useCallback(async (id, mine = true) => {
    const ok = await confirm(mine
      ? { title: "Delete this line?", text: "It will be removed from your list.", okLabel: "Delete" }
      : { title: "Remove this line?", text: "It leaves your list only. Restore brings it back.", okLabel: "Remove" });
    if (!ok) return;
    try {
      if (mine) await api.deleteChecklistLine(id); else await api.hideSharedLine(id);
      setChecks((list) => (mine ? withoutItem(list, id) : withHidden(list, id)));
    } catch (err) {
      fail(err);
    }
  }, [confirm, fail]);

  // Brings back every line removed or reworded in one list.
  const restore = useCallback(async (kind) => {
    try {
      await api.restoreChecklist(kind);
      setChecks(await api.listChecklists());
    } catch (err) {
      fail(err);
    }
  }, [fail]);

  const clear = useCallback(async (kind) => {
    try {
      await api.clearChecklist(kind);
      setChecks((list) => clearKind(list, kind));
    } catch (err) {
      fail(err);
    }
  }, [fail]);

  const list = LISTS.find((l) => l.kind === view);

  // The reader reports where it is; keep it on the server so reading continues on any device.
  const reportPage = useCallback(({ page, pages }) => {
    if (reading == null) return;
    const prev = saved.current[reading];
    if (prev && prev.page === page && prev.pages === pages) return;
    saved.current[reading] = { page, pages };
    api.saveProgress(reading, { lastPage: page, ...(pages ? { pages } : {}) })
      .then((p) => setBooks((list) => list.map((b) => (b.id === reading ? { ...b, lastPage: p.lastPage, pages: p.pages } : b))))
      .catch(() => {}); // not worth interrupting the reader over
  }, [reading]);

  const open = books?.find((b) => b.id === reading) || null;

  return (
    <section id="learn" className={`tab ${active ? "active" : ""}`}>
      {error && <div className="banner">{error}</div>}

      <div className="learn-tabs" role="tablist" aria-label="Learning">
        {[{ kind: "library", label: "Library", icon: "book" }, ...LISTS].map((t) => {
          const p = t.kind === "library" || !checks ? null : progress(itemsOf(checks, t.kind));
          return (
            <button key={t.kind} type="button" role="tab" aria-selected={view === t.kind} className={`k-${t.kind} ${view === t.kind ? "on" : ""}`} onClick={() => setView(t.kind)}>
              <Icon name={t.icon} size={17} />{t.label}
              {p && p.total > 0 && <em className={p.done === p.total ? "all" : ""}>{p.done}/{p.total}</em>}
            </button>
          );
        })}
      </div>

      {list && (checks === null
        ? !error && <div className="card"><p className="muted">Loading…</p></div>
        : <ChecklistPanel list={list} items={checks} onTick={tick} onClear={clear} onAdd={add} onEdit={edit} onRemove={remove} onRestore={restore} />)}

      {view === "library" && <div className="card">
        <CardHead icon="book" title="Library" />
        {books === null ? (
          !error && <p className="muted">Loading…</p>
        ) : books.length === 0 ? (
          <Empty icon="book">No books have been added yet.</Empty>
        ) : (
          <ul className="books">
            {books.map((b) => (
              <li key={b.id} className="book">
                <span className="book-ico"><Icon name="book" size={22} /></span>
                <div className="book-main">
                  <b className="book-title">{b.title}</b>
                  <small>{fmtSize(b.size)} · {progressLabel(b.lastPage, b.pages)}</small>
                  {b.pages > 0 && b.lastPage > 1 && <div className="book-bar"><i style={{ width: `${Math.min(100, (b.lastPage / b.pages) * 100)}%` }} /></div>}
                </div>
                <div className="book-acts">
                  <button type="button" className="btn small primary" onClick={() => setReading(b.id)}>{b.lastPage > 1 ? "Continue" : "Read"}</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>}

      {open && (
        <Suspense fallback={null}>
          <PdfReader key={open.id} book={open} onClose={() => setReading(null)} onProgress={reportPage} />
        </Suspense>
      )}
    </section>
  );
}
