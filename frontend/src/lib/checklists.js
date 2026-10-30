// Helpers for the Learning checklists (common mistakes, points to remember, trade management).
// The three lists the Learning tab offers besides the books. `kind` matches the server and also names the colour in the CSS (k-<kind>).
const LISTS = [
  { kind: "mistakes", label: "Mistakes", icon: "alert", title: "Common mistakes", blurb: "Tick each one you have read and will not repeat.", done: "Every mistake read. Keep them in front of you on every trade." },
  { kind: "remember", label: "Remember", icon: "bulb", title: "Points to always remember", blurb: "Read these before you open the chart.", done: "Every point read. Now trade the plan." },
  { kind: "management", label: "Management", icon: "sliders", title: "Trade management", blurb: "How to enter, protect and exit a trade.", done: "Every rule read. Decide the stop and target before you enter." },
];

// The picture for a heading inside a list. Anything not listed gets a note.
const GROUP_ICONS = { "Quick checklist": "bolt", "In detail": "note" };
const groupIcon = (group) => GROUP_ICONS[group] || "note";

const itemsOf = (items, kind) => (items || []).filter((i) => i.kind === kind).sort((a, b) => a.position - b.position);

// A list split under its headings, in order: [{ group: "Quick checklist", items: [...] }]. A list with no headings is one group named "".
function groupItems(items) {
  const out = [];
  for (const item of items) {
    const last = out[out.length - 1];
    if (last && last.group === item.group) last.items.push(item);
    else out.push({ group: item.group, items: [item] });
  }
  return out;
}

function progress(items) {
  const done = items.filter((i) => i.done).length;
  return { done, total: items.length, pct: items.length ? Math.round((done / items.length) * 100) : 0 };
}

const withDone = (items, id, done) => items.map((i) => (i.id === id ? { ...i, done } : i));
const clearKind = (items, kind) => items.map((i) => (i.kind === kind ? { ...i, done: false } : i));

export { LISTS, clearKind, groupIcon, groupItems, itemsOf, progress, withDone };
