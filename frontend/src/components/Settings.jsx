import { useEffect, useState } from "react";
import { num } from "../lib/format.js";
import { KILLZONE_NAMES, normalizeKillzones, nyClock, nyToLocal } from "../lib/killzones.js";
import { CardHead, Icon } from "./ui.jsx";

const DEFAULTS = { lot: 0.02, minRR: 2, maxTrades: 4, maxSL: 4, balance: 0, currency: "$" };

export default function Settings({ active, settings, onSave, onClearAll, onLogout, email }) {
  const [v, setV] = useState({});
  const text = (key) => String(v[key] ?? "");
  const bind = (key) => ({ value: text(key), onChange: (e) => setV((x) => ({ ...x, [key]: e.target.value })) });

  // Reload the form from saved settings whenever the tab is opened.
  useEffect(() => {
    if (active) setV({ ...settings, balance: settings.balance || "", killzones: normalizeKillzones(settings.killzones) });
  }, [active, settings]);

  const zones = v.killzones || normalizeKillzones(settings.killzones);
  const editZone = (key, patch) => setV((x) => ({ ...x, killzones: zones.map((z) => (z.key === key ? { ...z, ...patch } : z)) }));
  const now = new Date();

  function save() {
    onSave({
      lot: num(v.lot) ?? DEFAULTS.lot,
      minRR: num(v.minRR) ?? DEFAULTS.minRR,
      maxTrades: Math.max(1, Math.round(num(v.maxTrades) ?? DEFAULTS.maxTrades)),
      maxSL: Math.max(1, Math.round(num(v.maxSL) ?? DEFAULTS.maxSL)),
      balance: Math.max(0, num(v.balance) ?? 0),
      currency: String(v.currency || "").trim() || DEFAULTS.currency,
      killzones: normalizeKillzones(zones),
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
        <CardHead icon="clock" title="Market sessions"><span className="chip">New York time</span></CardHead>
        <div className="kz-list">
          {zones.map((z) => (
            <div key={z.key} className={`kz-row ${z.on ? "" : "off"}`} style={{ "--kz": z.color }}>
              <label className="kz-name">
                <input type="checkbox" checked={z.on} onChange={(e) => editZone(z.key, { on: e.target.checked })} />
                <i aria-hidden="true" />
                <b>{KILLZONE_NAMES[z.key]}</b>
              </label>
              <div className="kz-times">
                <input type="time" aria-label={`${KILLZONE_NAMES[z.key]} start`} value={z.start} onChange={(e) => e.target.value && editZone(z.key, { start: e.target.value })} />
                <span>–</span>
                <input type="time" aria-label={`${KILLZONE_NAMES[z.key]} end`} value={z.end} onChange={(e) => e.target.value && editZone(z.key, { end: e.target.value })} />
              </div>
              <input type="color" className="kz-color" aria-label={`${KILLZONE_NAMES[z.key]} colour`} value={z.color} onChange={(e) => editZone(z.key, { color: e.target.value })} />
              <small className="kz-local">{nyToLocal(z.start, now)}–{nyToLocal(z.end, now)} your time</small>
            </div>
          ))}
        </div>
        <p className="muted hint">Times are New York time (now {nyClock(now).label}), so daylight saving changes there need no edit. The checklist allows a trade only while one of the switched-on sessions is live.</p>
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
