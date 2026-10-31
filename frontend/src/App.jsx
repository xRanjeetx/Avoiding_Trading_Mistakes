import { useCallback, useEffect, useRef, useState } from "react";
import Loader from "./components/Loader.jsx";
import { api, ApiError, clearSession, getSession, setSession } from "./api/index.js";
import { NO_NEWS, NO_RULE_EDITS, activeRules } from "./lib/rules.js";
import { parseCsv } from "./lib/csv.js";
import Landing from "./pages/Landing.jsx";
import Checklist from "./pages/Checklist.jsx";
import Today from "./pages/Today.jsx";
import Journal from "./pages/Journal.jsx";
import Stats from "./pages/Stats.jsx";
import Settings from "./pages/Settings.jsx";
import Learning from "./pages/Learning.jsx";
import Admin from "./pages/Admin.jsx";
import SessionStrip from "./components/SessionStrip.jsx";
import CloseSheet from "./components/CloseSheet.jsx";
import News from "./pages/News.jsx";
import { compressImage } from "./lib/image.js";
import { dueReminders, loadInbox, loadPrefs, markSent, notify, saveInbox, savePrefs, wasSent } from "./lib/reminders.js";

const DEFAULT_SETTINGS = { lot: 0.02, minRR: 2, maxTrades: 4, maxSL: 4, balance: 0, currency: "$",
  pairs: [{ pair: "XAUUSD", lot: 0.02 }, { pair: "EURUSD", lot: 0.2 }], rules: NO_RULE_EDITS, news: NO_NEWS };
const KEY_THEME = "atm_theme";

const ICONS = {
  checklist: <><path d="M9 11l3 3 8-8" /><path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9" /></>,
  today: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
  log: <path d="M4 6h16M4 12h16M4 18h10" />,
  stats: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
  news: <><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M3 10h18M8 3v4M16 3v4" /></>,
  learn: <><path d="M5 4h13a1 1 0 0 1 1 1v14H6a1 1 0 0 0-1 1z" /><path d="M5 4v16M9 8h6" /></>,
  admin: <><path d="M12 3l7 3v5c0 4.5-3 8.2-7 10-4-1.8-7-5.5-7-10V6z" /><path d="M9 12l2 2 4-4" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></>,
};
const TABS = [["checklist", "Check"], ["today", "Today"], ["log", "Journal"], ["stats", "Stats"], ["news", "News"], ["learn", "Learning"], ["settings", "Settings"]];
const ADMIN_TAB = ["admin", "Admin"];
const PAGE = {
  checklist: ["Pre-trade checklist", "Pass every rule before you enter"],
  today: ["Today", "Your trades and daily limits"],
  log: ["Journal", "Every trade you have logged"],
  stats: ["Statistics", "How your trading is performing"],
  news: ["News", "High-impact events that lock trading"],
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
  const [calendar, setCalendar] = useState(null); // the automatic news calendar, null until it has loaded
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

  // The automatic news calendar. A failed request keeps what was loaded before (the server also keeps its last good copy).
  const loadCalendar = useCallback(async () => {
    try {
      setCalendar(await api.getCalendar());
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) onLogout();
    }
  }, [onLogout]);
  useEffect(() => {
    if (status !== "ready") return undefined;
    loadCalendar();
    const id = setInterval(loadCalendar, 30 * 60000);
    return () => clearInterval(id);
  }, [status, loadCalendar]);

  // Time-based rules (sessions, the loss cooldown) re-check every 10s.
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 10000);
    return () => clearInterval(id);
  }, []);

  // Reminders: a session about to open, a trade open for too long. Each one is sent once.
  const [reminders, setReminders] = useState(loadPrefs);
  const changeReminders = (patch) => setReminders((p) => { const next = { ...p, ...patch }; savePrefs(next); return next; });
  const [inbox, setInbox] = useState(loadInbox);
  const [bellOpen, setBellOpen] = useState(false);
  const [bellTop, setBellTop] = useState(64);
  const openBell = (e) => { setBellTop(e.currentTarget.getBoundingClientRect().bottom + 8); setBellOpen(true); };
  const updateInbox = useCallback((fn) => setInbox((list) => { const next = fn(list); saveInbox(next); return next; }), []);
  useEffect(() => {
    if (status !== "ready") return;
    for (const r of dueReminders({ entries, settings, prefs: reminders, now })) {
      if (wasSent(r.key)) continue;
      markSent(r.key);
      say(r.title);
      updateInbox((list) => [{ key: r.key, title: r.title, body: r.body, ts: Date.now() }, ...list]);
      notify(r.title, r.body, r.key);
    }
  }, [now, status, entries, settings, reminders, say, updateInbox]);

  // Opening the bell shows what is waiting; closing it removes what was seen.
  const closeBell = useCallback(() => { setBellOpen(false); updateInbox(() => []); }, [updateInbox]);
  useEffect(() => {
    if (!bellOpen) return undefined;
    const onKey = (e) => { if (e.key === "Escape") closeBell(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [bellOpen, closeBell]);

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
  useEffect(() => {
    document.body.classList.toggle("noscroll", menu);
    // Logging out (or a 401) unmounts this screen with the menu open; don't leave the landing page locked.
    return () => document.body.classList.remove("noscroll");
  }, [menu]);

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

  // Screenshots are saved as soon as they are picked, so they are not lost if the sheet is closed without saving.
  const replaceEntry = (saved) => setEntries((list) => list.map((e) => (e.id === saved.id ? saved : e)));
  const uploadShot = async (id, slot, file) => {
    let blob;
    try {
      blob = await compressImage(file);
    } catch (err) {
      say(err.message);
      return false;
    }
    const saved = await attempt(() => api.putImage(id, slot, blob));
    if (saved) replaceEntry(saved);
    return !!saved;
  };
  const removeShot = async (id, slot) => {
    const saved = await attempt(() => api.deleteImage(id, slot));
    if (saved) replaceEntry(saved);
    return !!saved;
  };

  const deleteEntry = async (id) => {
    const ok = await confirmToast({ title: "Delete this trade?", text: "It will be removed from your journal.", okLabel: "Delete" });
    if (!ok) return;
    const done = await attempt(async () => { await api.deleteEntry(id); return true; });
    if (done) setEntries((list) => list.filter((e) => e.id !== id));
  };

  // The News tab saves its settings on every change.
  const saveNews = async (news) => {
    const saved = await attempt(() => api.putSettings({ ...settings, news }));
    if (saved) setSettings({ ...DEFAULT_SETTINGS, ...saved });
    return !!saved;
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

  const exportData = async () => {
    const blob = await attempt(() => api.exportData());
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "trade-guard-data.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    say("Your data was downloaded.");
  };

  const logoutEverywhere = async () => {
    const done = await attempt(async () => { await api.logoutAll(); return true; });
    if (done) onLogout();
  };

  const deleteAccount = async (password) => {
    const done = await attempt(async () => { await api.deleteAccount(password); return true; });
    if (done) onLogout();
    return !!done;
  };

  const ruleCount = activeRules(settings).length;
  const sheetEntry = sheet && entries.find((e) => e.id === sheet.id);
  const goto = (t) => { setTab(t); setMenu(false); window.scrollTo({ top: 0 }); };

  if (status === "loading") return <Loader />;

  if (status !== "ready") {
    return (
      <main className="auth tg-loader">
        <div className="card">
          <div className="banner">{loadError}</div>
          <div className="actions"><button className="btn primary" onClick={load}>Retry</button><button className="btn ghost" onClick={onLogout}>Log out</button></div>
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
          <div className="head-brand"><b>Trade Guard</b><small>Trade by the rules</small></div>
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
          <div className="bell-wrap">
            <button className={`icon-btn bell ${inbox.length && !bellOpen ? "has-new" : ""}`} type="button" aria-label={`Notifications${inbox.length ? `, ${inbox.length} new` : ""}`}
              aria-expanded={bellOpen} title="Notifications" onClick={(e) => (bellOpen ? closeBell() : openBell(e))}>
              <svg viewBox="0 0 24 24"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0" /></svg>
              {inbox.length > 0 && !bellOpen && <span className="bell-badge">{inbox.length > 9 ? "9+" : inbox.length}</span>}
            </button>
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
        <Checklist active={tab === "checklist"} entries={entries} settings={settings} calendar={calendar} now={now} onLog={logTrade} onProgress={setProgress} />
        <Today active={tab === "today"} entries={entries} settings={settings} onQuick={(id, preset) => setSheet({ id, preset })} />
        <Journal active={tab === "log"} entries={entries} settings={settings} onEdit={(id) => setSheet({ id, preset: null })}
          onDelete={deleteEntry} />
        <Stats active={tab === "stats"} entries={entries} settings={settings} />
        <News active={tab === "news"} settings={settings} calendar={calendar} now={now} onSave={saveNews} onRefresh={loadCalendar} />
        <Learning active={tab === "learn"} onExpired={onLogout} />
        <Settings active={tab === "settings"} settings={settings} reminders={reminders} onReminders={changeReminders} onSave={saveSettings} onClearAll={clearAll}
          entries={entries} onImport={importCsv} onDeleteAccount={deleteAccount} onLogoutAll={logoutEverywhere} onExport={exportData} isAdmin={session.isAdmin} />
        {session.isAdmin && <Admin active={tab === "admin"} confirm={confirmToast} say={say} onExpired={onLogout} />}
      </main>

      <div className={`scrim ${menu ? "show" : ""}`} onClick={() => setMenu(false)} />
      <nav id="tabs" className={`sidebar ${menu ? "open" : ""}`} aria-label="Main menu">
        <div className="side-brand">
          <img src="/icon.svg" alt="" />
          <div><b>Trade Guard</b><small>Trade by the rules</small></div>
        </div>
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
          onSave={saveEntry} onClose={() => setSheet(null)} onShotUpload={uploadShot} onShotRemove={removeShot} />
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

      {bellOpen && (
        <>
          <div className="bell-scrim" onClick={closeBell} />
          <div className="bell-panel" style={{ top: bellTop }} role="dialog" aria-label="Notifications">
            <div className="bell-head"><b>Notifications</b></div>
            {inbox.length === 0 ? (
              <p className="bell-empty">You’re all caught up.</p>
            ) : (
              <ul>
                {inbox.map((n) => (
                  <li key={n.key}>
                    <b>{n.title}</b>
                    <span>{n.body}</span>
                    <small>{new Date(n.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</small>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}

      {toast && <div className="toast">{toast}</div>}
    </>
  );
}
