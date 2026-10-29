import { STAGES, emotionKeys, joinEmotions } from "../lib/emotions.js";

// Pick how you felt. You can choose several; tapping a chosen one again removes it, because the tag is optional.
export default function EmotionPicker({ stage, value, onChange }) {
  const chosen = emotionKeys(value);
  const toggle = (key) => onChange(joinEmotions(chosen.includes(key) ? chosen.filter((k) => k !== key) : [...chosen, key]));
  return (
    <div className="emo-picker" role="group" aria-label={stage === "before" ? "How I feel before the trade" : "How I feel after the trade"}>
      {STAGES[stage].map((e) => (
        <button key={e.key} type="button" className={`emo ${e.tone} ${chosen.includes(e.key) ? "on" : ""}`} aria-pressed={chosen.includes(e.key)}
          onClick={() => toggle(e.key)}>
          <span className="emo-ico" aria-hidden="true">{e.emoji}</span>{e.label}
        </button>
      ))}
    </div>
  );
}
