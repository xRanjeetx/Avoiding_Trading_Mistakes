import { useEffect, useRef, useState } from "react";
import { activeRules, isRuleOn } from "../lib/rules.js";
import { cooldownFor, evaluate, lotFor, newsLock, newsWarning, ruleTitle, todayCounts } from "../lib/evaluate.js";
import { fmtDuration } from "../lib/killzones.js";
import { num } from "../lib/format.js";
import EmotionPicker from "./EmotionPicker.jsx";
import { CardHead, Icon } from "./ui.jsx";

const fresh = (lot) => ({ pair: "", dir: null, setup: null, emotion: null, lot: String(lot), entry: "", sl: "", tp: "", notes: "", answers: {} });

function Status({ pass }) {
  return pass === true
    ? <span className="st ok"><Icon name="check" size={16} /></span>
    : pass === false ? <span className="st bad"><Icon name="x" size={16} /></span>
    : <span className="st wait"><Icon name="clock" size={16} /></span>;
}

export default function Checklist({ active, entries, settings, calendar, now, onLog, onProgress }) {
  // Only the rules switched on in Settings are checked; the user's own rules come after the built-in ones.
  const rules = activeRules(settings);
  const AUTO = rules.filter((r) => r.type === "auto");
  const SELF = rules.filter((r) => r.type === "self");
  const [form, setForm] = useState(() => fresh(settings.lot));
  const [busy, setBusy] = useState(false);
  const verdictRef = useRef(null);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  useEffect(() => { set({ lot: String(lotFor(settings, form.pair)) }); }, [settings.lot, settings.pairs]);

  const f = {
    pair: form.pair.trim().toUpperCase(), dir: form.dir, setup: form.setup,
    lot: num(form.lot), entry: num(form.entry), sl: num(form.sl), tp: num(form.tp),
  };
  const ev = evaluate({ f, answers: form.answers, entries, settings, now, calendar });

  const passed = rules.length - ev.failed.length - ev.pending.length;
  const state = ev.failed.length ? "no" : ev.ok ? "ok" : "pending";
  useEffect(() => { onProgress({ passed, state }); }, [passed, state]);

  const autoPass = AUTO.filter((r) => ev.res[r.id].pass === true).length;
  const autoFail = AUTO.some((r) => ev.res[r.id].pass === false);
  const answered = SELF.filter((r) => form.answers[r.id] !== undefined).length;
  const selfFail = SELF.some((r) => ev.res[r.id].pass === false);

  const cooling = isRuleOn(settings, 30) ? cooldownFor(entries, f.pair, now) : null;
  const newsHold = isRuleOn(settings, 32) ? newsLock(settings, now, calendar, f.pair) : null;
  const newsHeads = isRuleOn(settings, 32) && !newsHold ? newsWarning(settings, now, calendar, f.pair) : null;
  const c = todayCounts(entries);
  const lockMsg = isRuleOn(settings, 19) && c.sl >= settings.maxSL
    ? `${c.sl} SL hit today. Trading is done for today. Close the charts.`
    : isRuleOn(settings, 15) && c.trades >= settings.maxTrades ? `${c.trades} trades taken today. Daily limit reached.` : "";

  async function log() {
    if (!ev.ok || busy) return;
    setBusy(true);
    const ok = await onLog({
      timestamp: Date.now(),
      pair: f.pair, dir: f.dir, setup: f.setup, lot: f.lot, entry: f.entry, sl: f.sl, tp: f.tp,
      rr: ev.rr ? +ev.rr.toFixed(2) : null,
      answers: { ...form.answers },
      emotion: form.emotion,
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

  const heroText = ev.failed.length ? "Rules broken. Do not trade." : ev.ok ? "All clear. OK to trade." : "Complete the checklist below.";

  return (
    <>
    <section id="checklist" className={`tab ${active ? "active" : ""}`}>
      {lockMsg && <div className="banner lock"><Icon name="lock" size={20} />{lockMsg}</div>}
      {newsHold && <div className="banner lock"><Icon name="lock" size={20} />{newsHold.event.title || "High-impact news"} in {fmtDuration(newsHold.inMin)}. Trading is locked until it passes.</div>}
      {newsHeads && <div className="banner lock warn"><Icon name="alert" size={20} />{newsHeads.event.title || "Medium-impact news"} in {fmtDuration(newsHeads.inMin)} (medium impact). Trade with care.</div>}
      {cooling && <div className="banner lock"><Icon name="lock" size={20} />{f.pair} lost a trade. Locked for {cooling.leftMin} more min. Breathe, or look at another pair.</div>}

      <div className={`ready ${state}`}>
        <div className="ready-top">
          <div><small>Trade readiness</small><strong>{heroText}</strong></div>
          <span className="ready-count"><b>{passed}</b>/{rules.length}</span>
        </div>
        <div className="ready-track"><i style={{ width: `${rules.length ? (passed / rules.length) * 100 : 100}%` }} /></div>
      </div>

      <div className="card">
        <CardHead icon="sliders" title="Trade setup"><span className={`chip ${rrChip.cls}`}>{rrChip.text}</span></CardHead>
        <label className="field">
          <span>Pair</span>
          <input list="pair-options" value={form.pair} onChange={(e) => set({ pair: e.target.value, lot: String(lotFor(settings, e.target.value)) })} placeholder="e.g. XAUUSD" autoComplete="off" autoCapitalize="characters" spellCheck="false" />
          <datalist id="pair-options">{(settings.pairs || []).map((p) => <option key={p.pair} value={p.pair} />)}</datalist>
        </label>
        <div className="field">
          <span>Direction</span>
          <div className="seg" id="dir">
            <button type="button" data-val="buy" className={form.dir === "buy" ? "on" : ""} onClick={() => set({ dir: "buy" })}><Icon name="up" size={16} /> Buy</button>
            <button type="button" data-val="sell" className={form.dir === "sell" ? "on" : ""} onClick={() => set({ dir: "sell" })}><Icon name="down" size={16} /> Sell</button>
          </div>
        </div>
        <div className="field">
          <span>Setup</span>
          <div className="seg" id="setup">
            <button type="button" data-val="fvg" className={form.setup === "fvg" ? "on" : ""} onClick={() => set({ setup: "fvg" })}>5m FVG</button>
            <button type="button" data-val="wick" className={form.setup === "wick" ? "on" : ""} onClick={() => set({ setup: "wick" })}>5m Wick FVG</button>
          </div>
        </div>
        <div className="field">
          <span>How do I feel right now?</span>
          <EmotionPicker stage="before" value={form.emotion} onChange={(v) => set({ emotion: v })} />
        </div>
        <div className="grid2">
          <label className="field"><span>Lot size</span><input type="number" step="0.01" inputMode="decimal" value={form.lot} onChange={(e) => set({ lot: e.target.value })} /></label>
          <label className="field"><span>Entry</span><input type="number" step="any" inputMode="decimal" placeholder="0.00" value={form.entry} onChange={(e) => set({ entry: e.target.value })} /></label>
          <label className="field"><span>Stop loss</span><input type="number" step="any" inputMode="decimal" placeholder="0.00" value={form.sl} onChange={(e) => set({ sl: e.target.value })} /></label>
          <label className="field"><span>Take profit</span><input type="number" step="any" inputMode="decimal" placeholder="0.00" value={form.tp} onChange={(e) => set({ tp: e.target.value })} /></label>
        </div>
        <label className="field">
          <span>Why this trade?</span>
          <textarea rows="2" placeholder="Setup, confirmation, what you saw on the chart…" value={form.notes} onChange={(e) => set({ notes: e.target.value })} />
        </label>
      </div>

      {AUTO.length > 0 && <div className="card">
        <CardHead icon="bolt" title="Auto checks">
          <span className={`chip ${autoFail ? "bad" : autoPass === AUTO.length ? "good" : ""}`}>{autoPass}/{AUTO.length}</span>
        </CardHead>
        <ul className="rules">
          {AUTO.map((r, i) => {
            const { pass, detail } = ev.res[r.id];
            return (
              <li key={r.id} className={pass === true ? "pass" : pass === false ? "fail" : ""}>
                <span className="num">{i + 1}</span>
                <div className="body"><div className="title">{ruleTitle(r.id, settings)}</div><div className="sub">{detail}</div></div>
                <Status pass={pass} />
              </li>
            );
          })}
        </ul>
      </div>}

      {SELF.length > 0 && <div className="card">
        <CardHead icon="heart" title="Be honest with yourself">
          <span className={`chip ${selfFail ? "bad" : answered === SELF.length ? "good" : ""}`}>{answered}/{SELF.length} answered</span>
        </CardHead>
        <ul className="rules">
          {SELF.map((r, i) => {
            const { pass } = ev.res[r.id];
            const a = form.answers[r.id];
            const answer = (v) => set({ answers: { ...form.answers, [r.id]: v } });
            return (
              <li key={r.id} className={pass === true ? "pass" : pass === false ? "fail" : ""}>
                <span className="num">{AUTO.length + i + 1}</span>
                <div className="body"><div className="title">{r.title}</div>{r.q && <div className="sub">{r.q}</div>}{r.desc && <div className="sub"><em>{r.desc}</em></div>}</div>
                <div className="yn">
                  <button className={`yes ${a === true ? "on" : ""}`} onClick={() => answer(true)}>Yes</button>
                  <button className={`no ${a === false ? "on" : ""}`} onClick={() => answer(false)}>No</button>
                </div>
              </li>
            );
          })}
        </ul>
      </div>}

      <div id="verdict" ref={verdictRef} className={`verdict ${ev.failed.length ? "no" : ev.pending.length ? "pending" : "ok"}`}>
        {ev.failed.length ? (
          <>
            <div className="v-ico"><Icon name="ban" size={30} /></div><h3>DO NOT TRADE</h3>
            <p>You are breaking {ev.failed.length} rule{ev.failed.length > 1 ? "s" : ""}. Close the chart and walk away.</p>
            <ul>{ev.failed.map((id) => <li key={id}>{ruleTitle(id, settings)}</li>)}</ul>
          </>
        ) : ev.pending.length ? (
          <><div className="v-ico"><Icon name="clock" size={30} /></div><h3>Not ready yet</h3><p>{ev.pending.length} item{ev.pending.length > 1 ? "s" : ""} still to fill or answer.</p></>
        ) : (
          <><div className="v-ico"><Icon name="shield" size={30} /></div><h3>OK TO TRADE</h3><p>{rules.length ? `All ${rules.length} rules respected.` : "No rules are switched on."} Stick to the plan, no changes after entry.</p></>
        )}
      </div>

      <div className="actions">
        <button className="btn primary" disabled={!ev.ok || busy} onClick={log}><Icon name="check" size={18} /> Log this trade</button>
        <button className="btn ghost" onClick={() => setForm(fresh(settings.lot))}>Reset form</button>
      </div>

    </section>
      {/* Outside the section: .tab animates with a transform, which would re-anchor a fixed child. */}
      {active && (
        <div id="dock" className={`dock ${state}`}>
          <div className="dock-msg">
            <Icon name={ev.failed.length ? "ban" : ev.ok ? "shield" : "clock"} size={20} />
            {ev.failed.length ? `${ev.failed.length} rule${ev.failed.length > 1 ? "s" : ""} broken`
              : ev.ok ? "OK to trade" : `${ev.pending.length} left to check`}
          </div>
          <button className="btn small" onClick={() => (ev.ok ? log() : verdictRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }))}>
            {ev.ok ? "Log trade" : "Review"}
          </button>
        </div>
      )}
    </>
  );
}
