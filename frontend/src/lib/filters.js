import { outcome, ymd } from "./stats.js";

const NO_FILTER = { result: "all", pair: "all", setup: "all", from: "", to: "", q: "" };

// Journal filters. `from` / `to` are "YYYY-MM-DD" (local days, both included); `setup` may be "none" for untagged trades.
function filterEntries(entries, f) {
  const q = (f.q || "").trim().toLowerCase();
  return entries.filter((e) => {
    // "be" and "ctc" match the stored result, so they stay apart (BE: closed at cost by hand; CTC: reversed after 1:1.5 RR).
    // The others match the outcome (win, loss, open...).
    if (f.result === "be" || f.result === "ctc" ? e.result !== f.result : f.result !== "all" && outcome(e) !== f.result) return false;
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
