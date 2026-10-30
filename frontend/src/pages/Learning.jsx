import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "../api/index.js";
import { fmtSize, progressLabel } from "../lib/books.js";
import { Empty } from "../components/EntryCard.jsx";
import { CardHead, Icon } from "../components/ui.jsx";

// The reader (and pdf.js with it) is only downloaded when a book is opened.
const PdfReader = lazy(() => import("../components/PdfReader.jsx"));

// The books everyone can read. They are loaded from the server's library folder; you only keep your place in each.
export default function Learning({ active, onExpired }) {
  const [books, setBooks] = useState(null); // null while loading
  const [error, setError] = useState("");
  const [reading, setReading] = useState(null); // the book id being read
  const saved = useRef({}); // id -> { page, pages } last sent to the server, so the same progress is not sent twice

  const load = useCallback(async () => {
    setError("");
    try {
      setBooks(await api.listLibrary());
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) onExpired();
      else setError(err.message);
    }
  }, [onExpired]);

  useEffect(() => { if (active) load(); }, [active, load]);

  // The reader reports where it is; keep it on the server so reading continues on any device.
  const progress = useCallback(({ page, pages }) => {
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

      <div className="card">
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
      </div>

      {open && (
        <Suspense fallback={null}>
          <PdfReader key={open.id} book={open} onClose={() => setReading(null)} onProgress={progress} />
        </Suspense>
      )}
    </section>
  );
}
