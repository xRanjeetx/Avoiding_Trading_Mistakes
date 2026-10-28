import { outcome, ymd } from "./stats.js";

const NO_FILTER = { result: "all", pair: "all", setup: "all", from: "", to: "", q: "" };

// Journal filters. `from` / `to` are "YYYY-MM-DD" (local days, both included); `setup` may be "none" for untagged trades.
function filterEntries(entries, f) {
  const q = (f.q || "").trim().toLowerCase();
  return entries.filter((e) => {
    if (f.result !== "all" && outcome(e) !== f.result) return false;
    if (f.pair !== "all" && e.pair !== f.pair) return false;
    if (f.setup !== "all" && (e.setup || "none") !== f.setup) return false;
    const day = ymd(e.timestamp);
    if (f.from && day < f.from) return false;
    if (f.to && day > f.to) return false;
    return !q || [e.pair, e.notes, e.lesson].join(" ").toLowerCase().includes(q);
  });
}

const isFiltered = (f) => Object.keys(NO_FILTER).some((k) => f[k] !== NO_FILTER[k]);

export { NO_FILTER, filterEntries, isFiltered };
