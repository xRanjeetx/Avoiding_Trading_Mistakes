import { useEffect, useState } from "react";
import { api, ApiError } from "../api/index.js";
import { Icon } from "./ui.jsx";

// Settings > Security: turn two-factor sign-in (an authenticator app such as Google Authenticator, Microsoft
// Authenticator or Authy) on or off. Steps: password -> scan the QR code and type the first code -> save the recovery codes.
export default function TwoFactor() {
  const [on, setOn] = useState(null); // null until the server has answered
  const [step, setStep] = useState("idle"); // idle | password | scan | codes | disable
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [setup, setSetup] = useState(null); // { secret, qr }
  const [codes, setCodes] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => { api.me().then((m) => setOn(!!m.twoFactor)).catch(() => {}); }, []);

  const go = (next) => { setStep(next); setError(""); setCode(""); setPassword(""); };
  async function run(fn) {
    setBusy(true);
    setError("");
    try { await fn(); } catch (err) { setError(err instanceof ApiError ? err.message : "Something went wrong."); } finally { setBusy(false); }
  }

  const start = (e) => { e.preventDefault(); run(async () => { setSetup(await api.twoFactorSetup(password)); setPassword(""); setStep("scan"); }); };
  const confirm = (e) => { e.preventDefault(); run(async () => { const r = await api.twoFactorEnable(code.trim()); setCodes(r.recoveryCodes); setOn(true); go("codes"); }); };
  const stop = (e) => { e.preventDefault(); run(async () => { await api.twoFactorDisable(password, code.trim()); setOn(false); go("idle"); }); };

  const text = codes.join("\n");
  const copy = async () => { try { await navigator.clipboard.writeText(text); setCopied(true); } catch { /* the codes are on screen */ } };
  const save = () => {
    const url = URL.createObjectURL(new Blob([`Trade Guard recovery codes\nEach works once.\n\n${text}\n`], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "trade-guard-recovery-codes.txt";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const alert = error && <div className="af-error" role="alert">{error}</div>;

  if (on === null) return null;

  if (step === "password") {
    return (
      <form className="tf" onSubmit={start}>
        <p className="muted hint">Confirm your password to begin.</p>
        <label className="field">
          <input type="password" required autoFocus autoComplete="current-password" placeholder="Password" aria-label="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {alert}
        <div className="data-actions">
          <button type="button" className="btn ghost" disabled={busy} onClick={() => go("idle")}>Cancel</button>
          <button type="submit" className="btn" disabled={busy || !password}>{busy ? "Checking…" : "Continue"}</button>
        </div>
      </form>
    );
  }
  if (step === "scan") {
    return (
      <form className="tf" onSubmit={confirm}>
        <p className="muted hint">1. Scan this code with your authenticator app, or type the key into it. 2. Enter the 6-digit code it shows.</p>
        <img className="tf-qr" src={setup.qr} alt="QR code for your authenticator app" width="180" height="180" />
        <p className="tf-key" aria-label="Setup key"><code>{setup.secret}</code></p>
        <label className="field">
          <input inputMode="numeric" autoComplete="one-time-code" required autoFocus maxLength={10} placeholder="6-digit code" aria-label="6-digit code" value={code} onChange={(e) => setCode(e.target.value)} />
        </label>
        {alert}
        <div className="data-actions">
          <button type="button" className="btn ghost" disabled={busy} onClick={() => go("idle")}>Cancel</button>
          <button type="submit" className="btn" disabled={busy || !code.trim()}>{busy ? "Checking…" : "Turn on"}</button>
        </div>
      </form>
    );
  }
  if (step === "codes") {
    return (
      <div className="tf">
        <p><b>Two-factor sign-in is on.</b> Save these recovery codes now. Each one works once if you lose your phone, and they will not be shown again.</p>
        <pre className="tf-codes" aria-label="Recovery codes">{text}</pre>
        <div className="data-actions">
          <button type="button" className="btn ghost" onClick={copy}>{copied ? "Copied" : "Copy"}</button>
          <button type="button" className="btn ghost" onClick={save}><Icon name="download" size={16} /> Save as file</button>
          <button type="button" className="btn" onClick={() => { setCodes([]); setSetup(null); go("idle"); }}>I have saved them</button>
        </div>
      </div>
    );
  }
  if (step === "disable") {
    return (
      <form className="tf" onSubmit={stop}>
        <p className="muted hint">Enter your password and a current code (or a recovery code) to turn two-factor sign-in off.</p>
        <label className="field">
          <input type="password" required autoFocus autoComplete="current-password" placeholder="Password" aria-label="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        <label className="field">
          <input autoComplete="one-time-code" required maxLength={40} placeholder="Code or recovery code" aria-label="Code or recovery code" value={code} onChange={(e) => setCode(e.target.value)} />
        </label>
        {alert}
        <div className="data-actions">
          <button type="button" className="btn ghost" disabled={busy} onClick={() => go("idle")}>Cancel</button>
          <button type="submit" className="btn danger-outline" disabled={busy || !password || !code.trim()}>{busy ? "Checking…" : "Turn off"}</button>
        </div>
      </form>
    );
  }
  return (
    <div className="tf">
      <p className="muted hint">
        {on
          ? "Two-factor sign-in is on: logging in needs a code from your authenticator app."
          : "Add a code from an authenticator app to your password. Required for admins."}
      </p>
      <button type="button" className={on ? "btn ghost" : "btn"} onClick={() => go(on ? "disable" : "password")}>
        <Icon name="lock" size={16} /> {on ? "Turn off two-factor sign-in" : "Turn on two-factor sign-in"}
      </button>
    </div>
  );
}
