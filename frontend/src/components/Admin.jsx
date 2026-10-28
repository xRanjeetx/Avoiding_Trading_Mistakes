import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { api, ApiError } from "../api.js";
import AdminCharts from "./AdminCharts.jsx";import { CardHead, Icon } from "./ui.jsx";

const TILES = [
  ["totalUsers", "Users"], ["verifiedUsers", "Verified"], ["activeLast7Days", "Active 7d"],
  ["newLast7Days", "New 7d"], ["disabledUsers", "Disabled"], ["totalEntries", "Entries"],
];

const day = (iso) => (iso ? new Date(iso + "Z").toLocaleDateString() : "—");

function Status({ u, showAdmin }) {
  return (
    <>
      {showAdmin && u.isAdmin && <span className="chip admin">Admin</span>}
      {!u.isActive ? <span className="chip bad">Disabled</span>
        : !u.emailVerified ? <span className="chip warn">Unverified</span>
        : <span className="chip good">Active</span>}
    </>
  );
}

// Admin-only page. Shows counts and win rate per user, never trade contents.
export default function Admin({ active, confirm, say, onExpired }) {
  const [overview, setOverview] = useState(null);
  const [users, setUsers] = useState([]);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [busy, setBusy] = useState(null); // `${id}:${action}`
  const [error, setError] = useState("");
  const [growth, setGrowth] = useState(null);
  const [days, setDays] = useState(30);
  const [openId, setOpenId] = useState(null);
  const [adding, setAdding] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const sel = users.find((u) => u.id === openId) || null;
  const drawerOpen = !!sel || adding;

  const guard = useCallback(async (fn) => {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) onExpired();
      else if (err instanceof ApiError) say(err.message);
      else say("Something went wrong.");
      return undefined;
    }
  }, [onExpired, say]);

  const load = useCallback(async () => {
    setError("");
    try {
      const [o, u, g] = await Promise.all([api.adminOverview(), api.adminUsers(q, page, pageSize), api.adminGrowth(days)]);
      setOverview(o);
      setUsers(u.items);
      setTotal(u.total);
      setPages(u.pages);
      setPage(u.page); // the server moves us back when the page no longer exists (e.g. after a delete)
      setGrowth(g.days);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) onExpired();
      else setError(err.message);
    }
  }, [q, page, pageSize, days, onExpired]);

  // Refresh when the tab opens and (debounced) when the search changes.
  useEffect(() => {
    if (!active) return undefined;
    const id = setTimeout(load, 250);
    return () => clearTimeout(id);
  }, [active, load]);

  useEffect(() => {
    if (!drawerOpen) return undefined;
    // Escape also closes the confirm dialog on top; leave the drawer open in that case.
    const onKey = (e) => e.key === "Escape" && !document.querySelector(".confirm-backdrop") && (setOpenId(null), setAdding(false));
    document.addEventListener("keydown", onKey);
    document.body.classList.add("noscroll");
    return () => { document.removeEventListener("keydown", onKey); document.body.classList.remove("noscroll"); };
  }, [drawerOpen]);

  const run = async (user, action, fn, doneMsg) => {
    setBusy(`${user.id}:${action}`);
    const ok = await guard(async () => { await fn(); return true; });
    setBusy(null);
    if (ok) { say(doneMsg); load(); }
  };

  const addUser = async (e) => {
    e.preventDefault();
    setBusy("add");
    const email = newEmail.trim();
    const ok = await guard(async () => { await api.adminCreateUser(email); return true; });
    setBusy(null);
    if (ok) {
      say(`Account created. A temporary password was emailed to ${email}.`);
      setAdding(false);
      setNewEmail("");
      load();
    }
  };

  const toggle = async (u) => {
    if (u.isActive) {
      const ok = await confirm({ title: "Disable this account?", text: `${u.email} will be signed out and cannot log in until you enable it again. Their data is kept.`, okLabel: "Disable" });
      if (!ok) return;
    }
    run(u, "active", () => api.adminSetActive(u.id, !u.isActive), u.isActive ? "Account disabled." : "Account enabled.");
  };
  const remove = async (u) => {
    const ok = await confirm({ title: "Delete this user?", text: `${u.email} and all of their trades will be erased. This cannot be undone.`, okLabel: "Delete user" });
    if (ok) { await run(u, "delete", () => api.adminDeleteUser(u.id), "User deleted."); setOpenId(null); }
  };

  return (
    <section id="admin" className={`tab ${active ? "active" : ""}`}>
      {error && <div className="banner">{error}</div>}

      <div className="admin-tiles">
        {TILES.map(([key, label]) => (
          <div className="stat" key={key}>
            <small>{label}</small>
            <span>{overview ? overview[key] : "…"}</span>
          </div>
        ))}
      </div>

      {growth && <AdminCharts data={growth} days={days} onDays={setDays} />}

      <div className="card">
        <CardHead icon="user" title="Users">
          <button type="button" className="btn ghost sm" onClick={() => setAdding(true)}><Icon name="plus" size={16} /> Add user</button>
          <label className="pager-size">
            <span className="muted">Rows</span>
            <select aria-label="Rows per page" value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}>
              {[10, 25, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <label className="admin-search">
            <Icon name="search" size={16} />
            <input type="search" placeholder="Search email" aria-label="Search users by email" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
          </label>
        </CardHead>
        <div className="admin-scroll">
          <table className="admin-table">
            <thead>
              <tr><th>Email</th><th>Status</th><th /></tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className={u.isActive ? "" : "off"}>
                  <td className="em">{u.email}</td>
                  <td><Status u={u} /></td>
                  <td className="acts">
                    <button type="button" className="btn ghost sm" onClick={() => setOpenId(u.id)}>Detail</button>
                  </td>
                </tr>
              ))}
              {overview && users.length === 0 && <tr><td colSpan="3" className="muted">No users found.</td></tr>}
            </tbody>
          </table>
        </div>
        {total > 0 && (
          <div className="pager">
            <span className="muted">{(page - 1) * pageSize + 1}–{(page - 1) * pageSize + users.length} of {total}</span>
            <div className="pager-ctl">
              <button type="button" className="btn ghost sm" disabled={page <= 1} aria-label="Previous page" onClick={() => setPage(page - 1)}>Prev</button>
              <span className="muted">Page {page} of {pages}</span>
              <button type="button" className="btn ghost sm" disabled={page >= pages} aria-label="Next page" onClick={() => setPage(page + 1)}>Next</button>
            </div>
          </div>
        )}
      </div>

      {adding && createPortal(
        <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="addUserTitle" onClick={(e) => e.target === e.currentTarget && setAdding(false)}>
          <form className="sheet-card" onSubmit={addUser}>
            <div className="sheet-grab" />
            <div className="card-head">
              <h2 id="addUserTitle" className="admin-sheet-title"><span className="admin-sheet-ico"><Icon name="user" size={18} /></span>Add user</h2>
              <button className="icon-btn small" type="button" aria-label="Close" onClick={() => setAdding(false)}><Icon name="x" size={18} /></button>
            </div>
            <label className="field"><span>Email</span>
              <input type="email" required autoFocus maxLength={254} placeholder="name@example.com" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
            </label>
            <div className="admin-sheet-actions">
              <button type="submit" className="btn" disabled={busy === "add"}><Icon name="mail" size={18} /> {busy === "add" ? "Creating…" : "Create and email password"}</button>
            </div>
          </form>
        </div>,
        document.body
      )}

      {sel && createPortal(
        <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="adminSheetTitle" onClick={(e) => e.target === e.currentTarget && setOpenId(null)}>
          <div className="sheet-card">
            <div className="sheet-grab" />
            <div className="card-head">
              <h2 id="adminSheetTitle" className="admin-sheet-title"><span className="admin-sheet-ico"><Icon name="user" size={18} /></span>User details</h2>
              <button className="icon-btn small" type="button" aria-label="Close" onClick={() => setOpenId(null)}><Icon name="x" size={18} /></button>
            </div>
            <p className="admin-sheet-email">{sel.email}</p>
            <div className="admin-sheet-status"><Status u={sel} showAdmin /></div>

            <div className="admin-kv">
              <div><small>Joined</small><b>{day(sel.createdAt)}</b></div>
              <div><small>Email</small><b>{sel.emailVerified ? "Verified" : "Not verified"}</b></div>
              <div><small>Trades</small><b>{sel.entries}</b></div>
              <div><small>Closed</small><b>{sel.closedTrades}</b></div>
              <div><small>Win rate</small><b>{sel.winRate == null ? "—" : `${sel.winRate}%`}</b></div>
            </div>

            {sel.isAdmin ? (
              <p className="muted">Admin accounts can't be changed from here.</p>
            ) : (
              <div className="admin-sheet-actions">
                {!sel.emailVerified && (
                  <button type="button" className="btn ghost" disabled={!!busy} onClick={() => run(sel, "verify", () => api.adminVerify(sel.id), "Email marked verified.")}><Icon name="shield" size={18} /> Mark verified</button>
                )}
                <button type="button" className="btn ghost" disabled={!!busy} onClick={() => run(sel, "reset", () => api.adminSendReset(sel.id), "Password reset email sent.")}><Icon name="mail" size={18} /> Send password reset</button>
                <button type="button" className="btn ghost" disabled={!!busy} onClick={() => toggle(sel)}>
                  <Icon name={sel.isActive ? "ban" : "check"} size={18} /> {sel.isActive ? "Disable account" : "Enable account"}
                </button>
                <button type="button" className="btn danger-outline" disabled={!!busy} onClick={() => remove(sel)}><Icon name="trash" size={18} /> Delete user</button>
              </div>
            )}
          </div>
        </div>,
        document.body
      )}
    </section>
  );
}
