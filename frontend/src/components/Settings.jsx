import { useEffect, useRef, useState } from "react";
import { toCsv } from "../lib/csv.js";
import { num } from "../lib/format.js";
import { NO_NEWS, NO_RULE_EDITS, RULES } from "../lib/rules.js";
import { usdjpyPrice, valueBox } from "../lib/risk.js";
import { buildPayload, pairDraftOk, stateFromSettings, withNewsDraft, withPairDraft, withRuleDraft } from "../lib/settingsForm.js";
import { KILLZONE_NAMES, normalizeKillzones, nyClock, nyToLocal } from "../lib/killzones.js";
import { enable as enableNotifications, permission } from "../lib/reminders.js";
import { CardHead, Icon } from "./ui.jsx";

export default function Settings({ active, settings, reminders, onReminders, onSave, onClearAll, entries, onImport, onDeleteAccount, isAdmin }) {
  const [perm, setPerm] = useState(permission);

  const fileRef = useRef(null);
  const [importing, setImporting] = useState(false);
  function exportCsv() {
    const blob = new Blob(["﻿" + toCsv(entries)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `trade-guard-journal-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  async function pickFile(e) {
    const file = e.target.files[0];
    e.target.value = ""; // lets the same file be chosen again
    if (!file) return;
    setImporting(true);
    try {
      await onImport(file);
    } finally {
      setImporting(false);
    }
  }

  const [deleting, setDeleting] = useState(false);
  const [delPass, setDelPass] = useState("");
  const [delBusy, setDelBusy] = useState(false);
  async function submitDelete(e) {
    e.preventDefault();
    setDelBusy(true);
    const ok = await onDeleteAccount(delPass);
    if (!ok) setDelBusy(false); // on success the app signs out and this page goes away
  }
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
      const st = stateFromSettings(settings);
      setV(st.v); setPairs(st.pairs); setDraft(st.draft); setRules(st.rules); setRuleDraft(st.ruleDraft); setNews(st.news); setNewsDraft(st.newsDraft);
    }
  }, [active, settings]);

  const [pairs, setPairs] = useState([]);
  const [draft, setDraft] = useState({ pair: "", lot: "", value: "" });
  const editPair = (i, patch) => setPairs((ps) => ps.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const draftOk = pairDraftOk(draft, pairs);
  const jpy = usdjpyPrice(entries);
  function addPair() {
    if (!draftOk) return;
    setPairs(withPairDraft(pairs, draft));
    setDraft({ pair: "", lot: "", value: "" });
  }

  // Checklist rules: switch any rule off, or add your own yes/no rules. Saved with the Save button below.
  const [rules, setRules] = useState(NO_RULE_EDITS);
  const [ruleDraft, setRuleDraft] = useState({ title: "", q: "" });
  const isOn = (id) => !rules.disabled.includes(id);
  const flipRule = (id) => setRules((r) => ({ ...r, disabled: r.disabled.includes(id) ? r.disabled.filter((x) => x !== id) : [...r.disabled, id] }));
  const canAddRule = withRuleDraft(rules, ruleDraft) !== rules;
  function addRule() {
    if (!canAddRule) return;
    setRules(withRuleDraft(rules, ruleDraft));
    setRuleDraft({ title: "", q: "" });
  }
  const removeRule = (id) => setRules((r) => ({ ...r, custom: r.custom.filter((c) => c.id !== id), disabled: r.disabled.filter((x) => x !== id) }));
  const switchedOff = RULES.filter((r) => !isOn(r.id)).length + rules.custom.filter((r) => !isOn(r.id)).length;

  // High-impact news: add the date and time (your local time). Trading is locked for the lead time before each one.
  const [news, setNews] = useState(NO_NEWS);
  const [newsDraft, setNewsDraft] = useState({ when: "", title: "" });
  const canAddNews = withNewsDraft(news, newsDraft) !== news;
  function addNews() {
    if (!canAddNews) return;
    setNews(withNewsDraft(news, newsDraft));
    setNewsDraft({ when: "", title: "" });
  }
  const removeNews = (i) => setNews((n) => ({ ...n, events: n.events.filter((_, j) => j !== i) }));
  const newsWhen = (at) => new Date(at).toLocaleString([], { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const nowMs = Date.now();

  const zones = v.killzones || normalizeKillzones(settings.killzones);
  const editZone = (key, patch) => setV((x) => ({ ...x, killzones: zones.map((z) => (z.key === key ? { ...z, ...patch } : z)) }));
  const now = new Date();

  const save = () => onSave(buildPayload({ v, pairs, draft, rules, ruleDraft, news, newsDraft }, nowMs));

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
        <CardHead icon="wallet" title="Loss limits" />
        <div className="grid2">
          <label className="field"><span>Daily max loss ({settings.currency})</span>
            <input type="number" min="0" step="any" inputMode="decimal" placeholder="Off" {...bind("dailyLimit")} /></label>
          <label className="field"><span>Overall max loss ({settings.currency})</span>
            <input type="number" min="0" step="any" inputMode="decimal" placeholder="Off" {...bind("overallLimit")} /></label>
        </div>
        <div className="row-between loss-since">
          <span className="muted">Overall counting since: <b>{v.lossSince ? new Date(v.lossSince).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" }) : "your first trade"}</b></span>
          <span className="row">
            <button type="button" className="btn small" onClick={() => setV((x) => ({ ...x, lossSince: Date.now() }))}>Start from now</button>
            {v.lossSince && <button type="button" className="btn small ghost" onClick={() => setV((x) => ({ ...x, lossSince: null }))}>Count all</button>}
          </span>
        </div>
      </div>
      <div className="card">
        <CardHead icon="sliders" title="Pairs & lot sizes" />
        <div className="kz-list">
          {pairs.map((p, i) => (
            <div key={p.pair} className="kz-row pair-row">
              <b className="kz-name">{p.pair}</b>
              <input type="number" step="any" inputMode="decimal" aria-label={`${p.pair} lot size`} value={p.lot} onChange={(e) => editPair(i, { lot: e.target.value })} />
              <input type="number" step="any" inputMode="decimal" {...valueBox(p.pair, p.value, jpy)} aria-label={`${p.pair} value per 1.00 price move at 1 lot`} onChange={(e) => editPair(i, { value: e.target.value })} />
              <button type="button" className="btn small danger-outline" aria-label={`Remove ${p.pair}`} onClick={() => setPairs((ps) => ps.filter((_, j) => j !== i))}><Icon name="trash" size={16} /></button>
            </div>
          ))}
          <div className="kz-row pair-row">
            <input className="kz-name" placeholder="Pair e.g. GBPUSD" autoCapitalize="characters" autoComplete="off" value={draft.pair} onChange={(e) => setDraft((d) => ({ ...d, pair: e.target.value }))} />
            <input type="number" step="any" inputMode="decimal" placeholder="Lot" aria-label="New pair lot size" value={draft.lot} onChange={(e) => setDraft((d) => ({ ...d, lot: e.target.value }))} />
            <input type="number" step="any" inputMode="decimal" {...valueBox(draft.pair, draft.value, jpy)} aria-label="New pair value per 1.00 price move at 1 lot" onChange={(e) => setDraft((d) => ({ ...d, value: e.target.value }))} />
            <button type="button" className="btn small" disabled={!draftOk} onClick={addPair}><Icon name="check" size={16} /> Add</button>
          </div>
        </div>
      </div>
      <div className="card">
        <CardHead icon="check" title="Checklist rules">
          <span className={`chip ${switchedOff ? "warn" : "good"}`}>{switchedOff ? `${switchedOff} off` : "All on"}</span>
        </CardHead>
        <ul className="rule-edit">
          {RULES.map((r) => (
            <li key={r.id} className={isOn(r.id) ? "" : "off"}>
              <label>
                <input type="checkbox" className="rb-input" checked={isOn(r.id)} onChange={() => flipRule(r.id)} />
                <i className={`rb ${isOn(r.id) ? "on" : "off"}`} aria-hidden="true"><Icon name={isOn(r.id) ? "check" : "x"} size={16} /></i>
                <span><b>{r.title}</b><small>{r.type === "auto" ? "Checked automatically" : r.q}</small></span>
              </label>
            </li>
          ))}
          {rules.custom.map((r) => (
            <li key={r.id} className={isOn(r.id) ? "" : "off"}>
              <label>
                <input type="checkbox" className="rb-input" checked={isOn(r.id)} onChange={() => flipRule(r.id)} />
                <i className={`rb ${isOn(r.id) ? "on" : "off"}`} aria-hidden="true"><Icon name={isOn(r.id) ? "check" : "x"} size={16} /></i>
                <span><b>{r.title}</b><small>{r.q || "Your rule"}</small></span>
              </label>
              <button type="button" className="btn small danger-outline" aria-label={`Delete rule ${r.title}`} onClick={() => removeRule(r.id)}><Icon name="trash" size={16} /></button>
            </li>
          ))}
        </ul>
        <div className="rule-add">
          <input placeholder="Your rule, e.g. No trading before news" maxLength={60} aria-label="New rule title" value={ruleDraft.title} onChange={(e) => setRuleDraft((d) => ({ ...d, title: e.target.value }))} />
          <input placeholder="Question you answer Yes or No (optional)" maxLength={200} aria-label="New rule question" value={ruleDraft.q} onChange={(e) => setRuleDraft((d) => ({ ...d, q: e.target.value }))} />
          <button type="button" className="btn small" disabled={!canAddRule} onClick={addRule}><Icon name="plus" size={16} /> Add rule</button>
        </div>
        <p className="muted hint">Switch rules on or off, or add your own. Press Save settings to keep changes.</p>
      </div>
      <div className="card">
        <CardHead icon="wallet" title="Balance & currency" />
        <div className="grid2">
          <label className="field"><span>Starting balance</span><input type="number" step="any" inputMode="decimal" placeholder="optional" {...bind("balance")} /></label>
          <label className="field"><span>Currency symbol</span><input maxLength={4} placeholder="$" {...bind("currency")} /></label>
        </div>
      </div>
      <div className="card news-card">
        <CardHead icon="alert" title="High-impact news" />
        <label className="field"><span>Stop trading before news</span>
          <input type="number" min="1" max="1440" inputMode="numeric" {...bind("newsLead")} /></label>
        <ul className="rule-edit">
          {news.events.map((e, i) => (
            <li key={`${e.at}-${i}`} className={e.at <= nowMs ? "off" : ""}>
              <span><b>{e.title || "High-impact news"}</b><small>{newsWhen(e.at)}{e.at <= nowMs ? " · passed" : ""}</small></span>
              <button type="button" className="btn small danger-outline" aria-label={`Remove news ${e.title || newsWhen(e.at)}`} onClick={() => removeNews(i)}><Icon name="trash" size={16} /></button>
            </li>
          ))}
          {!news.events.length && <li><span><small>No news added yet.</small></span></li>}
        </ul>
        <div className="rule-add">
          <input type="datetime-local" aria-label="News date and time" value={newsDraft.when} onChange={(e) => setNewsDraft((d) => ({ ...d, when: e.target.value }))} />
          <input placeholder="Name, e.g. NFP or FOMC (optional)" maxLength={60} aria-label="News name" value={newsDraft.title} onChange={(e) => setNewsDraft((d) => ({ ...d, title: e.target.value }))} />
          <button type="button" className="btn small" disabled={!canAddNews} onClick={addNews}><Icon name="plus" size={16} /> Add news</button>
        </div>
        <p className="muted hint">The checklist locks from the set time before each news event until it passes. Press Save settings to keep changes.</p>
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

      <div className="card">
        <CardHead icon="book" title="Your data" />
        <p className="muted hint">Download every trade as a CSV file (opens in Excel or Google Sheets), or load trades from a file exported here. Importing never changes or duplicates trades you already have.</p>
        <div className="data-actions">
          <button type="button" className="btn ghost" disabled={!entries.length} onClick={exportCsv}><Icon name="download" size={16} /> Export CSV</button>
          <button type="button" className="btn ghost" disabled={importing} onClick={() => fileRef.current.click()}><Icon name="upload" size={16} /> {importing ? "Importing…" : "Import CSV"}</button>
          <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={pickFile} />
        </div>
      </div>

      <div className="card danger-zone">
        <CardHead icon="alert" title="Danger zone" />
        <p className="muted hint">Permanently deletes every trade and its history. This cannot be undone.</p>
        <div className="dz-actions">
          <button className="btn danger-outline" onClick={onClearAll}><Icon name="trash" size={16} /> Delete all data</button>
          {!isAdmin && !deleting && (
            <button className="btn danger-outline" onClick={() => setDeleting(true)}><Icon name="trash" size={16} /> Delete my account</button>
          )}
        </div>
        {!isAdmin && deleting && (
          <form className="del-account" onSubmit={submitDelete}>
            <p className="muted hint">This erases your account and all of your trades for good.</p>
            <label className="field">
              <input type="password" required autoFocus autoComplete="current-password" placeholder="Password" aria-label="Password" value={delPass} onChange={(e) => setDelPass(e.target.value)} />
            </label>
            <div className="data-actions">
              <button type="button" className="btn ghost" disabled={delBusy} onClick={() => { setDeleting(false); setDelPass(""); }}>Cancel</button>
              <button type="submit" className="btn danger-outline" disabled={delBusy || !delPass}><Icon name="trash" size={16} /> {delBusy ? "Deleting…" : "Delete my account"}</button>
            </div>
          </form>
        )}
      </div>
    </section>
  );
}
