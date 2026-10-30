import test from "node:test";
import assert from "node:assert/strict";
import { buildPayload, stateFromSettings, withPairDraft, withRuleDraft } from "../../src/lib/settingsForm.js";

const NOW = new Date("2026-10-28T12:00:00Z").getTime();
// What the API returns for a settings row.
const saved = () => ({
  lot: 0.02, minRR: 2, maxTrades: 4, maxSL: 4, balance: 5000.5, currency: "€",
  killzones: [{ key: "asian", start: "20:00", end: "00:00", on: true, color: "#06b6d4" }],
  pairs: [{ pair: "XAUUSD", lot: 0.02, value: 100 }, { pair: "EURUSD", lot: 0.2, value: null }],
  rules: { disabled: [3, 7], custom: [{ id: 1000, title: "News checked", q: "" }], nextId: 1001 },
  news: { leadMin: 90, auto: false, includeMedium: true, events: [{ at: NOW + 3600000, title: "NFP" }] },
  lossLimits: { daily: 20, overall: 1000.5, since: NOW - 86400000 },
});
const payload = (st) => buildPayload(st, NOW);
const fresh = () => stateFromSettings(saved());
const dirty = (st) => JSON.stringify(payload(st)) !== JSON.stringify(payload(fresh()));

test("an untouched form is not dirty, so Save stays off", () => assert.equal(dirty(fresh()), false));

test("it is also clean for settings with nothing set (a brand-new account)", () => {
  const empty = { lot: 0.02, minRR: 2, maxTrades: 4, maxSL: 4, balance: 0, currency: "$" };
  assert.equal(JSON.stringify(payload(stateFromSettings(empty))), JSON.stringify(payload(stateFromSettings(empty))));
  assert.equal(payload(stateFromSettings(empty)).news.leadMin, 120);
  assert.deepEqual(payload(stateFromSettings(empty)).rules, { disabled: [], custom: [], nextId: 1000 });
});

test("a payload built from saved settings reproduces them", () => {
  const p = payload(fresh());
  const s = saved();
  for (const k of ["lot", "minRR", "maxTrades", "maxSL", "balance", "currency", "pairs", "rules", "news", "lossLimits"]) assert.deepEqual(p[k], s[k], k);
});

test("any real edit makes it dirty", () => {
  const edit = (patch) => { const st = fresh(); return { ...st, ...patch(st) }; };
  assert.equal(dirty(edit((st) => ({ v: { ...st.v, lot: "0.05" } }))), true);
  assert.equal(dirty(edit((st) => ({ v: { ...st.v, currency: "$" } }))), true);
  assert.equal(dirty(edit((st) => ({ v: { ...st.v, balance: "" } }))), true);
  assert.equal(dirty(edit((st) => ({ v: { ...st.v, killzones: st.v.killzones.map((z) => ({ ...z, on: false })) } }))), true);
  assert.equal(dirty(edit((st) => ({ pairs: st.pairs.map((p) => ({ ...p, lot: "0.5" })) }))), true);
  assert.equal(dirty(edit((st) => ({ pairs: st.pairs.slice(1) }))), true);
  assert.equal(dirty(edit((st) => ({ rules: { ...st.rules, disabled: [3] } }))), true);
});

test("a half-typed add row counts as a change, and clearing it is clean again", () => {
  assert.equal(dirty({ ...fresh(), draft: { pair: "gbpusd", lot: "0.1" } }), true);
  assert.equal(dirty({ ...fresh(), ruleDraft: { title: "No Fridays", q: "" } }), true);
  assert.equal(dirty({ ...fresh(), draft: { pair: "", lot: "0.1" } }), false); // no pair name: nothing to add
  assert.equal(dirty({ ...fresh(), ruleDraft: { title: "   ", q: "x" } }), false);
});

test("typing then undoing an edit is clean again", () => {
  const st = fresh();
  assert.equal(dirty({ ...st, v: { ...st.v, lot: "0.05" } }), true);
  assert.equal(dirty({ ...st, v: { ...st.v, lot: "0.02" } }), false);
  assert.equal(dirty({ ...st, v: { ...st.v, lot: "0.020" } }), false); // same number
});

test("switching rules off and on again in another order is not a change", () => {
  const st = fresh(); // saved with [3, 7] off
  const flipped = { ...st, rules: { ...st.rules, disabled: [7, 3] } };
  assert.equal(dirty(flipped), false);
});

test("a pair that already exists is not added twice", () => {
  const st = fresh();
  assert.equal(withPairDraft(st.pairs, { pair: "xauusd", lot: "0.1" }), st.pairs);
  assert.equal(withPairDraft(st.pairs, { pair: "gbp usd!", lot: "0.1" }).at(-1).pair, "GBPUSD");
});

test("a rule draft adds one item, with a fresh id", () => {
  const st = fresh();
  const r = withRuleDraft(st.rules, { title: " Wait for close ", q: " Did I? " });
  assert.deepEqual(r.custom.at(-1), { id: 1001, title: "Wait for close", q: "Did I?" });
  assert.equal(r.nextId, 1002);
  assert.equal(withRuleDraft(st.rules, { title: "", q: "" }), st.rules);
});

test("saving settings keeps the news settings exactly as the News tab left them", () => {
  const st = fresh();
  assert.deepEqual(payload(st).news, saved().news);
  assert.deepEqual(payload({ ...st, news: undefined }).news, { leadMin: 120, events: [], auto: true, includeMedium: true });
});

test("loss limits: editing a limit or the start date makes the form dirty", () => {
  const edit = (patch) => { const st = fresh(); return { ...st, v: { ...st.v, ...patch } }; };
  assert.equal(dirty(edit({ dailyLimit: "30" })), true);
  assert.equal(dirty(edit({ overallLimit: "" })), true);
  assert.equal(dirty(edit({ lossSince: NOW })), true);
});

test("loss limits: blank, zero or junk switch a limit off (null), never 0", () => {
  const st = fresh();
  for (const bad of ["", "0", "-5", "abc"]) {
    const p = payload({ ...st, v: { ...st.v, dailyLimit: bad, overallLimit: bad } });
    assert.equal(p.lossLimits.daily, null, bad);
    assert.equal(p.lossLimits.overall, null, bad);
  }
});

test("loss limits: a new account has none, and the start date is kept or cleared", () => {
  const st = stateFromSettings({ ...saved(), lossLimits: undefined, pairs: [] });
  assert.deepEqual(payload(st).lossLimits, { daily: null, overall: null, since: null });
  assert.equal(payload({ ...fresh(), v: { ...fresh().v, lossSince: null } }).lossLimits.since, null);
});

test("pair value: blank means use the built-in one (null); a new pair carries its value", () => {
  const st = fresh();
  assert.equal(payload(st).pairs[1].value, null);
  const added = withPairDraft(st.pairs, { pair: "us30", lot: "0.1", value: "1" }).at(-1);
  assert.deepEqual(added, { pair: "US30", lot: "0.1", value: "1" });
  assert.equal(payload({ ...st, pairs: [{ pair: "US30", lot: "0.1", value: "0" }] }).pairs[0].value, null);
});
