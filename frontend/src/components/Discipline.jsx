import { HABITS, WINDOW_DAYS, computeDiscipline } from "../lib/discipline.js";
import { CardHead, Icon } from "./ui.jsx";

const TONE = (score) => (score == null ? "" : score >= 75 ? "good" : score >= 50 ? "mid" : "bad");
// Elite / Solid / Slipping / Off track -> a class for the badge's own colour and motion.
const GRADE_CLASS = { Elite: "elite", Solid: "solid", Slipping: "slipping", "Off track": "off" };
const pct = (n, best) => (best > 0 ? Math.min(100, (n / best) * 100) : 0);

// The two streak tiles share the look of the stat tiles on the Today tab.
function Streaks({ d }) {
  return (
    <div className="disc-streaks">
      <div className="stat" title="Clean trades in a row">
        <small><Icon name="check" size={14} /> Trade streak</small>
        <span>{d.tradeStreak}<em className="of">/{d.bestTradeStreak} best</em></span>
        <div className="meter"><i style={{ width: `${pct(d.tradeStreak, d.bestTradeStreak)}%` }} /></div>
      </div>
      <div className="stat" title="Clean trading days in a row">
        <small><Icon name="calendar" size={14} /> Day streak</small>
        <span>{d.dayStreak}<em className="of">/{d.bestDayStreak} best</em></span>
        <div className="meter"><i style={{ width: `${pct(d.dayStreak, d.bestDayStreak)}%` }} /></div>
      </div>
    </div>
  );
}
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

// Discipline score and streaks. `compact` is the short version used on the Today tab.
export default function Discipline({ entries, settings, compact = false, days = WINDOW_DAYS }) {
  const d = computeDiscipline(entries, settings, new Date(), days);
  const span = days > 0 ? `${days} days` : "all time";
  const tone = TONE(d.score);
  const slipped = Object.entries(d.slips).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);

  if (compact) {
    return (
      <div className="card disc compact">
        <CardHead icon="shield" title="Discipline"><span className={`chip ${tone}`}>{d.score == null ? "–" : `${d.score}%`}</span></CardHead>
        <Streaks d={d} />
      </div>
    );
  }

  return (
    <div className="card disc">
      <CardHead icon="shield" title="Discipline"><span className={`chip ${tone} ${d.grade ? `grade grade-${GRADE_CLASS[d.grade]}` : ""}`}>{d.grade ?? "No data"}</span></CardHead>
      {d.score == null ? (
        <p className="muted hint">Close a trade to get your score. It judges how you traded, not whether you won.</p>
      ) : (
        <>
          <div className="disc-top">
            <div className={`disc-ring ${tone}`} key={d.score} style={{ "--p": d.score }} role="img" aria-label={`Discipline score ${d.score} out of 100`}>
              <span>{d.score}</span>
            </div>
            <p className="muted hint">
              {d.score}% of your last {plural(d.windowN, "trade")} ({span}) followed every habit below.
              {d.goodLosses > 0 && <> {plural(d.goodLosses, "loss")} came with good process.</>}
              {d.badWins > 0 && <> {plural(d.badWins, "win")} broke a habit, so don’t count them as skill.</>}
            </p>
          </div>
          <Streaks d={d} />
          <div className="disc-slips">
            <small>{days > 0 ? `Slips in the last ${span}` : "Slips, all time"}</small>
            {slipped.length ? slipped.map(([k, n]) => (
              <div key={k} className="disc-slip"><Icon name="alert" size={15} /><span>{HABITS[k]}</span><b>{n}</b></div>
            )) : <div className="disc-slip clear"><Icon name="check" size={15} /><span>No slips. Keep it going.</span></div>}
          </div>
        </>
      )}
    </div>
  );
}
