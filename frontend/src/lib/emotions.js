// How the trader felt, tagged twice per trade: BEFORE taking it (on the checklist) and AFTER closing it.
// The API stores only the key ("calm", "fomo", ...); labels and emoji live here, one set per stage.
// tone: "good" = a state that supports disciplined trading, "bad" = a warning sign, "neutral" = neither.
const BEFORE = [
  { key: "calm", label: "Calm", emoji: "😌", tone: "good" },
  { key: "confident", label: "Confident", emoji: "😎", tone: "good" },
  { key: "focused", label: "Focused", emoji: "🎯", tone: "good" },
  { key: "anxious", label: "Anxious", emoji: "😰", tone: "bad" },
  { key: "fomo", label: "FOMO", emoji: "😱", tone: "bad" },
  { key: "greedy", label: "Greedy", emoji: "🤑", tone: "bad" },
  { key: "revenge", label: "Revenge", emoji: "😡", tone: "bad" },
  { key: "bored", label: "Bored", emoji: "🥱", tone: "bad" },
];

const AFTER = [
  { key: "satisfied", label: "Satisfied", emoji: "😊", tone: "good" },
  { key: "proud", label: "Proud", emoji: "💪", tone: "good" },
  { key: "relieved", label: "Relieved", emoji: "😮‍💨", tone: "good" },
  { key: "neutral", label: "Neutral", emoji: "😐", tone: "neutral" },
  { key: "disappointed", label: "Disappointed", emoji: "😞", tone: "bad" },
  { key: "frustrated", label: "Frustrated", emoji: "😤", tone: "bad" },
  { key: "angry", label: "Angry", emoji: "🤬", tone: "bad" },
  { key: "regret", label: "Regret", emoji: "😢", tone: "bad" },
];

const STAGES = { before: BEFORE, after: AFTER };
const STAGE_TITLE = { before: "Before the trade", after: "After the trade" };

// The definition for a stored key. A key from the other stage, or an unknown one, still gets something readable.
function emotionOf(key, stage = "before") {
  if (!key) return null;
  const other = stage === "before" ? "after" : "before";
  return STAGES[stage].find((e) => e.key === key)
    || STAGES[other].find((e) => e.key === key)
    || { key, label: key.replace(/_/g, " "), emoji: "🙂", tone: "neutral" };
}

// Best and worst emotion by win rate. Needs `minTrades` decided trades (wins + losses) per emotion to count,
// and two different emotions to compare. `by` is computeStats().byEmotion / .byEmotionAfter.
function emotionInsight(by, minTrades = 3) {
  const rated = Object.entries(by)
    .map(([key, p]) => ({ key, rate: p.wins + p.losses >= minTrades ? p.wins / (p.wins + p.losses) : null, ...p }))
    .filter((r) => r.rate != null);
  if (rated.length < 2) return null;
  rated.sort((a, b) => b.rate - a.rate || b.n - a.n);
  const best = rated[0];
  const worst = rated[rated.length - 1];
  return best.rate === worst.rate ? null : { best, worst };
}

export { AFTER, BEFORE, STAGES, STAGE_TITLE, emotionInsight, emotionOf };
