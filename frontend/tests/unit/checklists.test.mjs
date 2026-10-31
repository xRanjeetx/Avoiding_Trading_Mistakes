import test from "node:test";
import assert from "node:assert/strict";
import { LISTS, clearKind, groupIcon, groupItems, itemsOf, progress, withDone } from "../../src/lib/checklists.js";

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
  assert.deepEqual(LISTS.map((l) => l.kind), ["mistakes", "remember", "psychology", "management"]);
  for (const l of LISTS) assert.ok(l.label && l.icon && l.title && l.blurb && l.done);
});

test("groupIcon falls back to a note", () => {
  assert.equal(groupIcon("Quick checklist"), "bolt");
  assert.equal(groupIcon("In detail"), "note");
  assert.equal(groupIcon("Something new"), "note");
});
