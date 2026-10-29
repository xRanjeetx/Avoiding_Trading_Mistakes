// The rules from the "Mistakes to Avoid" checklist.
// type "auto": checked by the app from inputs, time or today's log.
// type "self": you must answer honestly. "Yes" always means the rule is respected.
const RULES = [
  { id: 31, title: "No Confirmation Bias",               type: "self", q: "Did I weigh evidence against my bias too, not only what supports my view and ignoring what contradicts it?" },
  { id: 1,  title: "No Indicator Trading",               type: "self", q: "Is this entry based on price action only, without indicators?" },
  { id: 2,  title: "TP & SL Fixed 1:2 RR",               type: "auto" },
  { id: 3,  title: "Lot Size Fixed",                     type: "auto" },
  { id: 29, title: "Confirmation in 5m FVG",             type: "self", q: "Did I get confirmation inside the 5m FVG before entering?" },
  { id: 6,  title: "No Trade in Ranging Market",         type: "self", q: "Is the market trending, not ranging?" },
  { id: 7,  title: "No FOMO",                            type: "self", q: "Am I calm, and not chasing a move I missed?" },
  { id: 8,  title: "No Multiple Trades in Same Direction", type: "auto" },
  { id: 30, title: "Cooldown After a Loss", type: "auto" },
  { id: 9,  title: "Full TP",                           type: "self", q: "Will I hold this trade until the full TP?" },
  { id: 10, title: "No Scalping",                        type: "self", q: "Is this a planned setup, not a quick scalp?" },
  { id: 11, title: "Trade Only in a Market Session",     type: "auto" },
  { id: 32, title: "No Trade Before High-Impact News",   type: "auto" },
  { id: 13, title: "No Revenge Trading",                 type: "self", q: "Am I taking this trade on its own merits, not to win back a loss?" },
  { id: 14, title: "Safe TP Always",                     type: "self", q: "Is my TP placed safely before the next key level?" },
  { id: 15, title: "Max Trades per Day",                 type: "auto" },
  { id: 17, title: "If Rejection, Then Wait",            type: "self", q: "If there was a rejection, did I wait for it to resolve?" },
  { id: 18, title: "5m Healthy Candle, Then Entry",      type: "self", q: "Did a healthy 5m candle close before my entry?" },
  { id: 19, title: "After Max SL, Stop Trading",         type: "auto" },
  { id: 33, title: "Within Loss Limits",                 type: "auto" },
  { id: 20, title: "Emotions in Control (No Anger)",     type: "self", q: "Am I emotionally neutral right now (no anger, fear or excitement)?" },
  { id: 21, title: "Discipline",                         type: "self", q: "Am I following my plan and rules exactly, with no exceptions?" },
  { id: 22, title: "CTC After 1:1.5 RR",                 type: "self", q: "Will I move my SL to cost once price reaches 1:1.5 RR?" },
  { id: 23, title: "No Recovery of Loss",                type: "self", q: "Am I trading my plan, not trying to win back money lost earlier?" },
  { id: 24, title: "Patience",                           type: "self", q: "Am I waiting patiently for my setup, not forcing a trade?" },
  { id: 25, title: "Setup: 5m FVG or Wick FVG",          type: "auto" },
  { id: 26, title: "No Gambling",                        type: "self", q: "Is this trade based on my edge and plan, not a gamble?" },
  { id: 27, title: "No Middle Trade",                    type: "self", q: "Is my entry at a clear level or zone, not in the middle of the range?" },
  { id: 28, title: "No Greed",                           type: "self", q: "Am I happy with my planned TP, without adding size or chasing extra?" },
];

// Per-user rule choices live in settings.rules: { disabled: [ids switched off], custom: [{ id, title, q }], nextId }.
// Custom rules are always yes/no questions ("Yes" means respected) and use ids from 1000 up, so they never clash with RULES.
const NO_RULE_EDITS = { disabled: [], custom: [], nextId: 1000 };
const CUSTOM_LIMIT = 30;

// High-impact news the user added in Settings: { leadMin: minutes before each event to stop trading, events: [{ at (epoch ms), title }] }.
const NO_NEWS = { leadMin: 120, events: [] };

// Money limits set in Settings: { daily, overall (the most that may be lost; null = off), since (epoch ms the overall count starts; null = all trades) }.
const NO_LOSS_LIMITS = { daily: null, overall: null, since: null };

const customRules = (settings) =>
  (settings?.rules?.custom || []).map((r) => ({ id: r.id, title: r.title, type: "self", q: r.q || "", custom: true }));
// Every rule the user could have: the built-in ones first, then their own.
const allRules = (settings) => [...RULES, ...customRules(settings)];
const isRuleOn = (settings, id) => !(settings?.rules?.disabled || []).includes(id);
// The rules the checklist actually asks about.
const activeRules = (settings) => allRules(settings).filter((r) => isRuleOn(settings, r.id));

// The two entry setups. The checklist requires one of them to be picked.
const SETUPS = { fvg: "5m FVG", wick: "5m Wick FVG" };

// After a losing trade on a pair, that pair is locked for this many minutes (other pairs stay open).
const COOLDOWN_MIN = 10;

export { RULES, SETUPS, COOLDOWN_MIN, CUSTOM_LIMIT, NO_LOSS_LIMITS, NO_NEWS, NO_RULE_EDITS, activeRules, allRules, isRuleOn };
