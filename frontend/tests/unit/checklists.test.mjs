import test from "node:test";
import assert from "node:assert/strict";
import { LISTS, changedCount, clearKind, groupIcon, groupItems, itemsOf, progress, withDone, withHidden, withItem, withSharedText, withText, withoutItem } from "../../src/lib/checklists.js";

const item = (id, kind, position, group = "", done = false) => ({ id, kind, position, group, text: `t${id}`, done });

test("itemsOf picks one list and puts it in order", () => {
  const all = [item(1, "remember", 2), item(2, "mistakes", 1), item(3, "remember", 1)];
  assert.deepEqual(itemsOf(all, "remember").map((i) => i.id), [3, 1]);
  assert.deepEqual(itemsOf(null, "remember"), []);
});

test("groupItems keeps headings in order", () => {
  const list = [item(1, "mistakes", 1, "Quick"), item(2, "mistakes", 2, "Quick"), item(3, "mistakes", 3, "Detail")];
  assert.deepEqual(groupItems(list).map((g) => [g.group, g.items.length]), [["Quick", 2], ["Detail", 1]]);
  assert.deepEqual(groupItems([item(1, "remember", 1)]).map((g) => g.group), [""]);
  assert.deepEqual(groupItems([]), []);
});

test("progress counts the ticked lines", () => {
  assert.deepEqual(progress([]), { done: 0, total: 0, pct: 0 });
  assert.deepEqual(progress([item(1, "x", 1, "", true), item(2, "x", 2), item(3, "x", 3)]), { done: 1, total: 3, pct: 33 });
});

test("withDone and clearKind return new lists", () => {
  const all = [item(1, "a", 1, "", true), item(2, "b", 1, "", true)];
  const ticked = withDone(all, 1, false);
  assert.equal(ticked[0].done, false);
  assert.equal(all[0].done, true);
  assert.deepEqual(clearKind(all, "b").map((i) => i.done), [true, false]);
});

test("every list the tab offers has what the screen needs", () => {
  assert.deepEqual(LISTS.map((l) => l.kind), ["mistakes", "remember", "psychology", "management", "rules"]);
  for (const l of LISTS) assert.ok(l.label && l.icon && l.title && l.blurb && l.done);
});

test("groupIcon falls back to a note", () => {
  assert.equal(groupIcon("Quick checklist"), "bolt");
  assert.equal(groupIcon("In detail"), "note");
  assert.equal(groupIcon("Something new"), "note");
});

test("own lines are told apart from shared ones that happen to share an id", () => {
  const all = [item(1, "rules", 1), { ...item(1, "rules", 2), mine: true }];
  assert.deepEqual(withDone(all, 1, true, true).map((i) => i.done), [false, true]);
  assert.deepEqual(withDone(all, 1, true).map((i) => i.done), [true, false]);
  assert.deepEqual(withText(all, 1, "new").map((i) => i.text), ["t1", "new"]);
  assert.deepEqual(withoutItem(all, 1).map((i) => !!i.mine), [false]);
  assert.equal(withItem(all, item(7, "rules", 3)).at(-1).mine, true);
});

test("the My Rules list is offered last", () => {
  assert.equal(LISTS.at(-1).kind, "rules");
});

test("a removed shared line leaves the list and the rest move up one number", () => {
  const all = [item(1, "mistakes", 1), item(2, "mistakes", 2), item(3, "mistakes", 3), { ...item(9, "mistakes", 4), mine: true }, item(4, "remember", 1)];
  const next = withHidden(all, 2);
  assert.deepEqual(itemsOf(next, "mistakes").map((i) => [i.id, i.position]), [[1, 1], [3, 2], [9, 3]]);
  assert.equal(itemsOf(next, "remember")[0].position, 1); // another list is untouched
  assert.equal(changedCount(next, "mistakes"), 1);
  assert.equal(changedCount(next, "remember"), 0);
});

test("a reworded shared line is marked edited, and own lines are not counted as changed", () => {
  const all = [item(1, "mistakes", 1), { ...item(1, "mistakes", 2), mine: true }];
  const next = withSharedText(all, 1, "New words");
  assert.equal(next[0].text, "New words");
  assert.equal(next[0].edited, true);
  assert.equal(next[1].text, "t1"); // the own line with the same id is a different line
  assert.equal(changedCount(next, "mistakes"), 1);
});
