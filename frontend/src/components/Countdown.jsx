import { useEffect, useState } from "react";

const R = 26, C = 2 * Math.PI * R;

// Live ring timer from `since` to `until` (ms): the arc fills as time passes, m:ss in the middle.
// Ticks every second on its own, so the page around it doesn't re-render.
export default function Countdown({ since, until }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const s = Math.max(0, Math.ceil((until - now) / 1000));
  const done = Math.min(1, Math.max(0, (now - since) / (until - since)));
  const text = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  return (
    <div className="cd-ring" role="timer" aria-label={`${text} left`}>
      <svg viewBox="0 0 64 64" aria-hidden="true">
        <circle className="cd-track" cx="32" cy="32" r={R} />
        <circle className="cd-arc" cx="32" cy="32" r={R} strokeDasharray={C} strokeDashoffset={C * (1 - done)} />
      </svg>
      <b>{text}</b>
    </div>
  );
}
