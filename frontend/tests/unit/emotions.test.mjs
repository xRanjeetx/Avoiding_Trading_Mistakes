import test from "node:test";
import assert from "node:assert/strict";
import { AFTER, BEFORE, emotionInsight, emotionOf } from "../../src/lib/emotions.js";
import { computeStats } from "../../src/lib/stats.js";

let n = 0;
const trade = (over = {}) => {
  n += 1;
  return { id: `e${n}`, timestamp: new Date(2026, 9, 5, 9, 0).getTime() + n * 1000, pair: "XAUUSD", dir: "buy", traded: true, result: "tp", pnl: 10, ...over };
};

test("every emotion has a key, label, emoji and tone, and keys are unique", () => {
  for (const list of [BEFORE, AFTER]) {
    assert.equal(new Set(list.map((e) => e.key)).size, list.length);
    for (const e of list) {
      assert.match(e.key, /^[a-z][a-z_]{0,19}$/, "must satisfy the API's key pattern");
      assert.ok(e.label && e.emoji && ["good", "bad", "neutral"].includes(e.tone), e.key);
    }
  }
  const keys = [...BEFORE, ...AFTER].map((e) => e.key);
  assert.equal(new Set(keys).size, keys.length, "a key means the same thing in both stages");
});

test("emotionOf finds a key by stage, falls back across stages, and tolerates unknown keys", () => {
  assert.equal(emotionOf("calm", "before").emoji, "😌");
  assert.equal(emotionOf("regret", "after").label, "Regret");
  assert.equal(emotionOf("regret", "before").label, "Regret"); // key from the other stage
  assert.deepEqual(emotionOf("very_happy", "after"), { key: "very_happy", label: "very happy", emoji: "🙂", tone: "neutral" });
  assert.equal(emotionOf(null), null);
  assert.equal(emotionOf(""), null);
});

test("win rate and P&L are grouped per emotion, before and after separately", () => {
  const s = computeStats([
    trade({ emotion: "calm", emotionAfter: "satisfied" }),
    trade({ emotion: "calm", emotionAfter: "relieved", pnl: 20 }),
    trade({ emotion: "calm", result: "sl", pnl: -5, emotionAfter: "frustrated" }),
    trade({ emotion: "revenge", result: "sl", pnl: -10, emotionAfter: "regret" }),
    trade({ emotion: "revenge", result: "sl", pnl: -10 }),
    trade({}), // untagged: left out
    trade({ emotion: "fomo", result: "open", pnl: null }), // still open: not counted yet
  ]);
  assert.deepEqual(s.byEmotion.calm, { n: 3, wins: 2, losses: 1, pnl: 25 });
  assert.deepEqual(s.byEmotion.revenge, { n: 2, wins: 0, losses: 2, pnl: -20 });
  assert.equal(s.byEmotion.fomo, undefined);
  assert.equal(Object.keys(s.byEmotion).length, 2);
  assert.deepEqual(Object.keys(s.byEmotionAfter).sort(), ["frustrated", "regret", "relieved", "satisfied"]);
  assert.equal(s.byEmotionAfter.regret.losses, 1);
});

test("no tags at all gives empty groups", () => {
  const s = computeStats([trade(), trade()]);
  assert.deepEqual(s.byEmotion, {});
  assert.deepEqual(s.byEmotionAfter, {});
});

test("insight names the best and weakest emotion, once there are enough trades", () => {
  const by = {
    calm: { n: 5, wins: 4, losses: 1, pnl: 30 },
    fomo: { n: 4, wins: 2, losses: 2, pnl: 0 },
    revenge: { n: 3, wins: 0, losses: 3, pnl: -30 },
    bored: { n: 2, wins: 0, losses: 2, pnl: -10 }, // too few trades to judge
  };
  const r = emotionInsight(by);
  assert.equal(r.best.key, "calm");
  assert.equal(r.worst.key, "revenge");
  assert.equal(r.best.rate, 0.8);
});

test("insight stays quiet when there is nothing to compare", () => {
  assert.equal(emotionInsight({}), null);
  assert.equal(emotionInsight({ calm: { n: 5, wins: 4, losses: 1, pnl: 1 } }), null); // only one emotion
  assert.equal(emotionInsight({ calm: { n: 3, wins: 2, losses: 1, pnl: 1 }, fomo: { n: 3, wins: 2, losses: 1, pnl: 1 } }), null); // same rate
  assert.equal(emotionInsight({ calm: { n: 2, wins: 2, losses: 0, pnl: 1 }, fomo: { n: 2, wins: 0, losses: 2, pnl: 1 } }), null); // all under 3
});
