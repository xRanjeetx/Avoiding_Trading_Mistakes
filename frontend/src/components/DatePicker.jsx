import { useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./ui.jsx";
import { useMenu } from "./useMenu.js";

const pad = (n) => String(n).padStart(2, "0");
const iso = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;
const todayIso = () => { const t = new Date(); return iso(t.getFullYear(), t.getMonth(), t.getDate()); };
const WEEK = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

function show(day, time) {
  if (!day) return "";
  const [y, m, d] = day.split("-").map(Number);
  const text = new Date(y, m - 1, d).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });
  return time ? `${text}, ${time}` : text;
}

// A calendar popover in place of <input type="date"> (or datetime-local with `time`). `value` is "YYYY-MM-DD", or
// "YYYY-MM-DDTHH:mm" with `time`; "" means none. `min` and `max` are "YYYY-MM-DD".
export default function DatePicker({ value, onChange, label, min, max, time = false, placeholder = "Select date" }) {
  const { open, style, box, menu, toggle, close } = useMenu({ width: 296, matchWidth: false });
  const [day, clock = "09:00"] = (value || "").split("T");
  const [view, setView] = useState(null); // { y, m } of the month on show, null = the month of the chosen day
  const shown = view || (() => { const [y, m] = (day || todayIso()).split("-").map(Number); return { y, m: m - 1 }; })();

  const emit = (d, t = clock) => onChange(d ? (time ? `${d}T${t}` : d) : "");
  const step = (n) => { const d = new Date(shown.y, shown.m + n, 1); setView({ y: d.getFullYear(), m: d.getMonth() }); };
  const first = new Date(shown.y, shown.m, 1);
  const lead = (first.getDay() + 6) % 7; // blanks before the 1st, with Monday first
  const count = new Date(shown.y, shown.m + 1, 0).getDate();
  const cells = [...Array(lead).fill(null), ...Array.from({ length: count }, (_, i) => i + 1)];
  const blocked = (d) => (min && d < min) || (max && d > max);
  const today = todayIso();

  return (
    <div className="dd dp" ref={box}>
      <button type="button" className={`dd-trigger ${day ? "" : "empty"}`} aria-label={label} aria-haspopup="dialog" aria-expanded={open}
        onClick={() => { setView(null); toggle(); }}>
        <Icon name="calendar" size={16} />
        <span>{day ? show(day, time ? clock : "") : placeholder}</span>
      </button>
      {open && createPortal(
        <div className="dd-menu dp-menu" role="dialog" aria-label={label} ref={menu} style={style}>
          <div className="dp-head">
            <button type="button" className="dp-nav" aria-label="Previous month" onClick={() => step(-1)}><Icon name="left" size={18} /></button>
            <b>{first.toLocaleDateString([], { month: "long", year: "numeric" })}</b>
            <button type="button" className="dp-nav" aria-label="Next month" onClick={() => step(1)}><span className="flip"><Icon name="left" size={18} /></span></button>
          </div>
          <div className="dp-grid">
            {WEEK.map((w) => <small key={w}>{w}</small>)}
            {cells.map((d, i) => {
              if (d == null) return <i key={`b${i}`} />;
              const id = iso(shown.y, shown.m, d);
              return (
                <button key={id} type="button" disabled={blocked(id)} className={`${id === day ? "on" : ""} ${id === today ? "today" : ""}`}
                  aria-label={show(id, "")} aria-pressed={id === day} onClick={() => { emit(id); if (!time) close(); }}>{d}</button>
              );
            })}
          </div>
          <div className="dp-foot">
            {time && <input type="time" aria-label={`${label} time`} value={clock} onChange={(e) => e.target.value && emit(day || today, e.target.value)} />}
            <button type="button" className="dp-link" disabled={blocked(today)} onClick={() => { emit(today); setView(null); if (!time) close(); }}>Today</button>
            <button type="button" className="dp-link" disabled={!day} onClick={() => { onChange(""); close(); }}>Clear</button>
            {time && <button type="button" className="dp-link done" onClick={close}>Done</button>}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
