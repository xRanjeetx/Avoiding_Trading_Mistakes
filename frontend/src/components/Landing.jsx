import { useRef, useState } from "react";
import { RULES } from "../lib/rules.js";
import Login from "./Login.jsx";
import MarketBackdrop from "./MarketBackdrop.jsx";

const KEY_THEME = "atm_theme";

function toggleTheme() {
  const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
  document.documentElement.dataset.theme = next;
  document.querySelector('meta[name="theme-color"]').content = next === "light" ? "#f1f7f5" : "#07110f";
  try { localStorage.setItem(KEY_THEME, next); } catch {}
}

const FEATURES = [
  { icon: <><path d="M9 11l3 3 8-8" /><path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9" /></>,
    title: "Pre-trade checklist", text: `${RULES.length} rules checked before every entry` },
  { icon: <><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>,
    title: "Daily lock", text: "Locks you out after max trades or SLs" },
  { icon: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
    title: "Journal & stats", text: "Equity curve, win rate, drawdown" },
];

function Check() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>;
}

// An emailed link opens the site as /?verify=TOKEN or /?reset=TOKEN. Read it once, then clean the address bar
// so the token is not left in the URL (history, screenshots, shared links).
// Cached because React StrictMode (dev) runs this twice and the second run would otherwise find the URL already cleaned.
let emailLink;
function readEmailLink() {
  if (emailLink !== undefined) return emailLink;
  const q = new URLSearchParams(window.location.search);
  const kind = q.has("verify") ? "verify" : q.has("reset") ? "reset" : null;
  emailLink = null;
  if (!kind) return emailLink;
  emailLink = { kind, token: q.get(kind) };
  window.history.replaceState(null, "", window.location.pathname);
  return emailLink;
}

export default function Landing({ onAuth }) {
  const [link] = useState(readEmailLink);
  const [mode, setMode] = useState(link ? "login" : "register");
  const authRef = useRef(null);

  // On stacked (phone/tablet) layouts the form sits below the fold, so bring it into view
  function openAuth(next) {
    setMode(next);
    if (window.matchMedia("(max-width: 959px)").matches) {
      authRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  return (
    <div className="lp">
      <MarketBackdrop />
      <header className="lp-nav">
        <span className="lp-brand"><img src="/icon.svg" alt="" /><span>Trade Guard</span></span>
        <div className="lp-nav-r">
          <button className="icon-btn" type="button" aria-label="Switch light/dark theme" onClick={toggleTheme}>
            <svg className="icon-sun" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
            <svg className="icon-moon" viewBox="0 0 24 24"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></svg>
          </button>
          <button className="lp-link-btn" type="button" onClick={() => openAuth("login")}>Log in</button>
          <button className="btn primary small" type="button" onClick={() => openAuth("register")}>Get started</button>
        </div>
      </header>

      <main className="lp-hero">
        <div className="lp-hero-copy">
          <span className="lp-pill"><i /> Discipline over impulse</span>
          <h1>Stop repeating the <em>same trading mistakes.</em></h1>
          <p className="lp-lead">
            A pre-trade checklist and journal in one. Trade Guard gives you the green light only when every one of your own rules passes.
          </p>
          <ul className="lp-feats">
            {FEATURES.map((f, i) => (
              <li key={f.title} style={{ "--i": i }}>
                <span className="lp-ico"><svg viewBox="0 0 24 24">{f.icon}</svg></span>
                <div><b>{f.title}</b><small>{f.text}</small></div>
              </li>
            ))}
          </ul>
          <ul className="lp-trust">
            <li><Check /> No broker connection</li>
            <li><Check /> Your rules, your limits</li>
            <li><Check /> Phone and desktop</li>
          </ul>
        </div>

        <div className="lp-visual">
          <div className="lp-glow" />
          <div className="lp-auth" ref={authRef}><Login mode={mode} onMode={setMode} onAuth={onAuth} link={link} /></div>
        </div>
      </main>
    </div>
  );
}
