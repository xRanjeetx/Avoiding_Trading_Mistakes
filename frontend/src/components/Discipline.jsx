import { HABITS, WINDOW_DAYS, computeDiscipline } from "../lib/discipline.js";
import { CardHead, Icon } from "./ui.jsx";

const TONE = (score) => (score == null ? "" : score >= 75 ? "good" : score >= 50 ? "mid" : "bad");
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

// Discipline score and streaks. `compact` is the short version used on the Today tab.
export default function Discipline({ entries, settings, compact = false }) {
  const d = computeDiscipline(entries, settings);
  const tone = TONE(d.score);
  const slipped = Object.entries(d.slips).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);

  if (compact) {
    return (
      <div className="card disc compact">
        <CardHead icon="shield" title="Discipline"><span className={`chip ${tone}`}>{d.score == null ? "–" : `${d.score}%`}</span></CardHead>
        <div className="disc-streaks">
          <div><b>{d.tradeStreak}</b><small>clean trades in a row</small></div>
          <div><b>{d.dayStreak}</b><small>clean trading days in a row</small></div>
        </div>
      </div>
    );
  }

  return (
    <div className="card disc">
      <CardHead icon="shield" title="Discipline"><span className={`chip ${tone}`}>{d.grade ?? "No data"}</span></CardHead>
      {d.score == null ? (
        <p className="muted hint">Close a trade to get your score. It judges how you traded, not whether you won.</p>
      ) : (
        <>
          <div className="disc-top">
            <div className={`disc-ring ${tone}`} style={{ "--p": d.score }} role="img" aria-label={`Discipline score ${d.score} out of 100`}>
              <span>{d.score}</span>
            </div>
            <p className="muted hint">
              {d.score}% of your last {plural(d.windowN, "trade")} ({WINDOW_DAYS} days) followed every habit below.
              {d.goodLosses > 0 && <> {plural(d.goodLosses, "loss")} came with good process.</>}
              {d.badWins > 0 && <> {plural(d.badWins, "win")} broke a habit, so don’t count them as skill.</>}
            </p>
          </div>
          <div className="disc-streaks">
            <div><b>{d.tradeStreak}</b><small>clean trades in a row</small><em>best {d.bestTradeStreak}</em></div>
            <div><b>{d.dayStreak}</b><small>clean trading days in a row</small><em>best {d.bestDayStreak}</em></div>
          </div>
          <div className="disc-slips">
            <small>Slips in the last {WINDOW_DAYS} days</small>
            {slipped.length ? slipped.map(([k, n]) => (
              <div key={k} className="disc-slip"><Icon name="alert" size={15} /><span>{HABITS[k]}</span><b>{n}</b></div>
            )) : <div className="disc-slip clear"><Icon name="check" size={15} /><span>No slips. Keep it going.</span></div>}
          </div>
        </>
      )}
    </div>
  );
}
