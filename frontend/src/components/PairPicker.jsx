import { createPortal } from "react-dom";
import { Icon } from "./ui.jsx";
import { useMenu } from "./useMenu.js";

// The pair box on the checklist: type any pair, or open the list of pairs registered in Settings and tap one.
export default function PairPicker({ value, pairs, onChange }) {
  const { open, style, box, menu, toggle, close } = useMenu();

  const pick = (pair) => { onChange(pair); close(); };
  return (
    <div className="field">
      <span>Pair</span>
      <div className="pair-picker" ref={box}>
        <input value={value} onChange={(e) => onChange(e.target.value)} placeholder="e.g. XAUUSD" autoComplete="off" autoCapitalize="characters" spellCheck="false" />
        <button type="button" className="pair-toggle" aria-label="Show registered pairs" aria-expanded={open} disabled={!pairs.length} onClick={toggle}>
          <Icon name="chevron" size={18} />
        </button>
        {open && createPortal(
          <ul className="pair-menu" role="listbox" aria-label="Registered pairs" ref={menu} style={style}>
            {pairs.map((p) => (
              <li key={p.pair} role="option" aria-selected={p.pair === value.trim().toUpperCase()}>
                <button type="button" className={p.pair === value.trim().toUpperCase() ? "on" : ""} onClick={() => pick(p.pair)}>
                  <b>{p.pair}</b><small>Lot {p.lot}</small>
                </button>
              </li>
            ))}
          </ul>,
          document.body,
        )}
      </div>
    </div>
  );
}
