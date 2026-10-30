import { useEffect, useRef, useState } from "react";
import { api } from "../api/index.js";
import { SLOTS } from "../lib/image.js";
import { Icon } from "./ui.jsx";

// Screenshots live behind the login, so they are fetched with the token and shown from a blob URL. The server's
// token for a slot changes whenever the picture is replaced, so it is also the cache key.
const urls = new Map();

function useShot(id, slot, token) {
  const [state, setState] = useState({ key: token, url: null, failed: false });
  useEffect(() => {
    if (!token || urls.has(token)) return;
    let live = true;
    api.imageBlob(id, slot, token).then(
      (blob) => {
        const url = URL.createObjectURL(blob);
        urls.set(token, url);
        if (live) setState({ key: token, url, failed: false });
      },
      () => live && setState({ key: token, url: null, failed: true }),
    );
    return () => { live = false; };
  }, [id, slot, token]);
  if (!token) return { url: null, failed: false };
  return { url: urls.get(token) || null, failed: state.key === token && state.failed };
}

function Picture({ id, slot, token, alt, className }) {
  const { url, failed } = useShot(id, slot, token);
  if (failed) return <span className="shot-miss muted">Could not load</span>;
  return url ? <img className={className} src={url} alt={alt} /> : <span className="shot-miss muted">Loading…</span>;
}

// ---------- Close / edit sheet: add, replace and remove ----------
export function ShotPicker({ entry, onUpload, onRemove }) {
  const [busy, setBusy] = useState(null);
  const inputs = useRef({});
  const images = entry.images || {};

  async function upload(slot, file) {
    if (!file || busy) return;
    setBusy(slot);
    await onUpload(entry.id, slot, file);
    setBusy(null);
  }
  async function remove(slot) {
    setBusy(slot);
    await onRemove(entry.id, slot);
    setBusy(null);
  }

  // Ctrl+V of a copied screenshot fills the first empty slot.
  useEffect(() => {
    const onPaste = (e) => {
      const file = [...(e.clipboardData?.files || [])].find((f) => f.type.startsWith("image/"));
      const slot = SLOTS.map(([s]) => s).find((s) => !images[s]);
      if (file && slot) { e.preventDefault(); upload(slot, file); }
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  });

  return (
    <div className="field"><span>Chart screenshots</span>
      <div className="shots">
        {SLOTS.map(([slot, label]) => {
          const token = images[slot];
          return (
            <div className="shot" key={slot}>
              {token ? (
                <div className="shot-frame">
                  <Picture id={entry.id} slot={slot} token={token} alt={`${label} screenshot`} />
                  <div className="shot-actions">
                    <button type="button" className="icon-btn small" aria-label={`Replace ${label.toLowerCase()} screenshot`} disabled={!!busy} onClick={() => inputs.current[slot].click()}><Icon name="upload" size={15} /></button>
                    <button type="button" className="icon-btn small" aria-label={`Remove ${label.toLowerCase()} screenshot`} disabled={!!busy} onClick={() => remove(slot)}><Icon name="trash" size={15} /></button>
                  </div>
                </div>
              ) : (
                <button type="button" className="shot-add" disabled={!!busy} onClick={() => inputs.current[slot].click()}>
                  <Icon name="image" size={22} />
                  <b>{busy === slot ? "Uploading…" : label}</b>
                  <small>Tap to add, or paste</small>
                </button>
              )}
              {token && <small className="shot-label">{busy === slot ? "Working…" : label}</small>}
              <input ref={(el) => { inputs.current[slot] = el; }} type="file" accept="image/*" hidden
                onChange={(e) => { upload(slot, e.target.files[0]); e.target.value = ""; }} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------- Journal card: thumbnails that open full size ----------
export function ShotThumbs({ entry }) {
  const [open, setOpen] = useState(null);
  const shown = SLOTS.filter(([slot]) => entry.images?.[slot]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === "Escape" && setOpen(null);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);
  if (!shown.length) return null;
  return (
    <>
      <div className="shots thumbs">
        {shown.map(([slot, label]) => (
          <button type="button" className="shot-thumb" key={slot} aria-label={`View ${label.toLowerCase()} screenshot`} onClick={() => setOpen(slot)}>
            <Picture id={entry.id} slot={slot} token={entry.images[slot]} alt={`${label} screenshot`} />
            <small className="shot-label">{label}</small>
          </button>
        ))}
      </div>
      {open && entry.images[open] && (
        <div className="lightbox" role="dialog" aria-modal="true" aria-label="Screenshot" onClick={() => setOpen(null)}>
          <button type="button" className="icon-btn lightbox-close" aria-label="Close" onClick={() => setOpen(null)}><Icon name="x" size={20} /></button>
          <Picture id={entry.id} slot={open} token={entry.images[open]} alt={`${entry.pair || "Trade"} screenshot`} className="lightbox-img" />
        </div>
      )}
    </>
  );
}
