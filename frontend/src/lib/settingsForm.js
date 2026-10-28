import { num } from "./format.js";
import { CUSTOM_LIMIT, NO_NEWS, NO_RULE_EDITS } from "./rules.js";
import { normalizeKillzones } from "./killzones.js";

const DEFAULTS = { lot: 0.02, minRR: 2, maxTrades: 4, maxSL: 4, balance: 0, currency: "$" };

// The form is plain state; these pure helpers turn it into what gets saved, so the form can also be compared with
// the saved settings (Save is only enabled when they differ). A half-typed "add" row counts as part of the form.
const cleanPair = (s) => s.toUpperCase().replace(/[^A-Z0-9._-]/g, "");
const pairDraftOk = (draft, pairs) => !!cleanPair(draft.pair) && num(draft.lot) > 0 && !pairs.some((p) => p.pair === cleanPair(draft.pair));
const withPairDraft = (pairs, draft) => (pairDraftOk(draft, pairs) ? [...pairs, { pair: cleanPair(draft.pair), lot: draft.lot }] : pairs);
// These return the same object when the draft cannot be added, so callers can test `next !== current`.
const withRuleDraft = (rules, d) => {
  const title = d.title.trim();
  return title && rules.custom.length < CUSTOM_LIMIT
    ? { ...rules, custom: [...rules.custom, { id: rules.nextId, title, q: d.q.trim() }], nextId: rules.nextId + 1 }
    : rules;
};
const withNewsDraft = (news, d) => {
  const at = d.when ? new Date(d.when).getTime() : NaN;
  return Number.isFinite(at) && news.events.length < 200
    ? { ...news, events: [...news.events, { at, title: d.title.trim() }].sort((a, b) => a.at - b.at) }
    : news;
};

function stateFromSettings(s) {
  return {
    v: { ...s, balance: s.balance || "", killzones: normalizeKillzones(s.killzones), newsLead: s.news?.leadMin ?? NO_NEWS.leadMin },
    pairs: (s.pairs || []).map((p) => ({ pair: p.pair, lot: String(p.lot) })),
    draft: { pair: "", lot: "" },
    rules: { ...NO_RULE_EDITS, ...s.rules },
    ruleDraft: { title: "", q: "" },
    news: { ...NO_NEWS, ...s.news },
    newsDraft: { when: "", title: "" },
  };
}

function buildPayload({ v, pairs, draft, rules, ruleDraft, news, newsDraft }, nowMs) {
  const r = withRuleDraft(rules, ruleDraft);
  return {
    lot: num(v.lot) ?? DEFAULTS.lot,
    minRR: num(v.minRR) ?? DEFAULTS.minRR,
    maxTrades: Math.max(1, Math.round(num(v.maxTrades) ?? DEFAULTS.maxTrades)),
    maxSL: Math.max(1, Math.round(num(v.maxSL) ?? DEFAULTS.maxSL)),
    balance: Math.max(0, num(v.balance) ?? 0),
    currency: String(v.currency || "").trim() || DEFAULTS.currency,
    killzones: normalizeKillzones(v.killzones),
    pairs: withPairDraft(pairs, draft).filter((p) => p.pair && num(p.lot) > 0).map((p) => ({ pair: p.pair, lot: num(p.lot) })),
    rules: { disabled: [...r.disabled].sort((a, b) => a - b), custom: r.custom, nextId: r.nextId },
    // past news is dropped after a day
    news: {
      leadMin: Math.min(1440, Math.max(1, Math.round(num(v.newsLead) ?? NO_NEWS.leadMin))),
      events: withNewsDraft(news, newsDraft).events.filter((e) => e.at > nowMs - 86400000),
    },
  };
}

export { buildPayload, cleanPair, pairDraftOk, stateFromSettings, withNewsDraft, withPairDraft, withRuleDraft };
