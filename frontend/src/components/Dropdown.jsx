import { createPortal } from "react-dom";
import { Icon } from "./ui.jsx";
import { useMenu } from "./useMenu.js";

// A themed replacement for <select>: options are [{ value, label }]. The value is compared as a string.
export default function Dropdown({ value, options, onChange, label, className = "" }) {
  const { open, style, box, menu, toggle, close } = useMenu();
  const current = options.find((o) => o.value === value) || options[0];

  const move = (e) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const items = [...menu.current.querySelectorAll("button")];
    const at = items.indexOf(document.activeElement);
    const next = e.key === "ArrowDown" ? (at + 1) % items.length : (at - 1 + items.length) % items.length;
    items[next]?.focus();
  };

  return (
    <div className={`dd ${className}`} ref={box} onKeyDown={open ? move : undefined}>
      <button type="button" className="dd-trigger" aria-label={label} aria-haspopup="listbox" aria-expanded={open} onClick={toggle}>
        <span>{current ? current.label : ""}</span>
        <Icon name="chevron" size={16} />
      </button>
      {open && createPortal(
        <ul className="dd-menu" role="listbox" aria-label={label} ref={menu} style={style}>
          {options.map((o) => (
            <li key={o.value} role="option" aria-selected={o.value === value}>
              <button type="button" className={o.value === value ? "on" : ""} autoFocus={o.value === value} onClick={() => { onChange(o.value); close(); }}>
                {o.label}{o.value === value && <Icon name="check" size={16} />}
              </button>
            </li>
          ))}
        </ul>,
        document.body,
      )}
    </div>
  );
}
