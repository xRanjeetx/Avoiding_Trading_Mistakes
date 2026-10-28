import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, clearSession, getSession, setSession } from "./api.js";
import { NO_NEWS, NO_RULE_EDITS, activeRules } from "./lib/rules.js";
import { parseCsv } from "./lib/csv.js";
import Landing from "./components/Landing.jsx";
import Checklist from "./components/Checklist.jsx";
import Today from "./components/Today.jsx";
import Journal from "./components/Journal.jsx";
import Stats from "./components/Stats.jsx";
import Settings from "./components/Settings.jsx";
import Learning from "./components/Learning.jsx";
import Admin from "./components/Admin.jsx";
import SessionStrip from "./components/SessionStrip.jsx";
import CloseSheet from "./components/CloseSheet.jsx";
import { dueReminders, loadPrefs, markSent, notify, savePrefs, wasSent } from "./lib/reminders.js";

const DEFAULT_SETTINGS = { lot: 0.02, minRR: 2, maxTrades: 4, maxSL: 4, balance: 0, currency: "$",
  pairs: [{ pair: "XAUUSD", lot: 0.02 }, { pair: "EURUSD", lot: 0.2 }], rules: NO_RULE_EDITS, news: NO_NEWS };
const KEY_THEME = "atm_theme";

const ICONS = {
  checklist: <><path d="M9 11l3 3 8-8" /><path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9" /></>,
  today: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
  log: <path d="M4 6h16M4 12h16M4 18h10" />,
  stats: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
  learn: <><path d="M5 4h13a1 1 0 0 1 1 1v14H6a1 1 0 0 0-1 1z" /><path d="M5 4v16M9 8h6" /></>,
  admin: <><path d="M12 3l7 3v5c0 4.5-3 8.2-7 10-4-1.8-7-5.5-7-10V6z" /><path d="M9 12l2 2 4-4" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></>,
};
const TABS = [["checklist", "Check"], ["today", "Today"], ["log", "Journal"], ["stats", "Stats"], ["learn", "Learning"], ["settings", "Settings"]];
const ADMIN_TAB = ["admin", "Admin"];
const PAGE = {
  checklist: ["Pre-trade checklist", "Pass every rule before you enter"],
  today: ["Today", "Your trades and daily limits"],
  log: ["Journal", "Every trade you have logged"],
  stats: ["Statistics", "How your trading is performing"],
  learn: ["Learning", "Your strategy and trading books"],
  settings: ["Settings", "Limits, sessions and account"],
  admin: ["Admin", "Users and account management"],
};

function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  document.querySelector('meta[name="theme-color"]').content = t === "light" ? "#f1f7f5" : "#07110f";
}

// An emailed verify/reset link belongs to whoever is opening it, not to a previous login saved in this browser.
// Drop the old session so the link is handled by the landing page instead of being ignored.
function initialSession() {
  const q = new URLSearchParams(window.location.search);
  if (q.has("verify") || q.has("reset")) { clearSession(); return null; }
  return getSession();
}

export default function App() {
  const [session, setSessionState] = useState(initialSession);
  useEffect(() => { document.body.classList.toggle("public", !session); }, [session]);
  // The role can change on the server (ADMIN_EMAILS), so refresh it instead of trusting the saved session.
  const hasSession = !!session;
  useEffect(() => {
    if (!hasSession) return;
    api.me().then((m) => {
      setSessionState((s) => {
        if (!s || !!s.isAdmin === m.isAdmin) return s;
        const next = { ...s, isAdmin: m.isAdmin };
        setSession(next);
        return next;
      });
    }).catch(() => {});
  }, [hasSession]);
  if (!session) {
    return <Landing onAuth={(s) => { setSession(s); setSessionState(s); }} />;
  }
  return <Journalled session={session} onLogout={() => { clearSession(); setSessionState(null); }} />;
}

function Journalled({ session, onLogout }) {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [entries, setEntries] = useState([]);
  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [loadError, setLoadError] = useState("");
  const [tabState, setTab] = useState("checklist");
  // The Admin tab is only offered to admins (the API enforces this too). Fall back if the role is lost.
  const tab = tabState === "admin" && !session.isAdmin ? "checklist" : tabState;
  const tabs = session.isAdmin ? [...TABS, ADMIN_TAB] : TABS;
  const [menu, setMenu] = useState(false);
  const [sheet, setSheet] = useState(null); // { id, preset }
  const [toast, setToast] = useState("");
  const [now, setNow] = useState(() => new Date());
  const [progress, setProgress] = useState({ passed: 0, state: "pending" });
  const toastTimer = useRef();

  // In-app replacement for window.confirm: resolves true on confirm, false on cancel/Escape/backdrop.
  const [ask, setAsk] = useState(null); // { title, text, okLabel, resolve }
  const confirmToast = useCallback((opts) => new Promise((resolve) => setAsk({ ...opts, resolve })), []);
  const answerAsk = (ok) => { ask.resolve(ok); setAsk(null); };
  useEffect(() => {
    if (!ask) return undefined;
    const onKey = (e) => { if (e.key === "Escape") { ask.resolve(false); setAsk(null); } };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [ask]);

  const say = useCallback((msg) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 2500);
  }, []);

  // Runs an API call; on failure shows the message (and logs out if the login expired).
  const attempt = useCallback(async (fn) => {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) onLogout();
      else say(err instanceof ApiError ? err.message : "Something went wrong.");
      return undefined;
    }
  }, [onLogout, say]);

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      const [s, e] = await Promise.all([api.getSettings(), api.listEntries()]);
      setSettings({ ...DEFAULT_SETTINGS, ...s });
      setEntries(e);
      setStatus("ready");
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return onLogout();
      setLoadError(err.message);
      setStatus("error");
    }
  }, [onLogout]);
  useEffect(() => { load(); }, [load]);

  // Time-based rules (sessions, the loss cooldown) re-check every 10s.
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 10000);
    return () => clearInterval(id);
  }, []);

  // Reminders: a session about to open, a trade open for too long. Each one is sent once.
  const [reminders, setReminders] = useState(loadPrefs);
  const changeReminders = (patch) => setReminders((p) => { const next = { ...p, ...patch }; savePrefs(next); return next; });
  useEffect(() => {
    if (status !== "ready") return;
    for (const r of dueReminders({ entries, settings, prefs: reminders, now })) {
      if (wasSent(r.key)) continue;
      markSent(r.key);
      say(r.title);
      notify(r.title, r.body, r.key);
    }
  }, [now, status, entries, settings, reminders, say]);

  // Follow the phone's theme until the user picks one manually.
  useEffect(() => {
    const mq = matchMedia("(prefers-color-scheme: light)");
    const onChange = (e) => {
      let saved = null;
      try { saved = localStorage.getItem(KEY_THEME); } catch {}
      if (!saved) applyTheme(e.matches ? "light" : "dark");
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  const toggleTheme = () => {
    const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
    applyTheme(next);
    try { localStorage.setItem(KEY_THEME, next); } catch {}
  };

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && setMenu(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => { document.body.classList.toggle("noscroll", menu); }, [menu]);

  // ---------- Actions ----------
  const logTrade = async (payload) => {
    const created = await attempt(() => api.createEntry(payload));
    if (!created) return false;
    setEntries((list) => [...list, created]);
    say("Trade logged. Close it from the Today tab when it finishes.");
    return true;
  };

  const saveEntry = async (next, missingPnl) => {
    const saved = await attempt(() => api.updateEntry(next));
    if (!saved) return false;
    setEntries((list) => list.map((e) => (e.id === saved.id ? saved : e)));
    say(missingPnl ? "Saved. Add a P&L amount to include it in profit stats." : "Saved.");
    return true;
  };

  const deleteEntry = async (id) => {
    const ok = await confirmToast({ title: "Delete this trade?", text: "It will be removed from your journal.", okLabel: "Delete" });
    if (!ok) return;
    const done = await attempt(async () => { await api.deleteEntry(id); return true; });
    if (done) setEntries((list) => list.filter((e) => e.id !== id));
  };

  const saveSettings = async (next) => {
    const saved = await attempt(() => api.putSettings(next));
    if (saved) {
      setSettings({ ...DEFAULT_SETTINGS, ...saved });
      say("Settings saved.");
    }
  };

  const clearAll = async () => {
    const ok = await confirmToast({ title: "Delete all data?", text: "All trades and history will be erased. This cannot be undone.", okLabel: "Delete all" });
    if (!ok) return;
    const done = await attempt(async () => { await api.deleteAllEntries(); return true; });
    if (done) {
      setEntries([]);
      say("All data deleted.");
    }
  };

  const importCsv = async (file) => {
    if (file.size > 5 * 1024 * 1024) return say("That file is too large (5 MB at most).");
    let list;
    try {
      list = parseCsv(await file.text());
    } catch (err) {
      return say(err.message);
    }
    if (list.length > 5000) return say("A file can hold up to 5000 trades. Split it and import in parts.");
    const res = await attempt(() => api.importEntries(list));
    if (!res) return;
    const fresh = await attempt(() => api.listEntries());
    if (fresh) setEntries(fresh);
    say(`Imported ${res.imported} trade${res.imported === 1 ? "" : "s"}${res.skipped ? `, ${res.skipped} already in your journal` : ""}.`);
  };

  const deleteAccount = async (password) => {
    const done = await attempt(async () => { await api.deleteAccount(password); return true; });
    if (done) onLogout();
    return !!done;
  };

  const ruleCount = activeRules(settings).length;
  const sheetEntry = sheet && entries.find((e) => e.id === sheet.id);
  const goto = (t) => { setTab(t); setMenu(false); window.scrollTo({ top: 0 }); };

  if (status !== "ready") {
    return (
      <main className="auth">
        <div className="card">
          {status === "loading" ? (
            <p className="muted">Loading your journal… the free server sleeps when idle, so this can take up to a minute.</p>
          ) : (
            <>
              <div className="banner">{loadError}</div>
              <div className="actions"><button className="btn primary" onClick={load}>Retry</button><button className="btn ghost" onClick={onLogout}>Log out</button></div>
            </>
          )}
        </div>
      </main>
    );
  }

  return (
    <>
      <header className="app-header">
        <div className="brand">
          <button className="icon-btn menu-btn" type="button" aria-label="Open menu" aria-expanded={menu} aria-controls="tabs" onClick={() => setMenu(!menu)}>
            <svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
          </button>
          <img src="/icon.svg" alt="" className="logo" />
          <div className="head-title">
            <h1>{PAGE[tab][0]}</h1>
            <div className="muted">{PAGE[tab][1]}</div>
            {tab === "checklist" && (
              <figure className="head-quote">
                <span className="hq-mark" aria-hidden="true">“</span>
                <blockquote>
                  Don’t lose patience. <b>Every great success</b> takes time and struggle.
                </blockquote>
              </figure>
            )}
          </div>
        </div>
        <div className="head-right">
          <div className="clock" title="Your local time">
            <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
            <span>{now.toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" })}</span>
          </div>
          <button className="icon-btn" type="button" aria-label="Switch light/dark theme" title="Switch theme" onClick={toggleTheme}>
            <svg className="icon-sun" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
            <svg className="icon-moon" viewBox="0 0 24 24"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></svg>
          </button>
          <div className={`ring ${progress.state}`} title="Rules passed">
            <svg viewBox="0 0 44 44">
              <circle cx="22" cy="22" r="19" className="ring-bg" />
              <circle cx="22" cy="22" r="19" className="ring-fg" style={{ strokeDashoffset: 119.4 * (1 - (ruleCount ? progress.passed / ruleCount : 1)) }} />
            </svg>
            <span>{progress.passed}/{ruleCount}</span>
          </div>
        </div>
      </header>

      <main>
        {tab === "checklist" && <SessionStrip settings={settings} now={now} />}
        <Checklist active={tab === "checklist"} entries={entries} settings={settings} now={now} onLog={logTrade} onProgress={setProgress} />
        <Today active={tab === "today"} entries={entries} settings={settings} onQuick={(id, preset) => setSheet({ id, preset })} />
        <Journal active={tab === "log"} entries={entries} settings={settings} onEdit={(id) => setSheet({ id, preset: null })}
          onDelete={deleteEntry} />
        <Stats active={tab === "stats"} entries={entries} settings={settings} />
        <Learning active={tab === "learn"} onExpired={onLogout} />
        <Settings active={tab === "settings"} settings={settings} reminders={reminders} onReminders={changeReminders} onSave={saveSettings} onClearAll={clearAll}
          entries={entries} onImport={importCsv} onDeleteAccount={deleteAccount} isAdmin={session.isAdmin} />
        {session.isAdmin && <Admin active={tab === "admin"} confirm={confirmToast} say={say} onExpired={onLogout} />}
      </main>

      <div className={`scrim ${menu ? "show" : ""}`} onClick={() => setMenu(false)} />
      <nav id="tabs" className={`sidebar ${menu ? "open" : ""}`} aria-label="Main menu">
        <div className="side-brand">
          <img src="/icon.svg" alt="" />
          <div><b>Trade Guard</b><small>Trade by the rules</small></div>
        </div>
        <div className="side-label">Menu</div>
        {tabs.map(([key, label]) => (
          <button key={key} className={tab === key ? "active" : ""} aria-current={tab === key ? "page" : undefined} onClick={() => goto(key)}>
            <span className="nav-ico"><svg viewBox="0 0 24 24">{ICONS[key]}</svg></span>
            <span>{label}</span>
          </button>
        ))}
        <div className="side-foot">
          <div className="user-chip" title={session.email}>
            <span className="avatar">{session.email.charAt(0).toUpperCase()}</span>
            <span className="user-meta">
              <small>Signed in as</small>
              <span className="user-email">{session.email}</span>
            </span>
          </div>
          <button type="button" className="logout-btn" aria-label="Log out" title="Log out" onClick={onLogout}>
            <svg viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" /></svg>
          </button>
        </div>
      </nav>

      {sheetEntry && (
        <CloseSheet key={sheetEntry.id + (sheet.preset || "")} entry={sheetEntry} preset={sheet.preset}
          onSave={saveEntry} onClose={() => setSheet(null)} />
      )}

      {ask && (
        <div className="confirm-backdrop" onClick={() => answerAsk(false)}>
          <div className="confirm-toast" role="alertdialog" aria-labelledby="confirmTitle" aria-describedby="confirmText" onClick={(e) => e.stopPropagation()}>
            <div className="confirm-ico" aria-hidden="true">
              <svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 10v6M14 10v6" /></svg>
            </div>
            <h3 id="confirmTitle">{ask.title}</h3>
            <p id="confirmText">{ask.text}</p>
            <div className="confirm-btns">
              <button type="button" className="btn ghost" autoFocus onClick={() => answerAsk(false)}>Cancel</button>
              <button type="button" className="btn danger-outline" onClick={() => answerAsk(true)}>{ask.okLabel}</button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </>
  );
}
