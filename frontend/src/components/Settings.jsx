import { useEffect, useState } from "react";
import { num } from "../lib/format.js";
import { CardHead, Icon } from "./ui.jsx";

const DEFAULTS = { lot: 0.02, minRR: 2, maxTrades: 4, maxSL: 4, londonStart: "12:30", londonEnd: "17:30", sessionStart: "18:00", sessionEnd: "22:30", balance: 0, currency: "$" };

export default function Settings({ active, settings, onSave, onClearAll, onLogout, email }) {
  const [v, setV] = useState({});
  const text = (key) => String(v[key] ?? "");
  const bind = (key) => ({ value: text(key), onChange: (e) => setV((x) => ({ ...x, [key]: e.target.value })) });

  // Reload the form from saved settings whenever the tab is opened.
  useEffect(() => {
    if (active) setV({ ...settings, balance: settings.balance || "" });
  }, [active, settings]);

  function save() {
    onSave({
      lot: num(v.lot) ?? DEFAULTS.lot,
      minRR: num(v.minRR) ?? DEFAULTS.minRR,
      maxTrades: Math.max(1, Math.round(num(v.maxTrades) ?? DEFAULTS.maxTrades)),
      maxSL: Math.max(1, Math.round(num(v.maxSL) ?? DEFAULTS.maxSL)),
      balance: Math.max(0, num(v.balance) ?? 0),
      currency: String(v.currency || "").trim() || DEFAULTS.currency,
      londonStart: v.londonStart || DEFAULTS.londonStart,
      londonEnd: v.londonEnd || DEFAULTS.londonEnd,
      sessionStart: v.sessionStart || DEFAULTS.sessionStart,
      sessionEnd: v.sessionEnd || DEFAULTS.sessionEnd,
    });
  }

  return (
    <section id="settings" className={`tab ${active ? "active" : ""}`}>
      <div className="card">
        <CardHead icon="shield" title="Risk rules" />
        <div className="grid2">
          <label className="field"><span>Fixed lot size</span><input type="number" step="0.01" inputMode="decimal" {...bind("lot")} /></label>
          <label className="field"><span>Minimum RR (1:x)</span><input type="number" step="0.1" inputMode="decimal" {...bind("minRR")} /></label>
          <label className="field"><span>Max trades / day</span><input type="number" min="1" inputMode="numeric" {...bind("maxTrades")} /></label>
          <label className="field"><span>Max SL / day</span><input type="number" min="1" inputMode="numeric" {...bind("maxSL")} /></label>
        </div>
      </div>
      <div className="card">
        <CardHead icon="wallet" title="Balance & currency" />
        <div className="grid2">
          <label className="field"><span>Starting balance</span><input type="number" step="any" inputMode="decimal" placeholder="optional" {...bind("balance")} /></label>
          <label className="field"><span>Currency symbol</span><input maxLength={4} placeholder="$" {...bind("currency")} /></label>
        </div>
      </div>
      <div className="card">
        <CardHead icon="globe" title="Sessions"><span className="chip">device time</span></CardHead>
        <div className="grid2">
          <label className="field"><span>London start</span><input type="time" {...bind("londonStart")} /></label>
          <label className="field"><span>London end</span><input type="time" {...bind("londonEnd")} /></label>
          <label className="field"><span>My session start</span><input type="time" {...bind("sessionStart")} /></label>
          <label className="field"><span>My session end</span><input type="time" {...bind("sessionEnd")} /></label>
        </div>
        <p className="muted hint">The defaults are set for India (IST). Adjust them when daylight saving time changes in London or New York.</p>
      </div>
      <div className="actions">
        <button className="btn primary" onClick={save}><Icon name="check" size={18} /> Save settings</button>
      </div>

      <div className="card">
        <CardHead icon="user" title="Account" />
        <div className="acct">
          <span className="avatar">{email.charAt(0).toUpperCase()}</span>
          <div><small>Signed in as</small><b>{email}</b></div>
          <button className="btn small" onClick={onLogout}><Icon name="logout" size={16} /> Log out</button>
        </div>
      </div>

      <div className="card danger-zone">
        <CardHead icon="alert" title="Danger zone" />
        <p className="muted hint">Permanently deletes every trade and its history. This cannot be undone.</p>
        <button className="btn danger-outline" onClick={onClearAll}><Icon name="trash" size={16} /> Delete all data</button>
      </div>
    </section>
  );
}
