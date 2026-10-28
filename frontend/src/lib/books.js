// Helpers for the Learning library.
function fmtSize(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  const mb = bytes / (1024 * 1024);
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

const clampPage = (page, total) => Math.min(Math.max(1, Math.round(Number(page)) || 1), Math.max(1, total || 1));

// Reading progress as "page 37 of 210", or "Not started".
function progressLabel(lastPage, total) {
  if (!lastPage || lastPage <= 1) return "Not started";
  return total ? `Page ${lastPage} of ${total}` : `Page ${lastPage}`;
}

export { clampPage, fmtSize, progressLabel };
