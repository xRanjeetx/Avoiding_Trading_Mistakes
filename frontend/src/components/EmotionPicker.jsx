import { STAGES } from "../lib/emotions.js";

// Pick how you felt. Tapping the chosen one again clears it, because the tag is optional.
export default function EmotionPicker({ stage, value, onChange }) {
  return (
    <div className="emo-picker" role="group" aria-label={stage === "before" ? "How I feel before the trade" : "How I feel after the trade"}>
      {STAGES[stage].map((e) => (
        <button key={e.key} type="button" className={`emo ${e.tone} ${value === e.key ? "on" : ""}`} aria-pressed={value === e.key}
          onClick={() => onChange(value === e.key ? null : e.key)}>
          <span className="emo-ico" aria-hidden="true">{e.emoji}</span>{e.label}
        </button>
      ))}
    </div>
  );
}
