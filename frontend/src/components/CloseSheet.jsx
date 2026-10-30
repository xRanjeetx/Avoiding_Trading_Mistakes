import { useEffect, useState } from "react";
import { isAtCost, num } from "../lib/format.js";
import EmotionPicker from "./EmotionPicker.jsx";
import { ShotPicker } from "./Shots.jsx";
import { Icon } from "./ui.jsx";

const RESULTS = [["tp", "TP hit"], ["sl", "SL hit"], ["be", "BE (closed at cost)"], ["manual", "Closed early"], ["ctc", "CTC (cost after 1:1.5)"]];

// Mount with a `key` per entry so the form state starts fresh each time it opens.
export default function CloseSheet({ entry, preset, onSave, onClose, onShotUpload, onShotRemove }) {
  const [result, setResult] = useState(preset || (entry.result === "open" ? null : entry.result));
  const [sign, setSign] = useState(entry.pnl != null && entry.pnl < 0 ? "loss" : "win");
  const [amount, setAmount] = useState(entry.pnl != null && !isAtCost(entry.result) ? String(Math.abs(entry.pnl)) : "");
  const [exit, setExit] = useState(entry.exit ?? "");
  const [notes, setNotes] = useState(entry.notes || "");
  const [lesson, setLesson] = useState(entry.lesson || "");
  const [emotion, setEmotion] = useState(entry.emotion ?? null);
  const [emotionAfter, setEmotionAfter] = useState(entry.emotionAfter ?? null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.classList.add("noscroll");
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.classList.remove("noscroll");
    };
  }, [onClose]);

  const closing = !!result;
  const amountLabel = result === "sl" ? "Loss amount" : result === "tp" ? "Profit amount" : "P&L amount";

  async function save() {
    const next = { ...entry, notes: notes.trim(), lesson: lesson.trim(), emotion, emotionAfter };
    if (result) {
      const amt = num(amount);
      let pnl = null;
      if (isAtCost(result)) pnl = 0;
      else if (amt != null) {
        const a = Math.abs(amt);
        pnl = result === "tp" ? a : result === "sl" ? -a : sign === "loss" ? -a : a;
      }
      if (entry.result === "open") next.closedAt = Date.now();
      next.result = result;
      next.pnl = pnl;
      next.exit = num(exit);
    }
    setBusy(true);
    const ok = await onSave(next, result && next.pnl == null);
    setBusy(false);
    if (ok) onClose();
  }

  return (
    <div id="sheet" className="sheet" role="dialog" aria-modal="true" aria-labelledby="sheetTitle" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet-card">
        <div className="sheet-grab" />
        <div className="card-head">
          <h2 id="sheetTitle">{entry.result === "open" ? "Close trade" : "Edit trade"}</h2>
          <button className="icon-btn small" type="button" aria-label="Close" onClick={onClose}><Icon name="x" size={18} /></button>
        </div>
        <p className="muted sheet-summary">{entry.pair || "—"} · {(entry.dir || "").toUpperCase()} · Lot {entry.lot ?? "–"} · Entry {entry.entry ?? "–"}</p>

        <div className="seg five" id="shResult">
          {RESULTS.map(([val, label]) => (
            <button key={val} type="button" data-val={val} className={result === val ? "on" : ""} onClick={() => setResult(val)}>{label}</button>
          ))}
        </div>
        {result === "manual" && (
          <div className="seg" id="shSign">
            <button type="button" data-val="win" className={sign === "win" ? "on" : ""} onClick={() => setSign("win")}>Profit</button>
            <button type="button" data-val="loss" className={sign === "loss" ? "on" : ""} onClick={() => setSign("loss")}>Loss</button>
          </div>
        )}

        {closing && (
          <div className="grid2">
            {!isAtCost(result) && (
              <label className="field"><span>{amountLabel}</span>
                <input type="number" step="any" inputMode="decimal" placeholder="e.g. 24.50" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
            )}
            <label className="field"><span>Exit price</span>
              <input type="number" step="any" inputMode="decimal" placeholder="optional" value={exit} onChange={(e) => setExit(e.target.value)} /></label>
          </div>
        )}
        <div className="field"><span>How I felt before the trade</span>
          <EmotionPicker stage="before" value={emotion} onChange={setEmotion} /></div>
        {closing && (
          <div className="field"><span>How I feel now</span>
            <EmotionPicker stage="after" value={emotionAfter} onChange={setEmotionAfter} /></div>
        )}
        <ShotPicker entry={entry} onUpload={onShotUpload} onRemove={onShotRemove} />
        <label className="field"><span>Why I took it</span>
          <textarea rows="2" placeholder="Setup and confirmation…" value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
        <label className="field"><span>Lesson / review</span>
          <textarea rows="2" placeholder="What went well? What would you change?" value={lesson} onChange={(e) => setLesson(e.target.value)} /></label>

        <div className="actions">
          <button className="btn primary" type="button" disabled={busy} onClick={save}><Icon name="check" size={18} /> Save</button>
          <button className="btn ghost" type="button" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
