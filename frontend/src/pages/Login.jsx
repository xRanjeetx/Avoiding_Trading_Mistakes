import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "../api/index.js";

function strength(pw) {
  let s = 0;
  if (pw.length >= 8) s++;
  if (pw.length >= 12) s++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++;
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) s++;
  return pw ? Math.max(1, s) : 0;
}
const LEVELS = ["", "Weak", "Fair", "Good", "Strong"];

const msg = (err) => (err instanceof ApiError ? err.message : "Something went wrong.");

// Auth form. `mode` ("login" | "register") is controlled by the parent so page buttons can switch it.
// `link` is an emailed link the page was opened with: { kind: "verify" | "reset", token }.
// `view` is the screen shown: the login/register form, or one step of the email flows.
export default function Login({ onAuth, mode, onMode, link }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [view, setView] = useState(link?.kind === "verify" ? "verifying" : link?.kind === "reset" ? "reset" : "form");
  const [unverified, setUnverified] = useState(false);
  const verifyStarted = useRef(false);
  const isLogin = mode === "login";
  const score = strength(password);
  const finish = (t) => onAuth({ token: t.access_token, email: t.email, isAdmin: !!t.is_admin });

  useEffect(() => {
    if (view !== "verifying" || verifyStarted.current) return;
    verifyStarted.current = true;
    api.verifyEmail(link.token).then(finish).catch((err) => { setError(msg(err)); setView("verify-failed"); });
  }, []);

  async function run(fn) {
    setBusy(true);
    setError("");
    setNotice("");
    try { await fn(); } catch (err) { setError(msg(err)); } finally { setBusy(false); }
  }

  const go = (v) => { setView(v); setError(""); setNotice(""); setUnverified(false); };
  const pick = (m) => { onMode(m); go("form"); };

  function submit(e) {
    e.preventDefault();
    setUnverified(false);
    run(async () => {
      try {
        const t = await (isLogin ? api.login : api.register)(email.trim(), password);
        if (t.access_token) finish(t); else go("check-inbox");
      } catch (err) {
        if (err instanceof ApiError && err.status === 403 && isLogin) setUnverified(true);
        throw err;
      }
    });
  }

  const resend = () => run(async () => { await api.resendVerification(email.trim()); setNotice("Verification email sent again. Check your inbox and spam folder."); });
  const forgot = (e) => { e.preventDefault(); run(async () => { await api.forgotPassword(email.trim()); go("reset-sent"); }); };
  const reset = (e) => { e.preventDefault(); run(async () => { finish(await api.resetPassword(link.token, password)); }); };

  const top = (title, text) => (
    <div className="auth-top">
      <span className="auth-badge">
        <svg viewBox="0 0 24 24"><path d="M12 3l7 3v5c0 4.5-3 8.2-7 10-4-1.8-7-5.5-7-10V6z" /><path d="M9 12l2 2 4-4" /></svg>
      </span>
      <div><h2>{title}</h2><p>{text}</p></div>
    </div>
  );
  const alerts = (
    <>
      {error && <div className="af-error" role="alert"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M12 7.5v5M12 16.2v.1" /></svg>{error}</div>}
      {notice && <p className="af-note" role="status">{notice}</p>}
    </>
  );
  const back = <p className="af-switch"><button type="button" disabled={busy} onClick={() => pick("login")}>Back to log in</button></p>;

  if (view === "verifying") {
    return <div className="card auth-card" id="auth">{top("Verifying your email", "One moment…")}<p className="af-note"><span className="af-spin" /></p></div>;
  }
  if (view === "verify-failed") {
    return <div className="card auth-card" id="auth">{top("Link not valid", "It may have expired or already been used.")}{alerts}{back}</div>;
  }
  if (view === "check-inbox") {
    return (
      <div className="card auth-card" id="auth">
        {top("Check your inbox", `We sent a verification link to ${email.trim()}. Open it to activate your account.`)}
        {alerts}
        <button type="button" className="af-submit" disabled={busy} onClick={resend}><span>{busy ? "Sending…" : "Resend email"}</span></button>
        {back}
      </div>
    );
  }
  if (view === "forgot" || view === "reset-sent") {
    const sent = view === "reset-sent";
    return (
      <form className="card auth-card" id="auth" onSubmit={forgot}>
        {top(sent ? "Check your inbox" : "Forgot your password?", sent ? `If an account exists for ${email.trim()}, a reset link is on its way. It expires in an hour.` : "Enter your email and we will send you a link to choose a new one.")}
        {!sent && (
          <label className="af">
            <span>Email</span>
            <div className="af-box">
              <svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="3" /><path d="M3.5 7.5l8.5 6 8.5-6" /></svg>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" autoCapitalize="none" required maxLength={254} autoFocus />
            </div>
          </label>
        )}
        {alerts}
        <button className="af-submit" disabled={busy}><span>{busy ? "Sending…" : sent ? "Send again" : "Send reset link"}</span></button>
        {back}
      </form>
    );
  }
  if (view === "reset") {
    return (
      <form className="card auth-card" id="auth" onSubmit={reset}>
        {top("Choose a new password", "You will be logged in once it is saved.")}
        <label className="af">
          <span>New password</span>
          <div className="af-box">
            <svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="9" rx="2.5" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
            <input type={show ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" autoComplete="new-password" required minLength={8} maxLength={72} autoFocus />
            <button type="button" className="af-eye" aria-label={show ? "Hide password" : "Show password"} onClick={() => setShow(!show)}>
              <svg viewBox="0 0 24 24"><path d="M2.5 12C3.5 10 7 6 12 6s8.5 4 9.5 6c-1 2-4.5 6-9.5 6s-8.5-4-9.5-6z" /><circle cx="12" cy="12" r="3" /></svg>
            </button>
          </div>
        </label>
        <div className={`af-meter s${score}`} aria-live="polite"><div><i /><i /><i /><i /></div><small>{score ? `${LEVELS[score]} password` : ""}</small></div>
        {alerts}
        <button className="af-submit" disabled={busy}>{busy ? <span className="af-spin" /> : null}<span>{busy ? "Saving…" : "Save password"}</span></button>
        {error && <p className="af-switch"><button type="button" onClick={() => go("forgot")}>Request a new link</button></p>}
      </form>
    );
  }

  return (
    <form className="card auth-card" id="auth" onSubmit={submit}>
      <div className="auth-top">
        <span className="auth-badge">
          <svg viewBox="0 0 24 24"><path d="M12 3l7 3v5c0 4.5-3 8.2-7 10-4-1.8-7-5.5-7-10V6z" /><path d="M9 12l2 2 4-4" /></svg>
        </span>
        <div>
          <h2>{isLogin ? "Welcome back" : "Create your account"}</h2>
          <p>{isLogin ? "Log in to open your journal." : "Keep your journal in the cloud. Free to start."}</p>
        </div>
      </div>

      <div className="auth-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={isLogin} className={isLogin ? "on" : ""} disabled={busy} onClick={() => pick("login")}>Log in</button>
        <button type="button" role="tab" aria-selected={!isLogin} className={!isLogin ? "on" : ""} disabled={busy} onClick={() => pick("register")}>Sign up</button>
      </div>

      <label className="af">
        <span>Email</span>
        <div className="af-box">
          <svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="3" /><path d="M3.5 7.5l8.5 6 8.5-6" /></svg>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" autoCapitalize="none" required maxLength={254} />
        </div>
      </label>

      <label className="af">
        <span>Password</span>
        <div className="af-box">
          <svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="9" rx="2.5" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
          <input type={show ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} placeholder={isLogin ? "Your password" : "At least 8 characters"} autoComplete={isLogin ? "current-password" : "new-password"} required minLength={8} maxLength={72} />
          <button type="button" className="af-eye" aria-label={show ? "Hide password" : "Show password"} onClick={() => setShow(!show)}>
            {show
              ? <svg viewBox="0 0 24 24"><path d="M3 3l18 18M10.6 6.2A9.8 9.8 0 0 1 12 6c5 0 8.5 4 9.5 6a14 14 0 0 1-3 3.8M6.5 7.6C4.4 9 3 11 2.5 12c1 2 4.5 6 9.5 6 1.4 0 2.7-.3 3.8-.8" /><path d="M9.9 10a3 3 0 0 0 4.1 4.1" /></svg>
              : <svg viewBox="0 0 24 24"><path d="M2.5 12C3.5 10 7 6 12 6s8.5 4 9.5 6c-1 2-4.5 6-9.5 6s-8.5-4-9.5-6z" /><circle cx="12" cy="12" r="3" /></svg>}
          </button>
        </div>
      </label>

      {!isLogin && (
        <div className={`af-meter s${score}`} aria-live="polite">
          <div><i /><i /><i /><i /></div>
          <small>{score ? `${LEVELS[score]} password` : ""}</small>
        </div>
      )}

      {isLogin && <p className="af-switch af-forgot"><button type="button" disabled={busy} onClick={() => go("forgot")}>Forgot password?</button></p>}

      {alerts}
      {unverified && <p className="af-switch"><button type="button" disabled={busy} onClick={resend}>Resend verification email</button></p>}

      <button className="af-submit" disabled={busy}>
        {busy ? <span className="af-spin" /> : null}
        <span>{busy ? "Please wait…" : isLogin ? "Log in" : "Create account"}</span>
        {!busy && <svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6" /></svg>}
      </button>
      {busy && <p className="af-note">The free server sleeps when idle, so the first request can take up to a minute.</p>}

      <p className="af-switch">
        {isLogin ? "New to Trade Guard?" : "Already have an account?"}{" "}
        <button type="button" disabled={busy} onClick={() => pick(isLogin ? "register" : "login")}>{isLogin ? "Create an account" : "Log in"}</button>
      </p>
      <p className="af-secure"><svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="9" rx="2.5" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>Your journal is private to your account</p>
    </form>
  );
}
