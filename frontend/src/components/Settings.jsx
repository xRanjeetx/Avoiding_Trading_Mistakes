import { useEffect, useState } from "react";
import { num } from "../lib/format.js";
import { KILLZONE_NAMES, normalizeKillzones, nyClock, nyToLocal } from "../lib/killzones.js";
import { enable as enableNotifications, permission } from "../lib/reminders.js";
import { CardHead, Icon } from "./ui.jsx";

const DEFAULTS = { lot: 0.02, minRR: 2, maxTrades: 4, maxSL: 4, balance: 0, currency: "$" };

export default function Settings({ active, settings, reminders, onReminders, onSave, onClearAll }) {
  const [perm, setPerm] = useState(permission);
  async function toggleReminders(on) {
    if (on) {
      const p = await enableNotifications();
      setPerm(p);
      onReminders({ on: p === "granted" });
    } else {
      onReminders({ on: false });
    }
  }
  const tick = (key, lo, hi) => (e) => {
    const n = Math.round(Number(e.target.value));
    if (Number.isFinite(n) && n >= lo && n <= hi) onReminders({ [key]: n });
  };

  const [v, setV] = useState({});
  const text = (key) => String(v[key] ?? "");
  const bind = (key) => ({ value: text(key), onChange: (e) => setV((x) => ({ ...x, [key]: e.target.value })) });

  // Reload the form from saved settings whenever the tab is opened.
  useEffect(() => {
    if (active) {
      setV({ ...settings, balance: settings.balance || "", killzones: normalizeKillzones(settings.killzones) });
      setPairs((settings.pairs || []).map((p) => ({ pair: p.pair, lot: String(p.lot) })));
    }
  }, [active, settings]);

  const [pairs, setPairs] = useState([]);
  const [draft, setDraft] = useState({ pair: "", lot: "" });
  const editPair = (i, patch) => setPairs((ps) => ps.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const cleanPair = (s) => s.toUpperCase().replace(/[^A-Z0-9._-]/g, "");
  const draftOk = cleanPair(draft.pair) && num(draft.lot) > 0 && !pairs.some((p) => p.pair === cleanPair(draft.pair));
  function addPair() {
    if (!draftOk) return;
    setPairs((ps) => [...ps, { pair: cleanPair(draft.pair), lot: draft.lot }]);
    setDraft({ pair: "", lot: "" });
  }

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
      // a half-typed "add pair" row is saved too, so pressing Save never silently drops it
      pairs: [...pairs, ...(draftOk ? [{ pair: cleanPair(draft.pair), lot: draft.lot }] : [])]
        .filter((p) => p.pair && num(p.lot) > 0)
        .map((p) => ({ pair: p.pair, lot: num(p.lot) })),
    });
  }

  return (
    <section id="settings" className={`tab ${active ? "active" : ""}`}>
      <div className="card">
        <CardHead icon="shield" title="Risk rules" />
        <div className="grid2">
          <label className="field"><span>Default lot (other pairs)</span><input type="number" step="0.01" inputMode="decimal" {...bind("lot")} /></label>
          <label className="field"><span>Minimum RR (1:x)</span><input type="number" step="0.1" inputMode="decimal" {...bind("minRR")} /></label>
          <label className="field"><span>Max trades / day</span><input type="number" min="1" inputMode="numeric" {...bind("maxTrades")} /></label>
          <label className="field"><span>Max SL / day</span><input type="number" min="1" inputMode="numeric" {...bind("maxSL")} /></label>
        </div>
      </div>
      <div className="card">
        <CardHead icon="sliders" title="Pairs & lot sizes" />
        <div className="kz-list">
          {pairs.map((p, i) => (
            <div key={p.pair} className="kz-row">
              <b className="kz-name">{p.pair}</b>
              <input type="number" step="any" inputMode="decimal" aria-label={`${p.pair} lot size`} value={p.lot} onChange={(e) => editPair(i, { lot: e.target.value })} />
              <button type="button" className="btn small danger-outline" aria-label={`Remove ${p.pair}`} onClick={() => setPairs((ps) => ps.filter((_, j) => j !== i))}><Icon name="trash" size={16} /></button>
            </div>
          ))}
          <div className="kz-row">
            <input className="kz-name" placeholder="Pair e.g. GBPUSD" autoCapitalize="characters" autoComplete="off" value={draft.pair} onChange={(e) => setDraft((d) => ({ ...d, pair: e.target.value }))} />
            <input type="number" step="any" inputMode="decimal" placeholder="Lot" aria-label="New pair lot size" value={draft.lot} onChange={(e) => setDraft((d) => ({ ...d, lot: e.target.value }))} />
            <button type="button" className="btn small" disabled={!draftOk} onClick={addPair}><Icon name="check" size={16} /> Add</button>
          </div>
        </div>
        <p className="muted hint">The lot-size rule uses the lot set here for the pair you trade. Pairs not listed use the default lot above. Press Save settings to keep changes.</p>
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
      <div className="card">
        <CardHead icon="bolt" title="Reminders"><span className="chip">This device</span></CardHead>
        <label className="rem-toggle">
          <input type="checkbox" checked={reminders.on && perm === "granted"} disabled={perm === "unsupported" || perm === "denied"} onChange={(e) => toggleReminders(e.target.checked)} />
          <span><b>Notify me</b><small>Before a session opens, and when a trade stays open too long</small></span>
        </label>
        <div className="grid2">
          <label className="field"><span>Before a session opens (min)</span><input type="number" min="1" max="60" inputMode="numeric" key={`l${reminders.lead}`} defaultValue={reminders.lead} onChange={tick("lead", 1, 60)} /></label>
          <label className="field"><span>Trade open longer than (min)</span><input type="number" min="15" max="1440" inputMode="numeric" key={`m${reminders.longMin}`} defaultValue={reminders.longMin} onChange={tick("longMin", 15, 1440)} /></label>
        </div>
        {(perm === "unsupported" || perm === "denied") && (
          <p className="muted hint">
            {perm === "unsupported" ? "This browser cannot show notifications."
              : "Notifications are blocked for this site. Allow them in your browser’s site settings, then switch this on."}
          </p>
        )}
      </div>
      <div className="actions">
        <button className="btn primary" onClick={save}><Icon name="check" size={18} /> Save settings</button>
      </div>

      <div className="card danger-zone">
        <CardHead icon="alert" title="Danger zone" />
        <p className="muted hint">Permanently deletes every trade and its history. This cannot be undone.</p>
        <button className="btn danger-outline" onClick={onClearAll}><Icon name="trash" size={16} /> Delete all data</button>
      </div>
    </section>
  );
}
