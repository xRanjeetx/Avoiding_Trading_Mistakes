import { useEffect, useRef, useState } from "react";
import { RULES } from "../lib/rules.js";
import { evaluate, ruleTitle, todayCounts } from "../lib/evaluate.js";
import { num } from "../lib/format.js";

const fresh = (lot) => ({ pair: "", dir: null, setup: null, lot: String(lot), entry: "", sl: "", tp: "", notes: "", answers: {} });
const AUTO = RULES.filter((r) => r.type === "auto");
const SELF = RULES.filter((r) => r.type === "self");

export default function Checklist({ active, entries, settings, now, onLog, onProgress }) {
  const [form, setForm] = useState(() => fresh(settings.lot));
  const [busy, setBusy] = useState(false);
  const verdictRef = useRef(null);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  useEffect(() => { set({ lot: String(settings.lot) }); }, [settings.lot]);

  const f = {
    pair: form.pair.trim().toUpperCase(), dir: form.dir, setup: form.setup,
    lot: num(form.lot), entry: num(form.entry), sl: num(form.sl), tp: num(form.tp),
  };
  const ev = evaluate({ f, answers: form.answers, entries, settings, now });

  const passed = RULES.length - ev.failed.length - ev.pending.length;
  const state = ev.failed.length ? "no" : ev.ok ? "ok" : "pending";
  useEffect(() => { onProgress({ passed, state }); }, [passed, state]);

  const autoPass = AUTO.filter((r) => ev.res[r.id].pass === true).length;
  const autoFail = AUTO.some((r) => ev.res[r.id].pass === false);
  const answered = SELF.filter((r) => form.answers[r.id] !== undefined).length;
  const selfFail = SELF.some((r) => ev.res[r.id].pass === false);

  const c = todayCounts(entries);
  const lockMsg = c.sl >= settings.maxSL
    ? `🔒 ${c.sl} SL hit today. Trading is done for today. Close the charts.`
    : c.trades >= settings.maxTrades ? `🔒 ${c.trades} trades taken today. Daily limit reached.` : "";

  async function log() {
    if (!ev.ok || busy) return;
    setBusy(true);
    const ok = await onLog({
      timestamp: Date.now(),
      pair: f.pair, dir: f.dir, setup: f.setup, lot: f.lot, entry: f.entry, sl: f.sl, tp: f.tp,
      rr: ev.rr ? +ev.rr.toFixed(2) : null,
      answers: { ...form.answers },
      failedRules: [],
      traded: true, result: "open", pnl: null, exit: null, closedAt: null,
      notes: form.notes.trim(), lesson: "",
    });
    setBusy(false);
    if (ok) {
      setForm(fresh(settings.lot));
      window.scrollTo({ top: 0 });
    }
  }

  const rrChip = ev.rr
    ? { text: `RR 1:${ev.rr.toFixed(2)}`, cls: ev.res[2].pass ? "good" : "bad" }
    : { text: ev.res[2].pass === false ? "RR invalid" : "RR –", cls: ev.res[2].pass === false ? "bad" : "" };

  return (
    <>
    <section id="checklist" className={`tab ${active ? "active" : ""}`}>
      {lockMsg && <div className="banner">{lockMsg}</div>}

      <div className="card">
        <div className="card-head"><h2>Trade setup</h2><span className={`chip ${rrChip.cls}`}>{rrChip.text}</span></div>
        <label className="field">
          <span>Pair</span>
          <input value={form.pair} onChange={(e) => set({ pair: e.target.value })} placeholder="e.g. XAUUSD" autoComplete="off" autoCapitalize="characters" spellCheck="false" />
        </label>
        <div className="seg" id="dir">
          <button type="button" data-val="buy" className={form.dir === "buy" ? "on" : ""} onClick={() => set({ dir: "buy" })}>▲ Buy</button>
          <button type="button" data-val="sell" className={form.dir === "sell" ? "on" : ""} onClick={() => set({ dir: "sell" })}>▼ Sell</button>
        </div>
        <div className="field">
          <span>Setup</span>
          <div className="seg" id="setup">
            <button type="button" data-val="fvg" className={form.setup === "fvg" ? "on" : ""} onClick={() => set({ setup: "fvg" })}>5m FVG</button>
            <button type="button" data-val="wick" className={form.setup === "wick" ? "on" : ""} onClick={() => set({ setup: "wick" })}>5m Wick FVG</button>
          </div>
        </div>
        <div className="grid2">
          <label className="field"><span>Lot size</span><input type="number" step="0.01" inputMode="decimal" value={form.lot} onChange={(e) => set({ lot: e.target.value })} /></label>
          <label className="field"><span>Entry</span><input type="number" step="any" inputMode="decimal" placeholder="0.00" value={form.entry} onChange={(e) => set({ entry: e.target.value })} /></label>
          <label className="field"><span>Stop loss</span><input type="number" step="any" inputMode="decimal" placeholder="0.00" value={form.sl} onChange={(e) => set({ sl: e.target.value })} /></label>
          <label className="field"><span>Take profit</span><input type="number" step="any" inputMode="decimal" placeholder="0.00" value={form.tp} onChange={(e) => set({ tp: e.target.value })} /></label>
        </div>
        <label className="field">
          <span>Why this trade? (optional)</span>
          <textarea rows="2" placeholder="Setup, confirmation, what you saw on the chart…" value={form.notes} onChange={(e) => set({ notes: e.target.value })} />
        </label>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>Auto checks</h2>
          <span className={`chip ${autoFail ? "bad" : autoPass === AUTO.length ? "good" : ""}`}>{autoPass}/{AUTO.length}</span>
        </div>
        <ul className="rules">
          {AUTO.map((r) => {
            const { pass, detail } = ev.res[r.id];
            return (
              <li key={r.id} className={pass === true ? "pass" : pass === false ? "fail" : ""}>
                <span className="num">{r.id}</span>
                <div className="body"><div className="title">{ruleTitle(r.id, settings)}</div><div className="sub">{detail}</div></div>
                <span className="status">{pass === true ? "✅" : pass === false ? "❌" : "⏳"}</span>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>Be honest with yourself</h2>
          <span className={`chip ${selfFail ? "bad" : answered === SELF.length ? "good" : ""}`}>{answered}/{SELF.length} answered</span>
        </div>
        <ul className="rules">
          {SELF.map((r) => {
            const { pass } = ev.res[r.id];
            const a = form.answers[r.id];
            const answer = (v) => set({ answers: { ...form.answers, [r.id]: v } });
            return (
              <li key={r.id} className={pass === true ? "pass" : pass === false ? "fail" : ""}>
                <span className="num">{r.id}</span>
                <div className="body"><div className="title">{r.title}</div><div className="sub">{r.q}</div></div>
                <div className="yn">
                  <button className={`yes ${a === true ? "on" : ""}`} onClick={() => answer(true)}>Yes</button>
                  <button className={`no ${a === false ? "on" : ""}`} onClick={() => answer(false)}>No</button>
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      <div id="verdict" ref={verdictRef} className={`verdict ${ev.failed.length ? "no" : ev.pending.length ? "pending" : "ok"}`}>
        {ev.failed.length ? (
          <>
            <div className="icon">⛔</div><h3>DO NOT TRADE</h3>
            <p>You are breaking {ev.failed.length} rule{ev.failed.length > 1 ? "s" : ""}. Close the chart and walk away.</p>
            <ul>{ev.failed.map((id) => <li key={id}><b>#{id}</b> {ruleTitle(id, settings)}</li>)}</ul>
          </>
        ) : ev.pending.length ? (
          <><div className="icon">⏳</div><h3>Not ready yet</h3><p>{ev.pending.length} item{ev.pending.length > 1 ? "s" : ""} still to fill or answer.</p></>
        ) : (
          <><div className="icon">✅</div><h3>OK TO TRADE</h3><p>All {RULES.length} rules respected. Stick to the plan, no changes after entry.</p></>
        )}
      </div>

      <div className="actions">
        <button className="btn primary" disabled={!ev.ok || busy} onClick={log}>✓ Log this trade</button>
        <button className="btn ghost" onClick={() => setForm(fresh(settings.lot))}>Reset form</button>
      </div>

    </section>
      {/* Outside the section: .tab animates with a transform, which would re-anchor a fixed child. */}
      {active && (
        <div id="dock" className={`dock ${state}`}>
          <div>
            {ev.failed.length ? `⛔ ${ev.failed.length} rule${ev.failed.length > 1 ? "s" : ""} broken`
              : ev.ok ? "✅ OK to trade" : `⏳ ${ev.pending.length} left to check`}
          </div>
          <button className="btn small" onClick={() => (ev.ok ? log() : verdictRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }))}>
            {ev.ok ? "Log trade" : "Review"}
          </button>
        </div>
      )}
    </>
  );
}
