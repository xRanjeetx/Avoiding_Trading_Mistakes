import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../api/index.js";
import { clampPage } from "../lib/books.js";
import { Icon } from "./ui.jsx";

// pdf.js is large, so it is only downloaded the first time a book is opened.
let pdfjsPromise;
function loadPdfjs() {
  pdfjsPromise ??= Promise.all([import("pdfjs-dist/build/pdf.min.mjs"), import("pdfjs-dist/build/pdf.worker.min.mjs?url")])
    .then(([lib, worker]) => {
      lib.GlobalWorkerOptions.workerSrc = worker.default;
      return lib;
    })
    .catch((err) => {
      pdfjsPromise = undefined; // let the next open try again
      throw err;
    });
  return pdfjsPromise;
}

const ZOOMS = [0.6, 0.8, 1, 1.25, 1.5, 2, 2.5];
const MAX_PIXELS = 16_000_000; // keeps a zoomed page from using too much memory on a phone

// One page at a time, fitted to the screen width. `onProgress({ page, pages })` reports where the reader is.
export default function PdfReader({ book, onClose, onProgress }) {
  const [pdf, setPdf] = useState(null);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [width, setWidth] = useState(0);
  const [pageText, setPageText] = useState("1");
  const bodyRef = useRef(null);
  const canvasRef = useRef(null);
  const taskRef = useRef(null);
  const touch = useRef(null);
  const live = useRef({ page: 1, pages: 0, ready: false });

  // Fetch the file (with the login token) and open it.
  useEffect(() => {
    let cancelled = false;
    let doc = null;
    (async () => {
      try {
        const [lib, bytes] = await Promise.all([loadPdfjs(), api.libraryFile(book.id)]);
        doc = await lib.getDocument({ data: bytes }).promise;
        if (cancelled) return;
        const start = clampPage(book.lastPage, doc.numPages);
        live.current = { page: start, pages: doc.numPages, ready: true };
        setPdf(doc);
        setPage(start);
        if (book.pages !== doc.numPages) onProgress({ page: start, pages: doc.numPages });
      } catch (err) {
        if (!cancelled) setError(err?.message || "This PDF could not be opened.");
      }
    })();
    return () => {
      cancelled = true;
      doc?.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book.id]);

  // The page size follows the window.
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return undefined;
    const measure = () => setWidth(Math.max(0, el.clientWidth - 24));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Draw the page.
  useEffect(() => {
    if (!pdf || !width) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const pg = await pdf.getPage(page);
        if (cancelled) return;
        const base = pg.getViewport({ scale: 1 });
        let out = (width / base.width) * zoom * Math.min(window.devicePixelRatio || 1, 2);
        const px = base.width * out * base.height * out;
        if (px > MAX_PIXELS) out *= Math.sqrt(MAX_PIXELS / px);
        const viewport = pg.getViewport({ scale: out });
        const canvas = canvasRef.current;
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        const css = (width / base.width) * zoom;
        canvas.style.width = `${Math.floor(base.width * css)}px`;
        canvas.style.height = `${Math.floor(base.height * css)}px`;
        taskRef.current?.cancel();
        taskRef.current = pg.render({ canvasContext: canvas.getContext("2d"), viewport });
        await taskRef.current.promise;
      } catch (err) {
        if (!cancelled && err?.name !== "RenderingCancelledException") setError("This page could not be drawn.");
      }
    })();
    return () => {
      cancelled = true;
      taskRef.current?.cancel();
    };
  }, [pdf, page, zoom, width]);

  // Remember the page a moment after the reader settles on it, and once more when the book is closed.
  useEffect(() => {
    live.current.page = page;
    setPageText(String(page));
    bodyRef.current?.scrollTo({ top: 0, left: 0 });
    if (!pdf) return undefined;
    const id = setTimeout(() => onProgress({ page, pages: live.current.pages }), 700);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pdf]);
  useEffect(() => () => {
    if (live.current.ready) onProgress({ page: live.current.page, pages: live.current.pages });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const total = pdf?.numPages || 0;
  const go = (n) => total && setPage(clampPage(n, total));
  const zoomBy = (dir) => setZoom((z) => {
    const i = ZOOMS.reduce((best, v, k) => (Math.abs(v - z) < Math.abs(ZOOMS[best] - z) ? k : best), 0);
    return ZOOMS[Math.min(ZOOMS.length - 1, Math.max(0, i + dir))];
  });

  useEffect(() => {
    const onKey = (e) => {
      if (e.target.tagName === "INPUT") return;
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight" || e.key === "PageDown") go(live.current.page + 1);
      else if (e.key === "ArrowLeft" || e.key === "PageUp") go(live.current.page - 1);
    };
    document.addEventListener("keydown", onKey);
    document.body.classList.add("noscroll");
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.classList.remove("noscroll");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [total]);

  // Swipe to turn the page, only while the page fits the screen (otherwise the swipe is for moving around it).
  const onTouchStart = (e) => { touch.current = zoom <= 1 && e.touches.length === 1 ? [e.touches[0].clientX, e.touches[0].clientY] : null; };
  const onTouchEnd = (e) => {
    const t = touch.current;
    touch.current = null;
    if (!t) return;
    const dx = e.changedTouches[0].clientX - t[0];
    const dy = e.changedTouches[0].clientY - t[1];
    if (Math.abs(dx) > 70 && Math.abs(dx) > 2 * Math.abs(dy)) go(page + (dx < 0 ? 1 : -1));
  };

  return createPortal(
    <div className="reader" role="dialog" aria-modal="true" aria-label={book.title}>
      <div className="reader-bar">
        <button type="button" className="icon-btn small" aria-label="Close book" onClick={onClose}><Icon name="left" size={18} /></button>
        <b className="reader-title" title={book.title}>{book.title}</b>
        <div className="reader-zoom">
          <button type="button" className="icon-btn small" aria-label="Zoom out" disabled={zoom <= ZOOMS[0]} onClick={() => zoomBy(-1)}>−</button>
          <span className="muted">{Math.round(zoom * 100)}%</span>
          <button type="button" className="icon-btn small" aria-label="Zoom in" disabled={zoom >= ZOOMS[ZOOMS.length - 1]} onClick={() => zoomBy(1)}>+</button>
        </div>
      </div>

      <div className="reader-body" ref={bodyRef} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        {error ? <p className="reader-msg">{error}</p>
          : !pdf ? <p className="reader-msg">Opening…</p>
          : <div className="reader-page"><canvas ref={canvasRef} aria-label={`Page ${page} of ${total}`} /></div>}
      </div>

      <div className="reader-nav">
        <button type="button" className="btn ghost small" disabled={!pdf || page <= 1} onClick={() => go(page - 1)}><Icon name="left" size={16} /> Prev</button>
        <form className="reader-jump" onSubmit={(e) => { e.preventDefault(); go(Number(pageText)); }}>
          <input inputMode="numeric" aria-label="Page number" disabled={!pdf} value={pageText} onChange={(e) => setPageText(e.target.value.replace(/\D/g, ""))}
            onBlur={() => setPageText(String(page))} />
          <span className="muted">of {total || "–"}</span>
        </form>
        <button type="button" className="btn ghost small" disabled={!pdf || page >= total} onClick={() => go(page + 1)}>Next <Icon name="right" size={16} /></button>
      </div>
    </div>,
    document.body
  );
}
