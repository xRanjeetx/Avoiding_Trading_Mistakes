import { useEffect, useRef } from "react";
import { Icon } from "./ui.jsx";

const OPEN_AT = 132; // px the row slides left to show the two buttons (2 x 66)

// One of the user's own lines. At rest it is just the line. Drag it left (finger or mouse) to show Edit and Delete behind
// it; on a laptop two small icons appear while the pointer is over the row or a button in it has focus. `open` and `onOpen`
// belong to the parent, so only one row is open at a time. A tap on an open row closes it instead of ticking the line.
export default function SwipeRow({ text, open, onOpen, onEdit, onDelete, children }) {
  const slide = useRef(null);
  const drag = useRef(null);
  const moved = useRef(false);

  const setX = (px) => { if (slide.current) slide.current.style.transform = px ? `translateX(${px}px)` : ""; };
  const start = (e) => {
    if (e.button > 0) return;
    drag.current = { x0: e.clientX, base: open ? -OPEN_AT : 0, dx: 0 };
    moved.current = false;
    slide.current.classList.add("drag");
  };
  const move = (e) => {
    const d = drag.current;
    if (!d) return;
    d.dx = e.clientX - d.x0;
    if (Math.abs(d.dx) > 6 && !moved.current) {
      moved.current = true;
      if (e.pointerType === "mouse") { try { slide.current.setPointerCapture(e.pointerId); } catch {} } // a finger is already tied to the row
    }
    if (moved.current) setX(Math.max(-OPEN_AT, Math.min(0, d.base + d.dx)));
  };
  const end = () => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    slide.current.classList.remove("drag");
    if (!moved.current) return;
    const shouldOpen = d.base + d.dx < -OPEN_AT / 2;
    setX(shouldOpen ? -OPEN_AT : 0);
    onOpen(shouldOpen);
  };
  // Keep the position in step when the parent opens or closes the row (another row opened, Escape, an action ran).
  useEffect(() => { if (!drag.current) setX(open ? -OPEN_AT : 0); }, [open]);

  const swallowTick = (e) => {
    if (moved.current) { e.preventDefault(); e.stopPropagation(); moved.current = false; return; }
    if (open) { e.preventDefault(); e.stopPropagation(); onOpen(false); }
  };

  return (
    <>
      <div className="chk-under">
        <button type="button" className="u-edit" tabIndex={open ? 0 : -1} aria-label={`Edit: ${text}`} onClick={onEdit}><Icon name="edit" size={18} />Edit</button>
        <button type="button" className="u-del" tabIndex={open ? 0 : -1} aria-label={`Delete: ${text}`} onClick={onDelete}><Icon name="trash" size={18} />Delete</button>
      </div>
      <div ref={slide} className="chk-slide" style={{ touchAction: "pan-y" }}
        onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onClickCapture={swallowTick}>
        {children}
      </div>
      <span className="chk-hint" aria-hidden="true" />
      <span className="chk-hov">
        <button type="button" className="chk-act" aria-label={`Edit: ${text}`} title="Edit" onClick={onEdit}><Icon name="edit" size={14} /></button>
        <button type="button" className="chk-act del" aria-label={`Delete: ${text}`} title="Delete" onClick={onDelete}><Icon name="trash" size={14} /></button>
      </span>
    </>
  );
}
