import test from "node:test";
import assert from "node:assert/strict";
import { buildPayload, stateFromSettings, withNewsDraft, withPairDraft, withRuleDraft } from "../src/lib/settingsForm.js";

const NOW = new Date("2026-10-28T12:00:00Z").getTime();
// What the API returns for a settings row.
const saved = () => ({
  lot: 0.02, minRR: 2, maxTrades: 4, maxSL: 4, balance: 5000.5, currency: "€",
  killzones: [{ key: "asian", start: "20:00", end: "00:00", on: true, color: "#06b6d4" }],
  pairs: [{ pair: "XAUUSD", lot: 0.02 }, { pair: "EURUSD", lot: 0.2 }],
  rules: { disabled: [3, 7], custom: [{ id: 1000, title: "News checked", q: "" }], nextId: 1001 },
  news: { leadMin: 120, events: [{ at: NOW + 3600000, title: "NFP" }] },
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
  for (const k of ["lot", "minRR", "maxTrades", "maxSL", "balance", "currency", "pairs", "rules", "news"]) assert.deepEqual(p[k], s[k], k);
});

test("any real edit makes it dirty", () => {
  const edit = (patch) => { const st = fresh(); return { ...st, ...patch(st) }; };
  assert.equal(dirty(edit((st) => ({ v: { ...st.v, lot: "0.05" } }))), true);
  assert.equal(dirty(edit((st) => ({ v: { ...st.v, currency: "$" } }))), true);
  assert.equal(dirty(edit((st) => ({ v: { ...st.v, balance: "" } }))), true);
  assert.equal(dirty(edit((st) => ({ v: { ...st.v, newsLead: "90" } }))), true);
  assert.equal(dirty(edit((st) => ({ v: { ...st.v, killzones: st.v.killzones.map((z) => ({ ...z, on: false })) } }))), true);
  assert.equal(dirty(edit((st) => ({ pairs: st.pairs.map((p) => ({ ...p, lot: "0.5" })) }))), true);
  assert.equal(dirty(edit((st) => ({ pairs: st.pairs.slice(1) }))), true);
  assert.equal(dirty(edit((st) => ({ rules: { ...st.rules, disabled: [3] } }))), true);
  assert.equal(dirty(edit((st) => ({ news: { ...st.news, events: [] } }))), true);
});

test("a half-typed add row counts as a change, and clearing it is clean again", () => {
  assert.equal(dirty({ ...fresh(), draft: { pair: "gbpusd", lot: "0.1" } }), true);
  assert.equal(dirty({ ...fresh(), ruleDraft: { title: "No Fridays", q: "" } }), true);
  assert.equal(dirty({ ...fresh(), newsDraft: { when: "2026-11-01T14:30", title: "CPI" } }), true);
  assert.equal(dirty({ ...fresh(), draft: { pair: "", lot: "0.1" } }), false); // no pair name: nothing to add
  assert.equal(dirty({ ...fresh(), ruleDraft: { title: "   ", q: "x" } }), false);
  assert.equal(dirty({ ...fresh(), newsDraft: { when: "", title: "NFP" } }), false);
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

test("rule and news drafts add one item, with fresh ids and in time order", () => {
  const st = fresh();
  const r = withRuleDraft(st.rules, { title: " Wait for close ", q: " Did I? " });
  assert.deepEqual(r.custom.at(-1), { id: 1001, title: "Wait for close", q: "Did I?" });
  assert.equal(r.nextId, 1002);
  assert.equal(withRuleDraft(st.rules, { title: "", q: "" }), st.rules);
  const n = withNewsDraft(st.news, { when: "2020-01-01T00:00", title: " Old " });
  assert.equal(n.events[0].title, "Old");
  assert.equal(n.events.length, 2);
  assert.equal(withNewsDraft(st.news, { when: "", title: "x" }), st.news);
});

test("news that ended more than a day ago is left out of what gets saved", () => {
  const st = fresh();
  const old = { ...st, news: { ...st.news, events: [{ at: NOW - 2 * 86400000, title: "Ancient" }, ...st.news.events] } };
  assert.deepEqual(payload(old).news.events, saved().news.events);
  assert.equal(dirty(old), false); // dropping it silently is not a user change
});

test("lead time is kept within 1 minute to 24 hours", () => {
  const st = fresh();
  assert.equal(payload({ ...st, v: { ...st.v, newsLead: "0" } }).news.leadMin, 1);
  assert.equal(payload({ ...st, v: { ...st.v, newsLead: "99999" } }).news.leadMin, 1440);
  assert.equal(payload({ ...st, v: { ...st.v, newsLead: "" } }).news.leadMin, 120);
});
