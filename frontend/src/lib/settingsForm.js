import { num } from "./format.js";
import { CUSTOM_LIMIT, NO_NEWS, NO_RULE_EDITS } from "./rules.js";
import { normalizeKillzones } from "./killzones.js";

const DEFAULTS = { lot: 0.02, minRR: 2, maxTrades: 4, maxSL: 4, balance: 0, currency: "$" };

// The form is plain state; these pure helpers turn it into what gets saved, so the form can also be compared with
// the saved settings (Save is only enabled when they differ). A half-typed "add" row counts as part of the form.
const cleanPair = (s) => s.toUpperCase().replace(/[^A-Z0-9._-]/g, "");
const pairDraftOk = (draft, pairs) => !!cleanPair(draft.pair) && num(draft.lot) > 0 && !pairs.some((p) => p.pair === cleanPair(draft.pair));
const withPairDraft = (pairs, draft) => (pairDraftOk(draft, pairs) ? [...pairs, { pair: cleanPair(draft.pair), lot: draft.lot, value: draft.value ?? "" }] : pairs);
// These return the same object when the draft cannot be added, so callers can test `next !== current`.
const withRuleDraft = (rules, d) => {
  const title = d.title.trim();
  return title && rules.custom.length < CUSTOM_LIMIT
    ? { ...rules, custom: [...rules.custom, { id: rules.nextId, title, q: d.q.trim() }], nextId: rules.nextId + 1 }
    : rules;
};

function stateFromSettings(s) {
  return {
    v: {
      ...s, balance: s.balance || "", killzones: normalizeKillzones(s.killzones),
      dailyLimit: s.lossLimits?.daily ?? "", overallLimit: s.lossLimits?.overall ?? "", lossSince: s.lossLimits?.since ?? null,
    },
    pairs: (s.pairs || []).map((p) => ({ pair: p.pair, lot: String(p.lot), value: p.value == null ? "" : String(p.value) })),
    draft: { pair: "", lot: "", value: "" },
    rules: { ...NO_RULE_EDITS, ...s.rules },
    ruleDraft: { title: "", q: "" },
    news: { ...NO_NEWS, ...s.news },
  };
}

function buildPayload({ v, pairs, draft, rules, ruleDraft, news }) {
  const r = withRuleDraft(rules, ruleDraft);
  return {
    lot: num(v.lot) ?? DEFAULTS.lot,
    minRR: num(v.minRR) ?? DEFAULTS.minRR,
    maxTrades: Math.max(1, Math.round(num(v.maxTrades) ?? DEFAULTS.maxTrades)),
    maxSL: Math.max(1, Math.round(num(v.maxSL) ?? DEFAULTS.maxSL)),
    balance: Math.max(0, num(v.balance) ?? 0),
    currency: String(v.currency || "").trim() || DEFAULTS.currency,
    killzones: normalizeKillzones(v.killzones),
    pairs: withPairDraft(pairs, draft).filter((p) => p.pair && num(p.lot) > 0).map((p) => ({ pair: p.pair, lot: num(p.lot), value: num(p.value) > 0 ? num(p.value) : null })),
    // blank or 0 switches a limit off
    lossLimits: { daily: num(v.dailyLimit) > 0 ? num(v.dailyLimit) : null, overall: num(v.overallLimit) > 0 ? num(v.overallLimit) : null, since: v.lossSince ?? null },
    rules: { disabled: [...r.disabled].sort((a, b) => a - b), custom: r.custom, nextId: r.nextId },
    // the News tab owns the news settings; saving here keeps them as they are
    news: { ...NO_NEWS, ...news },
  };
}

export { buildPayload, cleanPair, pairDraftOk, stateFromSettings, withPairDraft, withRuleDraft };
