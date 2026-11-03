import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

const GAP = 6;   // between the trigger and the menu
const EDGE = 8;  // the closest a menu may come to the screen edge

// Open/close state for a popover menu. Cards clip their contents, so the menu is drawn in the page body (createPortal in the
// component) at a fixed spot worked out from the trigger and the menu's real size: below the trigger, or above it when that
// has more room, nudged to stay fully on screen, and aligned to the trigger's right edge when it would run off the right.
// `width` is the menu's approximate width; `matchWidth` makes it at least as wide as the trigger. While open it follows the
// trigger when the page scrolls or the window resizes (staying on screen even when the trigger scrolls away), and closes only
// on a tap outside (not on the page scrollbar) or Escape.
export function useMenu({ width = 280, matchWidth = true } = {}) {
  const [open, setOpen] = useState(false);
  const [style, setStyle] = useState({});
  const box = useRef(null);
  const menu = useRef(null);

  const place = useCallback(() => {
    if (!box.current) return;
    const t = box.current.getBoundingClientRect();
    // A trigger scrolled out of sight pins the menu to the screen edge instead of taking it away.
    const r = { left: t.left, right: t.right, width: t.width, top: Math.min(Math.max(t.top, 0), window.innerHeight), bottom: Math.min(Math.max(t.bottom, 0), window.innerHeight) };
    const room = window.innerHeight - 2 * EDGE;
    const h = Math.min(menu.current?.offsetHeight || 340, room);
    const below = window.innerHeight - r.bottom - GAP - EDGE, above = r.top - GAP - EDGE;
    let top;
    if (h <= below) top = r.bottom + GAP;
    else if (h <= above) top = r.top - GAP - h;
    else top = Math.max(EDGE, Math.min(window.innerHeight - EDGE - h, below >= above ? r.bottom + GAP : r.top - GAP - h)); // no side fits: keep it on screen
    const pos = r.left + width > window.innerWidth - EDGE ? { right: Math.max(EDGE, window.innerWidth - r.right) } : { left: Math.max(EDGE, r.left) };
    setStyle({ ...pos, top, "--menu-max": `${room}px`, ...(matchWidth ? { minWidth: r.width } : {}) });
  }, [width, matchWidth]);

  // Once the menu is on screen its real height is known: place it again with that.
  useLayoutEffect(() => { if (open) place(); }, [open, place]);

  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => {
      if (box.current?.contains(e.target) || menu.current?.contains(e.target)) return;
      const root = document.documentElement;
      if (e.clientX >= root.clientWidth || e.clientY >= root.clientHeight) return; // grabbing the page scrollbar
      setOpen(false);
    };
    const key = (e) => { if (e.key === "Escape") setOpen(false); };
    const follow = (e) => {
      if (e.type === "scroll" && menu.current?.contains(e.target)) return; // scrolling the list itself
      place();
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", key);
    window.addEventListener("scroll", follow, true);
    window.addEventListener("resize", follow);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", key);
      window.removeEventListener("scroll", follow, true);
      window.removeEventListener("resize", follow);
    };
  }, [open, place]);

  const toggle = () => {
    if (!open) place();
    setOpen((o) => !o);
  };
  return { open, style, box, menu, toggle, close: () => setOpen(false) };
}
